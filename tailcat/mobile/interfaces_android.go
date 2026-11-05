//go:build android

package dshtailcat

/*
#include <ifaddrs.h>
#include <net/if.h>
#include <netinet/in.h>
#include <sys/socket.h>
*/
import "C"

import (
	"errors"
	"net"
	"unsafe"

	"tailscale.com/net/netmon"
)

// Inside the app sandbox, netmon would otherwise fail with "netlinkrib: permission denied"
// before any Tailcat dial (measured on an API 36 emulator, 2026-10-28: the same binary dials in
// ~3 s from adb shell and fails instantly under run-as). See interfaces.go.
func init() { netmon.RegisterInterfaceGetter(androidInterfaces) }

func androidInterfaces() ([]netmon.Interface, error) {
	var head *C.struct_ifaddrs
	if C.getifaddrs(&head) != 0 {
		return nil, errors.New("getifaddrs failed")
	}
	defer C.freeifaddrs(head)
	var rows []ifaddrRow
	for ifa := head; ifa != nil; ifa = ifa.ifa_next {
		if ifa.ifa_name == nil {
			continue
		}
		row := ifaddrRow{name: C.GoString(ifa.ifa_name), flags: uint32(ifa.ifa_flags)}
		row.index = int(C.if_nametoindex(ifa.ifa_name))
		row.ip, row.mask = sockaddrIP(ifa.ifa_addr, ifa.ifa_netmask)
		rows = append(rows, row)
	}
	return interfacesFromRows(rows), nil
}

func sockaddrIP(addr, mask *C.struct_sockaddr) (net.IP, net.IPMask) {
	if addr == nil {
		return nil, nil
	}
	switch addr.sa_family {
	case C.AF_INET:
		ip := net.IP(C.GoBytes(unsafe.Pointer(&(*C.struct_sockaddr_in)(unsafe.Pointer(addr)).sin_addr), 4))
		m := net.CIDRMask(0, 32)
		if mask != nil {
			m = net.IPMask(C.GoBytes(unsafe.Pointer(&(*C.struct_sockaddr_in)(unsafe.Pointer(mask)).sin_addr), 4))
		}
		return ip, m
	case C.AF_INET6:
		ip := net.IP(C.GoBytes(unsafe.Pointer(&(*C.struct_sockaddr_in6)(unsafe.Pointer(addr)).sin6_addr), 16))
		m := net.CIDRMask(0, 128)
		if mask != nil {
			m = net.IPMask(C.GoBytes(unsafe.Pointer(&(*C.struct_sockaddr_in6)(unsafe.Pointer(mask)).sin6_addr), 16))
		}
		return ip, m
	}
	return nil, nil
}
