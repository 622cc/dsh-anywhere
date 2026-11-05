// Generated interfaces: the app asks `ui.open { url, rootUrl, auth, title }` for a module the DSH agent built with
// the companion's show_interface tool. This downloads the signed package and the companion's root key over the
// device-key channel, verifies the package against that root (NshTrust) and runs it full screen in its own NshView,
// with no network and only `ui.close`.
package dev.dshmobile.nsh;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.longbridge.nsh.NshPackage;
import com.longbridge.nsh.NshTrust;
import com.longbridge.nsh.NshView;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class Modules {
    private final Activity activity;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService work = Executors.newSingleThreadExecutor();

    Modules(Activity activity) { this.activity = activity; }

    void attach(NshView view) {
        view.handle("ui.open", (data, reply) -> {
            Map<?, ?> args = data instanceof Map ? (Map<?, ?>) data : Map.of();
            String url = string(args.get("url")), rootUrl = string(args.get("rootUrl")), auth = string(args.get("auth")), title = string(args.get("title"));
            if (url.isEmpty() || rootUrl.isEmpty() || auth.isEmpty()) { reply.reject("ui.open needs url, rootUrl and auth"); return; }
            work.execute(() -> {
                try {
                    String root = new String(get(new URL(rootUrl), auth), StandardCharsets.UTF_8).trim();
                    File file = new File(activity.getCacheDir(), "module.nshpkg");
                    try (OutputStream out = new FileOutputStream(file)) { out.write(get(new URL(url), auth)); }
                    NshTrust trust = new NshTrust(dir("nsh-trust"));
                    if (!trust.addRoot(root)) throw new IOException("ui/root-key");
                    NshPackage pkg = trust.openPackage(file); // verifies; a refused package throws and nothing shows
                    main.post(() -> { new Screen(title).run(pkg); reply.resolve(null); });
                } catch (Exception e) {
                    reply.reject(e.getMessage() == null ? e.toString() : e.getMessage());
                }
            });
        });
    }

    private File dir(String name) throws IOException {
        File d = new File(activity.getFilesDir(), name);
        if (!d.isDirectory() && !d.mkdirs()) throw new IOException("ui/storage");
        return d;
    }

    private static byte[] get(URL url, String auth) throws IOException {
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setConnectTimeout(15_000);
        c.setReadTimeout(30_000);
        c.setRequestProperty("Authorization", "Bearer " + auth);
        try {
            if (c.getResponseCode() != 200) throw new IOException("ui/download:" + c.getResponseCode());
            try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[64 * 1024];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                return out.toByteArray();
            }
        } finally {
            c.disconnect();
        }
    }

    private static String string(Object o) { return o instanceof String ? (String) o : ""; }

    /** Full screen over the app: the title and Done, then the module. */
    private final class Screen extends Dialog {
        private final NshView app = new NshView(activity);

        Screen(String title) {
            super(activity, R.style.Dsh);
            app.setLimits(0, 0, 0, 0, 0); // NSH's default limits for an embedded app
            app.setGrantedCapabilities("{\"host\":[\"ui.close\"]}");
            app.handle("ui.close", (data, reply) -> { dismiss(); reply.resolve(null); });
            float dp = activity.getResources().getDisplayMetrics().density;
            LinearLayout root = new LinearLayout(activity);
            root.setOrientation(LinearLayout.VERTICAL);
            LinearLayout bar = new LinearLayout(activity);
            bar.setGravity(Gravity.CENTER_VERTICAL);
            bar.setPadding((int) (16 * dp), 0, (int) (4 * dp), 0);
            bar.addView(label(title, false), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            TextView done = label(activity.getString(R.string.done), true);
            done.setOnClickListener(v -> dismiss());
            bar.addView(done, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, (int) (48 * dp)));
            root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (int) (52 * dp)));
            FrameLayout body = new FrameLayout(activity);
            body.addView(app, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            root.addView(body, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                int top = Build.VERSION.SDK_INT >= 30 ? insets.getInsets(android.view.WindowInsets.Type.statusBars()).top : insets.getSystemWindowInsetTop();
                v.setPadding(0, top, 0, 0);
                return insets;
            });
            setContentView(root);
            setOnDismissListener(d -> app.destroy());
        }

        private TextView label(String text, boolean button) {
            TextView t = new TextView(activity);
            t.setText(text);
            t.setSingleLine(true);
            t.setTextColor(activity.getColor(R.color.foreground));
            t.setTextSize(TypedValue.COMPLEX_UNIT_SP, button ? 15 : 16);
            t.setTypeface(Typeface.create(Typeface.DEFAULT, button ? 500 : 600, false));
            t.setGravity(Gravity.CENTER_VERTICAL);
            if (button) t.setPadding(24, 0, 24, 0);
            return t;
        }

        void run(NshPackage pkg) {
            app.runPackage(pkg);
            show();
            Window w = getWindow();
            if (w == null) return;
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            w.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE); // the module's fields stay above the keyboard
            // dark system bar icons on the light theme, as the app's own window has (MainActivity.systemBars)
            boolean dark = (activity.getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES;
            android.view.WindowInsetsController c = Build.VERSION.SDK_INT >= 30 ? w.getInsetsController() : null;
            int light = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            if (c != null) c.setSystemBarsAppearance(dark ? 0 : light, light);
        }
    }
}
