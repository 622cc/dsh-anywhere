package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"tailscale.com/types/key"
)

func testPairingHandler(now time.Time) (*pairingHandler, string) {
	phone := key.NewNode().Public().String()
	h := newPairingHandler("proof", now.Add(time.Minute), func() time.Time { return now }, "DSH Mobile companion", func(context.Context, string) (string, error) {
		return "tc-normal", nil
	})
	h.invitation = func(address, client string) string {
		return `{"version":1,"baseUrl":"https://h-test.dsh.invalid","tailcat":{"address":"` + address + `","port":48931},"phone":"` + client + `"}`
	}
	return h, phone
}

func postPair(t *testing.T, h http.Handler, proof, phone string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]string{"phoneKey": phone})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/pair", strings.NewReader(string(body)))
	request.Header.Set("Authorization", "Bearer "+proof)
	recorder := httptest.NewRecorder()
	h.ServeHTTP(recorder, request)
	return recorder
}

func TestPairingHTTPReturnsOneInvitationForTheBoundDurableKey(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	h, phone := testPairingHandler(now)

	response := postPair(t, h, "proof", phone)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	var reply struct {
		Invitation string `json:"invitation"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(reply.Invitation, `"address":"tc-normal"`) || !strings.Contains(reply.Invitation, phone) {
		t.Fatalf("invitation does not name the normal address and durable key: %s", reply.Invitation)
	}

	again := postPair(t, h, "proof", phone)
	if again.Code != http.StatusOK || again.Body.String() != response.Body.String() {
		t.Fatalf("same key must be idempotent: %d %s", again.Code, again.Body.String())
	}
	other := postPair(t, h, "proof", key.NewNode().Public().String())
	if other.Code != http.StatusConflict {
		t.Fatalf("a second key must be refused, got %d", other.Code)
	}
}

func TestPairingHTTPRejectsBadProofPathMethodAndExpiry(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	h, phone := testPairingHandler(now)

	if got := postPair(t, h, "wrong", phone).Code; got != http.StatusUnauthorized {
		t.Fatalf("wrong proof: %d", got)
	}
	if got := postPair(t, h, "proof", "not-a-node-key").Code; got != http.StatusBadRequest {
		t.Fatalf("bad phone key: %d", got)
	}
	get := httptest.NewRequest(http.MethodGet, "/pair", nil)
	get.Header.Set("Authorization", "Bearer proof")
	recorder := httptest.NewRecorder()
	h.ServeHTTP(recorder, get)
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET: %d", recorder.Code)
	}
	other := httptest.NewRequest(http.MethodPost, "/other", strings.NewReader(`{"phoneKey":"`+phone+`"}`))
	other.Header.Set("Authorization", "Bearer proof")
	recorder = httptest.NewRecorder()
	h.ServeHTTP(recorder, other)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("wrong path: %d", recorder.Code)
	}
}

func TestPairingHTTPExpires(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	h, phone := testPairingHandler(now)
	expired := &pairingHandler{proof: "proof", expires: now.Add(-time.Second), now: func() time.Time { return now }, authorize: h.authorize, invitation: h.invitation}
	if got := postPair(t, expired, "proof", phone).Code; got != http.StatusGone {
		t.Fatalf("expired: %d", got)
	}
}
