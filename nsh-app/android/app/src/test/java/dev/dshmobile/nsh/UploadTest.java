// A file the person picks goes to DSH's raw upload route through the companion (/dsh/api/session/uploadFileBinary),
// with the device token in the header; the receipt comes back for the message to cite. A stand-in companion records
// what arrives.
package dev.dshmobile.nsh;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;

public class UploadTest {
    private static final class Seen { String method, path, query, auth, type; byte[] body; }

    /** One HTTP/1.1 exchange on loopback: records the request (fixed-length or chunked body), sends the answer. */
    private static String serve(int status, String answer, AtomicReference<Seen> seen) throws IOException {
        ServerSocket server = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
        Thread t = new Thread(() -> {
            try (Socket c = server.accept(); InputStream in = c.getInputStream(); OutputStream out = c.getOutputStream()) {
                String[] request = line(in).split(" ");
                Map<String, String> headers = new HashMap<>();
                for (String h; !(h = line(in)).isEmpty(); ) { int i = h.indexOf(':'); headers.put(h.substring(0, i).trim().toLowerCase(Locale.ROOT), h.substring(i + 1).trim()); }
                ByteArrayOutputStream body = new ByteArrayOutputStream();
                if ("chunked".equalsIgnoreCase(headers.get("transfer-encoding"))) {
                    for (int n; (n = Integer.parseInt(line(in).trim(), 16)) > 0; line(in)) body.write(in.readNBytes(n));
                    line(in);
                } else if (headers.containsKey("content-length")) body.write(in.readNBytes(Integer.parseInt(headers.get("content-length"))));
                Seen s = new Seen();
                s.method = request[0];
                s.path = request[1].contains("?") ? request[1].substring(0, request[1].indexOf('?')) : request[1];
                s.query = request[1].contains("?") ? request[1].substring(request[1].indexOf('?') + 1) : null;
                s.auth = headers.get("authorization"); s.type = headers.get("content-type"); s.body = body.toByteArray();
                seen.set(s);
                byte[] bytes = answer.getBytes(StandardCharsets.UTF_8);
                out.write(("HTTP/1.1 " + status + " X\r\nContent-Type: application/json\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                out.write(bytes); out.flush();
            } catch (IOException ignored) {
            } finally {
                try { server.close(); } catch (IOException ignored) {}
            }
        });
        t.setDaemon(true); t.start();
        return "http://127.0.0.1:" + server.getLocalPort() + "/dsh";
    }

    private static String line(InputStream in) throws IOException {
        StringBuilder b = new StringBuilder();
        for (int c; (c = in.read()) >= 0 && c != '\n'; ) if (c != '\r') b.append((char) c);
        return b.toString();
    }

    @Test public void uploadsTheBytesAndReturnsTheReceipt() throws Exception {
        AtomicReference<Seen> seen = new AtomicReference<>();
        String origin = serve(200, "{\"ok\":true,\"value\":{\"receiptId\":\"r1\",\"file\":{\"attachmentId\":\"a1\",\"name\":\"q 1&2.pdf\",\"bytes\":3}}}", seen);
        JSONObject value = Upload.send(origin, "device-token", "s/1", "q 1&2.pdf", new ByteArrayInputStream(new byte[] { 1, 2, 3 }));
        assertEquals("r1", value.getString("receiptId"));
        assertEquals("a1", value.getJSONObject("file").getString("attachmentId"));
        Seen s = seen.get();
        assertEquals("POST", s.method);
        assertEquals("/dsh/api/session/uploadFileBinary", s.path);
        assertEquals("sessionId=s%2F1&name=q+1%262.pdf", s.query);
        assertEquals("Bearer device-token", s.auth);
        assertEquals("application/octet-stream", s.type);
        assertArrayEquals(new byte[] { 1, 2, 3 }, s.body);
    }

    @Test public void dshsRefusalComesBackAsItsMessage() throws Exception {
        String origin = serve(200, "{\"ok\":false,\"error\":{\"code\":\"session/not-found\",\"message\":\"No such chat\"}}", new AtomicReference<>());
        try { Upload.send(origin, "t", "s1", "a.txt", new ByteArrayInputStream(new byte[0])); fail("expected a refusal"); }
        catch (IOException e) { assertEquals("No such chat", e.getMessage()); }
    }

    @Test public void anHttpFailureSaysSo() throws Exception {
        String origin = serve(403, "forbidden", new AtomicReference<>());
        try { Upload.send(origin, "t", "s1", "a.txt", new ByteArrayInputStream(new byte[0])); fail("expected a failure"); }
        catch (IOException e) { assertTrue(e.getMessage(), e.getMessage().contains("403")); }
    }
}
