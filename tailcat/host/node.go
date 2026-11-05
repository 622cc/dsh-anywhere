// Adapted from voxt-mobile tools/tailcat-host (https://github.com/jt-wang/voxt-mobile),
// Copyright the Voxt Mobile authors, Apache-2.0. See tailcat/NOTICE.

package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"strconv"
	"sync"

	"github.com/tailscale/tailcat"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
	"tailscale.com/wgengine/filter"
)

const (
	stateVersion = 1
	virtualPort  = 48931
	pairingPort  = 48932
)

// Fixed error vocabulary. Events never carry free text, input echoes or key material.
const (
	errRequest   = "invalid-request"
	errVersion   = "invalid-version"
	errAllowlist = "invalid-allowlist"
	errClientKey = "invalid-client-key"
	errPort      = "invalid-port"
	errState     = "invalid-state"
	errCommand   = "invalid-command"
	errStart     = "start-failed"
	errBusy      = "busy"
	errOperation = "operation-failed"
)

// Spec is the Tailcat server a starter must bring up. Region is nil only for a fresh node.
type Spec struct {
	Port    uint16 // Zero means the normal forwarding port.
	Key     key.NodePrivate
	PSK     tailcat.PresharedKey
	Region  *tailcfg.DERPRegion
	Allowed []key.NodePublic
	OnTCP   func(uint16) func(net.Conn)
}

// Running is an owned Tailcat server. Address is the tailcat address clients dial.
type Running interface {
	Address() string
	Region() *tailcfg.DERPRegion
	Close() error
}

// Starter brings up a Running node. Tests replace it; nil means the real Tailcat server.
type Starter func(context.Context, Spec) (Running, error)

type persisted struct {
	Version      int             `json:"version"`
	PrivateKey   string          `json:"privateKey"`
	PresharedKey string          `json:"presharedKey"`
	Region       json.RawMessage `json:"region"`
}

func parseAllowlist(texts []string) ([]key.NodePublic, string) {
	out := make([]key.NodePublic, 0, len(texts))
	seen := make(map[string]struct{}, len(texts))
	for _, text := range texts {
		var pub key.NodePublic
		if err := pub.UnmarshalText([]byte(text)); err != nil || pub.IsZero() {
			return nil, errClientKey
		}
		if _, exists := seen[pub.String()]; exists {
			return nil, errAllowlist
		}
		seen[pub.String()] = struct{}{}
		out = append(out, pub)
	}
	return out, ""
}

// parseState reads the opaque persisted string. JSON null or "" means a fresh identity.
func parseState(raw json.RawMessage) (key.NodePrivate, tailcat.PresharedKey, *tailcfg.DERPRegion, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return key.NodePrivate{}, tailcat.PresharedKey{}, nil, ""
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil || text == "" {
		return key.NodePrivate{}, tailcat.PresharedKey{}, nil, errState
	}
	var doc persisted
	if json.Unmarshal([]byte(text), &doc) != nil || doc.Version != stateVersion {
		return key.NodePrivate{}, tailcat.PresharedKey{}, nil, errState
	}
	var private key.NodePrivate
	if private.UnmarshalText([]byte(doc.PrivateKey)) != nil || private.IsZero() {
		return key.NodePrivate{}, tailcat.PresharedKey{}, nil, errState
	}
	var psk tailcat.PresharedKey
	if psk.UnmarshalText([]byte(doc.PresharedKey)) != nil || psk.IsZero() {
		return key.NodePrivate{}, tailcat.PresharedKey{}, nil, errState
	}
	var region tailcfg.DERPRegion
	if len(doc.Region) == 0 || string(doc.Region) == "null" || json.Unmarshal(doc.Region, &region) != nil || region.RegionID == 0 {
		return key.NodePrivate{}, tailcat.PresharedKey{}, nil, errState
	}
	return private, psk, &region, ""
}

