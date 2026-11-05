// Pairing input the phone must refuse or accept: the Android shell's fixtures (made by the companion's own encoders,
// android/app/src/test/resources/pairing.json) and extra.json (make-fixtures.py). Synthetic keys, hosts and tokens.
import DSHKit
import Foundation
import XCTest

final class InviteTests: XCTestCase {
    private let now: Int64 = 1_800_000_000_000

    private func pairing() throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../../android/app/src/test/resources/pairing.json").standardized
        return try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    }

    private func extra() throws -> [String: Any] {
        let url = Bundle.module.url(forResource: "extra", withExtension: "json", subdirectory: "Fixtures")!
        return try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    }

    private func text(_ o: Any) -> String { String(decoding: try! JSONSerialization.data(withJSONObject: o), as: UTF8.self) }

    private func refused(_ code: String, _ body: () throws -> Any, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try body(), file: file, line: line) { XCTAssertEqual(($0 as? LinkFailure)?.code, code, file: file, line: line) }
    }

    private func invitation(_ change: (inout [String: Any]) throws -> Void) throws -> String {
        var o = try pairing()["invitation"] as! [String: Any]
        try change(&o)
        return text(o)
    }

    func testTheQrDecodesToThePairingNodeCapability() throws {
        let f = try pairing()
        let b = try Invite.bootstrap(f["qr"] as! String, nowMs: now)
        let t = (f["bootstrap"] as! [String: Any])["tailcat"] as! [String: Any]
        XCTAssertEqual(b.address, t["address"] as? String)
        XCTAssertEqual(b.key, t["key"] as? String)
        XCTAssertEqual(b.proof, t["proof"] as? String)
    }

    func testThePlainJsonOfASameWifiPairingIsReadToo() throws {
        let b = try Invite.bootstrap(text(try pairing()["bootstrap"]!), nowMs: now)
        XCTAssertEqual(b.proof, String(repeating: "A", count: 43))
    }

    func testAnExpiredOrMalformedBootstrapIsRefused() throws {
        let f = try pairing()
        refused("link/expired") { try Invite.bootstrap(f["qr"] as! String, nowMs: 4_102_444_800_001) }
        var wrongPort = f["bootstrap"] as! [String: Any]
        var t = wrongPort["tailcat"] as! [String: Any]; t["port"] = 48931; wrongPort["tailcat"] = t
        refused("link/invalid") { try Invite.bootstrap(self.text(wrongPort), nowMs: self.now) }
        refused("link/invalid") { try Invite.bootstrap("dshm1:not-zlib", nowMs: self.now) }
        refused("link/invalid") { try Invite.bootstrap("dshm1:", nowMs: self.now) }
        refused("link/invalid") { try Invite.bootstrap("{}", nowMs: self.now) }
    }

    func testTheQrInflatesToAtMost64KiB() throws {
        let x = try extra()
        XCTAssertNoThrow(try Invite.bootstrap(x["qrAtCap"] as! String, nowMs: now))
        refused("link/invalid") { try Invite.bootstrap(x["qrOverCap"] as! String, nowMs: self.now) }
        refused("link/invalid") { try Invite.bootstrap(x["qrWithDictionary"] as! String, nowMs: self.now) }
    }

    func testTheInvitationNamesOneHostWhoseCertificateMatchesThePin() throws {
        let inv = try Invite.invitation(try invitation { _ in })
        XCTAssertEqual(inv.serverName, "h-0123456789abcdef0123456789abcdef.dsh.invalid")
        XCTAssertEqual(inv.port, 48931)
        XCTAssertEqual(inv.pairingToken, String(repeating: "B", count: 43))
        XCTAssertEqual(inv.address, "tcSYNTHETICADDRESSaGVsbG8")
    }

    func testAnInvitationWithAnotherCertificatePinOrHostIsRefused() throws {
        let f = try pairing()
        refused("link/certificate") { try Invite.invitation(try self.invitation { $0["pinSha256"] = f["otherPin"] }) }
        refused("link/certificate") {
            try Invite.invitation(try self.invitation { $0["certificatePem"] = f["otherCertificatePem"]; $0["pinSha256"] = f["otherPin"] })
        }
        refused("link/invalid") { try Invite.invitation(try self.invitation { $0["baseUrl"] = "https://example.com" }) }
        refused("link/invalid") {
            try Invite.invitation(try self.invitation { var t = $0["tailcat"] as! [String: Any]; t["port"] = 48932; $0["tailcat"] = t })
        }
        refused("link/invalid") { try Invite.invitation(try self.invitation { $0["certificatePem"] = "not a certificate" }) }
        refused("link/invalid") { try Invite.invitation(try self.invitation { $0["version"] = 3 }) }
    }

    func testACertificateMustNameExactlyTheHost() throws {
        let x = try extra()
        for name in ["twoNames", "noName"] {
            let c = x[name] as! [String: Any]
            refused("link/certificate") {
                try Invite.invitation(try self.invitation { $0["certificatePem"] = c["certificatePem"]; $0["pinSha256"] = c["pinSha256"] })
            }
        }
    }

    func testThePinIsTheCompanionsSpkiHash() throws {
        let f = try pairing()
        let inv = f["invitation"] as! [String: Any]
        let cert = try Certificate(pem: inv["certificatePem"] as! String)
        XCTAssertEqual(Invite.pin(cert), inv["pinSha256"] as? String)
        XCTAssertEqual(Invite.pin(try Certificate(pem: f["otherCertificatePem"] as! String)), f["otherPin"] as? String)
    }

    func testTlsTrustsOnlyTheInvitedCertificate() throws {
        let f = try pairing()
        let inv = try Invite.invitation(try invitation { _ in })
        XCTAssertTrue(inv.trusts(leaf: try Certificate(pem: (f["invitation"] as! [String: Any])["certificatePem"] as! String).der))
        XCTAssertFalse(inv.trusts(leaf: try Certificate(pem: f["otherCertificatePem"] as! String).der))
        XCTAssertFalse(inv.trusts(leaf: Data()))
    }
}
