// The phone's link to the owner's computer, as host functions for the app (as the Android shell's Link.java):
//   link.state   → { paired: false } or { paired: true, origin, token } (origin = this phone's bridge to /dsh)
//   link.scan    → the text of a scanned QR (VisionKit's scanner, Scanner.swift)
//   link.pair    { text } → as link.state; the one-time QR (or a dshm1: link) to a paired device
//   link.reset   → a new tunnel and bridge, as link.state (the app found the link dead)
//   link.forget  → unpairs this phone on the computer (best effort) and forgets the link
//   link.path    → { route: direct | relay | unknown, relay? } how the tunnel reaches the computer now
// Pairing follows docs/TAILCAT.md: the QR opens a short-lived pairing node; POST /pair with its proof and this phone's
// durable Tailcat key returns invitation v4; then the normal node, pinned TLS (Bridge) and POST /v1/pairings.
import DSHKit
import Dshtailcat
import NativeShell
import UIKit

final class Link {
    private weak var host: UIViewController?
    private let vault = Vault()
    private let work = DispatchQueue(label: "dsh-link")
    private let deviceName = UIDevice.current.model
    private var scanner: Scanner?
    // One tunnel per process: a second Tailcat node with the same key leaves the new bridge's connections reset.
    private static var tunnel: Int64 = -1
    private static var bridge: Bridge?

    init(host: UIViewController) { self.host = host }

    @MainActor
    func attach(_ view: NshAppView) {
        view.handle("link.state") { [self] _, reply in work.async { self.answer(reply) { try self.state() } } }
        view.handle("link.pair") { [self] data, reply in
            let text = (data as? [String: Any])?["text"] as? String ?? ""
            work.async { self.answer(reply) { try self.pair(text) } }
        }
        view.handle("link.reset") { [self] _, reply in work.async { self.answer(reply) { Link.disconnect(); return try self.state() } } }
        view.handle("link.forget") { [self] _, reply in work.async { self.forget(); reply.resolve(nil) } }
        // Which part answers, for saying why the computer can't be reached: DshtailcatDiagnose's answer (up to eight
        // seconds, so off the link's own queue) or {error}.
        view.handle("link.diagnose") { _, reply in
            DispatchQueue.global(qos: .utility).async {
                let handle = Link.tunnel
                guard handle >= 0, let data = DshtailcatDiagnose(handle).data(using: .utf8),
                      let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { reply.resolve(["error": "no-tunnel"]); return }
                reply.resolve(o)
            }
        }
        // How the tunnel reaches the computer now: {route: "direct"}, {route: "relay", relay: code} or {route: "unknown"}.
        // Off the link's own queue: the answer may take up to three seconds (DshtailcatPath).
        view.handle("link.path") { _, reply in
            DispatchQueue.global(qos: .utility).async {
                let handle = Link.tunnel
                var out: [String: Any] = ["route": "unknown"]
                if handle >= 0, let data = DshtailcatPath(handle).data(using: .utf8),
                   let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let route = o["route"] as? String {
                    out["route"] = route
                    if let relay = o["relay"] as? String { out["relay"] = relay }
                }
                reply.resolve(out)
            }
        }
        view.handle("link.scan") { [self] _, reply in
            guard let host else { return reply.reject("cancelled") }
            scanner = Scanner.present(from: host) { [weak self] result in
                self?.scanner = nil
                switch result {
                case .success(let text): reply.resolve(text)
                case .failure(let e): reply.reject((e as? LinkFailure)?.code ?? e.localizedDescription)
                }
            }
        }
    }

    /// Where the app's requests go: the bridge's /dsh origin and this phone's device token.
    struct Endpoint { let origin: String, token: String }

    /// Called off the main thread.
    func endpoint() throws -> Endpoint {
        let s = try work.sync { try state() }
        guard s["paired"] as? Bool == true, let origin = s["origin"] as? String, let token = s["token"] as? String else {
            throw LinkFailure("link/not-linked")
        }
        return Endpoint(origin: origin, token: token)
    }

    private func answer(_ reply: NshHostReply, _ body: () throws -> [String: Any]) {
        do { reply.resolve(try body()) } catch { reply.reject((error as? LinkFailure)?.code ?? error.localizedDescription) }
    }

    private func saved() -> [String: Any]? {
        vault.read().flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
    }

    private func save(_ link: [String: Any]) throws {
        try vault.write(String(decoding: try JSONSerialization.data(withJSONObject: link), as: UTF8.self))
    }

