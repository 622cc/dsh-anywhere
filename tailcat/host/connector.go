// Adapted from voxt-mobile tools/tailcat-host (https://github.com/jt-wang/voxt-mobile),
// Copyright the Voxt Mobile authors, Apache-2.0. See tailcat/NOTICE.

package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"

	"github.com/tailscale/tailcat"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
)

const (
	protoVersion   = 3
	lineLimit      = 64 * 1024
	pairingWindow  = 120 * time.Second
	persistTimeout = 10 * time.Second
	nameLimit      = 64
	maxAllowed     = 256
)

type config struct {
	Version        int             `json:"version"`
	LocalPort      int             `json:"localPort"`
	State          json.RawMessage `json:"state"`
	AllowedClients []string        `json:"allowedClients"`
	Name           string          `json:"name"`
}

type command struct {
	Command        string   `json:"command"`
	ID             string   `json:"id"`
	OK             bool     `json:"ok"`
	AllowedClients []string `json:"allowedClients"`
	Invitation     string   `json:"invitation"`
}

// Option supplies test seams. A nil Start uses the real Tailcat server; nil Signals
// installs SIGTERM/SIGINT handling.
type Option struct {
	Start   Starter
	Signals <-chan os.Signal
}

type runtime struct {
	ctx                      context.Context
	cfg                      config
	start                    Starter
	out                      io.Writer
	writeMu, opMu, pendingMu sync.Mutex
	pending                  map[string]chan bool
	serial                   uint64
	private                  key.NodePrivate
	psk                      tailcat.PresharedKey
	region                   *tailcfg.DERPRegion
	allowed                  []string
	normal                   Running
	normalConns              *liveConns
	pairing                  *pairingNode
}

type pairingNode struct {
	node     Running
	listener *connectionListener
	server   *http.Server
	cancel   context.CancelFunc
	once     sync.Once
}

func (p *pairingNode) close() {
	p.once.Do(func() {
		p.cancel()
		if p.server != nil {
			_ = p.server.Close()
		}
		p.listener.close()
		if p.node != nil {
			_ = p.node.Close()
		}
	})
}

