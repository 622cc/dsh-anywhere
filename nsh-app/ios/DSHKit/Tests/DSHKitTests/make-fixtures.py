# Regenerate (from the repo root): python3 -I nsh-app/ios/DSHKit/Tests/DSHKitTests/make-fixtures.py
# Synthetic certificates the companion never makes (two names, no name) and QR text at the 64 KiB inflate cap, for
# the cases android/app/src/test/resources/pairing.json does not cover (their private keys are thrown away), and that
# file's two synthetic identities as PKCS#12 (password `test`) for a stand-in companion's TLS (BridgeTests).
import base64, json, os, subprocess, tempfile, zlib

here = os.path.dirname(os.path.abspath(__file__))
host = 'h-0123456789abcdef0123456789abcdef.dsh.invalid'

def cert(san):
    with tempfile.TemporaryDirectory() as d:
        key, crt = os.path.join(d, 'k'), os.path.join(d, 'c')
        args = ['openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
                '-keyout', key, '-out', crt, '-days', '825', '-subj', '/CN=' + host]
        if san: args += ['-addext', 'subjectAltName=' + san]
        subprocess.run(args, check=True, capture_output=True)
        pem = open(crt).read()
        spki = subprocess.run(['openssl', 'x509', '-in', crt, '-pubkey', '-noout'], check=True, capture_output=True).stdout
        der = subprocess.run(['openssl', 'pkey', '-pubin', '-outform', 'der'], input=spki, check=True, capture_output=True).stdout
        import hashlib
        return {'certificatePem': pem, 'pinSha256': 'sha256/' + base64.b64encode(hashlib.sha256(der).digest()).decode()}

def qr(size):
    base = {'version': 1, 'expiresAt': 4102444800000, 'tailcat': {'address': 'tcSYNTHETICADDRESSaGVsbG8', 'port': 48932,
            'key': 'privkey:' + '11' * 32, 'proof': 'A' * 43}, 'pad': ''}
    base['pad'] = 'x' * (size - len(json.dumps(base, separators=(',', ':'))))
    text = json.dumps(base, separators=(',', ':'))
    assert len(text) == size
    return 'dshm1:' + base64.urlsafe_b64encode(zlib.compress(text.encode())).decode().rstrip('=')

def p12(f, cert_key, key_key):
    with tempfile.TemporaryDirectory() as d:
        open(os.path.join(d, 'c'), 'w').write(f[cert_key]); open(os.path.join(d, 'k'), 'w').write(f[key_key])
        der = subprocess.run(['openssl', 'pkcs12', '-export', '-in', os.path.join(d, 'c'), '-inkey', os.path.join(d, 'k'),
                              '-passout', 'pass:test'], check=True, capture_output=True).stdout
        return base64.b64encode(der).decode()

pairing = json.load(open(os.path.join(here, '../../../../android/app/src/test/resources/pairing.json')))
pairing['certPem'] = pairing['invitation']['certificatePem']
out = {'companionP12': p12(pairing, 'certPem', 'keyPem'), 'otherP12': p12(pairing, 'otherCertificatePem', 'otherKeyPem'),
       'twoNames': cert('DNS:' + host + ',DNS:other.dsh.invalid'), 'noName': cert(None),
       'qrAtCap': qr(65536), 'qrOverCap': qr(65537),
       'qrWithDictionary': 'dshm1:' + base64.urlsafe_b64encode((lambda c: c.compress(b'{}') + c.flush())(zlib.compressobj(zdict=b'dictionary'))).decode().rstrip('=')}
with open(os.path.join(here, 'Fixtures', 'extra.json'), 'w') as f:
    json.dump(out, f, indent=1); f.write('\n')
