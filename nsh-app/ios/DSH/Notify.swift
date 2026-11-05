// What the app tells the person while it is away, and the way back to the chat it is about (as the Android shell's
// Notify.java). notify.permission → {granted}; notify.request → asks once for alerts → {granted, decided}.
// notify.show {id, kind: answer|failed|decision, title, body} → one notification per chat (identifier = id), replaced by
// the next; a tap opens the app on that chat (the `notify.open` event {id}, or `open` in host.params on a cold start).
// notify.clear {id} → that chat's notification goes. notify.watch {title, body} | null → while the app is away and a
// chat runs, the app asks iOS for background time to keep watching. iOS gives a few tens of seconds, not a foreground
// service: news from a turn that ends later waits for the app to come back (a push from the computer would need APNs).
// app.state → {active}; the `app.state` event {active} when the app comes to the screen or leaves it.
import NativeShell
import UIKit
import UserNotifications

@MainActor
final class Notify: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notify()
    private let center = UNUserNotificationCenter.current()
    private weak var view: NshAppView?
    /// The chat of a notification tapped before the app's view exists (a cold start): `open` in host.params.
    private(set) var pendingOpen: String?
    private var watch: [String: Any]?
    private var active = true
    private var background: UIBackgroundTaskIdentifier = .invalid

    /// From application(_:didFinishLaunchingWithOptions:), so a tap that launched the app reaches the delegate.
    func start() {
        center.delegate = self
        // Hidden previews (the lock screen by default) show only what kind of news a chat has, not its name or words.
        center.setNotificationCategories(Set(["answer", "failed", "decision"].map {
            UNNotificationCategory(identifier: $0, actions: [], intentIdentifiers: [], hiddenPreviewsBodyPlaceholder: Notify.what($0))
        }))
        let app = NotificationCenter.default
        app.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { Notify.shared.activeChanged(false) }
        }
        // Became active, not will-enter-foreground: a cold launch can load the view while the app still reads as in the
        // background (seen on the iOS 26 simulator), and only this says it then came on screen.
        app.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { Notify.shared.activeChanged(true) }
        }
    }

    func attach(_ view: NshAppView) {
        self.view = view
        active = UIApplication.shared.applicationState != .background
        view.handle("app.state") { [self] _, reply in trace("app.state", active); reply.resolve(["active": active]) }
        view.handle("notify.permission") { [self] _, reply in
            trace("notify.permission", nil)
            Task { reply.resolve(["granted": await granted()]) }
        }
        // The phone's notification settings for this app, from the app's Settings page.
        view.handle("notify.settings") { [self] _, reply in
            trace("notify.settings", nil)
            Task { @MainActor in
                guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else { return reply.reject("settings/unavailable") }
                UIApplication.shared.open(url)
                reply.resolve(nil)
            }
        }
        view.handle("notify.request") { [self] _, reply in
            trace("notify.request", nil)
            Task {
                let ok = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
                // Still not determined: iOS did not put the question to the person (the app was not on screen), so the
                // app asks again another time.
                let decided = await center.notificationSettings().authorizationStatus != .notDetermined
                reply.resolve(["granted": ok ? true : await granted(), "decided": decided])
            }
        }
        view.handle("notify.show") { [self] data, reply in
            trace("notify.show", data)
            let m = data as? [String: Any] ?? [:]
            guard let id = m["id"] as? String else { return reply.reject("id is required") }
            Task {
                guard await granted() else { return reply.resolve(["shown": false]) }
                let kind = m["kind"] as? String ?? "answer", title = m["title"] as? String ?? "", body = m["body"] as? String ?? ""
                let content = UNMutableNotificationContent()
                let what = Notify.what(kind)
                content.title = title.isEmpty ? what : title
                content.body = body.isEmpty ? what : body
                if !body.isEmpty { content.subtitle = what }
                content.categoryIdentifier = ["failed", "decision"].contains(kind) ? kind : "answer"
                content.threadIdentifier = "chats"
                content.sound = .default
                content.userInfo = ["open": id]
                do {
                    try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
                    reply.resolve(["shown": true])
                } catch { reply.reject("\(error)") }
            }
        }
        view.handle("notify.clear") { [self] data, reply in
            trace("notify.clear", data)
            if let id = (data as? [String: Any])?["id"] as? String {
                center.removeDeliveredNotifications(withIdentifiers: [id])
                center.removePendingNotificationRequests(withIdentifiers: [id])
            }
            reply.resolve(nil)
        }
        view.handle("notify.watch") { [self] data, reply in
            trace("notify.watch", data)
            watch = data as? [String: Any]
            if watch == nil { endWatching() } else if !active { beginWatching() }
            reply.resolve(nil)
        }
    }

    /// What the app asks of the shell, in a debug build's log (`log show --predicate 'process == "DSH"'`).
    private func trace(_ name: String, _ data: Any?) {
        #if DEBUG
        NSLog("dsh notify: %@ %@", name, String(describing: data ?? ""))
        #endif
    }

    private func granted() async -> Bool {
        let s = await center.notificationSettings()
        return [.authorized, .provisional, .ephemeral].contains(s.authorizationStatus)
    }

    private func activeChanged(_ now: Bool) {
        guard now != active else { return }
        active = now
        if now { endWatching() } else if watch != nil { beginWatching() }
        view?.send("app.state", ["active": now])
    }

    private func beginWatching() {
        guard background == .invalid else { return }
        background = UIApplication.shared.beginBackgroundTask(withName: "watching") { [weak self] in self?.endWatching() }
    }

    private func endWatching() {
        guard background != .invalid else { return }
        UIApplication.shared.endBackgroundTask(background)
        background = .invalid
    }

    /// Clears the cold-start chat once the app has it.
    func takePendingOpen() -> String? { defer { pendingOpen = nil }; return pendingOpen }

    static func what(_ kind: String) -> String {
        kind == "decision" ? Words.notifyDecision : kind == "failed" ? Words.notifyFailed : Words.notifyAnswer
    }

    // A chat's news while the app is on screen came through the app's own banner; one that lands as the app comes
    // back still shows. The completion-handler forms, called on the main thread: with the async forms UIKit finished
    // the tap off the main thread and stopped the app (an assertion in -[UIApplication
    // _updateSnapshotAndStateRestorationWithAction:], seen on the iOS 26 simulator, 2026-10-30).
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .list, .sound])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler done: @escaping () -> Void) {
        let id = response.notification.request.content.userInfo["open"] as? String
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                if let id { if let view = Notify.shared.view { view.send("notify.open", ["id": id]) } else { Notify.shared.pendingOpen = id } }
            }
            done()
        }
    }
}
