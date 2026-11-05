// What the app tells the person while it is away, and the way back to the chat it is about.
// notify.permission → {granted}; notify.request → asks Android 13+ for POST_NOTIFICATIONS → {granted}.
// notify.show {id, kind: answer|failed|decision, title, body} → one notification per chat (tag = id), replaced by the next;
// a tap opens the app on that chat (the `notify.open` event {id}, or `open` in host.params on a cold start).
// notify.clear {id} → that chat's notification goes. notify.watch {title, body} | null → while the app is away and a
// chat runs, a foreground service keeps the app (and its link) alive with an ongoing notification; see Watching.
// app.state → {active}; the `app.state` event {active} when the app comes to the screen or leaves it.
package dev.dshmobile.nsh;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import com.longbridge.nsh.NshHostReply;
import com.longbridge.nsh.NshView;
import java.util.Map;

final class Notify {
    static final String EXTRA_OPEN = "dev.dshmobile.nsh.open";
    static final String ANSWERS = "answers", DECISIONS = "decisions", WATCHING = "watching";
    static final int REQUEST = 4301;
    private static final String GROUP = "dev.dshmobile.nsh.chats";
    private static final int CHAT = 1;

    private final Activity activity;
    private final NotificationManager manager;
    private NshView view;
    private NshHostReply asking;
    /** What the app wants watched ({title, body}), or null: Watching runs while this is set and the app is away. */
    static volatile Map<?, ?> watch;
    static volatile boolean active;

    Notify(Activity activity) {
        this.activity = activity;
        manager = activity.getSystemService(NotificationManager.class);
        channels(activity, manager);
    }

    static void channels(Context context, NotificationManager manager) {
        NotificationChannel answers = new NotificationChannel(ANSWERS, context.getString(R.string.channel_answers), NotificationManager.IMPORTANCE_HIGH);
        NotificationChannel decisions = new NotificationChannel(DECISIONS, context.getString(R.string.channel_decisions), NotificationManager.IMPORTANCE_HIGH);
        NotificationChannel watching = new NotificationChannel(WATCHING, context.getString(R.string.channel_watching), NotificationManager.IMPORTANCE_LOW);
        watching.setShowBadge(false);
        for (NotificationChannel c : new NotificationChannel[] { answers, decisions, watching }) {
            c.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE); // the lock screen shows the public version only
            manager.createNotificationChannel(c); // an existing channel keeps the person's own settings
        }
    }

    boolean granted() {
        if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        return manager.areNotificationsEnabled();
    }

    void attach(NshView view) {
        this.view = view;
        view.handle("app.state", (data, reply) -> reply.resolve(Map.of("active", active)));
        view.handle("notify.permission", (data, reply) -> reply.resolve(Map.of("granted", granted())));
        // The phone's notification settings for this app, from the app's Settings page.
        view.handle("notify.settings", (data, reply) -> activity.runOnUiThread(() -> {
            try {
                activity.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName()));
                reply.resolve(null);
            } catch (RuntimeException e) { reply.reject("settings/unavailable"); }
        }));
        view.handle("notify.request", (data, reply) -> activity.runOnUiThread(() -> {
            if (granted() || Build.VERSION.SDK_INT < 33) { reply.resolve(Map.of("granted", granted())); return; }
            if (asking != null) { reply.reject("busy"); return; }
            asking = reply;
            activity.requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQUEST);
        }));
        view.handle("notify.show", (data, reply) -> {
            Map<?, ?> m = data instanceof Map ? (Map<?, ?>) data : Map.of();
            Object id = m.get("id");
            if (!(id instanceof String)) { reply.reject("id is required"); return; }
            if (!granted()) { reply.resolve(Map.of("shown", false)); return; }
            manager.notify((String) id, CHAT, chat(activity, (String) id, text(m.get("kind")), text(m.get("title")), text(m.get("body"))));
            reply.resolve(Map.of("shown", true));
        });
        view.handle("notify.clear", (data, reply) -> {
            Object id = data instanceof Map ? ((Map<?, ?>) data).get("id") : null;
            if (id instanceof String) manager.cancel((String) id, CHAT);
            reply.resolve(null);
        });
        view.handle("notify.watch", (data, reply) -> activity.runOnUiThread(() -> {
            watch = data instanceof Map ? (Map<?, ?>) data : null;
            if (watch == null) Watching.stop(activity); else if (!active) Watching.start(activity);
            reply.resolve(null);
        }));
    }

    void permissionResult(int request) {
        if (request != REQUEST || asking == null) return;
        NshHostReply reply = asking; asking = null;
        reply.resolve(Map.of("granted", granted()));
    }

    /** The app came to the screen (true) or left it (false). Away with a chat running, the app keeps watching. */
    void activeChanged(boolean now) {
        active = now;
        if (now) Watching.stop(activity); else if (watch != null) Watching.start(activity);
        if (view != null) view.send("app.state", Map.of("active", now));
    }

    static String text(Object v) { return v instanceof String ? (String) v : ""; }

    /** Opens the app on chat `id` (null: where it was). */
    static PendingIntent open(Context context, String id) {
        Intent intent = new Intent(context, MainActivity.class).setAction(Intent.ACTION_VIEW).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (id != null) intent.putExtra(EXTRA_OPEN, id).setData(android.net.Uri.fromParts("dshchat", id, null)); // one intent per chat
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** A chat's news: its title, then the question, the error or the answer's first words, and what kind of news. */
    static Notification chat(Context context, String id, String kind, String title, String body) {
        boolean decision = "decision".equals(kind);
        String what = context.getString(decision ? R.string.notify_decision : "failed".equals(kind) ? R.string.notify_failed : R.string.notify_answer);
        // On the lock screen: only that a chat has news, not its name or words.
        Notification hidden = new Notification.Builder(context, decision ? DECISIONS : ANSWERS)
                .setSmallIcon(R.drawable.ic_notify).setContentTitle(context.getString(R.string.app_label)).setContentText(what).build();
        return new Notification.Builder(context, decision ? DECISIONS : ANSWERS)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title.isEmpty() ? what : title)
                .setContentText(body.isEmpty() ? what : body)
                .setStyle(new Notification.BigTextStyle().bigText(body.isEmpty() ? what : body))
                .setSubText(body.isEmpty() ? null : what)
                .setCategory(decision ? Notification.CATEGORY_REMINDER : Notification.CATEGORY_MESSAGE)
                .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(hidden)
                .setGroup(GROUP).setAutoCancel(true).setShowWhen(true)
                .setContentIntent(open(context, id))
                .build();
    }
}
