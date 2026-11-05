// The bridge carries plain app traffic as TLS that trusts only the invited certificate: a stand-in companion with
// that certificate echoes through it; one with any other certificate gets nothing and the app's connection closes.
package dev.dshmobile.nsh;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;
import org.json.JSONObject;
import org.junit.Test;

public class BridgeTest {
    private static JSONObject fixture() throws Exception {
        try (InputStream in = BridgeTest.class.getResourceAsStream("/pairing.json")) { return new JSONObject(new String(in.readAllBytes(), StandardCharsets.UTF_8)); }
    }

    /** A TLS echo server on loopback with the given identity: the companion's end of the tunnel. */
    private static SSLServerSocket companion(String certPem, String keyPem) throws Exception {
        byte[] der = Base64.getMimeDecoder().decode(keyPem.replaceAll("-----[A-Z ]+-----", ""));
        PrivateKey key = KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(der));
        KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType()); ks.load(null);
        ks.setKeyEntry("c", key, new char[0], new Certificate[] { Invite.certificate(certPem) });
        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()); kmf.init(ks, new char[0]);
        SSLContext tls = SSLContext.getInstance("TLS"); tls.init(kmf.getKeyManagers(), null, null);
        SSLServerSocket server = (SSLServerSocket) tls.getServerSocketFactory().createServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
        Thread t = new Thread(() -> {
            try (SSLSocket s = (SSLSocket) server.accept()) {
                byte[] buf = new byte[64]; int n = s.getInputStream().read(buf);
                s.getOutputStream().write(("echo:" + new String(buf, 0, n, StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8));
                s.getOutputStream().flush();
            } catch (Exception ignored) {}
        });
        t.setDaemon(true); t.start();
        return server;
    }

    private static String roundTrip(int port) throws Exception {
        try (Socket app = new Socket("127.0.0.1", port)) {
            app.setSoTimeout(5000);
            OutputStream out = app.getOutputStream(); out.write("ping".getBytes(StandardCharsets.UTF_8)); out.flush();
            byte[] buf = new byte[64]; int n = app.getInputStream().read(buf);
            return n < 0 ? "" : new String(buf, 0, n, StandardCharsets.UTF_8);
        } catch (java.net.SocketException closed) {
            return ""; // closed by the bridge (end of stream or reset): nothing reached the app
        }
    }

    @Test public void theInvitedComputerAnswersThroughTheBridge() throws Exception {
        JSONObject f = fixture();
        Invite.Invitation inv = Invite.invitation(f.getJSONObject("invitation").toString());
        try (SSLServerSocket server = companion(f.getJSONObject("invitation").getString("certificatePem"), f.getString("keyPem")); Bridge bridge = new Bridge(inv, server.getLocalPort())) {
            assertEquals("echo:ping", roundTrip(bridge.port()));
        }
    }

    @Test public void anotherCertificateGetsNothing() throws Exception {
        JSONObject f = fixture();
        Invite.Invitation inv = Invite.invitation(f.getJSONObject("invitation").toString());
        try (SSLServerSocket server = companion(f.getString("otherCertificatePem"), f.getString("otherKeyPem")); Bridge bridge = new Bridge(inv, server.getLocalPort())) {
            assertEquals("", roundTrip(bridge.port()));
        }
    }

    /** A bridge carries one computer: a new pairing with another computer (another address or port) needs a new one. */
    @Test public void aBridgeServesOnlyTheComputerItWasMadeFor() throws Exception {
        JSONObject f = fixture();
        Invite.Invitation inv = Invite.invitation(f.getJSONObject("invitation").toString());
        Invite.Invitation again = Invite.invitation(f.getJSONObject("invitation").toString());
        Invite.Invitation elsewhere = new Invite.Invitation(inv.json, inv.serverName, inv.address + "x", inv.port, inv.pairingToken, inv.certificate);
        Invite.Invitation otherPort = new Invite.Invitation(inv.json, inv.serverName, inv.address, inv.port + 1, inv.pairingToken, inv.certificate);
        try (Bridge bridge = new Bridge(inv, 1)) {
            assertTrue(bridge.serves(again));
            assertFalse(bridge.serves(elsewhere));
            assertFalse(bridge.serves(otherPort));
        }
    }
}
