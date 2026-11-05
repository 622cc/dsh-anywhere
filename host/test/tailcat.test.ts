import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { connect, createServer as createNetServer } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import type { TestContext } from 'node:test';
import { runAdminCli } from '../src/cli.ts';
import { loadConfiguration, prepareConfiguration } from '../src/config.ts';
import { lanAddresses, localPairingSession, sameSubnet, serveLocalPairing, wireLine, x25519Private, x25519PublicRaw } from '../src/local-pairing.ts';
import { startHostServer } from '../src/server.ts';
import { setupTailcat } from '../src/setup-tailcat.ts';
import { HostState, hashSecret } from '../src/state.ts';
import { createTailcatConnector, tailcatHelperCommand } from '../src/tailcat-connector.ts';
import type { HostAdapter, HostConfiguration } from '../src/types.ts';
import { generateServerIdentity } from '../src/x509.ts';
import { createWorkspaceSource } from '../src/workspace-source.ts';

const FAKE = fileURLToPath(new URL('./fixtures/fake-tailcat-helper.mjs', import.meta.url));
const helper = { command: process.execPath, args: [FAKE] };
const PHONE = 'nodekey:' + 'ab'.repeat(32), OTHER = 'nodekey:' + 'cd'.repeat(32);
const DSH = '0.2.1-alpha.1';
const all = { readWorkspaceIds: ['*'], executeWorkspaceIds: ['*'] };
const adapter: HostAdapter = {
  upstreamVersion: 'synthetic-tailcat', async listPresets() { return []; }, async listSessions() { return []; },
  async snapshot() { throw new Error('No synthetic sessions'); }, async *watch() {},
  async createSession() { return { sessionId: 'synthetic' }; }, async prompt() {}, async cancel() {},
};