func marshalState(private key.NodePrivate, psk tailcat.PresharedKey, region *tailcfg.DERPRegion) (string, error) {
	if region == nil {
		return "", errors.New(errState)
	}
	privText, err := private.MarshalText()
	if err != nil {
		return "", err
	}
	pskText, err := psk.MarshalText()
	if err != nil {
		return "", err
	}
	regionText, err := json.Marshal(region)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(persisted{
		Version: stateVersion, PrivateKey: string(privText), PresharedKey: string(pskText), Region: regionText,
	})
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// serveVirtual exposes only the normal virtual port, forwarding it to the loopback companion.
func serveVirtual(localPort int, conns *liveConns) func(uint16) func(net.Conn) {
	return func(port uint16) func(net.Conn) {
		if port != virtualPort {
			return nil
		}
		return func(client net.Conn) { proxyLoopback(client, localPort, conns) }
	}
}

func proxyLoopback(client net.Conn, localPort int, conns *liveConns) {
	defer client.Close()
	remote, err := conns.dial(localPort)
	if err != nil {
		return
	}
	defer conns.done(remote)
	var wg sync.WaitGroup
	wg.Add(2)
	pipe := func(dst, src net.Conn) {
		defer wg.Done()
		_, _ = io.Copy(dst, src)
		_ = dst.Close()
	}
	go pipe(remote, client)
	go pipe(client, remote)
	wg.Wait()
}

// liveConns owns every loopback connection of one node so closing the node cuts them all.
type liveConns struct {
	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex
	items  map[net.Conn]struct{}
	once   sync.Once
}

func newLiveConns(parent context.Context) (*liveConns, context.Context) {
	ctx, cancel := context.WithCancel(parent)
	return &liveConns{ctx: ctx, cancel: cancel, items: map[net.Conn]struct{}{}}, ctx
}

func (l *liveConns) dial(port int) (net.Conn, error) {
	conn, err := (&net.Dialer{}).DialContext(l.ctx, "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return nil, err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.ctx.Err() != nil {
		_ = conn.Close()
		return nil, l.ctx.Err()
	}
	l.items[conn] = struct{}{}
	return conn, nil
}

func (l *liveConns) done(conn net.Conn) {
	_ = conn.Close()
	l.mu.Lock()
	delete(l.items, conn)
	l.mu.Unlock()
}

func (l *liveConns) close() {
	l.once.Do(func() {
		l.cancel()
		l.mu.Lock()
		defer l.mu.Unlock()
		for conn := range l.items {
			_ = conn.Close()
		}
	})
}

type tailServer struct {
	server *tailcat.Server
	region *tailcfg.DERPRegion
	addr   string
}

func (s *tailServer) Address() string             { return s.addr }
func (s *tailServer) Region() *tailcfg.DERPRegion { return s.region }
func (s *tailServer) Close() error                { return s.server.Close() }

func realStart(ctx context.Context, spec Spec) (Running, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	// Tailcat admits every client when AllowedClients is empty; never start a node in that state.
	if len(spec.Allowed) == 0 {
		return nil, errors.New(errAllowlist)
	}
	port := spec.Port
	if port == 0 {
		port = virtualPort
	}
	server := &tailcat.Server{
		Key:            spec.Key,
		PresharedKey:   spec.PSK,
		Region:         spec.Region,
		AllowedClients: spec.Allowed,
		Logf:           func(string, ...any) {},
		OnTCP:          spec.OnTCP,
		ServedTCPPorts: []filter.PortRange{{First: port, Last: port}},
	}
	errc := make(chan error, 1)
	go func() { errc <- server.Start() }()
	select {
	case <-ctx.Done():
		go func() {
			if err := <-errc; err == nil {
				_ = server.Close()
			}
		}()
		return nil, ctx.Err()
	case err := <-errc:
		if err != nil {
			return nil, err
		}
		if ctx.Err() != nil {
			_ = server.Close()
			return nil, ctx.Err()
		}
		info, err := tailcat.ParseAddr(server.TailcatAddr())
		if err != nil || len(info.Region) != 1 || info.Region[0] == nil || info.Region[0].RegionID == 0 {
			_ = server.Close()
			return nil, errors.New(errStart)
		}
		return &tailServer{server: server, region: info.Region[0], addr: string(server.TailcatAddr())}, nil
	}
}
