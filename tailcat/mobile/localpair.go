package dshtailcat

// Same-Wi-Fi pairing crypto, phone role. Construction from voxt-mobile LocalPairing.swift
// (Apache-2.0, see tailcat/NOTICE) with this project's labels; contract and frozen test
// vector: docs/TAILCAT.md ("Same-Wi-Fi pairing").

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"

	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/hkdf"
)

const localPairLabel = "dsh-mobile-local-pairing-v1"

// LocalPairKeyPair returns a fresh X25519 key pair as {"private":"<b64>","public":"<b64>"}.
func LocalPairKeyPair() string {
	private := make([]byte, curve25519.ScalarSize)
	if _, err := io.ReadFull(rand.Reader, private); err != nil {
		return `{"error":"keypair-failed"}`
	}
	public, err := curve25519.X25519(private, curve25519.Basepoint)
	if err != nil {
		return `{"error":"keypair-failed"}`
	}
	body, err := json.Marshal(struct {
		Private string `json:"private"`
		Public  string `json:"public"`
	}{base64.StdEncoding.EncodeToString(private), base64.StdEncoding.EncodeToString(public)})
	if err != nil {
		return `{"error":"keypair-failed"}`
	}
	return string(body)
}

// LocalPairCode returns the 6-digit confirmation code the phone shows, or "" on invalid input.
func LocalPairCode(private, peerPublic string) string {
	code, _, err := localPairDerive(private, peerPublic)
	if err != nil {
		return ""
	}
	return code
}

// LocalPairOpen decrypts the host's sealed invitation, or returns "" if it does not authenticate.
func LocalPairOpen(private, peerPublic, sealed string) string {
	_, aeadKey, err := localPairDerive(private, peerPublic)
	if err != nil {
		return ""
	}
	box, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil || len(box) < chacha20poly1305.NonceSize+chacha20poly1305.Overhead || len(box) > 128*1024 {
		return ""
	}
	aead, err := chacha20poly1305.New(aeadKey)
	if err != nil {
		return ""
	}
	plain, err := aead.Open(nil, box[:chacha20poly1305.NonceSize], box[chacha20poly1305.NonceSize:], nil)
	if err != nil {
		return ""
	}
	return string(plain)
}

// localPairDerive computes the code and AEAD key for the phone holding private, talking to
// the host with peerPublic.
func localPairDerive(privateText, peerText string) (string, []byte, error) {
	private, err := decodeKey(privateText)
	if err != nil {
		return "", nil, err
	}
	hostPub, err := decodeKey(peerText)
	if err != nil {
		return "", nil, err
	}
	phonePub, err := curve25519.X25519(private, curve25519.Basepoint)
	if err != nil {
		return "", nil, err
	}
	shared, err := curve25519.X25519(private, hostPub) // Rejects low-order (all-zero) results.
	if err != nil {
		return "", nil, err
	}
	digest := sha256.New()
	digest.Write([]byte(localPairLabel))
	digest.Write(phonePub)
	digest.Write(hostPub)
	digest.Write(shared)
	code := fmt.Sprintf("%06d", binary.BigEndian.Uint64(digest.Sum(nil)[:8])%1_000_000)
	salt := append(append([]byte{}, phonePub...), hostPub...)
	aeadKey := make([]byte, chacha20poly1305.KeySize)
	if _, err := io.ReadFull(hkdf.New(sha256.New, shared, salt, []byte(localPairLabel+" invitation")), aeadKey); err != nil {
		return "", nil, err
	}
	return code, aeadKey, nil
}

func decodeKey(text string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(text)
	if err != nil || len(raw) != curve25519.PointSize {
		return nil, errInvalid
	}
	return raw, nil
}
