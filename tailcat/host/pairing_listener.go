package main

import (
	"net"
)

// pairingListener adapts the Tailcat connection stream to net.Listener so the
// proven Voxt HTTP pairing handler can serve the temporary pairing node.
type pairingListener struct{ listener *connectionListener }

func (l *pairingListener) Accept() (net.Conn, error) { return l.listener.accept() }
func (l *pairingListener) Close() error              { l.listener.close(); return nil }
func (l *pairingListener) Addr() net.Addr {
	return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: pairingPort}
}
