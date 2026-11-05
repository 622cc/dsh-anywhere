// network.state → {online}; the `network` event {online} when the phone gains or loses its default network.
// The link to the computer runs inside a Tailcat tunnel whose connections outlive a network change, so the app's
// socket alone never notices that the phone went offline (2026-10-29, emulator airplane mode: no socket error in 15 s).
package dev.dshmobile.nsh;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import com.longbridge.nsh.NshView;
import java.util.Map;

final class NetworkWatch {
    private final ConnectivityManager cm;
    private ConnectivityManager.NetworkCallback callback;

    NetworkWatch(Context context) { cm = context.getSystemService(ConnectivityManager.class); }

    boolean online() {
        Network n = cm.getActiveNetwork();
        NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n);
        return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    void attach(NshView view) {
        view.handle("network.state", (data, reply) -> reply.resolve(Map.of("online", online())));
        callback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { view.post(() -> view.send("network", Map.of("online", true))); }
            // The default network is gone; a network that takes over arrives as onAvailable right after.
            @Override public void onLost(Network network) { view.post(() -> view.send("network", Map.of("online", false))); }
        };
        cm.registerDefaultNetworkCallback(callback);
    }

    void detach() { if (callback != null) { try { cm.unregisterNetworkCallback(callback); } catch (RuntimeException ignored) {} callback = null; } }
}
