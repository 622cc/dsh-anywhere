package dshtailcat

import (
	"net"

	"tailscale.com/net/netmon"
)

// ifaddrRow is one getifaddrs(3) entry. Android apps targeting SDK 30+ cannot bind netlink,
// so net.Interfaces fails ("netlinkrib: permission denied") and Tailcat's netmon.New refuses
// to start; getifaddrs remains allowed and is what java.net.NetworkInterface uses.
type ifaddrRow struct {
	name  string
	index int
	flags uint32 // Linux IFF_* bits.
	ip    net.IP // nil for a link row without an address.
	mask  net.IPMask
}

// Linux IFF_* values; fixed by the kernel ABI, unlike the host's syscall constants.
const (
	linuxIFFUp           = 0x1
	linuxIFFBroadcast    = 0x2
	linuxIFFLoopback     = 0x8
	linuxIFFPointToPoint = 0x10
	linuxIFFRunning      = 0x40
	linuxIFFMulticast    = 0x1000
)

func linuxFlags(bits uint32) net.Flags {
	var flags net.Flags
	for _, m := range []struct {
		bit  uint32
		flag net.Flags
	}{{linuxIFFUp, net.FlagUp}, {linuxIFFBroadcast, net.FlagBroadcast}, {linuxIFFLoopback, net.FlagLoopback},
		{linuxIFFPointToPoint, net.FlagPointToPoint}, {linuxIFFRunning, net.FlagRunning}, {linuxIFFMulticast, net.FlagMulticast}} {
		if bits&m.bit != 0 {
			flags |= m.flag
		}
	}
	return flags
}

// interfacesFromRows groups rows by interface name in first-seen order. AltAddrs is always
// non-nil so netmon never falls back to the denied netlink path for an address-less link.
func interfacesFromRows(rows []ifaddrRow) []netmon.Interface {
	var out []netmon.Interface
	byName := map[string]int{}
	for _, row := range rows {
		i, ok := byName[row.name]
		if !ok {
			i = len(out)
			byName[row.name] = i
			out = append(out, netmon.Interface{
				Interface: &net.Interface{Index: row.index, Name: row.name, Flags: linuxFlags(row.flags)},
				AltAddrs:  []net.Addr{},
			})
		}
		if row.ip == nil {
			continue
		}
		ip := row.ip
		if v4 := ip.To4(); v4 != nil {
			ip = v4
		}
		out[i].AltAddrs = append(out[i].AltAddrs, &net.IPNet{IP: ip, Mask: row.mask})
	}
	return out
}
