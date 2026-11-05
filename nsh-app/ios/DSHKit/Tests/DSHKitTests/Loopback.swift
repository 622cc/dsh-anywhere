// A stand-in companion on 127.0.0.1: one HTTP/1.1 exchange, the request recorded (fixed-length or chunked body), a
// fixed answer sent.
import Foundation
import Network

struct Seen { var method = "", path = "", query: String?, headers: [String: String] = [:], body = Data() }

final class Loopback: @unchecked Sendable {
    private let listener: NWListener
    private let lock = NSLock()
    private var seen: Seen?
    private(set) var port = 0

    init(status: Int, answer: String) throws {
        let p = NWParameters.tcp
        p.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: p)
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { if case .ready = $0 { ready.signal() } }
        listener.newConnectionHandler = { [weak self] c in self?.serve(c, status: status, answer: answer) }
        listener.start(queue: .global())
        _ = ready.wait(timeout: .now() + 5)
        port = Int(listener.port?.rawValue ?? 0)
    }

    var request: Seen? { lock.lock(); defer { lock.unlock() }; return seen }

    private func serve(_ c: NWConnection, status: Int, answer: String) {
        c.start(queue: .global())
        var buffer = Data()
        func receive() {
            c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [self] data, _, done, _ in
                if let data { buffer.append(data) }
                if let s = parse(buffer) {
                    lock.lock(); seen = s; lock.unlock()
                    let body = Data(answer.utf8)
                    var head = Data("HTTP/1.1 \(status) X\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8)
                    head.append(body)
                    c.send(content: head, completion: .contentProcessed { _ in c.cancel() })
                } else if !done {
                    receive()
                }
            }
        }
        receive()
    }

    /// The whole request once it has arrived, else nil.
    private func parse(_ data: Data) -> Seen? {
        guard let end = data.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let lines = String(decoding: data[..<end.lowerBound], as: UTF8.self).components(separatedBy: "\r\n")
        let first = lines[0].split(separator: " ").map(String.init)
        var s = Seen()
        s.method = first[0]
        let target = first[1].split(separator: "?", maxSplits: 1).map(String.init)
        s.path = target[0]; s.query = target.count > 1 ? target[1] : nil
        for l in lines.dropFirst() { if let i = l.firstIndex(of: ":") { s.headers[l[..<i].lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces) } }
        var rest = Data(data[end.upperBound...])
        if s.headers["transfer-encoding"]?.lowercased() == "chunked" {
            var body = Data()
            while true {
                guard let crlf = rest.range(of: Data("\r\n".utf8)), let n = Int(String(decoding: rest[..<crlf.lowerBound], as: UTF8.self), radix: 16) else { return nil }
                if n == 0 { s.body = body; return s }
                let start = crlf.upperBound
                guard rest.count >= start - rest.startIndex + n + 2 else { return nil }
                body.append(rest[start..<start + n])
                rest = Data(rest[(start + n + 2)...])
            }
        }
        let length = Int(s.headers["content-length"] ?? "0") ?? 0
        guard rest.count >= length else { return nil }
        s.body = Data(rest.prefix(length))
        return s
    }

    deinit { listener.cancel() }
}
