package dshtailcat

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tailscale/tailcat"
	"golang.org/x/crypto/chacha20poly1305"
	"tailscale.com/types/key"
)

func testAddress(t *testing.T) string {
	t.Helper()
	// A syntactically valid Tailcat address; no server needs to exist for these tests.
	private := tailcat.NewPrivateKey()
	private.Public.RegionID = 10
	addr := string(private.Public.Addr())
	if !strings.HasPrefix(addr, "tc") {
		t.Fatal("test address setup failed")
	}
	return addr
}

type started struct {
	Handle int64 `json:"handle"`
	Port   int   `json:"port"`
	Error  string
}

func mustStart(t *testing.T, address, clientKey string, port int) started {
	t.Helper()
	var s started
	if json.Unmarshal([]byte(Start(address, clientKey, port)), &s) != nil || s.Handle == 0 || s.Port == 0 {
		t.Fatal("start failed")
	}
	return s
}

func installSession(t *testing.T, fake func(int) sessionDial) {
	t.Helper()
	previous := newSessionDial
	newSessionDial = func(_ string, _ key.NodePrivate, port int) sessionDial { return fake(port) }
	t.Cleanup(func() { newSessionDial = previous })
}

func TestKeysAndInvalidStart(t *testing.T) {
	private := NewClientKey()
	if !strings.HasPrefix(private, "privkey:") || !strings.HasPrefix(PublicKey(private), "nodekey:") || PublicKey("bad") != "" {
		t.Fatal("key helpers")
	}
	addr := testAddress(t)
	for _, tc := range []struct {
		address, key string
		port         int
		want         string
	}{
		{"", private, 1, `{"error":"invalid-address"}`},
		{"banana", private, 1, `{"error":"invalid-address"}`},
		{addr, "", 1, `{"error":"invalid-client-key"}`},
		{addr, "nodekey:00", 1, `{"error":"invalid-client-key"}`},
		{addr, private, 0, `{"error":"invalid-port"}`},
		{addr, private, 65536, `{"error":"invalid-port"}`},
	} {
		if got := Start(tc.address, tc.key, tc.port); got != tc.want || strings.Contains(got, "privkey:") {
			t.Fatalf("got %s want %s", got, tc.want)
		}
	}
	if Stop(9999) != 0 {
		t.Fatal("unknown handle")
	}
}

func TestHandlesDialLazilyAndStopIndependently(t *testing.T) {
	var mu sync.Mutex
	var dialed, closed []int
	installSession(t, func(port int) sessionDial {
		return sessionDial{
			dial: func(context.Context) (net.Conn, error) {
				mu.Lock()
				dialed = append(dialed, port)
				mu.Unlock()
				return nil, errInvalid
			},
			close: func() { mu.Lock(); closed = append(closed, port); mu.Unlock() },
		}
	})
	addr, private := testAddress(t), NewClientKey()
	first, second := mustStart(t, addr, private, 48931), mustStart(t, addr, private, 48932)
	if first.Handle == second.Handle || first.Port == second.Port {
		t.Fatal("handles not independent")
	}
	mu.Lock()
	if len(dialed) != 0 {
		t.Fatal("dialed before accept")
	}
	mu.Unlock()
	conn, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(first.Port))
	if err != nil {
		t.Fatal(err)
	}
	conn.Close()
	deadline := time.Now().Add(2 * time.Second)
	for {
		mu.Lock()
		n := len(dialed)
		mu.Unlock()
		if n == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("accept did not dial")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if Stop(first.Handle) != 0 || Stop(first.Handle) != 0 {
		t.Fatal("stop not idempotent")
	}
	mu.Lock()
	if len(closed) != 1 || closed[0] != 48931 {
		t.Fatal("stop closed the wrong client")
	}
	mu.Unlock()
	if c, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(first.Port), 100*time.Millisecond); err == nil {
		c.Close()
		t.Fatal("stopped forward still accepts")
	}
	Stop(second.Handle)
}

func TestForwardCarriesBody(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.Copy(w, r.Body) }))
	defer origin.Close()
	f, err := startForward(func(ctx context.Context) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", origin.Listener.Addr().String())
	})
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.Repeat([]byte("payload"), 65536)
	res, err := (&http.Client{Timeout: 3 * time.Second}).Post("http://"+f.addr(), "application/octet-stream", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !bytes.Equal(got, body) {
		t.Fatal("body corrupted")
	}
	f.close()
	f.close()
}

