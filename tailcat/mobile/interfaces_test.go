package dshtailcat

import (
	"net"
	"reflect"
	"testing"
)

// Android apps (targetSdk 30+) cannot bind netlink, so Go's net.Interfaces fails and Tailcat's
// netmon.New refuses to start. The app sandbox still allows getifaddrs; these are its rows.
func TestInterfacesFromAddressRowsGroupsByNameAndMapsLinuxFlags(t *testing.T) {
	const up, broadcast, loopback, running, multicast = 0x1, 0x2, 0x8, 0x40, 0x1000
	rows := []ifaddrRow{
		{name: "lo", index: 1, flags: up | loopback | running, ip: net.IPv4(127, 0, 0, 1), mask: net.CIDRMask(8, 32)},
		{name: "wlan0", index: 7, flags: up | broadcast | running | multicast, ip: net.IPv4(192, 0, 2, 19), mask: net.CIDRMask(24, 32)},
		{name: "wlan0", index: 7, flags: up | broadcast | running | multicast, ip: net.ParseIP("fec0::1"), mask: net.CIDRMask(64, 128)},
		{name: "dummy0", index: 9, flags: 0, ip: nil, mask: nil}, // A link row without an address.
	}
	got := interfacesFromRows(rows)
	if len(got) != 3 {
		t.Fatalf("want 3 interfaces in first-seen order, got %d", len(got))
	}
	lo, wlan, dummy := got[0], got[1], got[2]
	if lo.Name != "lo" || lo.Index != 1 || !lo.IsLoopback() || !lo.IsUp() {
		t.Fatalf("loopback mapped wrong: %+v flags=%v", lo.Interface, lo.Flags)
	}
	if wlan.Name != "wlan0" || wlan.Index != 7 || wlan.Flags != net.FlagUp|net.FlagBroadcast|net.FlagRunning|net.FlagMulticast {
		t.Fatalf("wlan0 mapped wrong: %+v flags=%v", wlan.Interface, wlan.Flags)
	}
	addrs, err := wlan.Addrs()
	want := []net.Addr{
		&net.IPNet{IP: net.IPv4(192, 0, 2, 19).To4(), Mask: net.CIDRMask(24, 32)},
		&net.IPNet{IP: net.ParseIP("fec0::1"), Mask: net.CIDRMask(64, 128)},
	}
	if err != nil || !reflect.DeepEqual(addrs, want) {
		t.Fatalf("wlan0 addresses: %v %v", addrs, err)
	}
	if dummy.IsUp() || dummy.AltAddrs == nil || len(dummy.AltAddrs) != 0 {
		t.Fatalf("an address-less link must report zero addresses, not fall back to net.Interfaces: %+v", dummy)
	}
}