    /// The paired computer's origin through the bridge, starting the tunnel if needed.
    private func state() throws -> [String: Any] {
        guard let link = saved(), let token = link["token"] as? String, let invitation = link["invitation"] as? String,
            let clientKey = link["clientKey"] as? String
        else { return ["paired": false] }
        let port = try Link.connect(try Invite.invitation(invitation), clientKey: clientKey)
        return ["paired": true, "origin": "http://127.0.0.1:\(port)/dsh", "token": token]
    }

    private func pair(_ text: String) throws -> [String: Any] {
        let boot = try Invite.bootstrap(text.trimmingCharacters(in: .whitespacesAndNewlines), nowMs: Int64(Date().timeIntervalSince1970 * 1000))
        var link = saved() ?? [:]
        if link["clientKey"] == nil { link["clientKey"] = DshtailcatNewClientKey(); try save(link) }
        let clientKey = link["clientKey"] as! String
        // 1. The pairing node: trade the QR's proof and this phone's public key for the invitation.
        let pairing = try Link.started(DshtailcatStart(boot.address, boot.key, Invite.pairingPort))
        let invitationText: String
        do {
            defer { _ = DshtailcatStop(pairing.handle) }
            let body = try JSONSerialization.data(withJSONObject: ["phoneKey": DshtailcatPublicKey(clientKey)])
            let answer = try Link.http("POST", "http://127.0.0.1:\(pairing.port)/pair", auth: "Bearer \(boot.proof)", body: body)
            guard let o = try? JSONSerialization.jsonObject(with: answer) as? [String: Any], let i = o["invitation"] as? String else {
                throw LinkFailure("link/invalid")
            }
            invitationText = i
        }
        let inv = try Invite.invitation(invitationText)
        // 2. The computer itself, over pinned TLS: the one-time pairing token becomes this phone's device token.
        let port = try Link.connect(inv, clientKey: clientKey)
        let body = try JSONSerialization.data(withJSONObject: ["pairingToken": inv.pairingToken, "deviceName": deviceName])
        let answer = try Link.http("POST", "http://127.0.0.1:\(port)/v1/pairings", auth: nil, body: body)
        guard let device = try? JSONSerialization.jsonObject(with: answer) as? [String: Any], let token = device["deviceToken"] as? String else {
            throw LinkFailure("link/invalid")
        }
        link["invitation"] = inv.json
        link["token"] = token
        try save(link)
        return try state()
    }

    private func forget() {
        if let token = saved()?["token"] as? String, let b = Link.bridge {
            // Offline: the computer keeps the device until its owner revokes it.
            _ = try? Link.http("DELETE", "http://127.0.0.1:\(b.port)/v1/device", auth: "Bearer \(token)", body: nil)
        }
        Link.disconnect()
        vault.clear()
    }

    private static func connect(_ inv: Invitation, clientKey: String) throws -> Int {
        if let bridge, bridge.serves(inv) { return bridge.port }
        // Pairing with another computer: the old tunnel and bridge reach the old one.
        disconnect()
        let normal = try started(DshtailcatStart(inv.address, clientKey, inv.port))
        tunnel = normal.handle
        do {
            bridge = try Bridge(invitation: inv, tailcatPort: normal.port)
        } catch {
            disconnect()
            throw error
        }
        return bridge!.port
    }

    private static func disconnect() {
        bridge?.close()
        bridge = nil
        if tunnel >= 0 { _ = DshtailcatStop(tunnel); tunnel = -1 }
    }

    /// DshtailcatStart's answer: {"handle":n,"port":p} or {"error":code}.
    private static func started(_ answer: String) throws -> (handle: Int64, port: Int) {
        let o = (try? JSONSerialization.jsonObject(with: Data(answer.utf8))) as? [String: Any] ?? [:]
        if let e = o["error"] { throw LinkFailure("link/tunnel:\(e)") }
        guard let h = (o["handle"] as? NSNumber)?.int64Value, let p = (o["port"] as? NSNumber)?.intValue else { throw LinkFailure("link/tunnel:answer") }
        return (h, p)
    }

    /// One request, waited for on the calling (work) queue; 410 is link/expired, other refusals link/refused:<status>.
    static func http(_ method: String, _ url: String, auth: String?, body: Data?) throws -> Data {
        var request = URLRequest(url: URL(string: url)!, timeoutInterval: 30)
        request.httpMethod = method
        if let auth { request.setValue(auth, forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let done = DispatchSemaphore(value: 0)
        var result: Result<(Data, Int), Error> = .failure(LinkFailure("link/tunnel:timeout"))
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { result = .failure(error) } else { result = .success((data ?? Data(), (response as? HTTPURLResponse)?.statusCode ?? 0)) }
            done.signal()
        }.resume()
        done.wait()
        let (data, status) = try result.get()
        if status == 410 { throw LinkFailure("link/expired") }
        if status >= 400 { throw LinkFailure("link/refused:\(status)") }
        return data
    }
}
