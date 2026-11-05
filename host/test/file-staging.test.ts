import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { assertPrivate } from '../src/private-files.ts';
import { assertStagedFilePrivate } from './helpers/staged-file-acl.ts';
import { mkdtemp, mkdir, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileStaging } from '../src/file-staging.ts';
import { UPLOAD_LIMIT } from '../src/phone.ts';

test('staging rejects redirected directories and foreign reads, retains owner-only ACL and cleans ENOSPC', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'file-staging-security-'))), store = new FileStaging(join(root, 'host.sqlite'));
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  const signal = new AbortController().signal, data = () => (async function* () { yield Buffer.from('abc'); })();
  const path = await store.save(data(), 3, signal); await assertPrivate(store.directory); await assertStagedFilePrivate(path); assert.match(path, /[a-f0-9]{48}\.tmp$/);
  assert.throws(() => store.read(join(root, 'foreign'), signal), { code: 'not_found' }); await store.remove(path);
  const original = fs.open;
  fs.open = (async (...args: Parameters<typeof fs.open>) => { const handle = await original(...args); handle.write = (async () => { throw Object.assign(new Error('Synthetic disk full'), { code: 'ENOSPC' }); }) as typeof handle.write; return handle; }) as typeof fs.open;
  syncBuiltinESMExports();
  try { await assert.rejects(store.save(data(), 3, signal), { code: 'ENOSPC' }); } finally { fs.open = original; syncBuiltinESMExports(); }
  assert.deepEqual(await readdir(store.directory), []);
  const target = join(root, 'target'), redirected = join(root, 'redirected'); await mkdir(target); await mkdir(redirected); await symlink(target, join(redirected, 'mobile-uploads'), 'junction');
  await assert.rejects(new FileStaging(join(redirected, 'host.sqlite')).startup([]), { code: 'unsafe_private_path' });
});

test('private staging reserves total disk bytes/count before intake and removes partial failures', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'file-staging-'))), store = new FileStaging(join(root, 'host.sqlite'));
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  assert.throws(() => store.assertOutside([{ path: root }]), { code: 'unsafe_private_path' });
  const signal = new AbortController().signal;
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  const data = async function* () { await gate; throw new Error('Synthetic interrupted body'); yield Buffer.alloc(0); };
  // Reservations alone enforce 512 MiB; no large payload needs allocating.
  const pending = Array.from({ length: 25 }, () => store.save(data(), UPLOAD_LIMIT, signal));
  await assert.rejects(store.save(data(), UPLOAD_LIMIT, signal), { code: 'rate_limited' });
  release(); await Promise.all(pending.map(p => assert.rejects(p, /Synthetic interrupted body/)));
  assert.deepEqual(await readdir(store.directory), []);
  const one = () => (async function* () { yield Buffer.from('a'); })();
  const paths: string[] = [];
  for (let i = 0; i < 64; i++) paths.push(await store.save(one(), 1, signal));
  await assert.rejects(store.save(one(), 1, signal), { code: 'rate_limited' });
  await store.remove(paths[0]!); paths.shift(); paths.push(await store.save(one(), 1, signal));
  await Promise.all(paths.map(path => store.remove(path)));
  await assert.rejects(store.save(one(), 2, signal), { code: 'invalid_request' });
  assert.deepEqual(await readdir(store.directory), []);
});
