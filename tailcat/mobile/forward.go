// Adapted from voxt-mobile ios/VoxtTailcat/Native (https://github.com/jt-wang/voxt-mobile),
// Copyright the Voxt Mobile authors, Apache-2.0. See tailcat/NOTICE.

package dshtailcat

import (
	"context"
	"io"
	"net"
	"sync"
	"time"
)

// forward listens on an ephemeral 127.0.0.1 port and bridges each accepted connection to
// a fresh dial. Dialing is lazy: nothing reaches the network until the app connects.
type forward struct {
	listener net.Listener
	ctx      context.Context
	cancel   context.CancelFunc
	mu       sync.Mutex
	closed   bool
	active   map[net.Conn]bool
	wg       sync.WaitGroup
	once     sync.Once
}

func startForward(dial func(context.Context) (net.Conn, error)) (*forward, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	f := &forward{listener: ln, ctx: ctx, cancel: cancel, active: make(map[net.Conn]bool)}
	f.wg.Add(1)
	go func() {
		defer f.wg.Done()
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			if !f.track(c) {
				_ = c.Close()
				return
			}
			f.wg.Add(1)
			go f.serve(c, dial)
		}
	}()
	return f, nil
}

func (f *forward) addr() string { return f.listener.Addr().String() }

func (f *forward) track(c net.Conn) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return false
	}
	f.active[c] = true
	return true
}

func (f *forward) untrack(c net.Conn) {
	_ = c.Close()
	f.mu.Lock()
	delete(f.active, c)
	f.mu.Unlock()
}

func (f *forward) serve(local net.Conn, dial func(context.Context) (net.Conn, error)) {
	defer f.wg.Done()
	defer f.untrack(local)
	ctx, cancel := context.WithTimeout(f.ctx, 10*time.Second)
	defer cancel()
	remote, err := dial(ctx)
	if err != nil {
		return
	}
	if !f.track(remote) {
		_ = remote.Close()
		return
	}
	defer f.untrack(remote)
	var copying sync.WaitGroup
	copying.Add(2)
	pipe := func(dst, src net.Conn) {
		defer copying.Done()
		_, _ = io.Copy(dst, src)
		if cw, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = cw.CloseWrite()
		} else {
			_ = dst.Close()
		}
	}
	go pipe(remote, local)
	go pipe(local, remote)
	copying.Wait()
}

func (f *forward) close() {
	f.once.Do(func() {
		f.cancel()
		_ = f.listener.Close()
		f.mu.Lock()
		f.closed = true
		for c := range f.active {
			_ = c.Close()
		}
		f.mu.Unlock()
		f.wg.Wait()
	})
}
