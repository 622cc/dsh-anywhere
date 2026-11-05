// While the app is away and a chat still runs, this foreground service keeps the app's process (its JavaScript and
// the link to the computer) from being frozen, so the app can say when the answer is ready or the agent asks. Its
// ongoing notification says what it watches; "Stop" ends it. It runs only between the app leaving the screen with a
// chat running and the last chat finishing or the app coming back (Notify.activeChanged, notify.watch).
// Android 14+: type specialUse, as no other type fits (dataSync is for transfers and is capped at 6 h on Android 15).
package dev.dshmobile.nsh;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import java.util.Map;

public final class Watching extends Service {
    private static final int ONGOING = 2;
    private static final String STOP = "dev.dshmobile.nsh.watching.stop";

    static volatile boolean running;

    /** Starts watching, or, already watching, shows what it watches now (a running service is not started again). */
    static void start(Context context) {
        if (running) { context.getSystemService(android.app.NotificationManager.class).notify(ONGOING, ongoing(context)); return; }
        try { context.startForegroundService(new Intent(context, Watching.class)); }
        catch (RuntimeException e) { Log.w("dsh", "watching: " + e); } // Android refused (the app is not allowed to start one now)
    }

    static void stop(Context context) { if (running) context.stopService(new Intent(context, Watching.class)); }

    static Notification ongoing(Context context) {
        Map<?, ?> watch = Notify.watch;
        String title = watch == null ? "" : Notify.text(watch.get("title")), body = watch == null ? "" : Notify.text(watch.get("body"));
        PendingIntent stop = PendingIntent.getService(context, 0, new Intent(context, Watching.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(context, Notify.WATCHING)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title.isEmpty() ? context.getString(R.string.watching) : title)
                .setContentText(body)
                .setOngoing(true).setShowWhen(false).setVisibility(Notification.VISIBILITY_PRIVATE)
                .setContentIntent(Notify.open(context, null))
                .addAction(new Notification.Action.Builder(null, context.getString(R.string.watching_stop), stop).build())
                .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Map<?, ?> watch = Notify.watch;
        if ((intent != null && STOP.equals(intent.getAction())) || watch == null || Notify.active) {
            if (intent != null && STOP.equals(intent.getAction())) Notify.watch = null;
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = ongoing(this);
        running = true;
        if (Build.VERSION.SDK_INT >= 34) startForeground(ONGOING, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(ONGOING, n);
        return START_NOT_STICKY;
    }

    /** The app's task was swiped away: its JavaScript is gone with the Activity, so there is nothing left to watch. */
    @Override
    public void onTaskRemoved(Intent root) { stopSelf(); }

    @Override
    public void onDestroy() { running = false; super.onDestroy(); }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
