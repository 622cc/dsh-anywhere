// One full-screen NshView running assets/nsh (built from ../nsh-app by build.sh). The NSH app draws into the
// system bars' areas itself.
package dev.dshmobile.nsh;

import android.app.Activity;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsetsController;
import com.longbridge.nsh.NshView;

public final class MainActivity extends Activity {
    private NshView app;
    private Files files;
    private NetworkWatch network;
    private Notify notify;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        edgeToEdge();
        app = new NshView(this);
        app.setErrorListener(message -> Log.e("nsh", message));
        app.setLimits(2047, 0, Integer.MAX_VALUE, Integer.MAX_VALUE, Integer.MAX_VALUE);
        setContentView(app);
        new Modules(this).attach(app); // generated interfaces (`ui.open`)
        Link link = new Link(this);
        link.attach(app); // the link to the owner's computer (`link.*`)
        files = new Files(this, link);
        files.attach(app); // a file for a message (`files.pick`)
        Haptics.attach(this, app); // the phone's feedback (`haptic`)
        network = new NetworkWatch(this);
        network.attach(app); // whether the phone has a network (`network.state`, `network`)
        notify = new Notify(this);
        notify.attach(app); // what the app tells the person while away (`notify.*`, `app.state`)
        String pair = pairText(getIntent()), open = openChat(getIntent());
        if (pair != null) app.setParams(java.util.Map.of("pair", pair));
        else if (open != null) app.setParams(java.util.Map.of("open", open)); // opened from a chat's notification
        app.loadAssetBundle("nsh");
    }

    /** Draw behind the system bars: the app gets them as `safeArea()` (as nsh's AppActivity does). */
    @SuppressWarnings("deprecation")
    private void edgeToEdge() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        getWindow().setStatusBarColor(0);
        getWindow().setNavigationBarColor(0);
        systemBars();
    }

    /** Dark system bar icons in light mode, light ones in dark mode. */
    @SuppressWarnings("deprecation")
    private void systemBars() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        View decor = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            c.setSystemBarsAppearance(dark ? 0 : light, light);
        } else {
            int flags = decor.getSystemUiVisibility();
            int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            decor.setSystemUiVisibility(dark ? flags & ~light : flags | light);
        }
    }

    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        systemBars();
    }

    /** A pairing QR opened while the app runs: the app's `pair` event; a chat's notification: `notify.open`. */
    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        String pair = pairText(intent), open = openChat(intent);
        if (pair != null) app.send("pair", java.util.Map.of("text", pair));
        else if (open != null) app.send("notify.open", java.util.Map.of("id", open)); // a chat's notification tapped
    }

    private static String openChat(android.content.Intent intent) {
        String id = intent == null ? null : intent.getStringExtra(Notify.EXTRA_OPEN);
        return id != null && !id.isEmpty() ? id : null;
    }

    @Override
    protected void onStart() { super.onStart(); if (notify != null) notify.activeChanged(true); }

    @Override
    protected void onStop() { if (notify != null) notify.activeChanged(false); super.onStop(); }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (notify != null) notify.permissionResult(request);
    }

    private static String pairText(android.content.Intent intent) {
        String data = intent == null ? null : intent.getDataString();
        return data != null && data.startsWith("dshm1:") ? data : null;
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int request, int result, android.content.Intent data) {
        super.onActivityResult(request, result, data);
        if (request == Files.REQUEST && files != null) files.picked(result, data);
    }

    /** Android 12 and older: the app gets the back button first. */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (app == null || !app.handleBack()) super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (network != null) network.detach();
        app.destroy();
        super.onDestroy();
    }
}
