// Regenerate: node nsh-app/android/app/src/test/make-fixtures.ts nsh-app/android/app/src/test/resources (from the repo root).
// Synthetic pairing fixtures for the shell's JVM tests: a QR bootstrap and invitation v4 with a freshly generated
// certificate. No real keys, hosts or tokens.
import { writeFileSync } from 'node:fs';
import { encodeInvitationQr } from '../../../../../host/src/qr.ts';
import { generateServerIdentity } from '../../../../../host/src/x509.ts';
const out = process.argv[2]!;
const hostId = '0123456789abcdef0123456789abcdef';
const identity = generateServerIdentity(`h-${hostId}.dsh.invalid`);
const other = generateServerIdentity('h-ffffffffffffffffffffffffffffffff.dsh.invalid');
const address = 'tcSYNTHETICADDRESSaGVsbG8';
const bootstrap = { version: 1, expiresAt: 4102444800000, tailcat: { address, port: 48932, key: 'privkey:' + '11'.repeat(32), proof: 'A'.repeat(43) } };
const invitation = { version: 4, baseUrl: `https://h-${hostId}.dsh.invalid`, pinSha256: identity.pinSha256, certificatePem: identity.certPem, pairingToken: 'B'.repeat(43), tailcat: { address, port: 48931 } };
writeFileSync(`${out}/pairing.json`, JSON.stringify({ qr: encodeInvitationQr(bootstrap), bootstrap, invitation, otherCertificatePem: other.certPem, otherPin: other.pinSha256, keyPem: identity.keyPem, otherKeyPem: other.keyPem }, null, 1) + '\n');