// Run reads one configuration line, then commands, until stdin closes or a signal arrives.
// stdout is private typed IPC; nothing is written to logs.
func Run(in io.Reader, out io.Writer, opt Option) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 4096), lineLimit)
	emitFixed := func(code string) error {
		_, _ = io.WriteString(out, `{"event":"error","code":"`+code+"\"}\n")
		return errors.New(code)
	}
	if !scanner.Scan() {
		return emitFixed(errRequest)
	}
	var cfg config
	if json.Unmarshal(scanner.Bytes(), &cfg) != nil {
		return emitFixed(errRequest)
	}
	if cfg.Version != protoVersion {
		return emitFixed(errVersion)
	}
	if cfg.LocalPort < 1024 || cfg.LocalPort > 65534 {
		return emitFixed(errPort)
	}
	if len(cfg.AllowedClients) > maxAllowed {
		return emitFixed(errAllowlist)
	}
	if _, code := parseAllowlist(cfg.AllowedClients); code != "" {
		return emitFixed(code)
	}
	private, psk, region, code := parseState(cfg.State)
	if code != "" {
		return emitFixed(code)
	}
	if private.IsZero() {
		private, psk = key.NewNode(), tailcat.NewPresharedKey()
	}
	cfg.Name = cleanName(cfg.Name)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	start := opt.Start
	if start == nil {
		start = realStart
	}
	r := &runtime{ctx: ctx, cfg: cfg, start: start, out: out, pending: map[string]chan bool{},
		private: private, psk: psk, region: region, allowed: append([]string(nil), cfg.AllowedClients...)}
	signals := opt.Signals
	if signals == nil {
		ch := make(chan os.Signal, 1)
		signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT)
		defer signal.Stop(ch)
		signals = ch
	}
	commands := make(chan command)
	go func() {
		defer close(commands)
		for scanner.Scan() {
			var cmd command
			if json.Unmarshal(scanner.Bytes(), &cmd) != nil {
				cancel()
				return
			}
			select {
			case commands <- cmd:
			case <-ctx.Done():
				return
			}
		}
	}()
	var operations sync.WaitGroup
	tasks := make(chan func() error, 16)
	operations.Add(1)
	go func() {
		defer operations.Done()
		for {
			select {
			case <-ctx.Done():
				return
			case fn := <-tasks:
				r.opMu.Lock()
				if ctx.Err() == nil {
					if err := fn(); err != nil {
						_ = r.emit(map[string]any{"event": "error", "code": errOperation})
					}
				}
				r.opMu.Unlock()
			}
		}
	}()
	launch := func(fn func() error) {
		select {
		case tasks <- fn:
		default:
			_ = r.emit(map[string]any{"event": "error", "code": errBusy})
		}
	}
	launch(func() error {
		if len(r.allowed) > 0 {
			if err := r.replaceNormal(ctx, r.allowed); err != nil {
				return err
			}
		}
		return r.emit(map[string]any{"event": "ready", "address": r.normalAddress()})
	})
	defer func() {
		cancel()
		operations.Wait()
		r.opMu.Lock()
		defer r.opMu.Unlock()
		if r.pairing != nil {
			r.pairing.close()
		}
		r.stopNormal()
	}()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-signals:
			return nil
		case cmd, ok := <-commands:
			if !ok {
				return nil
			}
			switch cmd.Command {
			case "ack":
				r.pendingMu.Lock()
				ch := r.pending[cmd.ID]
				r.pendingMu.Unlock()
				if ch != nil {
					select {
					case ch <- cmd.OK:
					default:
					}
				}
			case "pair":
				invitation := cmd.Invitation
				launch(func() error { return r.beginPairing(invitation) })
			case "cancelPairing":
				launch(func() error {
					if r.pairing != nil {
						r.pairing.close()
						r.pairing = nil
					}
					return r.emit(map[string]any{"event": "pairingClosed"})
				})
			case "setAllowed":
				keys := append([]string{}, cmd.AllowedClients...)
				if len(keys) > maxAllowed {
					_ = r.emit(map[string]any{"event": "error", "code": errAllowlist})
					continue
				}
				if _, code := parseAllowlist(keys); code != "" {
					_ = r.emit(map[string]any{"event": "error", "code": code})
					continue
				}
				launch(func() error {
					if err := r.replaceNormal(ctx, keys); err != nil {
						return err
					}
					return r.emit(map[string]any{"event": "ready", "address": r.normalAddress()})
				})
			default:
				_ = r.emit(map[string]any{"event": "error", "code": errCommand})
			}
		}
	}
}

func cleanName(name string) string {
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.TrimSpace(name))
	if runes := []rune(name); len(runes) > nameLimit {
		name = string(runes[:nameLimit])
	}
	return name
}

func (r *runtime) emit(v any) error {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	return json.NewEncoder(r.out).Encode(v)
}

func (r *runtime) normalAddress() string {
	if r.normal == nil {
		return ""
	}
	return r.normal.Address()
}

func (r *runtime) stopNormal() {
	if r.normalConns != nil {
		r.normalConns.close()
		r.normalConns = nil
	}
	if r.normal != nil {
		_ = r.normal.Close()
		r.normal = nil
	}
}

func (r *runtime) startNormal(keys []string) error {
	allowed, code := parseAllowlist(keys)
	if code != "" {
		return errors.New(code)
	}
	conns, ctx := newLiveConns(r.ctx)
	node, err := r.start(ctx, Spec{Key: r.private, PSK: r.psk, Region: r.region, Allowed: allowed, OnTCP: serveVirtual(r.cfg.LocalPort, conns)})
	if err != nil {
		conns.close()
		return err
	}
	if node.Region() == nil || node.Region().RegionID == 0 || !strings.HasPrefix(node.Address(), "tc") {
		_ = node.Close()
		conns.close()
		return errors.New(errStart)
	}
	r.normal, r.normalConns, r.region = node, conns, node.Region()
	return nil
}

