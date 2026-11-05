import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';
import { HostError } from './errors.ts';

// Minimal DER for one fixed certificate shape: self-signed ECDSA P-256 leaf, one DNS SAN,
// serverAuth only, not a CA. Every output is re-parsed and checked with node:crypto below.
function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let value = n; value > 0; value >>>= 8) bytes.unshift(value & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, ...content: Buffer[]) => { const body = Buffer.concat(content); return Buffer.concat([Buffer.from([tag]), length(body.length), body]); };
const sequence = (...items: Buffer[]) => tlv(0x30, ...items);
function oid(text: string): Buffer {
  const parts = text.split('.').map(Number), out = [40 * parts[0]! + parts[1]!];
  for (const part of parts.slice(2)) {
    const chunk = [part & 0x7f];
    for (let value = part >>> 7; value > 0; value >>>= 7) chunk.unshift((value & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
function time(date: Date): Buffer {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'; // YYYYMMDDHHMMSSZ
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2), 'ascii')) : tlv(0x18, Buffer.from(iso, 'ascii'));
}
function extension(id: string, critical: boolean, value: Buffer): Buffer {
  return sequence(oid(id), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), tlv(0x04, value));
}

export interface GeneratedIdentity { certPem: string; keyPem: string; pinSha256: string }
/** Self-signed P-256 server identity for exactly one DNS name; no OpenSSL (macOS ships LibreSSL). */
export function generateServerIdentity(dnsName: string, validDays = 825, now = Date.now()): GeneratedIdentity {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(dnsName) || !Number.isInteger(validDays) || validDays < 1 || validDays > 825) throw new HostError('invalid_request');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const serial = randomBytes(16); serial[0] = (serial[0]! & 0x7f) | 0x40; // Positive, no leading zero byte.
  const ecdsaSha256 = sequence(oid('1.2.840.10045.4.3.2'));
  const name = sequence(tlv(0x31, sequence(oid('2.5.4.3'), tlv(0x0c, Buffer.from('DSH Mobile companion', 'utf8')))));
  const keyBits = spki.subarray(spki.length - 65); // Uncompressed EC point inside the SPKI BIT STRING.
  const extensions = sequence(
    extension('2.5.29.19', true, sequence()), // basicConstraints: cA FALSE.
    extension('2.5.29.15', true, tlv(0x03, Buffer.from([0x07, 0x80]))), // keyUsage: digitalSignature.
    extension('2.5.29.37', false, sequence(oid('1.3.6.1.5.5.7.3.1'))), // extKeyUsage: serverAuth.
    extension('2.5.29.17', false, sequence(tlv(0x82, Buffer.from(dnsName, 'ascii')))), // subjectAltName: dNSName.
    extension('2.5.29.14', false, tlv(0x04, createHash('sha1').update(keyBits).digest())), // subjectKeyIdentifier.
  );
  const tbs = sequence(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))), tlv(0x02, serial), ecdsaSha256, name,
    sequence(time(new Date(now - 5 * 60_000)), time(new Date(now + validDays * 86_400_000 - 60_000))),
    name, spki, tlv(0xa3, extensions),
  );
  const signature = sign('sha256', tbs, privateKey); // DER ECDSA-Sig-Value.
  const der = sequence(tbs, ecdsaSha256, tlv(0x03, Buffer.from([0]), signature));
  const certPem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/.{1,64}/g, line => line + '\n')}-----END CERTIFICATE-----\n`;
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const x509 = new X509Certificate(certPem);
  if (x509.ca || !x509.verify(publicKey) || !x509.checkPrivateKey(privateKey) || !x509.keyUsage?.includes('1.3.6.1.5.5.7.3.1') ||
      x509.checkHost(dnsName, { wildcards: false, partialWildcards: false, multiLabelWildcards: false, subject: 'never' }) !== dnsName) throw new HostError('invalid_config');
  return { certPem, keyPem, pinSha256: 'sha256/' + createHash('sha256').update(spki).digest('base64') };
}
