// The phone's link to the owner's computer, as host functions for the app:
//   link.state   → { paired: false } or { paired: true, origin, token } (origin = this phone's bridge to /dsh)
//   link.scan    → the text of a scanned QR (Google's code scanner: no camera permission for this app)
//   link.pair    { text } → as link.state; the one-time QR (or a dshm1: link) to a paired device
//   link.forget  → unpairs this phone on the computer (best effort) and forgets the link
// Pairing follows docs/TAILCAT.md: the QR opens a short-lived pairing node; POST /pair with its proof and this
// phone's durable Tailcat key returns invitation v4; then the normal node, pinned TLS and POST /v1/pairings.
package dev.dshmobile.nsh;

import android.app.Activity;
import android.os.Build;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;
import com.longbridge.nsh.NshView;
import dev.dshmobile.tailcat.dshtailcat.Dshtailcat;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

final class Link {
    private final Activity activity;
    private final Vault vault;
    private final ExecutorService work = Executors.newSingleThreadExecutor();
    // One tunnel per process: an activity recreated in the same process (back, then reopen) must reuse it, since a
    // second Tailcat node with the same key leaves the new bridge's connections reset.
    private static long tunnel = -1;
    private static Bridge bridge;

    Link(Activity activity) { this.activity = activity; this.vault = new Vault(activity.getApplicationContext()); }

    void attach(NshView view) {
        view.handle("link.state", (data, reply) -> work.execute(() -> {
            try { reply.resolve(state()); } catch (Exception e) { reply.reject(message(e)); }
        }));
        view.handle("link.pair", (data, reply) -> work.execute(() -> {
            try { reply.resolve(pair(data instanceof Map ? String.valueOf(((Map<?, ?>) data).get("text")) : "")); } catch (Exception e) { reply.reject(message(e)); }
        }));
        // The app found the link dead (calls unanswered, the socket not opening): a new tunnel and bridge.
        view.handle("link.reset", (data, reply) -> work.execute(() -> {
            try { disconnect(); reply.resolve(state()); } catch (Exception e) { reply.reject(message(e)); }
        }));
        view.handle("link.forget", (data, reply) -> work.execute(() -> { forget(); reply.resolve(null); }));
        // Which part answers, for saying why the computer can't be reached: Dshtailcat.diagnose's answer (up to eight
        // seconds, so off the link's own thread) or {error}.
        view.handle("link.diagnose", (data, reply) -> new Thread(() -> {
            java.util.Map<String, Object> out = new java.util.HashMap<>();
            long handle = tunnel;
            if (handle < 0) { out.put("error", "no-tunnel"); reply.resolve(out); return; }
            try {
                JSONObject o = new JSONObject(Dshtailcat.diagnose(handle));
                for (java.util.Iterator<String> keys = o.keys(); keys.hasNext();) { String k = keys.next(); out.put(k, o.get(k)); }
            } catch (Exception e) { out.put("error", "unreadable"); }
            reply.resolve(out);
        }).start());
        // How the tunnel reaches the computer now: {route: "direct"}, {route: "relay", relay: code} or {route: "unknown"}.
        // Off the link's own thread: the answer may take up to three seconds (Dshtailcat.path).
        view.handle("link.path", (data, reply) -> new Thread(() -> {
            long handle = tunnel;
            java.util.Map<String, Object> out = new java.util.HashMap<>();
            out.put("route", "unknown");
            if (handle >= 0) {
                try {
                    JSONObject o = new JSONObject(Dshtailcat.path(handle));
                    if (o.has("route")) { out.put("route", o.getString("route")); if (o.has("relay")) out.put("relay", o.getString("relay")); }
                } catch (Exception e) { /* unknown */ }
            }
            reply.resolve(out);
        }).start());
        view.handle("link.scan", (data, reply) -> activity.runOnUiThread(() ->
            GmsBarcodeScanning.getClient(activity, new GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build())
                .startScan()
                .addOnSuccessListener(code -> reply.resolve(code.getRawValue()))
                .addOnCanceledListener(() -> reply.reject("cancelled"))
                .addOnFailureListener(e -> reply.reject(message(e)))));
    }

    /** Where the app's requests go: the bridge's /dsh origin and this phone's device token. */
    static final class Endpoint { final String origin, token; Endpoint(String origin, String token) { this.origin = origin; this.token = token; } }

