package main

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tailscale/tailcat"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
)

type fakeNode struct {
	addr   string
	region *tailcfg.DERPRegion
	closed atomic.Bool
}

func (n *fakeNode) Address() string             { return n.addr }
func (n *fakeNode) Region() *tailcfg.DERPRegion { return n.region }
func (n *fakeNode) Close() error                { n.closed.Store(true); return nil }

type nodeStart struct {
	spec Spec
	node *fakeNode
}

func fixtureRegion() *tailcfg.DERPRegion {
	return &tailcfg.DERPRegion{RegionID: 19, RegionCode: "fix",
		Nodes: []*tailcfg.DERPNode{{Name: "fix", RegionID: 19, HostName: "loopback.invalid", DERPPort: 443}}}
}

// harness runs Run over pipes with a fake starter and decodes every event.
type harness struct {
	t      *testing.T
	write  *io.PipeWriter
	events chan map[string]any
	starts chan nodeStart
	done   chan error
}

func newHarness(t *testing.T, cfg map[string]any) *harness {
	t.Helper()
	input, write := io.Pipe()
	read, output := io.Pipe()
	h := &harness{t: t, write: write, events: make(chan map[string]any, 32), starts: make(chan nodeStart, 16), done: make(chan error, 1)}
	go func() {
		defer close(h.events)
		dec := json.NewDecoder(read)
		for {
			var e map[string]any
			if dec.Decode(&e) != nil {
				return
			}
			h.events <- e
		}
	}()
	go func() {
		h.done <- Run(input, output, Option{Signals: make(chan os.Signal), Start: func(_ context.Context, s Spec) (Running, error) {
			addr := "tc-normal"
			if s.Port == pairingPort {
				addr = "tc-pairing"
			}
			node := &fakeNode{addr: addr, region: fixtureRegion()}
			h.starts <- nodeStart{s, node}
			return node, nil
		}})
		_ = output.Close()
	}()
	t.Cleanup(func() { _ = write.Close(); _ = read.Close() })
	h.send(cfg)
	return h
}

func (h *harness) send(v any) {
	h.t.Helper()
	if json.NewEncoder(h.write).Encode(v) != nil {
		h.t.Fatal("IPC write failed")
	}
}

func (h *harness) event(kind string) map[string]any {
	h.t.Helper()
	select {
	case e := <-h.events:
		if e["event"] != kind {
			h.t.Fatalf("event %v, want %s", e["event"], kind)
		}
		return e
	case <-time.After(3 * time.Second):
		h.t.Fatalf("timeout waiting for %s", kind)
		return nil
	}
}

func (h *harness) start() nodeStart {
	h.t.Helper()
	select {
	case s := <-h.starts:
		return s
	case <-time.After(3 * time.Second):
		h.t.Fatal("timeout waiting for node start")
		return nodeStart{}
	}
}