func TestCloseCancelsPendingDial(t *testing.T) {
	entered, exited := make(chan struct{}), make(chan struct{})
	f, err := startForward(func(ctx context.Context) (net.Conn, error) {
		close(entered)
		<-ctx.Done()
		close(exited)
		return nil, ctx.Err()
	})
	if err != nil {
		t.Fatal(err)
	}
	c, err := net.Dial("tcp", f.addr())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("dial never started")
	}
	f.close()
	select {
	case <-exited:
	case <-time.After(time.Second):
		t.Fatal("dial not cancelled")
	}
}

// Frozen vector from docs/TAILCAT.md.
const (
	vPhonePrivate = "ERERERERERERERERERERERERERERERERERERERERERE="
	vPhonePublic  = "e06Qm75//kTEZaIgA31gjuNYl9Me+XLwf3SJLLD3PxM="
	vHostPrivate  = "IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI="
	vHostPublic   = "D6poTtKIZ7l/Smot7l34zpdOdrcBjj8iocTPJnhXDyA="
	vCode         = "295936"
	vKey          = "380q6EYc859pXQkUCN6O6yEjVt0LPwnps+5K71Biy/c="
	vNonce        = "MzMzMzMzMzMzMzMz"
	vPlaintext    = `{"version":3}`
	vSealed       = "MzMzMzMzMzMzMzMzCy/nmRJXOOnj64hGBAw4VoRK2dUw3zgf3IEP2kU="
)

func TestLocalPairFrozenVector(t *testing.T) {
	code, aeadKey, err := localPairDerive(vPhonePrivate, vHostPublic)
	if err != nil || code != vCode || base64.StdEncoding.EncodeToString(aeadKey) != vKey {
		t.Fatalf("derive: %s %s %v", code, base64.StdEncoding.EncodeToString(aeadKey), err)
	}
	if LocalPairCode(vPhonePrivate, vHostPublic) != vCode {
		t.Fatal("code")
	}
	nonce, _ := base64.StdEncoding.DecodeString(vNonce)
	aead, _ := chacha20poly1305.New(aeadKey)
	if sealed := base64.StdEncoding.EncodeToString(append(nonce, aead.Seal(nil, nonce, []byte(vPlaintext), nil)...)); sealed != vSealed {
		t.Fatalf("seal %s", sealed)
	}
	if LocalPairOpen(vPhonePrivate, vHostPublic, vSealed) != vPlaintext {
		t.Fatal("open")
	}
	tampered := []byte(vSealed)
	tampered[20] ^= 1
	if LocalPairOpen(vPhonePrivate, vHostPublic, string(tampered)) != "" || LocalPairOpen(vPhonePrivate, vPhonePublic, vSealed) != "" {
		t.Fatal("tampered or wrong-peer box opened")
	}
	if LocalPairCode("bad", vHostPublic) != "" || LocalPairCode(vPhonePrivate, base64.StdEncoding.EncodeToString(make([]byte, 32))) != "" {
		t.Fatal("invalid or low-order input accepted")
	}
	var pair struct{ Private, Public string }
	if json.Unmarshal([]byte(LocalPairKeyPair()), &pair) != nil || LocalPairCode(pair.Private, vHostPublic) == "" {
		t.Fatal("key pair")
	}
	_ = vHostPrivate
}

func TestPathSaysDirectOrWhichRelay(t *testing.T) {
	answers := map[int]func(context.Context) (string, string, error){
		48931: func(context.Context) (string, string, error) { return "direct", "", nil },
		48932: func(context.Context) (string, string, error) { return "relay", "tok", nil },
		48933: func(context.Context) (string, string, error) { return "", "", errInvalid },
	}
	installSession(t, func(port int) sessionDial {
		return sessionDial{dial: func(context.Context) (net.Conn, error) { return nil, errInvalid }, close: func() {}, route: answers[port]}
	})
	addr, private := testAddress(t), NewClientKey()
	direct, relay, failing := mustStart(t, addr, private, 48931), mustStart(t, addr, private, 48932), mustStart(t, addr, private, 48933)
	defer Stop(direct.Handle)
	defer Stop(relay.Handle)
	defer Stop(failing.Handle)
	for _, tc := range []struct {
		handle int64
		want   string
	}{
		{direct.Handle, `{"route":"direct"}`},
		{relay.Handle, `{"route":"relay","relay":"tok"}`},
		{failing.Handle, `{"error":"unreachable"}`},
		{9999, `{"error":"unknown-handle"}`},
	} {
		if got := Path(tc.handle); got != tc.want {
			t.Fatalf("Path(%d) = %s, want %s", tc.handle, got, tc.want)
		}
	}
}

