// A file for a message, sent as DSH's raw upload (POST /api/session/uploadFileBinary, the bytes as the body) through
// the companion's /dsh relay. DSH answers {"ok":true,"value":{receiptId,file}} or {"ok":false,"error":{code,message}};
// the message then cites the receipt (docs/research/dsh-protocol-parity.md, section 4).
package dev.dshmobile.nsh;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

final class Upload {
    private Upload() {}

    /** Streams {@code data} to DSH for the chat {@code sessionId}; returns {receiptId, file}. */
    static JSONObject send(String origin, String token, String sessionId, String name, InputStream data) throws IOException {
        String query = "sessionId=" + URLEncoder.encode(sessionId, "UTF-8") + "&name=" + URLEncoder.encode(name, "UTF-8");
        HttpURLConnection c = (HttpURLConnection) new URL(origin + "/api/session/uploadFileBinary?" + query).openConnection();
        try {
            c.setRequestMethod("POST");
            c.setConnectTimeout(30_000);
            c.setReadTimeout(120_000);
            c.setDoOutput(true);
            c.setChunkedStreamingMode(64 * 1024); // the file is not read into memory
            c.setRequestProperty("Authorization", "Bearer " + token);
            c.setRequestProperty("Content-Type", "application/octet-stream");
            try (OutputStream out = c.getOutputStream()) {
                byte[] buf = new byte[64 * 1024];
                for (int n; (n = data.read(buf)) > 0; ) out.write(buf, 0, n);
            }
            int status = c.getResponseCode();
            InputStream in = status < 400 ? c.getInputStream() : c.getErrorStream();
            String text = in == null ? "" : read(in);
            if (status != 200) throw new IOException("upload/failed:" + status);
            try {
                JSONObject answer = new JSONObject(text);
                if (!answer.optBoolean("ok")) {
                    JSONObject error = answer.optJSONObject("error");
                    throw new IOException(error != null ? error.optString("message", "upload/refused") : "upload/refused");
                }
                return answer.getJSONObject("value");
            } catch (JSONException e) {
                throw new IOException("upload/unreadable");
            }
        } finally {
            c.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = s.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
