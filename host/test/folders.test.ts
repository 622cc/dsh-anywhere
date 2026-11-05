// Folders on the computer for the phone's folder picker, served by the companion itself under /dsh/companion/folders/*
// in DSH's call envelope. DSH Desktop composes its native directory picker on a local install, so DSH's own
// directoryPicker/list refuses the phone; these calls follow the contract of DSH's browse backend
// (dsh-host-directory-picker-browse 0.2.1-rc.3: directories only, name-sorted, links to directories followed, a host-owned
// `hidden` flag, one-segment non-recursive creation) and stay inside the owner's home and registered workspaces.
// Synthetic folders only: a temporary "home" stands in for the owner's.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createFolders } from '../src/folders.ts';
import { startHostServer } from '../src/server.ts';
import type { HostAdapter, HostConfiguration } from '../src/types.ts';

const adapter = { upstreamVersion: 'synthetic', async listSessions() { return []; }, async listPresets() { return []; } } as unknown as HostAdapter;

/** base/home (the owner's home), base/ws (a registered workspace outside home), base/outside (neither). */
function layout(t: TestContext) {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-folders-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'), ws = join(base, 'ws'), outside = join(base, 'outside');
  for (const dir of [home, ws, outside, join(home, 'projects', 'app'), join(home, 'Desktop'), join(home, '.config'), join(home, 'beta'), join(outside, 'secret')]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(home, 'notes.txt'), 'x');
  symlinkSync(join(home, 'projects'), join(home, 'work'));
  symlinkSync(outside, join(home, 'escape'));
  symlinkSync(join(base, 'gone'), join(home, 'broken'));
  return { base, home, ws, outside };
}