const emptyRegistry = { list: () => [], archivedSessionIds: [] };
const registry = () => createWorkspaceSource({ workspaceSource: 'dsh-registry' }, () => emptyRegistry);
// Remove temp directories after every test's own hooks have closed databases and helpers: Windows
// refuses to delete open files, and a throwing hook would skip the remaining cleanup.
const tempDirs: string[] = [];
after(() => { for (const dir of tempDirs) try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp only */ } });
function temp(_t: TestContext, prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}
/** Fake helper behavior is selected by environment; restore it after each test. */
function fakeEnv(t: TestContext, values: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
function readLog(path: string): Record<string, any>[] {
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}
async function waitFor<T>(probe: () => T | undefined | false, timeoutMs = 5000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > end) throw new Error('condition not reached');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
async function tailcatSetup(t: TestContext) {
  const dir = temp(t, 'dsh-mobile-tailcat-'), configPath = join(dir, 'companion', 'host.json');
  const result = await setupTailcat({ configPath, port: await freePort(), dshVersion: DSH, hostName: 'Synthetic Mac' });
  return { dir, configPath, result, config: await loadConfiguration(configPath) };
}

test('native identity is a pinned P-256 serverAuth leaf for exactly one DNS name and completes TLS', async t => {
  const name = 'h-0123456789abcdef0123456789abcdef.dsh.invalid', identity = generateServerIdentity(name);
  const x509 = new X509Certificate(identity.certPem);
  assert.equal(x509.ca, false); assert.ok(x509.verify(x509.publicKey));
  assert.equal(x509.publicKey.asymmetricKeyDetails?.namedCurve, 'prime256v1');
  assert.deepEqual(x509.keyUsage, ['1.3.6.1.5.5.7.3.1']);
  assert.equal(x509.subjectAltName, `DNS:${name}`);
  assert.equal(x509.checkHost(name, { subject: 'never' }), name);
  assert.equal(x509.checkHost('h-other.dsh.invalid'), undefined);
  assert.ok(Date.parse(x509.validTo) - Date.now() <= 825 * 86_400_000);
  assert.equal(identity.pinSha256, 'sha256/' + createHash('sha256').update(x509.publicKey.export({ type: 'spki', format: 'der' })).digest('base64'));
  for (const bad of ['', 'UPPER.invalid', 'nodot', '-x.invalid']) assert.throws(() => generateServerIdentity(bad), { code: 'invalid_request' });
  const server = createHttpsServer({ cert: identity.certPem, key: identity.keyPem, minVersion: 'TLSv1.2' }, (_req, res) => res.end('ok'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const peer = await new Promise<X509Certificate>((resolve, reject) => {
    const socket = tlsConnect({ host: '127.0.0.1', port: (server.address() as { port: number }).port, servername: name, ca: identity.certPem }, () => { resolve(socket.getPeerX509Certificate()!); socket.end(); });
    socket.on('error', reject);
  });
  assert.equal(peer.fingerprint256, x509.fingerprint256);
});

test('tailcat configuration requires loopback TLS with the exact inner name and excludes relay', async t => {
  const { config, configPath, result } = await tailcatSetup(t);
  assert.equal(result.existing, false);
  assert.match(config.publicUrl!, /^https:\/\/h-[a-f0-9]{32}\.dsh\.invalid$/);
  assert.equal(config.publicUrl, `https://h-${config.tailcat!.hostId}.dsh.invalid`);
  assert.equal(config.includeCertificatePem, true); assert.equal(config.workspaceSource, 'dsh-registry');
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as HostConfiguration;
  for (const bad of [{ bind: '0.0.0.0' }, { port: 80 }, { tls: undefined }, { tailcat: { enabled: true, hostId: 'XYZ' } }, { tailcat: { enabled: true, hostId: '0'.repeat(32) } },
    { tailcat: { ...raw.tailcat, helperPath: 'relative/helper' } }, { tailcat: { ...raw.tailcat, extra: 1 } }, { relay: { url: 'wss://relay.example.test', routeId: 'a'.repeat(32), connectorToken: 'A'.repeat(43) } }])
    await assert.rejects(prepareConfiguration({ ...raw, ...bad } as HostConfiguration), { code: 'invalid_config' }, JSON.stringify(Object.keys(bad)));
  assert.deepEqual((await setupTailcat({ configPath, port: raw.port, dshVersion: DSH })).existing, true, 'rerun keeps the identity');
  await assert.rejects(setupTailcat({ configPath, port: raw.port + 1, dshVersion: DSH }), { code: 'invalid_config' });
  assert.throws(() => tailcatHelperCommand({ enabled: true, hostId: raw.tailcat!.hostId, helperPath: join(tmpdir(), 'missing-tailcat-helper') }), { code: 'tailcat_helper_missing' });
  await assert.rejects(startHostServer({ config: { ...raw, tailcat: { ...raw.tailcat!, helperPath: join(tmpdir(), 'missing-tailcat-helper') } }, adapter, workspaceSource: await registry() }), { code: 'tailcat_helper_missing' }, 'fails closed before binding');
});

test('a helper persist without a DERP region yet (null state) is accepted and keeps a fresh identity', async t => {
  const state = new HostState(join(temp(t, 'dsh-tailcat-null-'), 'host.sqlite'));
  t.after(() => state.close());
  state.persistTailcat(null, []);
  assert.equal(state.tailcatSnapshot().state, null);
  assert.deepEqual(state.tailcatSnapshot().allowedClients, []);
  assert.throws(() => state.persistTailcat('', []));
});

test('helper persist is acknowledged only after the state commit, and status never shows secrets', async t => {
  const { dir, config, configPath } = await tailcatSetup(t), log = join(dir, 'helper.log');
  fakeEnv(t, { FAKE_TAILCAT_LOG: log, FAKE_TAILCAT_DB: config.statePath });
  const state = new HostState(config.statePath); t.after(() => state.close());
  const connector = createTailcatConnector({ tailcat: config.tailcat!, state, targetPort: config.port, hostName: config.hostName, helper, pollMs: 20, sweepMs: 50 });
  t.after(() => connector.close());
  connector.start();
  const ack = await waitFor(() => readLog(log).find(row => row.ack));
  assert.deepEqual(ack, { ack: '1', ok: true, committedState: 'fake-node-state-1' });
  const configLine = readLog(log)[0]!.received;
  assert.deepEqual(configLine, { version: 3, localPort: config.port, state: null, allowedClients: [], name: 'Synthetic Mac' });
  await waitFor(() => connector.status().ready);
  let output = '';
  assert.equal(await runAdminCli(['tailcat-status', '--config', configPath], { out: text => { output += text; }, error() {} }), 0);
  const status = JSON.parse(output);
  assert.equal(status.running, true); assert.equal(status.allowedClients, 0);
  assert.ok(!output.includes('fake-node-state'), 'node state stays private');
});

/** The normal invitation never enters the QR: the CLI hands the helper a template, and the helper serves it to the phone over /pair. */
function helperInvitation(log: string): Record<string, any> {
  const template = readLog(log).find(row => row.received?.command === 'pair')?.received.invitation;
  assert.ok(typeof template === 'string' && template.length > 0, 'the CLI handed the helper the invitation template');
  assert.match(template, /\$TAILCAT_ADDRESS/);
  return JSON.parse(template.replaceAll('$TAILCAT_ADDRESS', 'tcfake-normal-address').replaceAll('$PHONE_KEY', PHONE));
}

test('CLI pairing round trip: plugin opens the window, bootstrap v1 renders, the helper gets the v4 template, consume links the phone key', async t => {
  const { dir, config, configPath } = await tailcatSetup(t), log = join(dir, 'helper.log');
  fakeEnv(t, { FAKE_TAILCAT_LOG: log, FAKE_TAILCAT_AUTOPAIR: PHONE });
  const state = new HostState(config.statePath); t.after(() => state.close());
  const connector = createTailcatConnector({ tailcat: config.tailcat!, state, targetPort: config.port, hostName: config.hostName, helper, pollMs: 20, sweepMs: 50 });
  t.after(() => connector.close());
  connector.start(); await waitFor(() => connector.status().ready);
  const output = join(dir, 'companion', 'invitations', 'phone.json');
  let errors = '';
  assert.equal(await runAdminCli(['pair', '--config', configPath, '--tailcat', '--read', 'all', '--execute', 'all', '--output', output], { out() {}, error: text => { errors += text; } }), 0, errors);
  const bootstrap = JSON.parse(readFileSync(output, 'utf8'));
  assert.deepEqual(Object.keys(bootstrap).sort(), ['expiresAt', 'tailcat', 'version'], 'the QR carries only the pairing-node capability');
  assert.equal(bootstrap.version, 1);
  assert.deepEqual(bootstrap.tailcat, { address: 'tcfake-pairing-address', port: 48932, key: 'privkey:' + '1'.repeat(64), proof: 'P'.repeat(43) });
  assert.ok(bootstrap.expiresAt > Date.now() && bootstrap.expiresAt <= Date.now() + 121_000);
  const invitation = helperInvitation(log);
  assert.equal(invitation.version, 4); assert.equal(invitation.baseUrl, config.publicUrl);
  assert.deepEqual(invitation.tailcat, { address: 'tcfake-normal-address', port: 48931 }, 'the normal invitation names the normal node and carries no key or proof');
  assert.match(invitation.certificatePem, /BEGIN CERTIFICATE/); assert.match(invitation.pinSha256, /^sha256\//);
  // The fake phone is allowlisted through the window; the key is provisional until /v1/pairings succeeds.
  await waitFor(() => state.tailcatClientCounts().pending === 1);
  assert.deepEqual(state.tailcatAllowedClients(), [PHONE]);
  const paired = state.consumePairing(invitation.pairingToken, 'Synthetic phone');
  assert.deepEqual(state.tailcatClientCounts(), { linked: 1, pending: 0 });
  assert.equal(state.nextTailcatPairingRequest(), undefined, 'the CLI deleted the request row and its ephemeral key/proof');
  // Revocation removes reachability on the next sweep.
  state.revokeDevice(paired.deviceId); connector.sweep();
  await waitFor(() => readLog(log).some(row => row.received?.command === 'setAllowed' && row.received.allowedClients.length === 0));
  assert.deepEqual(state.tailcatAllowedClients(), []);
});

test('pair --tailcat refuses an existing output file before opening a window, and says so', async t => {
  const { dir, config, configPath } = await tailcatSetup(t), log = join(dir, 'helper.log');
  fakeEnv(t, { FAKE_TAILCAT_LOG: log });
  const state = new HostState(config.statePath); t.after(() => state.close());
  const connector = createTailcatConnector({ tailcat: config.tailcat!, state, targetPort: config.port, hostName: config.hostName, helper, pollMs: 20, sweepMs: 50 });
  t.after(() => connector.close());
  connector.start(); await waitFor(() => connector.status().ready);
  const output = join(dir, 'companion', 'invitations', 'stale.json');
  const io = { out() {}, error: (text: string) => { errors += text; } };
  let errors = '';
  assert.equal(await runAdminCli(['pair', '--config', configPath, '--tailcat', '--read', 'all', '--output', output], io), 0, errors);
  const first = readFileSync(output, 'utf8');
  errors = '';
  assert.equal(await runAdminCli(['pair', '--config', configPath, '--tailcat', '--read', 'all', '--execute', 'all', '--output', output], io), 1);
  assert.match(errors, /^invitation_output_exists/, 'an existing file is not reported as an unreachable companion');
  assert.equal(readFileSync(output, 'utf8'), first, 'the existing file is left untouched');
  assert.equal(readLog(log).filter(row => row.received?.command === 'pair').length, 1, 'no second pairing window was opened');
});

test('unconsumed phone keys expire from the allowlist, and pairing fails cleanly without a running companion', async t => {
  const { dir, config, configPath } = await tailcatSetup(t), log = join(dir, 'helper.log');
  let now = Date.now();
  const state = new HostState(config.statePath, { now: () => now }); t.after(() => state.close());
  const offer = state.createPairing(all), hash = hashSecret(offer.pairingToken);
  state.persistTailcat('fake-node-state-1', [PHONE], { pairingHash: hash, offerExpiresAt: offer.expiresAt });
  state.persistTailcat('fake-node-state-1', [PHONE, OTHER]); // A key outside any window expires immediately.
  now += 1;
  assert.deepEqual(state.tailcatAllowedClients(), [PHONE]);
  fakeEnv(t, { FAKE_TAILCAT_LOG: log });
  const connector = createTailcatConnector({ tailcat: config.tailcat!, state, targetPort: config.port, hostName: config.hostName, helper, pollMs: 20, sweepMs: 50 });
  t.after(() => connector.close());
  connector.start();
  await waitFor(() => readLog(log)[0]?.received?.allowedClients?.length === 1);
  now = offer.expiresAt + 60_001; connector.sweep();
  await waitFor(() => readLog(log).some(row => row.received?.command === 'setAllowed' && row.received.allowedClients.length === 0));
  await connector.close();
  let errors = '';
  assert.equal(await runAdminCli(['pair', '--config', configPath, '--tailcat', '--read', 'all', '--qr'], { out() {}, error: text => { errors += text; } }, { tailcatWaitMs: 300 }), 1);
  assert.match(errors, /^tailcat_unavailable/);
});

test('a crashing helper restarts with backoff and resumes from persisted state', async t => {
  const { dir, config } = await tailcatSetup(t), log = join(dir, 'helper.log');
  fakeEnv(t, { FAKE_TAILCAT_LOG: log, FAKE_TAILCAT_CRASH_ONCE: join(dir, 'crashed') });
  const state = new HostState(config.statePath); t.after(() => state.close());
  state.persistTailcat('persisted-node-state', []);
  const connector = createTailcatConnector({ tailcat: config.tailcat!, state, targetPort: config.port, hostName: config.hostName, helper, pollMs: 20, sweepMs: 50 });
  t.after(() => connector.close());
  connector.start();
  await waitFor(() => connector.status().ready, 8000);
  assert.ok(connector.status().restarts >= 1);
  const configs = readLog(log).filter(row => row.received?.version === 3);
  assert.equal(configs.length, 2);
  assert.ok(configs.every(row => row.received.state === 'persisted-node-state'));
});

test('companion server runs the helper, exempts loopback tunnels from throttling and links the paired phone', async t => {
  const { dir, configPath } = await tailcatSetup(t), log = join(dir, 'helper.log');
  fakeEnv(t, { FAKE_TAILCAT_LOG: log, FAKE_TAILCAT_AUTOPAIR: PHONE });
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as HostConfiguration;
  const host = await startHostServer({ config: raw, adapter, workspaceSource: await registry(), tailcatHelper: helper });
  t.after(() => host.close());
  await waitFor(() => host.tailcat?.status().ready);
  const output = join(dir, 'companion', 'invitations', 'server.json');
  assert.equal(await runAdminCli(['pair', '--config', configPath, '--tailcat', '--read', 'all', '--output', output], { out() {}, error() {} }), 0);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).version, 1);
  await waitFor(() => host.state.tailcatClientCounts().pending === 1);
  const invitation = helperInvitation(log);
  const name = new URL(invitation.baseUrl).hostname;
  // What the phone does through its Tailcat forward: pinned HTTPS to the loopback listener.
  const body = JSON.stringify({ pairingToken: invitation.pairingToken, deviceName: 'Synthetic phone' });
  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const socket = tlsConnect({ host: '127.0.0.1', port: raw.port, servername: name, ca: invitation.certificatePem }, () => {
      socket.write(`POST /v1/pairings HTTP/1.1\r\nHost: ${name}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    });
    let text = ''; socket.setEncoding('utf8'); socket.on('data', chunk => { text += chunk; }); socket.on('error', reject);
    socket.on('end', () => resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(text)?.[1]), body: text.slice(text.indexOf('\r\n\r\n') + 4) }));
  });
  assert.equal(response.status, 201);
  assert.deepEqual(host.state.tailcatClientCounts(), { linked: 1, pending: 0 });
  // Thirty-plus bad bearers from loopback never throttle the tunnel peer.
  for (let n = 0; n < 32; n++) {
    const status = await new Promise<number>((resolve, reject) => {
      const socket = tlsConnect({ host: '127.0.0.1', port: raw.port, servername: name, ca: invitation.certificatePem }, () => socket.write(`GET /v1/workspaces HTTP/1.1\r\nHost: ${name}\r\nAuthorization: Bearer ${'A'.repeat(43)}\r\nConnection: close\r\n\r\n`));
      let text = ''; socket.setEncoding('utf8'); socket.on('data', chunk => { text += chunk; }); socket.on('error', reject);
      socket.on('end', () => resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(text)?.[1])));
    });
    assert.equal(status, 401);
  }
});

test('same-Wi-Fi pairing reproduces the frozen vector and delivers the sealed invitation to the approved phone', async t => {
  const phone = x25519Private(Buffer.from('ERERERERERERERERERERERERERERERERERERERERERE=', 'base64'));
  const hostKey = x25519Private(Buffer.from('IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI=', 'base64'));
  assert.equal(x25519PublicRaw(phone).toString('base64'), 'e06Qm75//kTEZaIgA31gjuNYl9Me+XLwf3SJLLD3PxM=');
  assert.equal(x25519PublicRaw(hostKey).toString('base64'), 'D6poTtKIZ7l/Smot7l34zpdOdrcBjj8iocTPJnhXDyA=');
  const phoneSide = localPairingSession(phone, x25519PublicRaw(hostKey), true), hostSide = localPairingSession(hostKey, x25519PublicRaw(phone), false);
  assert.equal(phoneSide.code, '295936'); assert.equal(hostSide.code, '295936');
  const sealed = hostSide.seal('{"version":3}', Buffer.from('MzMzMzMzMzMzMzMz', 'base64'));
  assert.equal(sealed.toString('base64'), 'MzMzMzMzMzMzMzMzCy/nmRJXOOnj64hGBAw4VoRK2dUw3zgf3IEP2kU=');
  assert.equal(phoneSide.open(sealed), '{"version":3}');
  assert.throws(() => phoneSide.open(Buffer.concat([sealed.subarray(0, 20), Buffer.from([sealed[20]! ^ 1]), sealed.subarray(21)])));
  assert.equal(wireLine({ v: 1, publicKey: 'x', device: 'd' }), '{"device":"d","publicKey":"x","v":1}\n');

  // Loopback stands in for Wi-Fi; one denied phone, then one approved phone.
  const invitation = JSON.stringify({ version: 3, pairingToken: 'synthetic' });
  let advertised = 0, port = 0;
  const decisions: string[] = [];
  const served = serveLocalPairing({ invitation, expiresAt: Date.now() + 10_000, serviceName: 'Synthetic Mac', host: '127.0.0.1',
    advertise: () => { advertised++; return () => { advertised--; }; }, onListening: value => { port = value; },
    confirm: async (code, device) => { decisions.push(`${device}:${code}`); return device === 'Approved phone'; } });
  await waitFor(() => port);
  async function phoneAttempt(device: string) {
    const own = generateKeyPairSync('x25519').privateKey, socket = connect(port, '127.0.0.1');
    const lines: string[] = []; let buffer = '';
    socket.setEncoding('utf8'); socket.on('data', chunk => { buffer += chunk; for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { lines.push(buffer.slice(0, i)); buffer = buffer.slice(i + 1); } });
    socket.write(wireLine({ v: 1, publicKey: x25519PublicRaw(own).toString('base64'), device }));
    await waitFor(() => lines.length >= 2 || (lines.length === 1 && socket.readableEnded && lines));
    const hello = JSON.parse(lines[0]!), session = localPairingSession(own, Buffer.from(hello.publicKey, 'base64'), true);
    const reply = JSON.parse(lines[1]!);
    socket.destroy();
    return { code: session.code, reply, session };
  }
  const denied = await phoneAttempt('Other phone');
  assert.deepEqual(denied.reply, { status: 'denied', v: 1 });
  const approved = await phoneAttempt('Approved phone');
  assert.equal(approved.reply.status, 'approved');
  assert.equal(approved.session.open(Buffer.from(approved.reply.sealed, 'base64')), invitation);
  assert.deepEqual(decisions, [`Other phone:${denied.code}`, `Approved phone:${approved.code}`]);
  await served;
  assert.equal(advertised, 0, 'Bonjour registration ends with the window');
  await assert.rejects(serveLocalPairing({ invitation, expiresAt: Date.now() + 100, serviceName: 'x', host: '127.0.0.1', advertise: () => () => {}, confirm: async () => true }), { code: 'pairing_not_approved' });
  // A silent LAN peer is dropped after the hello timeout instead of holding the single slot all window.
  let silentPort = 0;
  const window = serveLocalPairing({ invitation, expiresAt: Date.now() + 10_000, serviceName: 'x', host: '127.0.0.1', helloTimeoutMs: 200,
    advertise: () => () => {}, onListening: value => { silentPort = value; }, confirm: async () => true });
  await waitFor(() => silentPort);
  const silent = connect(silentPort, '127.0.0.1'); silent.on('error', () => {});
  const dropped = Date.now();
  await new Promise<void>(done => silent.once('close', () => done()));
  assert.ok(Date.now() - dropped < 2000, 'silent peer released the slot');
  port = silentPort;
  assert.equal((await phoneAttempt('Approved phone')).reply.status, 'approved');
  await window;
});

test('same-Wi-Fi pairing binds only private LAN addresses of physical interfaces and same-subnet peers', () => {
  const entry = (address: string, netmask: string, family: 'IPv4' | 'IPv6' = 'IPv4', internal = false) =>
    ({ address, netmask, family, internal, mac: '00:00:00:00:00:00', cidr: null }) as never;
  const lan = lanAddresses({
    lo0: [entry('127.0.0.1', '255.0.0.0', 'IPv4', true)],
    en0: [entry('192.168.1.20', '255.255.255.0'), entry('fe80::1', 'ffff:ffff:ffff:ffff::', 'IPv6')],
    en1: [entry('203.0.113.7', '255.255.255.0'), entry('10.0.0.5', '255.0.0.0')],
    en2: [entry('100.100.1.1', '255.192.0.0')],
    utun3: [entry('10.8.0.2', '255.255.255.0')], awdl0: [entry('169.254.3.3', '255.255.0.0')], bridge100: [entry('192.168.64.1', '255.255.255.0')],
  });
  assert.deepEqual(lan.map(item => item.address), ['192.168.1.20', '10.0.0.5'], 'no loopback, public, CGNAT/Tailscale, VPN, AirDrop or VM bridge');
  const wifi = { address: '192.168.1.20', netmask: '255.255.255.0' };
  assert.ok(sameSubnet('192.168.1.77', wifi));
  assert.ok(sameSubnet('::ffff:192.168.1.77', wifi));
  assert.ok(!sameSubnet('192.168.2.77', wifi));
  assert.ok(!sameSubnet('10.8.0.9', wifi));
  assert.ok(!sameSubnet('fe80::2', wifi));
  assert.ok(!sameSubnet(undefined, wifi));
});

test('pair --tailcat --local runs the whole same-Wi-Fi flow through the CLI', async t => {
  const { dir, config, configPath } = await tailcatSetup(t);
  fakeEnv(t, { FAKE_TAILCAT_LOG: join(dir, 'helper.log') });
  const state = new HostState(config.statePath); t.after(() => state.close());
  const connector = createTailcatConnector({ tailcat: config.tailcat!, state, targetPort: config.port, hostName: config.hostName, helper, pollMs: 20, sweepMs: 50 });
  t.after(() => connector.close());
  connector.start(); await waitFor(() => connector.status().ready);
  let received: Promise<string> | undefined;
  const cli = runAdminCli(['pair', '--config', configPath, '--tailcat', '--local', '--read', 'all'], { out() {}, error() {} }, { localPairing: {
    host: '127.0.0.1', advertise: () => () => {}, confirm: async () => true,
    onListening: port => { received = new Promise((resolve, reject) => {
      const own = generateKeyPairSync('x25519').privateKey, socket = connect(port, '127.0.0.1'); let buffer = '', session: ReturnType<typeof localPairingSession> | undefined;
      socket.setEncoding('utf8'); socket.on('error', reject);
      socket.on('data', chunk => { buffer += chunk; for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
        if (line.publicKey) session = localPairingSession(own, Buffer.from(line.publicKey, 'base64'), true);
        else { socket.destroy(); line.status === 'approved' ? resolve(session!.open(Buffer.from(line.sealed, 'base64'))) : reject(new Error('denied')); }
      } });
      socket.write(wireLine({ v: 1, publicKey: x25519PublicRaw(own).toString('base64'), device: 'Synthetic phone' }));
    }); } } });
  assert.equal(await cli, 0);
  const bootstrap = JSON.parse(await received!);
  assert.equal(bootstrap.version, 1); assert.equal(bootstrap.tailcat.port, 48932);
  assert.equal(bootstrap.pairingToken, undefined, 'same-Wi-Fi delivery carries the bootstrap, not the normal invitation');
  const invitation = helperInvitation(join(dir, 'helper.log'));
  assert.ok(state.consumePairing(invitation.pairingToken, 'Synthetic phone').deviceToken);
});
