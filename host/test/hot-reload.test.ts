// DSH's profile hot reload starts the new companion while the old one is still closing: the new one must wait for
// the port instead of failing once and leaving the phone with no companion until DSH restarts.
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startHostServer } from '../src/server.ts';
import type { HostAdapter, HostConfiguration } from '../src/types.ts';

const adapter = { upstreamVersion: 'synthetic', async listSessions() { return []; }, async listPresets() { return []; } } as unknown as HostAdapter;

test('a companion started while the previous one still holds the port starts once the port is free', async t => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'hot-reload-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = createServer(); await new Promise<void>(resolve => old.listen(0, '127.0.0.1', resolve));
  const port = (old.address() as AddressInfo).port;
  setTimeout(() => old.close(), 1500); // the previous companion finishes closing a moment later
  const config: HostConfiguration = { hostName: 'Synthetic', bind: '127.0.0.1', port, statePath: join(dir, 'host.sqlite'), allowInsecureLoopback: true, workspaces: [{ id: 'alpha', name: 'alpha', path: dir }] };
  const host = await startHostServer({ config, adapter });
  t.after(() => host.close());
  const { baseUrl } = await host.start();
  assert.equal(baseUrl, `http://127.0.0.1:${port}`);
});

test('a companion started while the previous one still holds the state lock starts once it is released', async t => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'hot-reload-lock-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config: HostConfiguration = { hostName: 'Synthetic', bind: '127.0.0.1', port: 0, statePath: join(dir, 'host.sqlite'), allowInsecureLoopback: true, workspaces: [{ id: 'alpha', name: 'alpha', path: dir }] };
  const old = await startHostServer({ config, adapter });
  await old.start();
  setTimeout(() => { old.close(); }, 1500); // the previous companion is still closing
  const next = await startHostServer({ config, adapter });
  t.after(() => next.close());
  const { baseUrl } = await next.start();
  assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
});
