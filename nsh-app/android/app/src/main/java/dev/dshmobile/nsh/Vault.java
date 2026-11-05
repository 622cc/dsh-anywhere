// The phone's link to its computer (Tailcat client key, invitation, device token), encrypted at rest with a key
// that never leaves the Android Keystore, in no-backup storage.
package dev.dshmobile.nsh;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class Vault {
    private static final String ALIAS = "dsh-link";
    private final File file;

    Vault(Context context) { file = new File(context.getNoBackupFilesDir(), "link.bin"); }

    synchronized String read() {
        try {
            if (!file.exists()) return null;
            ByteBuffer data = ByteBuffer.wrap(Files.readAllBytes(file.toPath()));
            byte[] iv = new byte[12]; data.get(iv);
            byte[] sealed = new byte[data.remaining()]; data.get(sealed);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            return new String(c.doFinal(sealed), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null; // unreadable (key gone after a restore): start over with a new pairing
        }
    }

    synchronized void write(String json) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] sealed = c.doFinal(json.getBytes(StandardCharsets.UTF_8));
        File tmp = new File(file.getPath() + ".tmp");
        Files.write(tmp.toPath(), ByteBuffer.allocate(12 + sealed.length).put(c.getIV()).put(sealed).array());
        if (!tmp.renameTo(file)) throw new java.io.IOException("link/save");
    }

    synchronized void clear() { file.delete(); }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return g.generateKey();
    }
}
