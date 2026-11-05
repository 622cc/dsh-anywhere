// The bridge carries plain app traffic as TLS that trusts only the invited certificate: a stand-in companion with
// that certificate echoes through it; one with any other certificate gets nothing and the app's connection closes
// (as android BridgeTest).
import DSHKit
import Foundation
import Network
import XCTest

final class BridgeTests: XCTestCase {
    private func json(_ url: URL) throws -> [String: Any] { try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any] }
    private var pairingURL: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../android/app/src/test/resources/pairing.json").standardized
    }

    private func identity(_ name: String) throws -> SecIdentity {
        let x = try json(Bundle.module.url(forResource: "extra", withExtension: "json", subdirectory: "Fixtures")!)
        var items: CFArray?
        var options: [CFString: Any] = [kSecImportExportPassphrase: "test"]
        // Never into the Mac's keychain (iOS keeps imports in memory anyway).
        if #available(iOS 18, macOS 15, *) { options[kSecImportToMemoryOnly] = true }
        let status = SecPKCS12Import(Data(base64Encoded: x[name] as! String)! as CFData, options as CFDictionary, &items)
        XCTAssertEqual(status, errSecSuccess)
        let first = (items as! [[String: Any]])[0]
        return first[kSecImportItemIdentity as String] as! SecIdentity
    }

    /// A TLS echo server on 127.0.0.1 presenting `identity`; records the SNI it was asked for.
    private final class Companion: @unchecked Sendable {
        let listener: NWListener
        private(set) var port = 0
        init(_ identity: SecIdentity) throws {
            let tls = NWProtocolTLS.Options()
            sec_protocol_options_set_local_identity(tls.securityProtocolOptions, sec_identity_create(identity)!)
            let p = NWParameters(tls: tls)
            p.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
            listener = try NWListener(using: p)
            let ready = DispatchSemaphore(value: 0)
            listener.stateUpdateHandler = { if case .ready = $0 { ready.signal() } }
            listener.newConnectionHandler = { c in
                c.start(queue: .global())
                func echo() {
                    c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, done, error in
                        if let data, !data.isEmpty { c.send(content: data, completion: .contentProcessed { _ in }) }
                        if !done && error == nil { echo() }
                    }
                }
                echo()
            }
            listener.start(queue: .global())
            _ = ready.wait(timeout: .now() + 5)
            port = Int(listener.port!.rawValue)
        }
        deinit { listener.cancel() }
    }

    /// Sends `text` to the bridge as the app would and returns what comes back within `timeout` (nil: closed, nothing).
    private func roundTrip(_ port: Int, _ text: String, timeout: TimeInterval = 10) -> String? {
        let c = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: UInt16(port))!, using: .tcp)
        let done = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var answer: String?
        c.stateUpdateHandler = { if case .ready = $0 {
            c.send(content: Data(text.utf8), completion: .contentProcessed { _ in })
            c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, _ in
                if let data, !data.isEmpty { answer = String(decoding: data, as: UTF8.self) }
                done.signal()
            }
        } }
        c.start(queue: .global())
        _ = done.wait(timeout: .now() + timeout)
        c.cancel()
        return answer
    }

    func testTheInvitedCompanionEchoesThroughTheBridge() throws {
        let inv = try Invite.invitation(String(decoding: try JSONSerialization.data(withJSONObject: try json(pairingURL)["invitation"]!), as: UTF8.self))
        let companion = try Companion(try identity("companionP12"))
        let bridge = try Bridge(invitation: inv, tailcatPort: companion.port)
        defer { bridge.close() }
        XCTAssertEqual(roundTrip(bridge.port, "GET / HTTP/1.1\r\n\r\n"), "GET / HTTP/1.1\r\n\r\n")
        XCTAssertEqual(roundTrip(bridge.port, "again"), "again")
    }

    func testAnyOtherCertificateGetsNothing() throws {
        let inv = try Invite.invitation(String(decoding: try JSONSerialization.data(withJSONObject: try json(pairingURL)["invitation"]!), as: UTF8.self))
        let impostor = try Companion(try identity("otherP12"))
        let bridge = try Bridge(invitation: inv, tailcatPort: impostor.port)
        defer { bridge.close() }
        XCTAssertNil(roundTrip(bridge.port, "secret"))
    }

    func testTheBridgeServesOnlyTheSameComputer() throws {
        let f = try json(pairingURL)
        let inv = try Invite.invitation(String(decoding: try JSONSerialization.data(withJSONObject: f["invitation"]!), as: UTF8.self))
        let bridge = try Bridge(invitation: inv, tailcatPort: 9)
        defer { bridge.close() }
        XCTAssertTrue(bridge.serves(inv))
        var other = f["invitation"] as! [String: Any]
        var t = other["tailcat"] as! [String: Any]; t["address"] = "tcANOTHERNODEaGVsbG8"; other["tailcat"] = t
        XCTAssertFalse(bridge.serves(try Invite.invitation(String(decoding: try JSONSerialization.data(withJSONObject: other), as: UTF8.self))))
    }
}
