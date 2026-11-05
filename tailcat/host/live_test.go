package main

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"os"
	"strconv"
	"testing"
	"time"

	dshtailcat "dshmobile.local/tailcat/mobile"
)

// TestLivePairAndForward runs the real helper runtime and the real mobile client over
// Tailscale's public DERP relays: pair, then round-trip bytes through 48931 to a loopback
// echo. Needs outbound internet. Opt in with DSH_TAILCAT_LIVE=1.
func TestLivePairAndForward(t *testing.T) {
	if os.Getenv("DSH_TAILCAT_LIVE") != "1" {
		t.Skip("set DSH_TAILCAT_LIVE=1 to run against real DERP relays")
	}
	echo, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer echo.Close()
	go func() {
		for {
			conn, err := echo.Accept()
			if err != nil {
				return
			}
			go func() { defer conn.Close(); _, _ = io.Copy(conn, conn) }()
		}
	}()

	input, write := io.Pipe()
	read, output := io.Pipe()
	defer write.Close()
	go func() { _ = Run(input, output, Option{Signals: make(chan os.Signal)}); _ = output.Close() }()
	events := bufio.NewScanner(read)
	next := func(kind string, timeout time.Duration) map[string]any {
		t.Helper()
		got := make(chan map[string]any, 1)
		go func() {
			for events.Scan() {
				var e map[string]any
				if json.Unmarshal(events.Bytes(), &e) == nil && e["event"] == kind {
					got <- e
					return
				}
				if e != nil && e["event"] == "error" {
					got <- e
					return
				}
			}
			got <- nil
		}()
		select {
		case e := <-got:
			if e == nil || e["event"] != kind {
				t.Fatalf("waiting for %s, got %v", kind, e)
			}
			return e
		case <-time.After(timeout):
			t.Fatalf("timeout waiting for %s", kind)
			return nil
		}
	}
	send := func(v any) {
		if json.NewEncoder(write).Encode(v) != nil {
			t.Fatal("IPC write")
		}
	}
	send(map[string]any{"version": 3, "localPort": echo.Addr().(*net.TCPAddr).Port, "state": nil, "allowedClients": []string{}, "name": "live"})
	next("ready", 10*time.Second)
	send(map[string]any{"command": "pair"})
	pairing := next("pairing", 60*time.Second)

	phonePrivate := dshtailcat.NewClientKey()
	var fwd struct {
		Handle int64
		Port   int
	}
	if json.Unmarshal([]byte(dshtailcat.Start(pairing["address"].(string), pairing["key"].(string), pairingPort)), &fwd) != nil || fwd.Port == 0 {
		t.Fatal("pairing forward did not start")
	}
	replies := make(chan map[string]any, 1)
	go func() {
		conn, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(fwd.Port))
		if err != nil {
			replies <- nil
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(90 * time.Second))
		line, _ := json.Marshal(map[string]any{"v": 1, "proof": pairing["proof"], "phoneKey": dshtailcat.PublicKey(phonePrivate)})
		_, _ = conn.Write(append(line, '\n'))
		raw, err := bufio.NewReader(conn).ReadBytes('\n')
		var reply map[string]any
		if err != nil || json.Unmarshal(raw, &reply) != nil {
			replies <- nil
			return
		}
		replies <- reply
	}()
	persist := next("persist", 90*time.Second)
	send(map[string]any{"command": "ack", "id": persist["id"], "ok": true})
	paired := next("paired", 30*time.Second)
	reply := <-replies
	dshtailcat.Stop(fwd.Handle)
	if reply == nil || reply["address"] != paired["address"] || reply["port"] != float64(virtualPort) {
		t.Fatalf("pairing reply %v", reply)
	}

	if json.Unmarshal([]byte(dshtailcat.Start(reply["address"].(string), phonePrivate, virtualPort)), &fwd) != nil || fwd.Port == 0 {
		t.Fatal("normal forward did not start")
	}
	defer dshtailcat.Stop(fwd.Handle)
	conn, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(fwd.Port))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(90 * time.Second))
	if _, err := conn.Write([]byte("tailcat-live-ok")); err != nil {
		t.Fatal(err)
	}
	got := make([]byte, len("tailcat-live-ok"))
	if _, err := io.ReadFull(conn, got); err != nil || string(got) != "tailcat-live-ok" {
		t.Fatalf("round trip failed: %q %v", got, err)
	}
}
