// Command phone is a reference Tailcat phone for end-to-end checks of docs/TAILCAT.md. It does what
// the Android app does with the same mobile library: Voxt-style /pair over the temporary pairing
// node, then the normal forward, pinned HTTPS to the companion and one authenticated read.
// It prints only statuses, never keys or tokens.
package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	dshtailcat "dshmobile.local/tailcat/mobile"
)

type bootstrap struct {
	Version  int `json:"version"`
	Expires  int64 `json:"expiresAt"`
	Tailcat  struct {
		Address string `json:"address"`
		Port    int    `json:"port"`
		Key     string `json:"key"`
		Proof   string `json:"proof"`
	} `json:"tailcat"`
}

type normalInvitation struct {
	Version        int    `json:"version"`
	BaseURL        string `json:"baseUrl"`
	PinSHA256      string `json:"pinSha256"`
	CertificatePEM string `json:"certificatePem"`
	PairingToken   string `json:"pairingToken"`
	Tailcat        struct {
		Address string `json:"address"`
		Port    int    `json:"port"`
	} `json:"tailcat"`
}

type forward struct {
	Handle int64  `json:"handle"`
	Port   int    `json:"port"`
	Error  string `json:"error"`
}

func start(address, key string, port int) (forward, error) {
	var f forward
	if err := json.Unmarshal([]byte(dshtailcat.Start(address, key, port)), &f); err != nil || f.Error != "" || f.Port == 0 {
		return f, fmt.Errorf("start failed: %s", f.Error)
	}
	return f, nil
}

func main() {
	path := flag.String("invitation", "", "bootstrap v1 JSON file")
	timeout := flag.Duration("timeout", 90*time.Second, "overall deadline")
	flag.Parse()
	if err := run(*path, *timeout); err != nil {
		fmt.Fprintln(os.Stderr, "FAIL:", err)
		os.Exit(1)
	}
}

func run(path string, timeout time.Duration) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var boot bootstrap
	if err := json.Unmarshal(raw, &boot); err != nil || boot.Version != 1 {
		return errors.New("not a bootstrap v1")
	}
	deadline := time.Now().Add(timeout)

	// 1. The phone's durable Tailcat identity is created once and sent to /pair.
	phoneKey := dshtailcat.NewClientKey()
	public := dshtailcat.PublicKey(phoneKey)
	pairing, err := start(boot.Tailcat.Address, boot.Tailcat.Key, boot.Tailcat.Port)
	if err != nil {
		return err
	}
	pairClient := &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{
		DisableKeepAlives: true,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "tcp", fmt.Sprintf("127.0.0.1:%d", pairing.Port))
		},
	}}
	var invitation string
	for attempt := 1; ; attempt++ {
		request, _ := http.NewRequest(http.MethodPost, "http://pairing.invalid/pair", strings.NewReader(fmt.Sprintf(`{"phoneKey":%q}`, public)))
		request.Header.Set("Authorization", "Bearer "+boot.Tailcat.Proof)
		request.Header.Set("Content-Type", "application/json")
		response, err := pairClient.Do(request)
		if err == nil {
			body, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
			response.Body.Close()
			if response.StatusCode != http.StatusOK {
				dshtailcat.Stop(pairing.Handle)
				return fmt.Errorf("/pair status %d", response.StatusCode)
			}
			var reply struct {
				Invitation string `json:"invitation"`
			}
			if json.Unmarshal(body, &reply) != nil || reply.Invitation == "" {
				dshtailcat.Stop(pairing.Handle)
				return errors.New("/pair: no invitation")
			}
			invitation = reply.Invitation
			break
		}
		if time.Now().After(deadline) {
			dshtailcat.Stop(pairing.Handle)
			return fmt.Errorf("/pair: %w", err)
		}
		fmt.Printf("pairing node not reachable yet (attempt %d)\n", attempt)
		time.Sleep(2 * time.Second)
	}
	dshtailcat.Stop(pairing.Handle)
	fmt.Println("pairing node: ok (invitation received)")

	var normalInv normalInvitation
	if err := json.Unmarshal([]byte(invitation), &normalInv); err != nil || normalInv.Version != 4 || normalInv.Tailcat.Port != 48931 || !strings.HasPrefix(normalInv.Tailcat.Address, "tc") {
		return errors.New("invalid normal invitation")
	}

	// 2. Normal node with the same durable key, pinned HTTPS through the loopback forward.
	normal, err := start(normalInv.Tailcat.Address, phoneKey, normalInv.Tailcat.Port)
	if err != nil {
		return err
	}
	defer dshtailcat.Stop(normal.Handle)
	base, err := url.Parse(normalInv.BaseURL)
	if err != nil {
		return err
	}
	block, _ := pem.Decode([]byte(normalInv.CertificatePEM))
	if block == nil {
		return errors.New("bad certificate")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return err
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	tlsConfig := &tls.Config{ServerName: base.Hostname(), RootCAs: pool, MinVersion: tls.VersionTLS12,
		VerifyConnection: func(state tls.ConnectionState) error {
			sum := sha256.Sum256(state.PeerCertificates[0].RawSubjectPublicKeyInfo)
			if "sha256/"+base64.StdEncoding.EncodeToString(sum[:]) != normalInv.PinSHA256 {
				return errors.New("pin mismatch")
			}
			return nil
		}}
	client := &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{
		TLSClientConfig: tlsConfig, ForceAttemptHTTP2: false, DisableKeepAlives: true,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "tcp", fmt.Sprintf("127.0.0.1:%d", normal.Port))
		},
	}}
	var token string
	for attempt := 1; ; attempt++ {
		body := strings.NewReader(fmt.Sprintf(`{"pairingToken":%q,"deviceName":"Reference phone"}`, normalInv.PairingToken))
		response, err := client.Post(normalInv.BaseURL+"/v1/pairings", "application/json", body)
		if err == nil {
			payload, _ := io.ReadAll(io.LimitReader(response.Body, 65536))
			response.Body.Close()
			if response.StatusCode != 201 {
				return fmt.Errorf("/v1/pairings status %d", response.StatusCode)
			}
			var paired struct {
				DeviceToken string `json:"deviceToken"`
			}
			if json.Unmarshal(payload, &paired) != nil || paired.DeviceToken == "" {
				return errors.New("/v1/pairings: no device token")
			}
			token = paired.DeviceToken
			break
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("/v1/pairings: %w", err)
		}
		fmt.Printf("companion not reachable yet (attempt %d)\n", attempt)
		time.Sleep(2 * time.Second)
	}
	fmt.Println("pairing: 201, device token received")
	request, _ := http.NewRequest("GET", normalInv.BaseURL+"/v1/workspaces", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("/v1/workspaces: %w", err)
	}
	response.Body.Close()
	fmt.Printf("workspaces: %d\n", response.StatusCode)
	if response.StatusCode != 200 {
		return errors.New("authenticated read failed")
	}
	fmt.Println("PASS: phone paired and read over Tailcat")
	return nil
}
