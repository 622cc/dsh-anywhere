// Adapted from voxt-mobile tools/tailcat-host (https://github.com/jt-wang/voxt-mobile),
// Copyright the Voxt Mobile authors, Apache-2.0. See tailcat/NOTICE.

package main

import (
	"bufio"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"tailscale.com/types/key"
)

const (
	pairingLineLimit = 4096
	pairingReadLimit = 5 * time.Second
)

// pairingReply is the success or failure line sent back to the phone.
type pairingReply struct {
	V       int    `json:"v"`
	Address string `json:"address,omitempty"`
	Port    int    `json:"port,omitempty"`
	Name    string `json:"name,omitempty"`
	Error   string `json:"error,omitempty"`
}

// Pairing failures, a fixed vocabulary.
const (
	pairUnauthorized = "unauthorized"
	pairExpired      = "expired"
	pairConflict     = "conflict"
	pairUnavailable  = "unavailable"
	pairInvalid      = "invalid"
)

// authorizeFunc adds the phone to the normal node and returns the normal node's address.
type authorizeFunc func(ctx context.Context, phone string) (address string, err error)

// pairingHandler serves one pairing window: one phone key, idempotent for that key.
type pairingHandler struct {
	mu             sync.Mutex
	proof          string
	expires        time.Time
	now            func() time.Time
	name           string
	authorize      authorizeFunc
	bound          string
	address        string
	invitation     func(address, client string) string
	invitationText string
}

func newPairingHandler(proof string, expires time.Time, now func() time.Time, name string, authorize authorizeFunc) *pairingHandler {
	return &pairingHandler{proof: proof, expires: expires, now: now, name: name, authorize: authorize}
}

// ServeConn answers exactly one request line on conn, then closes it.
func (h *pairingHandler) ServeConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(pairingReadLimit + 15*time.Second))
	_ = conn.SetReadDeadline(time.Now().Add(pairingReadLimit))
	reply := h.handle(ctx, readLine(conn))
	body, err := json.Marshal(reply)
	if err != nil {
		return
	}
	_, _ = conn.Write(append(body, '\n'))
}

func readLine(conn net.Conn) []byte {
	reader := bufio.NewReaderSize(conn, pairingLineLimit+1)
	line, err := reader.ReadSlice('\n')
	if err != nil || len(line) > pairingLineLimit {
		return nil
	}
	return line
}

func (h *pairingHandler) handle(ctx context.Context, line []byte) pairingReply {
	fail := func(code string) pairingReply { return pairingReply{V: 1, Error: code} }
	if line == nil {
		return fail(pairInvalid)
	}
	var req struct {
		V        int    `json:"v"`
		Proof    string `json:"proof"`
		PhoneKey string `json:"phoneKey"`
	}
	if json.Unmarshal(line, &req) != nil || req.V != 1 {
		return fail(pairInvalid)
	}
	if subtle.ConstantTimeCompare([]byte(req.Proof), []byte(h.proof)) != 1 {
		return fail(pairUnauthorized)
	}
	var pub key.NodePublic
	if pub.UnmarshalText([]byte(req.PhoneKey)) != nil || pub.IsZero() {
		return fail(pairInvalid)
	}
	phone := pub.String()
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.now().Before(h.expires) {
		return fail(pairExpired)
	}
	if h.bound != "" && h.bound != phone {
		return fail(pairConflict)
	}
	if h.address == "" {
		address, err := h.authorize(ctx, phone)
		if err != nil || address == "" {
			return fail(pairUnavailable)
		}
		h.bound, h.address = phone, address
	}
	return pairingReply{V: 1, Address: h.address, Port: virtualPort, Name: h.name}
}

// ServeHTTP is the Voxt-compatible pairing endpoint: one Bearer proof, one
// durable phone key, one invitation. It runs inside the Tailcat pairing node.
func (h *pairingHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.EscapedPath() != "/pair" || r.URL.RawQuery != "" {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+h.proof)) != 1 {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 4097))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if len(body) > 4096 {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	var request struct {
		PhoneKey string `json:"phoneKey"`
	}
	if json.Unmarshal(body, &request) != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	var public key.NodePublic
	if public.UnmarshalText([]byte(request.PhoneKey)) != nil || public.IsZero() {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	phone := public.String()
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.now().Before(h.expires) {
		w.WriteHeader(http.StatusGone)
		return
	}
	if h.bound != "" && h.bound != phone {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if h.invitationText == "" {
		address, err := h.authorize(r.Context(), phone)
		if err != nil || address == "" || h.invitation == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		h.bound, h.invitationText = phone, h.invitation(address, phone)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"invitation": h.invitationText})
}

// connectionListener turns Tailcat OnTCP connections into a stream of accepted conns.
type connectionListener struct {
	conns chan net.Conn
	done  chan struct{}
	once  sync.Once
}

func newConnectionListener() *connectionListener {
	return &connectionListener{conns: make(chan net.Conn), done: make(chan struct{})}
}

func (l *connectionListener) offer(c net.Conn) {
	select {
	case l.conns <- c:
	case <-l.done:
		_ = c.Close()
	}
}

func (l *connectionListener) accept() (net.Conn, error) {
	select {
	case c := <-l.conns:
		return c, nil
	case <-l.done:
		return nil, errors.New("closed")
	}
}

func (l *connectionListener) close() { l.once.Do(func() { close(l.done) }) }