    Endpoint endpoint() throws Exception {
        Map<String, Object> s = state();
        if (!Boolean.TRUE.equals(s.get("paired"))) throw new IOException("link/not-linked");
        return new Endpoint((String) s.get("origin"), (String) s.get("token"));
    }

    /** The paired computer's origin through the bridge, starting the tunnel if needed. */
    private Map<String, Object> state() throws Exception {
        String saved = vault.read();
        Map<String, Object> out = new HashMap<>();
        JSONObject link = saved == null ? null : new JSONObject(saved);
        if (link == null || !link.has("token")) { out.put("paired", false); return out; }
        Invite.Invitation inv = Invite.invitation(link.getString("invitation"));
        int port = connect(inv, link.getString("clientKey"));
        out.put("paired", true);
        out.put("origin", "http://127.0.0.1:" + port + "/dsh");
        out.put("token", link.getString("token"));
        return out;
    }

    private Map<String, Object> pair(String text) throws Exception {
        Invite.Bootstrap boot = Invite.bootstrap(text.trim(), System.currentTimeMillis());
        JSONObject link = vault.read() == null ? new JSONObject() : new JSONObject(vault.read());
        if (!link.has("clientKey")) { link.put("clientKey", Dshtailcat.newClientKey()); vault.write(link.toString()); }
        String clientKey = link.getString("clientKey");
        // 1. The pairing node: trade the QR's proof and this phone's public key for the invitation.
        JSONObject pairing = started(Dshtailcat.start(boot.address, boot.key, Invite.PAIRING_PORT));
        String invitation;
        try {
            JSONObject answer = new JSONObject(http("POST", "http://127.0.0.1:" + pairing.getInt("port") + "/pair", "Bearer " + boot.proof,
                new JSONObject().put("phoneKey", Dshtailcat.publicKey(clientKey)).toString()));
            invitation = answer.getString("invitation");
        } finally {
            Dshtailcat.stop(pairing.getLong("handle"));
        }
        Invite.Invitation inv = Invite.invitation(invitation);
        // 2. The computer itself, over pinned TLS: the one-time pairing token becomes this phone's device token.
        int port = connect(inv, clientKey);
        JSONObject device = new JSONObject(http("POST", "http://127.0.0.1:" + port + "/v1/pairings", null,
            new JSONObject().put("pairingToken", inv.pairingToken).put("deviceName", Build.MODEL).toString()));
        link.put("invitation", inv.json).put("token", device.getString("deviceToken"));
        vault.write(link.toString());
        return state();
    }

    private void forget() {
        try {
            String saved = vault.read();
            Bridge b = bridge;
            if (saved != null && new JSONObject(saved).has("token") && b != null)
                http("DELETE", "http://127.0.0.1:" + b.port() + "/v1/device", "Bearer " + new JSONObject(saved).getString("token"), null);
        } catch (Exception ignored) {
            // offline: the computer keeps the device until its owner revokes it
        }
        disconnect();
        vault.clear();
    }

    private static synchronized int connect(Invite.Invitation inv, String clientKey) throws Exception {
        if (bridge != null && bridge.serves(inv)) return bridge.port();
        // Pairing with another computer: the old tunnel and bridge reach the old one.
        disconnect();
        JSONObject normal = started(Dshtailcat.start(inv.address, clientKey, inv.port));
        tunnel = normal.getLong("handle");
        bridge = new Bridge(inv, normal.getInt("port"));
        return bridge.port();
    }

    private static synchronized void disconnect() {
        if (bridge != null) { bridge.close(); bridge = null; }
        if (tunnel >= 0) { Dshtailcat.stop(tunnel); tunnel = -1; }
    }

    /** Dshtailcat.start's answer: {"handle":n,"port":p} or {"error":code}. */
    private static JSONObject started(String answer) throws Exception {
        JSONObject o = new JSONObject(answer);
        if (o.has("error")) throw new IOException("link/tunnel:" + o.getString("error"));
        return o;
    }

    private static String http(String method, String url, String auth, String body) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(30_000);
        c.setReadTimeout(30_000);
        if (auth != null) c.setRequestProperty("Authorization", auth);
        if (body != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = c.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int status = c.getResponseCode();
        try (InputStream in = status < 400 ? c.getInputStream() : c.getErrorStream()) {
            String text = in == null ? "" : read(in);
            if (status == 410) throw new IOException("link/expired");
            if (status >= 400) throw new IOException("link/refused:" + status);
            return text;
        } finally {
            c.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private static String message(Throwable e) { return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage(); }
}
