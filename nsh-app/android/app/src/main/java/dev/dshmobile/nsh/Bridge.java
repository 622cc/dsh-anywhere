// The app speaks plain HTTP and WebSocket to 127.0.0.1:<port>; each connection continues as TLS that trusts only
// the computer's invited certificate (SNI h-<hostId>.dsh.invalid), carried by Tailcat (WireGuard) to the companion.
// NSH's WebSocket cannot be given a private certificate, so TLS ends here, inside the app's own process.
package dev.dshmobile.nsh;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;

final class Bridge implements Closeable {
    private final ServerSocket server;
    private final Invite.Invitation invitation;
    private final ExecutorService pool = Executors.newCachedThreadPool(r -> { Thread t = new Thread(r, "dsh-bridge"); t.setDaemon(true); return t; });

    /** Whether this bridge reaches the computer `other` invites to: the same node, port, name and certificate. */
    boolean serves(Invite.Invitation other) {
        return invitation.address.equals(other.address) && invitation.port == other.port
            && invitation.serverName.equals(other.serverName) && invitation.certificate.equals(other.certificate);
    }

    Bridge(Invite.Invitation invitation, int tailcatPort) throws Exception {
        this.invitation = invitation;
        SSLContext tls = SSLContext.getInstance("TLS");
        tls.init(null, new TrustManager[] { invitation.trust() }, null);
        SSLSocketFactory factory = tls.getSocketFactory();
        server = new ServerSocket(0, 32, InetAddress.getByName("127.0.0.1"));
        pool.execute(() -> {
            while (!server.isClosed()) {
                try {
                    Socket local = server.accept();
                    pool.execute(() -> connect(local, factory, invitation.serverName, tailcatPort));
                } catch (IOException e) {
                    return; // closed
                }
            }
        });
    }

    int port() { return server.getLocalPort(); }

    private void connect(Socket local, SSLSocketFactory factory, String serverName, int tailcatPort) {
        try {
            SSLSocket remote = (SSLSocket) factory.createSocket();
            remote.connect(new InetSocketAddress("127.0.0.1", tailcatPort), 20_000);
            remote.setSoTimeout(15_000); // a dead tunnel must not hold the handshake forever
            SSLParameters p = remote.getSSLParameters();
            p.setServerNames(List.of(new SNIHostName(serverName)));
            remote.setSSLParameters(p);
            remote.startHandshake(); // the trust manager accepts only the invited certificate
            remote.setSoTimeout(0); // then as long as the app keeps the connection (the stream socket idles between frames)
            pool.execute(() -> pump(local, remote));
            pump(remote, local);
        } catch (IOException e) {
            closeQuietly(local);
        }
    }

    private static void pump(Socket from, Socket to) {
        try (InputStream in = from.getInputStream(); OutputStream out = to.getOutputStream()) {
            byte[] buf = new byte[32 * 1024];
            for (int n; (n = in.read(buf)) >= 0; ) { out.write(buf, 0, n); out.flush(); }
        } catch (IOException ignored) {
        } finally {
            closeQuietly(from); closeQuietly(to);
        }
    }

    private static void closeQuietly(Socket s) { try { s.close(); } catch (IOException ignored) {} }

    @Override public void close() {
        try { server.close(); } catch (IOException ignored) {}
        pool.shutdownNow();
    }
}
