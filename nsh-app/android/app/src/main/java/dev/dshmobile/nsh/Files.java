// files.pick { sessionId } → the receipt of the file the person picked, uploaded for that chat (Upload), or null when
// they cancel. The system's document picker hands over only the picked file, so the app needs no storage permission.
package dev.dshmobile.nsh;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import com.longbridge.nsh.NshHostReply;
import com.longbridge.nsh.NshView;
import java.io.InputStream;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

final class Files {
    static final int REQUEST = 0x5D5;
    private final Activity activity;
    private final Link link;
    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private NshHostReply pending;
    private String sessionId;

    Files(Activity activity, Link link) { this.activity = activity; this.link = link; }

    void attach(NshView view) {
        view.handle("files.pick", (data, reply) -> activity.runOnUiThread(() -> {
            Object id = data instanceof Map ? ((Map<?, ?>) data).get("sessionId") : null;
            if (!(id instanceof String) || pending != null) { reply.reject(pending != null ? "busy" : "sessionId is required"); return; }
            pending = reply; sessionId = (String) id;
            Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            activity.startActivityForResult(pick, REQUEST);
        }));
    }

    /** MainActivity's onActivityResult for REQUEST. */
    void picked(int result, Intent data) {
        NshHostReply reply = pending; String id = sessionId;
        pending = null; sessionId = null;
        if (reply == null) return;
        Uri uri = result == Activity.RESULT_OK && data != null ? data.getData() : null;
        if (uri == null) { reply.resolve(null); return; }
        work.execute(() -> {
            try (InputStream in = activity.getContentResolver().openInputStream(uri)) {
                if (in == null) throw new java.io.IOException("file/unreadable");
                Link.Endpoint to = link.endpoint();
                JSONObject value = Upload.send(to.origin, to.token, id, nameOf(uri), in);
                reply.resolve(value);
            } catch (Exception e) {
                reply.reject(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            }
        });
    }

    private String nameOf(Uri uri) {
        try (Cursor c = activity.getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (RuntimeException ignored) {
            // a provider without a display name
        }
        String last = uri.getLastPathSegment();
        return last == null || last.isEmpty() ? "file" : last;
    }
}