func diagnoseWith(t *testing.T, relay error, ping error) map[string]any {
	t.Helper()
	installSession(t, func(int) sessionDial {
		return sessionDial{
			dial:  func(context.Context) (net.Conn, error) { return nil, io.EOF },
			close: func() {},
			relay: func(context.Context) error { return relay },
			ping: func(context.Context) (time.Duration, error) {
				if ping != nil {
					return 0, ping
				}
				return 240 * time.Millisecond, nil
			},
		}
	})
	s := mustStart(t, testAddress(t), NewClientKey(), 48931)
	t.Cleanup(func() { Stop(s.Handle) })
	var out map[string]any
	if err := json.Unmarshal([]byte(Diagnose(s.Handle)), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestDiagnoseSaysWhichPartAnswers(t *testing.T) {
	for _, c := range []struct {
		name              string
		relay, ping       error
		wantRelay, wantPC string
	}{
		{"everything answers", nil, nil, "reachable", "reachable"},
		{"the relay answers and the computer does not", nil, io.EOF, "reachable", "unreachable"},
		{"nothing answers", io.EOF, io.EOF, "unreachable", "unreachable"},
		{"the computer's answer came through a relay, whatever the probe said", io.EOF, nil, "reachable", "reachable"},
	} {
		t.Run(c.name, func(t *testing.T) {
			out := diagnoseWith(t, c.relay, c.ping)
			if out["relay"] != c.wantRelay || out["computer"] != c.wantPC {
				t.Fatalf("got %v", out)
			}
			if c.ping == nil && out["latencyMs"] != float64(240) {
				t.Fatalf("latency: %v", out)
			}
			if c.ping != nil && out["latencyMs"] != nil {
				t.Fatalf("no answer has no latency: %v", out)
			}
		})
	}
	if Diagnose(987654) != `{"error":"unknown-handle"}` {
		t.Fatal("unknown handle")
	}
}

// A computer that stays silent uses up the whole limit. The relay's answer, in long before, still counts: seen on the
// emulator on 2026-11-03, a revoked phone was told its network blocked the relay about half the time.
func TestDiagnoseKeepsTheRelaysAnswerWhenTheComputerStaysSilent(t *testing.T) {
	defer func(d time.Duration) { diagnoseLimit = d }(diagnoseLimit)
	diagnoseLimit = 5 * time.Millisecond
	silent := &bridgeSession{
		relay: func(context.Context) error { return nil },
		ping: func(ctx context.Context) (time.Duration, error) {
			<-ctx.Done()
			return 0, ctx.Err()
		},
	}
	const handle = int64(987653)
	registryMu.Lock()
	sessions[handle] = silent
	registryMu.Unlock()
	defer func() {
		registryMu.Lock()
		delete(sessions, handle)
		registryMu.Unlock()
	}()
	for i := 0; i < 60; i++ {
		var out map[string]any
		if err := json.Unmarshal([]byte(Diagnose(handle)), &out); err != nil {
			t.Fatal(err)
		}
		if out["relay"] != "reachable" || out["computer"] != "unreachable" {
			t.Fatalf("run %d: %v", i, out)
		}
	}
}

func TestRelayProbeNeedsARealTLSAnswer(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	host, port, _ := net.SplitHostPort(server.Listener.Addr().String())
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := probeRelay(ctx, []relayNode{{host: "relay.test", dial: host, port: port}}, true); err != nil {
		t.Fatalf("a relay that answers: %v", err)
	}
	// A network that lets the connection open and then answers with anything but TLS blocks it too.
	plain, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer plain.Close()
	go func() {
		for {
			c, err := plain.Accept()
			if err != nil {
				return
			}
			_, _ = c.Write([]byte("HTTP/1.1 403 Forbidden\r\n\r\n"))
			c.Close()
		}
	}()
	_, plainPort, _ := net.SplitHostPort(plain.Addr().String())
	if probeRelay(ctx, []relayNode{{host: "relay.test", dial: "127.0.0.1", port: plainPort}}, true) == nil {
		t.Fatal("a filter's plain answer counted as the relay")
	}
	closed, _ := net.Listen("tcp", "127.0.0.1:0")
	_, closedPort, _ := net.SplitHostPort(closed.Addr().String())
	closed.Close()
	if probeRelay(ctx, []relayNode{{host: "relay.test", dial: "127.0.0.1", port: closedPort}}, true) == nil {
		t.Fatal("a closed port counted as the relay")
	}
	// One relay that answers is enough; none to try is not.
	if err := probeRelay(ctx, []relayNode{{host: "relay.test", dial: "127.0.0.1", port: closedPort}, {host: "relay.test", dial: host, port: port}}, true); err != nil {
		t.Fatalf("second relay: %v", err)
	}
	if probeRelay(ctx, nil, true) == nil {
		t.Fatal("no relays counted as reachable")
	}
}