// pairHTTP drives the Voxt-compatible /pair endpoint through the real pairing node.
func pairHTTP(t *testing.T, spec Spec, method, path, authorization, body string) chan *http.Response {
	t.Helper()
	handler := spec.OnTCP(pairingPort)
	if handler == nil {
		t.Fatal("pairing port absent")
	}
	clientConn, serverConn := net.Pipe()
	go handler(serverConn)
	client := &http.Client{Transport: &http.Transport{DisableKeepAlives: true,
		DialContext: func(context.Context, string, string) (net.Conn, error) { return clientConn, nil }}}
	request, err := http.NewRequest(method, "http://pairing.invalid"+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	replies := make(chan *http.Response, 1)
	go func() {
		response, err := client.Do(request)
		if err != nil {
			replies <- nil
			return
		}
		replies <- response
	}()
	return replies
}

func pairingBody(phone string) string { return `{"phoneKey":"` + phone + `"}` }

func TestPairPersistAllowlistAndRevoke(t *testing.T) {
	h := newHarness(t, map[string]any{"version": 3, "localPort": 18080, "state": nil, "allowedClients": []string{}, "name": " Owner\x07's Mac "})
	if ready := h.event("ready"); ready["address"] != "" {
		t.Fatal("unpaired helper advertised an address")
	}
	select {
	case <-h.starts:
		t.Fatal("unpaired normal node started")
	default:
	}

	template := `{"version":1,"baseUrl":"https://h-test.dsh.invalid","tailcat":{"address":"$TAILCAT_ADDRESS","port":48931},"client":"$PHONE_KEY"}`
	h.send(map[string]any{"command": "pair", "invitation": template})
	pair := h.start()
	e := h.event("pairing")
	if e["address"] != "tc-pairing" || e["port"] != float64(pairingPort) || len(e["proof"].(string)) != 43 {
		t.Fatal("pairing event fields")
	}
	var temporary key.NodePrivate
	if temporary.UnmarshalText([]byte(e["key"].(string))) != nil {
		t.Fatal("pairing key format")
	}
	if len(pair.spec.Allowed) != 1 || pair.spec.Allowed[0] != temporary.Public() || pair.spec.Port != pairingPort {
		t.Fatal("pairing node must admit only the ephemeral key")
	}
	if pair.spec.OnTCP(virtualPort) != nil {
		t.Fatal("pairing node exposes the forwarding port")
	}
	proof := e["proof"].(string)
	phone := key.NewNode().Public().String()

	wrong := <-pairHTTP(t, pair.spec, http.MethodPost, "/pair", "Bearer wrong-proof", pairingBody(phone))
	if wrong == nil || wrong.StatusCode != http.StatusUnauthorized {
		t.Fatal("wrong proof accepted")
	}
	wrong.Body.Close()

	reply := pairHTTP(t, pair.spec, http.MethodPost, "/pair", "Bearer "+proof, pairingBody(phone))
	normal := h.start()
	persist := h.event("persist")
	if len(normal.spec.Allowed) != 1 || normal.spec.Allowed[0].String() != phone || normal.spec.OnTCP(pairingPort) != nil {
		t.Fatal("normal node allowlist or ports")
	}
	if persist["allowedClients"].([]any)[0] != phone || !strings.Contains(persist["state"].(string), "privkey:") {
		t.Fatal("persist omitted state or allowlist")
	}
	select {
	case <-reply:
		t.Fatal("reply before the host persisted the allowlist")
	case <-time.After(20 * time.Millisecond):
	}
	h.send(map[string]any{"command": "ack", "id": persist["id"], "ok": true})
	if paired := h.event("paired"); paired["client"] != phone || paired["address"] != "tc-normal" {
		t.Fatal("paired event")
	}
	response := <-reply
	if response == nil || response.StatusCode != http.StatusOK {
		t.Fatalf("pairing reply %v", response)
	}
	payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	response.Body.Close()
	if !strings.Contains(string(payload), "tc-normal") || !strings.Contains(string(payload), phone) {
		t.Fatalf("invitation %s", payload)
	}
	again := <-pairHTTP(t, pair.spec, http.MethodPost, "/pair", "Bearer "+proof, pairingBody(phone))
	if again == nil || again.StatusCode != http.StatusOK {
		t.Fatal("same phone retry not idempotent")
	}
	again.Body.Close()
	conflict := <-pairHTTP(t, pair.spec, http.MethodPost, "/pair", "Bearer "+proof, pairingBody(key.NewNode().Public().String()))
	if conflict == nil || conflict.StatusCode != http.StatusConflict {
		t.Fatal("second phone accepted in one window")
	}
	conflict.Body.Close()
	bad := <-pairHTTP(t, pair.spec, http.MethodPost, "/pair", "Bearer "+proof, "not json")
	if bad == nil || bad.StatusCode != http.StatusBadRequest {
		t.Fatal("malformed request")
	}
	bad.Body.Close()

	h.send(map[string]any{"command": "cancelPairing"})
	h.event("pairingClosed")
	if !pair.node.closed.Load() || normal.node.closed.Load() {
		t.Fatal("cancel must close only the pairing node")
	}

	h.send(map[string]any{"command": "setAllowed", "allowedClients": []string{"nodekey:bad"}})
	if e := h.event("error"); e["code"] != errClientKey {
		t.Fatal("invalid setAllowed key")
	}
	h.send(map[string]any{"command": "setAllowed", "allowedClients": []string{}})
	persist = h.event("persist")
	if len(persist["allowedClients"].([]any)) != 0 {
		t.Fatal("revocation persist")
	}
	h.send(map[string]any{"command": "ack", "id": persist["id"], "ok": true})
	if ready := h.event("ready"); ready["address"] != "" || !normal.node.closed.Load() {
		t.Fatal("empty allowlist must stop the normal node")
	}

	h.send(map[string]any{"command": "nope"})
	if e := h.event("error"); e["code"] != errCommand {
		t.Fatal("unknown command")
	}
	_ = h.write.Close()
	select {
	case <-h.done:
	case <-time.After(3 * time.Second):
		t.Fatal("helper did not stop on stdin EOF")
	}
}

func TestRestartRestoresIdentityAndAllowlist(t *testing.T) {
	phone := key.NewNode().Public().String()
	private, psk := key.NewNode(), tailcat.NewPresharedKey()
	state, err := marshalState(private, psk, fixtureRegion())
	if err != nil {
		t.Fatal(err)
	}
	h := newHarness(t, map[string]any{"version": 3, "localPort": 18080, "state": state, "allowedClients": []string{phone}, "name": "x"})
	normal := h.start()
	if !normal.spec.Key.Equal(private) || !normal.spec.PSK.Equal(psk) || normal.spec.Region == nil || normal.spec.Region.RegionID != 19 {
		t.Fatal("restart did not restore identity and region")
	}
	persist := h.event("persist")
	h.send(map[string]any{"command": "ack", "id": persist["id"], "ok": true})
	if ready := h.event("ready"); ready["address"] != "tc-normal" {
		t.Fatal("restored node address")
	}
}

func TestRejectedPersistenceClosesUncommittedNormalNode(t *testing.T) {
	h := newHarness(t, map[string]any{"version": 3, "localPort": 18080, "state": nil, "allowedClients": []string{key.NewNode().Public().String()}, "name": ""})
	normal := h.start()
	persist := h.event("persist")
	h.send(map[string]any{"command": "ack", "id": persist["id"], "ok": false})
	if e := h.event("error"); e["code"] != errOperation {
		t.Fatal("rejected persistence must fail the operation")
	}
	if !normal.node.closed.Load() {
		t.Fatal("uncommitted authorization kept alive")
	}
}

func TestInvalidConfigurationRejectedBeforeStart(t *testing.T) {
	client := key.NewNode().Public().String()
	cases := []struct{ body, want, leak string }{
		{`not json`, errRequest, ""},
		{`{"version":2,"localPort":8080,"state":null,"allowedClients":[]}`, errVersion, ""},
		{`{"version":3,"localPort":80,"state":null,"allowedClients":[]}`, errPort, ""},
		{`{"version":3,"localPort":65535,"state":null,"allowedClients":[]}`, errPort, ""},
		{`{"version":3,"localPort":8080,"state":null,"allowedClients":["` + client + `","` + client + `"]}`, errAllowlist, ""},
		{`{"version":3,"localPort":8080,"state":null,"allowedClients":["nodekey:00"]}`, errClientKey, "nodekey:00"},
		{`{"version":3,"localPort":8080,"state":"not-json","allowedClients":[]}`, errState, "not-json"},
		{`{"version":3,"localPort":8080,"state":{"version":1},"allowedClients":[]}`, errState, ""},
		{`{"version":3,"localPort":8080,"padding":"` + strings.Repeat("x", 70000) + `"}`, errRequest, ""},
	}
	for _, tc := range cases {
		var out strings.Builder
		started := false
		err := Run(strings.NewReader(tc.body+"\n"), &out, Option{Start: func(context.Context, Spec) (Running, error) { started = true; return nil, nil }})
		if err == nil || started || strings.TrimSpace(out.String()) != `{"event":"error","code":"`+tc.want+`"}` {
			t.Fatalf("%s: got %q", tc.want, out.String())
		}
		if tc.leak != "" && strings.Contains(out.String(), tc.leak) {
			t.Fatal("rejection echoed input")
		}
	}
}

func TestVirtualPortForwardsOnlyToLoopbackCompanion(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		buf := make([]byte, 5)
		_, _ = io.ReadFull(conn, buf)
		_, _ = conn.Write(append([]byte("echo:"), buf...))
	}()
	conns, _ := newLiveConns(context.Background())
	defer conns.close()
	serve := serveVirtual(ln.Addr().(*net.TCPAddr).Port, conns)
	if serve(pairingPort) != nil || serve(22) != nil {
		t.Fatal("non-virtual port served")
	}
	client, server := net.Pipe()
	go serve(virtualPort)(server)
	_ = client.SetDeadline(time.Now().Add(3 * time.Second))
	_, _ = client.Write([]byte("hello"))
	got := make([]byte, 10)
	if _, err := io.ReadFull(client, got); err != nil || string(got) != "echo:hello" {
		t.Fatal("virtual port did not reach the loopback companion")
	}
}

func TestStateRoundTrip(t *testing.T) {
	private, psk := key.NewNode(), tailcat.NewPresharedKey()
	state, err := marshalState(private, psk, fixtureRegion())
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(state)
	p2, k2, r2, code := parseState(encoded)
	if code != "" || !p2.Equal(private) || !k2.Equal(psk) || r2.RegionID != 19 {
		t.Fatal("state round trip")
	}
	if _, err := marshalState(private, psk, nil); err == nil {
		t.Fatal("state without region must not be persisted")
	}
}

func TestRealStartRefusesEmptyAllowlist(t *testing.T) {
	// An empty Tailcat allowlist admits every client, so no node may start without one.
	if _, err := realStart(context.Background(), Spec{Key: key.NewNode()}); err == nil || err.Error() != errAllowlist {
		t.Fatalf("empty allowlist started a node: %v", err)
	}
}
