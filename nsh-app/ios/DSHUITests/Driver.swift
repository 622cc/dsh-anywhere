// Drives the app on a simulator for the side-by-side checks with the Android app (docs: ios/README in nsh-app/README.md).
// The simulator has no window to click, so this UI test takes one step at a time from a folder on the Mac that the
// checker writes to, `DSH_DRIVE_DIR` (passed as TEST_RUNNER_DSH_DRIVE_DIR to xcodebuild):
//   step.json  {"do": "tap", "id"|"label"|"x"+"y"} · {"do": "type", "text"} · {"do": "keys", "text"} · {"do": "shot", "name"} · {"do": "tree"}
//              {"do": "swipe", "dir": "up"|"down"|"left"|"right", "id"?} · {"do": "launch", "args": [...], "bundle"?}
//              {"do": "rotate", "to": "portrait"|"left"|"right"} · {"do": "wait", "id"|"label", "seconds"} · {"do": "stop"}
//              {"do": "texts"} (every label on screen) · "app": "springboard" on a tap, wait or tree for the system's prompts
//              and notifications · {"do": "home"} (the app goes to the background) · {"do": "pull"} (Notification Center)
//   done.json  what the step did ({ok, error?, tree?}); shots go to <name>.png beside it.
// It runs only when DSH_DRIVE_DIR is set; `xcodebuild test` without it skips.
import XCTest

final class Driver: XCTestCase {
    private var app = XCUIApplication()

    func testDrive() throws {
        guard let dir = ProcessInfo.processInfo.environment["DSH_DRIVE_DIR"].map(URL.init(fileURLWithPath:)) else {
            throw XCTSkip("DSH_DRIVE_DIR is not set")
        }
        continueAfterFailure = true
        executionTimeAllowance = 4 * 3600
        let step = dir.appendingPathComponent("step.json"), done = dir.appendingPathComponent("done.json")
        let deadline = Date().addingTimeInterval(4 * 3600)
        try? write(["ok": true, "ready": true], to: done)
        while Date() < deadline {
            guard let data = try? Data(contentsOf: step), let s = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                Thread.sleep(forTimeInterval: 0.2)
                continue
            }
            try? FileManager.default.removeItem(at: step)
            if s["do"] as? String == "stop" { try? write(["ok": true], to: done); return }
            var out: [String: Any] = ["ok": true, "do": s["do"] ?? ""]
            do { try run(s, dir: dir, out: &out) } catch { out = ["ok": false, "error": "\(error)"] }
            try? write(out, to: done)
        }
    }

    private struct Failure: Error, CustomStringConvertible { let description: String }

    private func element(_ s: [String: Any]) throws -> XCUIElement {
        // "app": "springboard" reaches the system's own prompts ("Open in DSH?").
        let target = s["app"] as? String == "springboard" ? XCUIApplication(bundleIdentifier: "com.apple.springboard") : app
        let q = target.descendants(matching: .any)
        let e: XCUIElement
        if let id = s["id"] as? String { e = q.matching(identifier: id).firstMatch }
        else if let label = s["label"] as? String { e = q.matching(NSPredicate(format: "label == %@", label)).firstMatch }
        else if let part = s["contains"] as? String { e = q.matching(NSPredicate(format: "label CONTAINS %@", part)).firstMatch }
        else { throw Failure(description: "no id, label or contains") }
        guard e.waitForExistence(timeout: (s["seconds"] as? Double) ?? 10) else { throw Failure(description: "not found: \(s)") }
        return e
    }

    private func run(_ s: [String: Any], dir: URL, out: inout [String: Any]) throws {
        switch s["do"] as? String {
        case "launch":
            // "bundle" launches another app (Safari, to tell the simulator's rotation from the app's).
            app = (s["bundle"] as? String).map { XCUIApplication(bundleIdentifier: $0) } ?? XCUIApplication()
            app.launchArguments = s["args"] as? [String] ?? []
            app.launch()
        case "activate": app.activate()
        case "terminate": app.terminate()
        case "tap":
            if let x = s["x"] as? Double, let y = s["y"] as? Double {
                let target = s["app"] as? String == "springboard" ? XCUIApplication(bundleIdentifier: "com.apple.springboard") : app
                target.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y)).tap()
            } else if let hold = s["hold"] as? Double {
                try element(s).press(forDuration: hold)
            } else {
                try element(s).tap()
            }
        case "type":
            let text = s["text"] as? String ?? ""
            if s["id"] != nil || s["label"] != nil { try element(s).typeText(text) }
            // Typing with nothing focused is an XCTest failure that ends the run, so type into the focused element
            // (a web page's text area included) and say so in done.json when there is none.
            else {
                let focused = app.descendants(matching: .any).matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch
                guard focused.waitForExistence(timeout: 3) else { throw Failure(description: "nothing has keyboard focus") }
                focused.typeText(text)
            }
        case "keys":
            // Presses the on-screen keyboard's keys one by one: a web page's text area (the terminal) takes no typeText.
            let keyboard = app.keyboards.firstMatch
            guard keyboard.waitForExistence(timeout: 3) else { throw Failure(description: "no keyboard on screen") }
            for c in s["text"] as? String ?? "" {
                let names = c == " " ? ["space"] : c == "\n" ? ["Return", "return"] : [String(c)]
                guard let key = names.lazy.map({ keyboard.keys[$0] }).first(where: { $0.exists }) ?? names.lazy.map({ keyboard.buttons[$0] }).first(where: { $0.exists })
                else { throw Failure(description: "no key for \(c.debugDescription)") }
                key.tap()
            }
        case "swipe":
            let target = (s["id"] != nil || s["label"] != nil) ? try element(s) : app
            switch s["dir"] as? String {
            case "down": target.swipeDown()
            case "left": target.swipeLeft()
            case "right": target.swipeRight()
            default: target.swipeUp()
            }
        case "wait": _ = try element(s)
        case "gone":
            let e = app.descendants(matching: .any).matching(identifier: s["id"] as? String ?? "").firstMatch
            let gone = NSPredicate(format: "exists == false")
            let r = XCTWaiter.wait(for: [expectation(for: gone, evaluatedWith: e)], timeout: (s["seconds"] as? Double) ?? 10)
            if r != .completed { throw Failure(description: "still there: \(s)") }
        case "rotate":
            XCUIDevice.shared.orientation = ["left": .landscapeLeft, "right": .landscapeRight][s["to"] as? String ?? ""] ?? .portrait
        case "shot":
            let png = XCUIScreen.main.screenshot().pngRepresentation
            try png.write(to: dir.appendingPathComponent("\(s["name"] as? String ?? "shot").png"))
        case "tree":
            out["tree"] = (s["app"] as? String == "springboard" ? XCUIApplication(bundleIdentifier: "com.apple.springboard") : app).debugDescription
        case "home": XCUIDevice.shared.press(.home)
        case "pull":
            // A finger from the top edge down: Notification Center, where a notification stays until it is opened.
            let board = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            board.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.005))
                .press(forDuration: 0.1, thenDragTo: board.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.7)))
        case "texts":
            out["texts"] = app.descendants(matching: .any).allElementsBoundByIndex.compactMap { e -> String? in
                let l = e.label; return l.isEmpty ? nil : l
            }
        default: throw Failure(description: "unknown step \(s)")
        }
    }

    private func write(_ o: [String: Any], to url: URL) throws {
        let tmp = url.appendingPathExtension("tmp")
        try JSONSerialization.data(withJSONObject: o).write(to: tmp)
        _ = try? FileManager.default.removeItem(at: url)
        try FileManager.default.moveItem(at: tmp, to: url)
    }
}
