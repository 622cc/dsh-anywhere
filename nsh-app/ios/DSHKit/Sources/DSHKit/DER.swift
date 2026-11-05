// The two fields of an X.509 certificate pairing reads: the SubjectPublicKeyInfo (whose hash is the pin) and the
// subjectAltName's DNS names. A reader of DER's tag-length-value encoding, only as far as those fields; the
// system parses the whole certificate first (SecCertificateCreateWithData), so anything malformed is refused there.
import Foundation
import Security

public struct Certificate: Equatable, Sendable {
    /// The certificate as DER.
    public let der: Data
    /// Its SubjectPublicKeyInfo, as DER.
    public let spki: Data
    /// The dNSName entries of its subjectAltName, in order.
    public let dnsNames: [String]

    /// The first certificate of a PEM text.
    public init(pem: String) throws {
        let body = pem.components(separatedBy: "-----BEGIN CERTIFICATE-----").dropFirst().first?
            .components(separatedBy: "-----END CERTIFICATE-----").first
        guard let body, let der = Data(base64Encoded: body, options: .ignoreUnknownCharacters) else { throw LinkFailure("link/invalid") }
        try self.init(der: der)
    }

    public init(der: Data) throws {
        guard SecCertificateCreateWithData(nil, der as CFData) != nil else { throw LinkFailure("link/invalid") }
        var top = DERReader(der)
        guard var cert = top.read(0x30)?.contents, var tbs = cert.read(0x30)?.contents else { throw LinkFailure("link/invalid") }
        _ = tbs.read(0xA0) // version
        for tag: UInt8 in [0x02, 0x30, 0x30, 0x30, 0x30] { guard tbs.read(tag) != nil else { throw LinkFailure("link/invalid") } } // serial, signature, issuer, validity, subject
        guard let spki = tbs.read(0x30) else { throw LinkFailure("link/invalid") }
        _ = tbs.read(0x81); _ = tbs.read(0x82) // issuer and subject unique ids
        var names: [String] = []
        if var wrapper = tbs.read(0xA3)?.contents, var extensions = wrapper.read(0x30)?.contents {
            while var ext = extensions.read(0x30)?.contents {
                guard let id = ext.read(0x06) else { throw LinkFailure("link/invalid") }
                _ = ext.read(0x01) // critical
                guard let value = ext.read(0x04) else { throw LinkFailure("link/invalid") }
                guard id.value == Data([0x55, 0x1D, 0x11]) else { continue } // 2.5.29.17 subjectAltName
                var outer = DERReader(value.value)
                guard var general = outer.read(0x30)?.contents else { throw LinkFailure("link/invalid") }
                while let name = general.next() {
                    if name.tag == 0x82 { names.append(String(decoding: name.value, as: UTF8.self)) } // [2] dNSName
                }
            }
        }
        self.der = der
        self.spki = spki.raw
        self.dnsNames = names
    }
}

/// One element: its tag, its value and its whole encoding.
struct DERElement {
    let tag: UInt8
    let value: Data
    let raw: Data
    var contents: DERReader { DERReader(value) }
}

/// Reads elements one after another from DER bytes.
struct DERReader {
    private let data: Data
    private var at: Int

    init(_ data: Data) { self.data = Data(data); at = 0 }

    /// The next element, whatever its tag; nil at the end or on a malformed length.
    mutating func next() -> DERElement? {
        let start = at
        guard at + 2 <= data.count else { return nil }
        let tag = data[at]
        var length = Int(data[at + 1])
        at += 2
        if length & 0x80 != 0 {
            let count = length & 0x7F
            guard count > 0, count <= 4, at + count <= data.count else { at = start; return nil }
            length = data[at..<at + count].reduce(0) { $0 << 8 | Int($1) }
            at += count
        }
        guard length >= 0, at + length <= data.count else { at = start; return nil }
        let value = data[at..<at + length]
        at += length
        return DERElement(tag: tag, value: Data(value), raw: Data(data[start..<at]))
    }

    /// The next element if it has `tag`; otherwise nil, and nothing is read.
    mutating func read(_ tag: UInt8) -> DERElement? {
        let start = at
        guard let e = next() else { return nil }
        if e.tag == tag { return e }
        at = start
        return nil
    }
}