// persist asks the host to store state and allowlist, and waits for its ack.
func (r *runtime) persist(ctx context.Context, keys []string) error {
	var state any // JSON null until a node has chosen a region; nothing secret to restore yet.
	if r.region != nil {
		text, err := marshalState(r.private, r.psk, r.region)
		if err != nil {
			return err
		}
		state = text
	}
	r.serial++
	id := strconv.FormatUint(r.serial, 10)
	ch := make(chan bool, 1)
	r.pendingMu.Lock()
	r.pending[id] = ch
	r.pendingMu.Unlock()
	defer func() {
		r.pendingMu.Lock()
		delete(r.pending, id)
		r.pendingMu.Unlock()
	}()
	if keys == nil {
		keys = []string{}
	}
	if err := r.emit(map[string]any{"event": "persist", "id": id, "state": state, "allowedClients": keys}); err != nil {
		return err
	}
	timer := time.NewTimer(persistTimeout)
	defer timer.Stop()
	select {
	case ok := <-ch:
		if ok {
			return nil
		}
		return errors.New("persistence-rejected")
	case <-ctx.Done():
		return ctx.Err()
	case <-r.ctx.Done():
		return r.ctx.Err()
	case <-timer.C:
		return errors.New("persistence-timeout")
	}
}

// replaceNormal restarts the normal node with keys (an empty list stops it), persists, and
// rolls back to the previous allowlist if starting or persisting fails.
func (r *runtime) replaceNormal(ctx context.Context, keys []string) error {
	previous := append([]string(nil), r.allowed...)
	had := r.normal != nil
	r.stopNormal()
	var err error
	if len(keys) > 0 {
		err = r.startNormal(keys)
	}
	if err == nil {
		err = r.persist(ctx, keys)
	}
	if err != nil {
		r.stopNormal()
		if had && len(previous) > 0 {
			_ = r.startNormal(previous)
		}
		return err
	}
	r.allowed = append([]string(nil), keys...)
	return nil
}

func (r *runtime) beginPairing(invitation string) error {
	if r.pairing != nil {
		r.pairing.close()
		r.pairing = nil
	}
	client, serverKey, psk := key.NewNode(), key.NewNode(), tailcat.NewPresharedKey()
	proofBytes := make([]byte, 32)
	if _, err := rand.Read(proofBytes); err != nil {
		return err
	}
	proof := base64.RawURLEncoding.EncodeToString(proofBytes)
	expires := time.Now().Add(pairingWindow)
	ctx, cancel := context.WithDeadline(r.ctx, expires)
	listener := newConnectionListener()
	p := &pairingNode{listener: listener, cancel: cancel}
	handler := newPairingHandler(proof, expires, time.Now, r.cfg.Name, func(requestCtx context.Context, phone string) (string, error) {
		r.opMu.Lock()
		defer r.opMu.Unlock()
		if r.pairing != p || ctx.Err() != nil {
			return "", errors.New("session-expired")
		}
		keys := append([]string(nil), r.allowed...)
		found := false
		for _, k := range keys {
			if k == phone {
				found = true
			}
		}
		if !found {
			if len(keys) >= maxAllowed {
				return "", errors.New(errAllowlist)
			}
			keys = append(keys, phone)
		}
		if r.normal == nil || !found {
			if err := r.replaceNormal(requestCtx, keys); err != nil {
				return "", err
			}
		}
		if requestCtx.Err() != nil || ctx.Err() != nil {
			return "", errors.New("session-expired")
		}
		if err := r.emit(map[string]any{"event": "paired", "address": r.normalAddress(), "client": phone}); err != nil {
			return "", err
		}
		return r.normalAddress(), nil
	})
	handler.invitation = func(address, client string) string {
		return strings.ReplaceAll(strings.ReplaceAll(invitation, "$TAILCAT_ADDRESS", address), "$PHONE_KEY", client)
	}
	node, err := r.start(ctx, Spec{Port: pairingPort, Key: serverKey, PSK: psk, Allowed: []key.NodePublic{client.Public()},
		OnTCP: func(port uint16) func(net.Conn) {
			if port != pairingPort {
				return nil
			}
			return func(conn net.Conn) { listener.offer(conn) }
		}})
	if err != nil {
		cancel()
		listener.close()
		return err
	}
	if !strings.HasPrefix(node.Address(), "tc") {
		_ = node.Close()
		cancel()
		listener.close()
		return errors.New(errStart)
	}
	p.node = node
	r.pairing = p
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	p.server = server
	go func() { _ = server.Serve(&pairingListener{listener}) }()
	go func() { <-ctx.Done(); p.close() }()
	rawKey, err := client.MarshalText()
	if err != nil {
		return err
	}
	return r.emit(map[string]any{"event": "pairing", "address": node.Address(), "port": pairingPort,
		"key": string(rawKey), "proof": proof, "expiresAt": expires.Unix()})
}
