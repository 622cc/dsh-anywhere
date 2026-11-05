// The phone's way to DSH: Tailcat reaches only the companion's own server, so the companion relays /dsh/* to DSH's
// web protocol, signed in as DSH's Desktop host signs in. Only a device paired with every workspace (the owner's
// phone) may use it. The stand-in DSH (helpers/fake-dsh.ts) mints a host-bound cookie at GET /?token=.
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { WebSocket } from 'ws';
import { createDshRelay } from '../src/dsh-relay.ts';
import { startHostServer } from '../src/server.ts';
import type { HostAdapter, HostConfiguration } from '../src/types.ts';
import { fakeDsh, TOKEN } from './helpers/fake-dsh.ts';

const adapter = { upstreamVersion: 'synthetic', async listSessions() { return []; }, async listPresets() { return []; } } as unknown as HostAdapter;
const ENVELOPE = { type: 'client-request', rpcId: 'r', method: 'session/list', payload: { args: { _request: {} } } };

async function setup(t: TestContext) {
  const dsh = await fakeDsh(t);
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-route-')));
  const pkg = join(dir, 'p.nshpkg'); writeFileSync(pkg, 'signed-package-bytes');
  const ui = { packagePath: (id: string) => (id === 'call/1' ? pkg : undefined), rootKey: async () => 'root-public-key' };
  const config: HostConfiguration = { hostName: 'Synthetic', bind: '127.0.0.1', port: 0, statePath: join(dir, 'host.sqlite'), allowInsecureLoopback: true, workspaces: [{ id: 'alpha', name: 'alpha', path: dir }] };
  const relay = createDshRelay({ ui, upstream: () => ({ origin: dsh.origin, loginUrl: `${dsh.origin}/?token=${TOKEN}` }) });
  const host = await startHostServer({ config, adapter, dsh: () => relay });
  const base = (await host.start()).baseUrl;
  t.after(async () => { await relay.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); });
  const pair = (grants: { readWorkspaceIds: string[]; executeWorkspaceIds: string[] }) => host.state.consumePairing(host.state.createPairing(grants).pairingToken, 'Synthetic phone').deviceToken;
  const post = (path: string, token?: string, headers: Record<string, string> = {}) => fetch(`${base}/dsh${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(ENVELOPE) });
  return { dsh, base, pair, post, owner: pair({ readWorkspaceIds: ['*'], executeWorkspaceIds: ['*'] }) };
}

test('the owner\'s phone reaches DSH: one sign-in, DSH\'s Host and session cookie, nothing of the phone\'s own', async t => {
  const { dsh, post, owner } = await setup(t);
  const first = await post('/api/session/list', owner, { cookie: 'phone=1' });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { echoed: ENVELOPE, path: '/api/session/list' });
  assert.equal((await post('/api/session/list', owner)).status, 200);
  assert.equal(dsh.logins(), 1, 'one sign-in serves later requests');
  const forwarded = dsh.seen.filter(s => s.path.startsWith('/api/'));
  assert.equal(forwarded.length, 2);
  assert.ok(forwarded.every(s => s.host === new URL(dsh.origin).host && !s.authorization && !s.cookie?.includes('phone=1') && !s.path.includes(owner)), 'the device token and the phone\'s cookies never reach DSH');
});

test('only the owner\'s phone, only with its token in the header, only the API', async t => {
  const { dsh, base, pair, post, owner } = await setup(t);
  assert.equal((await post('/api/session/list', pair({ readWorkspaceIds: ['*'], executeWorkspaceIds: [] }))).status, 403, 'a phone limited to reading must not get owner access to DSH');
  assert.equal((await post('/api/session/list', pair({ readWorkspaceIds: ['alpha'], executeWorkspaceIds: ['alpha'] }))).status, 403);
  assert.equal((await post('/api/session/list')).status, 401);
  assert.equal((await post(`/api/session/list?dshm_key=${owner}`)).status, 401, 'no query credentials outside the socket');
  assert.equal((await post('/api/session/list', owner, { origin: 'https://example.invalid' })).status, 403, 'no browser surface');
  assert.equal((await fetch(`${base}/dsh/`, { headers: { authorization: `Bearer ${owner}` } })).status, 404);
  assert.equal(dsh.seen.length, 0);
});

test('an expired DSH session is renewed once and the request still succeeds', async t => {
  const { dsh, post, owner } = await setup(t);
  assert.equal((await post('/api/session/list', owner)).status, 200);
  dsh.rotate();
  assert.equal((await post('/api/session/list', owner)).status, 200);
  assert.equal(dsh.logins(), 2);
});

test('the socket is relayed both ways with DSH\'s cookie; the token may ride its query', async t => {
  const { base, pair, owner } = await setup(t);
  const ws = new WebSocket(`${base.replace('http', 'ws')}/dsh/api/remote.mux?dshm_key=${owner}`);
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const echoed = new Promise<string>(resolve => ws.once('message', data => resolve(String(data))));
  ws.send('ping');
  assert.equal(await echoed, 'echo:ping');
  for (const [token, status] of [[pair({ readWorkspaceIds: ['*'], executeWorkspaceIds: [] }), 403], ['wrong', 401]] as const) {
    const refused = new WebSocket(`${base.replace('http', 'ws')}/dsh/api/remote.mux?dshm_key=${token}`);
    refused.on('error', () => {}); t.after(() => refused.terminate());
    assert.equal(await new Promise<number>(resolve => refused.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))), status);
  }
});

test('generated modules: the owner\'s phone gets the root key and a call\'s package', async t => {
  const { base, dsh, owner } = await setup(t);
  const get = (path: string, token?: string) => fetch(`${base}/dsh${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const root = await get('/ui/root.pub', owner);
  assert.equal(root.status, 200); assert.equal(await root.text(), 'root-public-key');
  const pkg = await get(`/ui/package?call=${encodeURIComponent('call/1')}`, owner);
  assert.equal(pkg.status, 200); assert.equal(pkg.headers.get('content-type'), 'application/octet-stream'); assert.equal(await pkg.text(), 'signed-package-bytes');
  assert.equal((await get('/ui/package?call=missing', owner)).status, 404);
  assert.equal((await get('/ui/root.pub')).status, 401);
  assert.equal(dsh.seen.length, 0);
});
