// What a pairing QR and the invitation it leads to may contain (docs/TAILCAT.md: bootstrap v1, invitation v4).
// The QR only reaches a short-lived pairing node; the invitation names the computer's one certificate, which
// is the only one this phone will ever trust for it.
package dev.dshmobile.nsh;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Base64;
import java.util.Collection;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.Inflater;
import javax.net.ssl.X509TrustManager;
import org.json.JSONObject;

final class Invite {
    private Invite() {}

    static final int PAIRING_PORT = 48932, NORMAL_PORT = 48931;
    private static final Pattern BASE_URL = Pattern.compile("https://(h-[0-9a-f]{32}\\.dsh\\.invalid)");
    private static final Pattern ADDRESS = Pattern.compile("tc[A-Za-z0-9_-]{8,2048}");
    private static final Pattern SECRET = Pattern.compile("[A-Za-z0-9_-]{43}");

    static final class Bootstrap {
        final String address, key, proof;
        Bootstrap(String address, String key, String proof) { this.address = address; this.key = key; this.proof = proof; }
    }

    static final class Invitation {
        final String json, serverName, address, pairingToken;
        final int port;
        final X509Certificate certificate;
        Invitation(String json, String serverName, String address, int port, String pairingToken, X509Certificate certificate) {
            this.json = json; this.serverName = serverName; this.address = address; this.port = port; this.pairingToken = pairingToken; this.certificate = certificate;
        }
        /** Trusts exactly the invited certificate: no system roots, no other key. */
        X509TrustManager trust() {
            return new X509TrustManager() {
                @Override public void checkClientTrusted(X509Certificate[] chain, String auth) throws CertificateException { throw new CertificateException("no client certificates"); }
                @Override public void checkServerTrusted(X509Certificate[] chain, String auth) throws CertificateException {
                    if (chain == null || chain.length == 0 || !chain[0].equals(certificate)) throw new CertificateException("not the invited certificate");
                }
                @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            };
        }
    }

    /** The QR text (`dshm1:` zlib, base64url) or the plain JSON a same-Wi-Fi pairing delivers. */
    // Refusals are codes (link/expired, link/invalid, link/certificate): the app words them in the phone's language.
    static Bootstrap bootstrap(String text, long nowMs) {
        try {
            String json = text.startsWith("dshm1:") ? inflate(Base64.getUrlDecoder().decode(text.substring(6))) : text;
            JSONObject o = new JSONObject(json), t = o.getJSONObject("tailcat");
            if (o.getInt("version") != 1 || o.getLong("expiresAt") <= nowMs) throw new IllegalArgumentException("link/expired");
            String address = t.getString("address"), key = t.getString("key"), proof = t.getString("proof");
            if (t.getInt("port") != PAIRING_PORT || !ADDRESS.matcher(address).matches() || !key.startsWith("privkey:") || !SECRET.matcher(proof).matches()) throw new IllegalArgumentException("link/invalid");
            return new Bootstrap(address, key, proof);
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("link/invalid");
        }
    }

    static Invitation invitation(String json) {
        try {
            JSONObject o = new JSONObject(json), t = o.getJSONObject("tailcat");
            Matcher base = BASE_URL.matcher(o.getString("baseUrl"));
            if (o.getInt("version") != 4 || !base.matches() || t.getInt("port") != NORMAL_PORT || !ADDRESS.matcher(t.getString("address")).matches()) throw new IllegalArgumentException("link/invalid");
            String token = o.getString("pairingToken");
            if (!SECRET.matcher(token).matches()) throw new IllegalArgumentException("link/invalid");
            X509Certificate cert = certificate(o.getString("certificatePem"));
            if (!pin(cert).equals(o.getString("pinSha256")) || !onlyName(cert, base.group(1))) throw new IllegalArgumentException("link/certificate");
            return new Invitation(json, base.group(1), t.getString("address"), NORMAL_PORT, token, cert);
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("link/invalid");
        }
    }

    static X509Certificate certificate(String pem) throws CertificateException {
        return (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(pem.getBytes(StandardCharsets.US_ASCII)));
    }

    /** `sha256/` + base64 of the SHA-256 of the certificate's SubjectPublicKeyInfo (host/src/config.ts). */
    static String pin(X509Certificate cert) throws Exception {
        return "sha256/" + Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(cert.getPublicKey().getEncoded()));
    }

    private static boolean onlyName(X509Certificate cert, String name) throws CertificateException {
        Collection<List<?>> names = cert.getSubjectAlternativeNames();
        if (names == null) return false;
        int dns = 0; boolean match = false;
        for (List<?> n : names) if (Integer.valueOf(2).equals(n.get(0))) { dns++; match |= name.equals(n.get(1)); }
        return dns == 1 && match;
    }

    private static String inflate(byte[] data) throws Exception {
        Inflater inflater = new Inflater();
        inflater.setInput(data);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        while (!inflater.finished()) {
            int n = inflater.inflate(buf);
            if (n == 0 && (inflater.needsInput() || inflater.needsDictionary())) throw new IllegalArgumentException("link/invalid");
            out.write(buf, 0, n);
            if (out.size() > 65536) throw new IllegalArgumentException("link/invalid");
        }
        inflater.end();
        return out.toString(StandardCharsets.UTF_8.name());
    }
}