async function setup(t: TestContext) {
  const dirs = layout(t);
  const config: HostConfiguration = { hostName: 'Synthetic', bind: '127.0.0.1', port: 0, statePath: join(dirs.base, 'host.sqlite'), allowInsecureLoopback: true, workspaces: [{ id: 'alpha', name: 'alpha', path: dirs.ws }] };
  const host = await startHostServer({ config, adapter, folderHome: dirs.home });
  const base = (await host.start()).baseUrl;
  t.after(() => host.close());
  const pair = (grants: { readWorkspaceIds: string[]; executeWorkspaceIds: string[] }) => host.state.consumePairing(host.state.createPairing(grants).pairingToken, 'Synthetic phone').deviceToken;
  const owner = pair({ readWorkspaceIds: ['*'], executeWorkspaceIds: ['*'] });
  const raw = (method: string, args: Record<string, unknown>, token: string | null = owner) => fetch(`${base}/dsh/companion/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r1', method, payload: { args } }),
  });
  /** The call's result: {ok, value} or {ok: false, error: {code, details}}. */
  const call = async (method: string, args: Record<string, unknown>, token: string = owner) => {
    const res = await raw(method, args, token);
    assert.equal(res.status, 200);
    const body = await res.json() as { type: string; rpcId: string; result: { ok: boolean; value?: any; error?: { code: string; message: string; details: { path?: string } } } };
    assert.equal(body.type, 'server-response'); assert.equal(body.rpcId, 'r1');
    return body.result;
  };
  return { ...dirs, pair, owner, raw, call };
}

test('only a paired phone: listing needs read of every workspace, creating also needs execute', async t => {
  const { home, raw, call, pair } = await setup(t);
  assert.equal((await raw('folders/list', {}, null)).status, 401);
  assert.equal((await raw('folders/list', {}, 'not-a-token')).status, 401);
  const partial = pair({ readWorkspaceIds: ['alpha'], executeWorkspaceIds: ['alpha'] });
  assert.equal((await raw('folders/list', {}, partial)).status, 403, 'a phone limited to some workspaces does not browse the computer');
  assert.equal((await raw('folders/check', { path: home }, partial)).status, 403);
  const reader = pair({ readWorkspaceIds: ['*'], executeWorkspaceIds: [] });
  assert.equal((await call('folders/list', {}, reader)).ok, true, 'reading every workspace is enough to list');
  assert.equal((await call('folders/check', { path: join(home, 'new') }, reader)).ok, true);
  assert.equal((await raw('folders/create', { path: home, name: 'new' }, reader)).status, 403, 'creating needs execute');
  assert.equal(existsSync(join(home, 'new')), false);
  assert.equal((await raw('folders/remove', { path: home })).status, 404);
  assert.equal((await raw('folders/list', { path: home, extra: 1 })).status, 400, 'arguments must match exactly');
  assert.equal((await raw('folders/list', { path: 7 })).status, 400);
});

test('a listing is home by default: folders only, by name, links to folders followed, dot-folders flagged hidden', async t => {
  const { home, call } = await setup(t);
  const r = await call('folders/list', {});
  assert.equal(r.ok, true);
  assert.equal(r.value.path, home); assert.equal(r.value.home, home); assert.equal(r.value.truncated, false);
  assert.deepEqual(r.value.crumbs, [{ name: home, path: home, hidden: false }], 'home is the top: no crumbs above it');
  assert.deepEqual(r.value.entries, [
    { name: '.config', path: join(home, '.config'), hidden: true },
    { name: 'beta', path: join(home, 'beta'), hidden: false },
    { name: 'Desktop', path: join(home, 'Desktop'), hidden: false },
    { name: 'projects', path: join(home, 'projects'), hidden: false },
    { name: 'work', path: join(home, 'work'), hidden: false },
  ], 'no file, no broken link, no link leading out of home');
  const into = await call('folders/list', { path: join(home, 'work') });
  assert.equal(into.ok, true, 'a link to a folder inside home is entered');
  assert.deepEqual(into.value.entries.map((e: { name: string }) => e.name), ['app']);
  assert.equal(into.value.path, join(home, 'work'), 'the path stays the one asked for');
  assert.deepEqual(into.value.crumbs.map((c: { name: string }) => c.name), [home, 'work']);
});

test('nothing outside home and the registered workspaces: not by path, not by "..", not through a link', async t => {
  const { home, ws, outside, call } = await setup(t);
  for (const path of [outside, join(outside, 'secret'), join(home, '..', 'outside'), join(home, 'escape'), '/']) {
    const r = await call('folders/list', { path });
    assert.equal(r.ok, false, path); assert.equal(r.error!.code, 'directory-picker/outside-home', path);
  }
  const relative = await call('folders/list', { path: 'home/projects' });
  assert.equal(relative.error!.code, 'directory-picker/unreadable', 'a path that is not fully qualified is refused as DSH refuses it');
  const workspace = await call('folders/list', { path: ws });
  assert.equal(workspace.ok, true, 'a registered workspace outside home is browsable');
  assert.deepEqual(workspace.value.crumbs.map((c: { path: string }) => c.path), [ws]);
  const check = await call('folders/check', { path: join(outside, 'new') });
  assert.equal(check.error!.code, 'directory-picker/outside-home');
  const create = await call('folders/create', { path: outside, name: 'new' });
  assert.equal(create.error!.code, 'directory-picker/outside-home');
  const through = await call('folders/create', { path: join(home, 'escape'), name: 'new' });
  assert.equal(through.error!.code, 'directory-picker/outside-home');
  assert.equal(existsSync(join(outside, 'new')), false);
});

test('a folder that is not there and a file are told apart, in listing and in checking', async t => {
  const { home, call } = await setup(t);
  assert.equal((await call('folders/list', { path: join(home, 'missing') })).error!.code, 'directory-picker/not-found');
  assert.equal((await call('folders/list', { path: join(home, 'notes.txt') })).error!.code, 'directory-picker/not-directory');
  assert.equal((await call('folders/list', { path: join(home, 'broken') })).error!.code, 'directory-picker/not-found');
  assert.deepEqual((await call('folders/check', { path: join(home, 'projects') })).value, { path: join(home, 'projects'), state: 'directory' });
  assert.deepEqual((await call('folders/check', { path: join(home, 'work') })).value, { path: join(home, 'work'), state: 'directory' });
  assert.deepEqual((await call('folders/check', { path: join(home, 'notes.txt') })).value, { path: join(home, 'notes.txt'), state: 'not-directory' });
  assert.deepEqual((await call('folders/check', { path: join(home, 'projects', 'new') })).value,
    { path: join(home, 'projects', 'new'), state: 'missing', parent: join(home, 'projects'), name: 'new', parentExists: true });
  assert.deepEqual((await call('folders/check', { path: join(home, 'nope', 'new') })).value,
    { path: join(home, 'nope', 'new'), state: 'missing', parent: join(home, 'nope'), name: 'new', parentExists: false });
  assert.deepEqual((await call('folders/check', { path: `${join(home, 'projects', 'new')}/` })).value.name, 'new', 'a trailing slash names the same folder');
});

test('creating makes one folder in a folder that exists, and says so when it is already there', async t => {
  const { home, call } = await setup(t);
  const made = await call('folders/create', { path: join(home, 'projects'), name: 'fresh' });
  assert.deepEqual(made, { ok: true, value: { path: join(home, 'projects', 'fresh') } });
  assert.equal(existsSync(join(home, 'projects', 'fresh')), true);
  const again = await call('folders/create', { path: join(home, 'projects'), name: 'fresh' });
  assert.equal(again.error!.code, 'directory-picker/exists');
  assert.equal(again.error!.details.path, join(home, 'projects', 'fresh'));
  const overFile = await call('folders/create', { path: home, name: 'notes.txt' });
  assert.equal(overFile.error!.code, 'directory-picker/exists');
  const deep = await call('folders/create', { path: join(home, 'nope'), name: 'new' });
  assert.equal(deep.error!.code, 'directory-picker/create-failed', 'a missing parent is a failure, never made on the way');
  assert.equal(existsSync(join(home, 'nope')), false);
});

test('a new folder\'s name is one path segment', async t => {
  const { home, call } = await setup(t);
  for (const name of ['', '   ', '.', '..', 'a/b', 'a\\b', '../up', 'nul\u0000x', 'line\nbreak']) {
    const r = await call('folders/create', { path: home, name });
    assert.equal(r.ok, false, JSON.stringify(name)); assert.equal(r.error!.code, 'directory-picker/create-failed', JSON.stringify(name));
  }
  assert.equal(existsSync(join(home, 'a')), false); assert.equal(existsSync(join(home, '..', 'up')), false);
});

test('a level with more folders than the bound keeps the first by name and says it is cut', async t => {
  const { home } = layout(t);
  const folders = createFolders({ home, roots: async () => [], maxEntries: 2 });
  const listing = await folders.list(undefined, new AbortController().signal);
  assert.deepEqual(listing.entries.map(e => e.name), ['.config', 'beta']);
  assert.equal(listing.truncated, true);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(folders.list(home, aborted.signal));
});
