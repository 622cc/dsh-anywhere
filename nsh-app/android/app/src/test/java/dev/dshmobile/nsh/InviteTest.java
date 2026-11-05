// Pairing input the phone must refuse or accept, with fixtures made by the companion's own encoders
// (host/src/qr.ts, host/src/x509.ts): synthetic keys, hosts and tokens only.
package dev.dshmobile.nsh;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import org.json.JSONObject;
import org.junit.Test;

public class InviteTest {
    private static final long NOW = 1_800_000_000_000L;

    private static JSONObject fixture() throws Exception {
        try (InputStream in = InviteTest.class.getResourceAsStream("/pairing.json")) {
            return new JSONObject(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    @Test public void theQrDecodesToThePairingNodeCapability() throws Exception {
        Invite.Bootstrap b = Invite.bootstrap(fixture().getString("qr"), NOW);
        JSONObject expected = fixture().getJSONObject("bootstrap").getJSONObject("tailcat");
        assertEquals(expected.getString("address"), b.address);
        assertEquals(expected.getString("key"), b.key);
        assertEquals(expected.getString("proof"), b.proof);
    }

    @Test public void anExpiredOrMalformedBootstrapIsRefused() throws Exception {
        String qr = fixture().getString("qr");
        // The app shows these codes in the phone's language (nsh-app/src/strings.ts `readable`).
        assertEquals("link/expired", assertThrows(IllegalArgumentException.class, () -> Invite.bootstrap(qr, 4_102_444_800_001L)).getMessage());
        JSONObject wrongPort = fixture().getJSONObject("bootstrap");
        wrongPort.getJSONObject("tailcat").put("port", 48931);
        assertEquals("link/invalid", assertThrows(IllegalArgumentException.class, () -> Invite.bootstrap(wrongPort.toString(), NOW)).getMessage());
        assertEquals("link/invalid", assertThrows(IllegalArgumentException.class, () -> Invite.bootstrap("dshm1:not-zlib", NOW)).getMessage());
    }

    @Test public void theInvitationNamesOneHostWhoseCertificateMatchesThePin() throws Exception {
        Invite.Invitation inv = Invite.invitation(fixture().getJSONObject("invitation").toString());
        assertEquals("h-0123456789abcdef0123456789abcdef.dsh.invalid", inv.serverName);
        assertEquals(48931, inv.port);
        assertEquals("B".repeat(43), inv.pairingToken);
    }

    @Test public void anInvitationWithAnotherCertificatePinOrHostIsRefused() throws Exception {
        JSONObject f = fixture();
        JSONObject pin = f.getJSONObject("invitation"); pin.put("pinSha256", f.getString("otherPin"));
        assertEquals("link/certificate", assertThrows(IllegalArgumentException.class, () -> Invite.invitation(pin.toString())).getMessage());
        JSONObject cert = fixture().getJSONObject("invitation"); cert.put("certificatePem", f.getString("otherCertificatePem")).put("pinSha256", f.getString("otherPin"));
        assertEquals("link/certificate", assertThrows(IllegalArgumentException.class, () -> Invite.invitation(cert.toString())).getMessage());
        JSONObject host = fixture().getJSONObject("invitation"); host.put("baseUrl", "https://example.com");
        assertEquals("link/invalid", assertThrows(IllegalArgumentException.class, () -> Invite.invitation(host.toString())).getMessage());
        JSONObject port = fixture().getJSONObject("invitation"); port.getJSONObject("tailcat").put("port", 48932);
        assertEquals("link/invalid", assertThrows(IllegalArgumentException.class, () -> Invite.invitation(port.toString())).getMessage());
    }

    @Test public void tlsTrustsOnlyTheInvitedCertificate() throws Exception {
        JSONObject f = fixture();
        Invite.Invitation inv = Invite.invitation(f.getJSONObject("invitation").toString());
        inv.trust().checkServerTrusted(new X509Certificate[] { inv.certificate }, "ECDHE_ECDSA");
        X509Certificate other = Invite.certificate(f.getString("otherCertificatePem"));
        assertThrows(CertificateException.class, () -> inv.trust().checkServerTrusted(new X509Certificate[] { other }, "ECDHE_ECDSA"));
    }
}
