package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"tailscale.com/types/key"
)

func TestPairingHandlerControls(t *testing.T) {
	now := time.Now()
	calls := 0
	phone := key.NewNode().Public().String()
	h := newPairingHandler("fixture-proof", now.Add(time.Minute), func() time.Time { return now }, "Mac",
		func(context.Context, string) (string, error) { calls++; return "tc-normal", nil })
	line := func(proof, phone string) []byte {
		return []byte(`{"v":1,"proof":"` + proof + `","phoneKey":"` + phone + `"}`)
	}
	cases := []struct {
		line []byte
		want string
	}{
		{nil, pairInvalid},
		{[]byte(`{"v":2,"proof":"fixture-proof","phoneKey":"` + phone + `"}`), pairInvalid},
		{line("wrong", phone), pairUnauthorized},
		{line("fixture-proof", "nodekey:bad"), pairInvalid},
		{line("fixture-proof", phone), ""},
		{line("fixture-proof", phone), ""},
		{line("fixture-proof", key.NewNode().Public().String()), pairConflict},
	}
	for i, tc := range cases {
		got := h.handle(context.Background(), tc.line)
		if got.Error != tc.want || (tc.want == "" && (got.Address != "tc-normal" || got.Port != virtualPort || got.Name != "Mac")) {
			t.Fatalf("case %d: %+v", i, got)
		}
	}
	if calls != 1 {
		t.Fatal("authorization not idempotent")
	}
	now = now.Add(2 * time.Minute)
	if got := h.handle(context.Background(), line("fixture-proof", phone)); got.Error != pairExpired {
		t.Fatal("expired window accepted")
	}
}

func TestPairingFailureNeverReleasesAddress(t *testing.T) {
	h := newPairingHandler("p", time.Now().Add(time.Minute), time.Now, "",
		func(context.Context, string) (string, error) { return "tc-secret", errors.New("persist denied") })
	got := h.handle(context.Background(), []byte(`{"v":1,"proof":"p","phoneKey":"`+key.NewNode().Public().String()+`"}`))
	if got.Error != pairUnavailable || strings.Contains(got.Address, "tc") {
		t.Fatal("persistence failure released the address")
	}
}
