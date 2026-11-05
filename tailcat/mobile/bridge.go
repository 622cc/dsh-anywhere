// Adapted from voxt-mobile ios/VoxtTailcat/Native (https://github.com/jt-wang/voxt-mobile),
// Copyright the Voxt Mobile authors, Apache-2.0. See tailcat/NOTICE.

// Package dshtailcat is the Android (gomobile) side of the DSH Anywhere Tailcat transport.
// Contract: docs/TAILCAT.md ("Go mobile API"). Every function returns a value; nothing
// panics or throws across the language boundary, and no error echoes input or key material.
package dshtailcat

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/tailscale/tailcat"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
)

var errInvalid = errors.New("invalid")

// NewClientKey returns a fresh node private key ("privkey:…").
func NewClientKey() string {
	text, err := key.NewNode().MarshalText()
	if err != nil {
		return ""
	}
	return string(text)
}

// PublicKey returns the node public key ("nodekey:…") for private, or "" if private is invalid.
func PublicKey(private string) string {
	priv, err := parseClientKey(private)
	if err != nil {
		return ""
	}
	text, err := priv.Public().MarshalText()
	if err != nil {
		return ""
	}
	return string(text)
}

// Start opens a loopback forward whose connections are dialed to remotePort on the Tailcat
// server at address, authenticating as clientKey. Returns {"handle":n,"port":p} or {"error":code}.
func Start(address, clientKey string, remotePort int) string {
	if !validAddress(address) {
		return `{"error":"invalid-address"}`
	}
	private, err := parseClientKey(clientKey)
	if err != nil {
		return `{"error":"invalid-client-key"}`
	}
	if remotePort < 1 || remotePort > 65535 {
		return `{"error":"invalid-port"}`
	}
	opened := newSessionDial(address, private, remotePort)
	session := &bridgeSession{closeFn: opened.close, route: opened.route, relay: opened.relay, ping: opened.ping}
	fwd, err := openForward(opened.dial)
	if err != nil {
		session.close()
		return `{"error":"bind-failed"}`
	}
	session.forward = fwd
	port, err := loopbackPort(fwd)
	if err != nil {
		session.close()
		return `{"error":"bind-failed"}`
	}
	handle := register(session)
	body, err := json.Marshal(struct {
		Handle int64 `json:"handle"`
		Port   int   `json:"port"`
	}{handle, port})
	if err != nil {
		Stop(handle)
		return `{"error":"start-failed"}`
	}
	return string(body)
}

// Stop closes the forward and its Tailcat client. Unknown or repeated handles are no-ops.
func Stop(handle int64) int {
	registryMu.Lock()
	session := sessions[handle]
	delete(sessions, handle)
	registryMu.Unlock()
	session.close()
	return 0
}

