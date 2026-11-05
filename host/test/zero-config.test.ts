// The bundle row (`dsh plugin add …tgz`) carries no configuration: the companion finds the running DSH's version,
// creates its private Tailcat configuration on first start and refuses to run beside an install-host companion.
// HOME points at a throwaway directory, so the default private path is a temp path.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import plugin from '../src/plugin.ts';
import { HOST_VERSION } from '../src/phone.ts';
import { defaultConfigPath, legacyCompanionActive, runningDshVersion } from '../src/zero-config.ts';

const FAKE_HELPER = fileURLToPath(new URL('./fixtures/fake-tailcat-helper.mjs', import.meta.url));

function sandbox(t: TestContext) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-anywhere-zero-')));
  const previous = process.env.HOME;
  process.env.HOME = join(root, 'home');
  mkdirSync(process.env.HOME);
  t.after(() => { process.env.HOME = previous; rmSync(root, { recursive: true, force: true }); });
  return root;
}
/** A DSH installation as runProfile sees it: installAnchor is @deepseek-ai/dsh's package.json; app-boot sits beside it. */
function installation(root: string, version: string): string {
  const scope = join(root, 'runtime', 'node_modules', '@deepseek-ai');
  mkdirSync(join(scope, 'dsh'), { recursive: true }); mkdirSync(join(scope, 'dsh-app-boot'), { recursive: true });
  writeFileSync(join(scope, 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version, type: 'module' }));
  writeFileSync(join(scope, 'dsh-app-boot', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version, type: 'module', exports: { '.': './lib/index.js', './package.json': './package.json' } }));
  return join(scope, 'dsh', 'package.json');
}
function profile(root: string, patch?: string) {
  const dir = join(root, 'profiles', 'desktop');
  mkdirSync(dir, { recursive: true });
  if (patch !== undefined) writeFileSync(join(dir, 'cordis.patch.yml'), patch);
  return { dir, patchPath: join(dir, 'cordis.patch.yml') };
}
function context(services: Record<string, unknown>) {
  const registry = { list: () => [], archivedSessionIds: [] };
  const all: Record<string, unknown> = { workspaceRegistry: registry, ...services };
  return {
    sessionController: { async list() { return []; } },
    get: (name: string) => all[name],
    on: () => () => {},
    inject: () => undefined,
  } as any;
}
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

test('the default private configuration is the path install-host uses', t => {
  sandbox(t);
  const expected = process.platform === 'darwin'
    ? join(process.env.HOME!, 'Library', 'Application Support', 'DSHMobile', 'host', 'host.json')
    : join(process.env.XDG_DATA_HOME ?? join(process.env.HOME!, '.local', 'share'), 'DSHMobile', 'host', 'host.json');
  assert.equal(defaultConfigPath(), expected);
  const installer = readFileSync(new URL('../../tools/install-host.mjs', import.meta.url), 'utf8');
  assert.match(installer, /path\.join\(homedir\(\), 'Library', 'Application Support', 'DSHMobile'\)/);
  assert.match(installer, /path\.join\(base, 'host', 'host\.json'\)/);
});

test('the running DSH version is the version of the app-boot package beside the installation anchor', t => {
  const root = sandbox(t);
  assert.equal(runningDshVersion({ installAnchor: installation(root, '0.2.1-rc.3') }), '0.2.1-rc.3');
  assert.equal(runningDshVersion(undefined), undefined, 'no profile context: unknown');
  assert.equal(runningDshVersion({ installAnchor: join(root, 'nowhere', 'package.json') }), undefined);
  assert.equal(runningDshVersion({ installAnchor: 42 }), undefined);
});

test('an install-host block in the profile patch is detected by its marker; other patches are not', t => {
  const root = sandbox(t);
  assert.equal(legacyCompanionActive(undefined), false);
  assert.equal(legacyCompanionActive({ patchPath: join(root, 'missing.yml') }), false);
  const plain = profile(root, '# synthetic\n- insert:\n    - id: other\n      name: other\n');
  assert.equal(legacyCompanionActive(plain), false);
  const legacy = profile(root, '# synthetic\n# DSH-MOBILE-COMPANION-BEGIN v1 id=dsh-mobile-companion\n- insert:\n    - id: dsh-mobile-companion\n      name: "file:///synthetic/companion.js"\n# DSH-MOBILE-COMPANION-END v1 id=dsh-mobile-companion\n');
  assert.equal(legacyCompanionActive(legacy), true);
});

test('a bundle row with no configuration sets up Tailcat once, with the running DSH version, then starts from it', async t => {
  const root = sandbox(t);
  const ctx = context({ profileContext: { installAnchor: installation(root, '0.2.1-rc.3'), ...profile(root, '# synthetic\n') } });
  const configPath = defaultConfigPath();
  // Running from source there is no bundled helper next to the plugin: setup happens, then start fails closed before binding.
  await assert.rejects(plugin.apply(ctx, {} as any), { code: 'tailcat_helper_missing' });
  const created = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(created.dshVersion, '0.2.1-rc.3');
  assert.equal(created.tailcat.enabled, true);
  assert.equal(statSync(configPath).mode & 0o077, 0, 'owner-only');
  const hostId = created.tailcat.hostId;
  // Second start reuses the identity. Point it at the fake helper and a free port (the default 19445 may be in use here).
  writeFileSync(configPath, JSON.stringify({ ...created, port: await freePort(), tailcat: { ...created.tailcat, helperPath: FAKE_HELPER } }, null, 2), { mode: 0o600 });
  const stop = await plugin.apply(ctx, undefined as any);
  t.after(stop);
  assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).tailcat.hostId, hostId, 'never regenerated');
  assert.match(readFileSync(join(configPath, '..', 'companion.log'), 'utf8'), new RegExp(`running ${HOST_VERSION.replaceAll('.', '\\.')}`));
});

test('a bundle row fails closed without a supported DSH version and creates nothing', async t => {
  const root = sandbox(t);
  await assert.rejects(plugin.apply(context({}), {} as any), { code: 'unsupported_dsh_version' });
  await assert.rejects(plugin.apply(context({ profileContext: { installAnchor: installation(root, '0.3.0'), ...profile(root) } }), {} as any), { code: 'unsupported_dsh_version' });
  assert.equal(existsSync(defaultConfigPath()), false);
});

test('a bundle row stands down while an install-host companion is set up in the same profile', async t => {
  const root = sandbox(t);
  const legacy = profile(root, '# DSH-MOBILE-COMPANION-BEGIN v1 id=dsh-mobile-companion\n- insert: []\n# DSH-MOBILE-COMPANION-END v1 id=dsh-mobile-companion\n');
  await assert.rejects(plugin.apply(context({ profileContext: { installAnchor: installation(root, '0.2.1-rc.3'), ...legacy } }), {} as any), { code: 'companion_conflict' });
  assert.equal(existsSync(defaultConfigPath()), false);
});

test('rows that name a configPath keep their validation: relative paths and unknown keys are refused', async t => {
  const root = sandbox(t);
  const ctx = context({ profileContext: { installAnchor: installation(root, '0.2.1-rc.3'), ...profile(root) } });
  await assert.rejects(plugin.apply(ctx, { dshVersion: '0.2.1-rc.3', configPath: 'relative/host.json' }), { code: 'invalid_config' });
  await assert.rejects(plugin.apply(ctx, { dshVersion: '0.2.1-rc.3', configPath: join(root, 'host.json'), extra: 1 } as any), { code: 'invalid_config' });
  assert.equal(existsSync(defaultConfigPath()), false, 'an explicit row never falls back to the default path');
});
