// What a pairing QR and the invitation it leads to may contain (docs/TAILCAT.md: bootstrap v1, invitation v4), as the
// Android shell's Invite.java. The QR only reaches a short-lived pairing node; the invitation names the computer's one
// certificate, which is the only one this phone will ever trust for it.
import CryptoKit
import Foundation

/// A refusal as a code (link/expired, link/invalid, link/certificate, ...): the app words it in the phone's language.
public struct LinkFailure: Error, Equatable, LocalizedError {
    public let code: String
    public init(_ code: String) { self.code = code }
    public var errorDescription: String? { code }
}

/// The QR's capability: the pairing node and the proof it asks for.
public struct Bootstrap: Equatable, Sendable {
    public let address: String, key: String, proof: String
}

/// The computer this phone pairs with: its node, the one name and certificate its TLS may show, the one-time token.
public struct Invitation: Equatable, Sendable {
    public let json: String, serverName: String, address: String, port: Int, pairingToken: String
    public let certificate: Certificate

    /// Whether a TLS server's leaf certificate is the invited one: no system roots, no other key.
    public func trusts(leaf der: Data) -> Bool { !der.isEmpty && der == certificate.der }

    /// Whether `other` invites to the same node, port, name and certificate.
    public func sameComputer(as other: Invitation) -> Bool {
        address == other.address && port == other.port && serverName == other.serverName && certificate == other.certificate
    }
}

public enum Invite {
    public static let pairingPort = 48932, normalPort = 48931
    private static var baseURL: Regex<(Substring, Substring)> { #/https:\/\/(h-[0-9a-f]{32}\.dsh\.invalid)/# }
    private static var address: Regex<Substring> { #/tc[A-Za-z0-9_-]{8,2048}/# }
    private static var secret: Regex<Substring> { #/[A-Za-z0-9_-]{43}/# }

    /// The QR text (`dshm1:` zlib, base64url) or the plain JSON a same-Wi-Fi pairing delivers.
    public static func bootstrap(_ text: String, nowMs: Int64) throws -> Bootstrap {
        let json: Data
        if text.hasPrefix("dshm1:") {
            guard let data = base64url(String(text.dropFirst(6))) else { throw LinkFailure("link/invalid") }
            json = try Inflate.zlib(data)
        } else {
            json = Data(text.utf8)
        }
        guard let o = object(json), let t = o["tailcat"] as? [String: Any],
            let version = integer(o["version"]), let expiresAt = integer(o["expiresAt"])
        else { throw LinkFailure("link/invalid") }
        if version != 1 || expiresAt <= nowMs { throw LinkFailure("link/expired") }
        guard let a = t["address"] as? String, let key = t["key"] as? String, let proof = t["proof"] as? String,
            integer(t["port"]) == Int64(pairingPort), a.wholeMatch(of: address) != nil, key.hasPrefix("privkey:"),
            proof.wholeMatch(of: secret) != nil
        else { throw LinkFailure("link/invalid") }
        return Bootstrap(address: a, key: key, proof: proof)
    }

    public static func invitation(_ json: String) throws -> Invitation {
        guard let o = object(Data(json.utf8)), let t = o["tailcat"] as? [String: Any], integer(o["version"]) == 4,
            let base = (o["baseUrl"] as? String)?.wholeMatch(of: baseURL), integer(t["port"]) == Int64(normalPort),
            let a = t["address"] as? String, a.wholeMatch(of: address) != nil,
            let token = o["pairingToken"] as? String, token.wholeMatch(of: secret) != nil,
            let pem = o["certificatePem"] as? String, let pinned = o["pinSha256"] as? String
        else { throw LinkFailure("link/invalid") }
        let host = String(base.1)
        let cert = try Certificate(pem: pem)
        guard pin(cert) == pinned, cert.dnsNames == [host] else { throw LinkFailure("link/certificate") }
        return Invitation(json: json, serverName: host, address: a, port: normalPort, pairingToken: token, certificate: cert)
    }

    /// `sha256/` + base64 of the SHA-256 of the certificate's SubjectPublicKeyInfo (host/src/config.ts).
    public static func pin(_ cert: Certificate) -> String {
        "sha256/" + Data(SHA256.hash(data: cert.spki)).base64EncodedString()
    }

    private static func object(_ data: Data) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// A JSON integer (not a boolean, not a fraction).
    private static func integer(_ value: Any?) -> Int64? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let i = n.int64Value
        return NSNumber(value: i) == n ? i : nil
    }

    /// Base64url with or without padding; anything outside its alphabet is refused.
    private static func base64url(_ s: String) -> Data? {
        guard !s.isEmpty, s.wholeMatch(of: #/[A-Za-z0-9_-]+={0,2}/#) != nil else { return nil }
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        b = b.trimmingCharacters(in: CharacterSet(charactersIn: "="))
        b += String(repeating: "=", count: (4 - b.count % 4) % 4)
        return Data(base64Encoded: b)
    }
}