// Path reports how the session reaches the server: {"route":"direct"}, {"route":"relay","relay":code}, or
// {"error":code}. It waits up to three seconds for the server's answer; addresses never leave the bridge.
func Path(handle int64) string {
	registryMu.Lock()
	session := sessions[handle]
	registryMu.Unlock()
	if session == nil || session.route == nil {
		return `{"error":"unknown-handle"}`
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	route, relay, err := session.route(ctx)
	if err != nil || (route != "direct" && route != "relay") {
		return `{"error":"unreachable"}`
	}
	body, err := json.Marshal(struct {
		Route string `json:"route"`
		Relay string `json:"relay,omitempty"`
	}{route, relay})
	if err != nil {
		return `{"error":"unreachable"}`
	}
	return string(body)
}

// Diagnose reports which part answers, for telling the person why the computer can't be reached:
// {"relay":"reachable"|"unreachable","computer":"reachable"|"unreachable","latencyMs":n} (latency only with an answer),
// or {"error":code}. It takes at most eight seconds; addresses never leave the bridge.
func Diagnose(handle int64) string {
	registryMu.Lock()
	session := sessions[handle]
	registryMu.Unlock()
	if session == nil || session.relay == nil || session.ping == nil {
		return `{"error":"unknown-handle"}`
	}
	ctx, cancel := context.WithTimeout(context.Background(), diagnoseLimit)
	defer cancel()
	relayed := make(chan error, 1)
	go func() { relayed <- session.relay(ctx) }()
	type answer struct {
		latency time.Duration
		err     error
	}
	pinged := make(chan answer, 1)
	go func() {
		latency, err := session.ping(ctx)
		pinged <- answer{latency, err}
	}()
	out := struct {
		Relay     string `json:"relay"`
		Computer  string `json:"computer"`
		LatencyMs *int64 `json:"latencyMs,omitempty"`
	}{"unreachable", "unreachable", nil}
	// Both end by the limit, so each answer is read whole: a silent computer uses up the limit, and a select against
	// ctx.Done() would then pick at random between that and the relay's answer.
	if a := <-pinged; a.err == nil {
		ms := a.latency.Milliseconds()
		out.Relay, out.Computer, out.LatencyMs = "reachable", "reachable", &ms
	} else if err := <-relayed; err == nil {
		out.Relay = "reachable"
	}
	body, err := json.Marshal(out)
	if err != nil {
		return `{"error":"unreachable"}`
	}
	return string(body)
}

func validAddress(address string) bool {
	if address == "" || len(address) > 8192 {
		return false
	}
	info, err := tailcat.ParseAddr(tailcat.Addr(address))
	if err != nil {
		return false
	}
	return !info.ServerPublic.IsZero() && !info.ServerDiscoPublic.IsZero()
}

func parseClientKey(text string) (key.NodePrivate, error) {
	var private key.NodePrivate
	if err := private.UnmarshalText([]byte(text)); err != nil {
		return key.NodePrivate{}, err
	}
	if private.IsZero() {
		return key.NodePrivate{}, errInvalid
	}
	return private, nil
}

func loopbackPort(f *forward) (int, error) {
	host, portText, err := net.SplitHostPort(f.addr())
	if err != nil || host != "127.0.0.1" {
		return 0, errInvalid
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return 0, errInvalid
	}
	return port, nil
}

type sessionDial struct {
	dial  func(context.Context) (net.Conn, error)
	close func()
	// route asks how packets reach the server now: "direct", or "relay" and the relay's region code.
	route func(context.Context) (string, string, error)
	// relay says whether this network lets the phone reach a relay of the server's region.
	relay func(context.Context) error
	// ping asks the computer itself, through a relay. A computer that is off and one that no longer allows this
	// phone look the same here: Tailcat gives a client it does not allow no reply.
	ping func(context.Context) (time.Duration, error)
}

func realSessionDial(address string, clientKey key.NodePrivate, remotePort int) sessionDial {
	client := &tailcat.Client{Server: tailcat.Addr(address), Key: clientKey, Logf: func(string, ...any) {}}
	port := uint16(remotePort)
	return sessionDial{
		dial:  func(ctx context.Context) (net.Conn, error) { return client.DialTCPPort(ctx, port) },
		close: func() { _ = client.Close() },
		// A disco ping's pong says whether it came over a direct path (Endpoint) or a relay (DERPRegionCode);
		// it also nudges the client to find a direct path (tailcat v0.6.0 Client.DiscoPing).
		route: func(ctx context.Context) (string, string, error) {
			res, err := client.DiscoPing(ctx)
			if err != nil {
				return "", "", err
			}
			if res.Err != "" {
				return "", "", errInvalid
			}
			if res.Endpoint != "" {
				return "direct", "", nil
			}
			return "relay", res.DERPRegionCode, nil
		},
		relay: func(ctx context.Context) error {
			info, err := tailcat.ParseAddr(tailcat.Addr(address))
			if err != nil {
				return err
			}
			if err := info.Expand(ctx); err != nil {
				return err
			}
			return probeRelay(ctx, relayNodes(info.Region), false)
		},
		ping: func(ctx context.Context) (time.Duration, error) {
			res, err := client.Ping(ctx)
			return res.Latency, err
		},
	}
}

type relayNode struct{ host, dial, port string }

func relayNodes(regions []*tailcfg.DERPRegion) []relayNode {
	var nodes []relayNode
	for _, region := range regions {
		for _, node := range region.Nodes {
			dial := node.IPv4
			if dial == "" || dial == "none" {
				dial = node.HostName
			}
			port := node.DERPPort
			if port == 0 {
				port = 443
			}
			nodes = append(nodes, relayNode{host: node.HostName, dial: dial, port: strconv.Itoa(port)})
		}
	}
	return nodes
}

// probeRelay finishes a TLS handshake with one of the nodes: a network that blocks them refuses, stays silent or
// answers as something else. Nothing is sent after the handshake. skipVerify is for tests' own certificates.
func probeRelay(ctx context.Context, nodes []relayNode, skipVerify bool) error {
	last := error(errInvalid)
	for _, node := range nodes {
		dialer := tls.Dialer{Config: &tls.Config{ServerName: node.host, InsecureSkipVerify: skipVerify, MinVersion: tls.VersionTLS12}}
		conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(node.dial, node.port))
		if err == nil {
			_ = conn.Close()
			return nil
		}
		last = err
	}
	return last
}

// Test seams.
var (
	diagnoseLimit  = 8 * time.Second
	newSessionDial = realSessionDial
	openForward    = startForward
)

type bridgeSession struct {
	forward *forward
	closeFn func()
	route   func(context.Context) (string, string, error)
	relay   func(context.Context) error
	ping    func(context.Context) (time.Duration, error)
	once    sync.Once
}

func (s *bridgeSession) close() {
	if s == nil {
		return
	}
	s.once.Do(func() {
		if s.forward != nil {
			s.forward.close()
		}
		if s.closeFn != nil {
			s.closeFn()
		}
	})
}

var (
	registryMu sync.Mutex
	nextHandle int64 = 1
	sessions         = map[int64]*bridgeSession{}
)

func register(session *bridgeSession) int64 {
	registryMu.Lock()
	defer registryMu.Unlock()
	handle := nextHandle
	nextHandle++
	sessions[handle] = session
	return handle
}
