// haptic { kind } → the phone's own feedback for a moment of the app: tick (a choice in a list), press (a long
// press opening a menu), confirm (an answer the computer took), reject (one it did not), threshold / unthreshold (a
// swipe crossing the point where letting go acts). Android's HapticFeedbackConstants, which
// follow the system's touch-feedback setting; CONFIRM / REJECT exist from Android 11, older phones get a plain tap.
package dev.dshmobile.nsh;

import android.app.Activity;
import android.os.Build;
import android.view.HapticFeedbackConstants;
import com.longbridge.nsh.NshView;
import java.util.Map;

final class Haptics {
    static int constant(String kind) {
        switch (kind) {
            case "press": return HapticFeedbackConstants.LONG_PRESS;
            case "confirm": return Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
            case "reject": return Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.VIRTUAL_KEY;
            // A swipe crossed the point where letting go acts (threshold), or came back before it (unthreshold):
            // Android 14's gesture constants; older phones feel nothing rather than a buzz.
            case "threshold": return Build.VERSION.SDK_INT >= 34 ? HapticFeedbackConstants.GESTURE_THRESHOLD_ACTIVATE : -1;
            case "unthreshold": return Build.VERSION.SDK_INT >= 34 ? HapticFeedbackConstants.GESTURE_THRESHOLD_DEACTIVATE : -1;
            // A choice among options: SEGMENT_TICK from Android 14, the clock tick before.
            default: return Build.VERSION.SDK_INT >= 34 ? HapticFeedbackConstants.SEGMENT_TICK : HapticFeedbackConstants.CLOCK_TICK;
        }
    }

    static void attach(Activity activity, NshView view) {
        view.handle("haptic", (data, reply) -> activity.runOnUiThread(() -> {
            Object kind = data instanceof Map ? ((Map<?, ?>) data).get("kind") : null;
            int constant = constant(kind instanceof String ? (String) kind : "tick");
            if (constant >= 0) view.performHapticFeedback(constant);
            reply.resolve(null);
        }));
    }
}
