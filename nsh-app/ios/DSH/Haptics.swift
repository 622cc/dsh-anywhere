// haptic { kind } → the phone's own feedback for a moment of the app: tick (a choice in a list), press (a long press
// opening a menu), confirm (an answer the computer took), reject (one it did not), threshold / unthreshold (a swipe
// crossing the point where letting go acts). UIKit's feedback generators, which follow the system's haptics setting
// (as the Android shell's Haptics.java).
import NativeShell
import UIKit

enum Haptics {
    @MainActor
    static func play(_ kind: String) {
        switch kind {
        case "press": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case "confirm": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "reject": UINotificationFeedbackGenerator().notificationOccurred(.error)
        case "threshold": UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        case "unthreshold": UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.6)
        default: UISelectionFeedbackGenerator().selectionChanged()
        }
    }

    @MainActor
    static func attach(_ view: NshAppView) {
        view.handle("haptic") { data, reply in
            play((data as? [String: Any])?["kind"] as? String ?? "tick")
            reply.resolve(nil)
        }
    }
}
