// macOS/POSIX installer, run against a throwaway HOME and DSH_HOME. Needs the built host (npm run build).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const installer = path.join(path.dirname(fileURLToPath(import.meta.url)), 'install-host.mjs');

function sandbox(t) {
  const home = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'dsh-install-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dshHome = path.join(home, '.dsh');
  mkdirSync(path.join(dshHome, 'profiles', 'desktop'), { recursive: true });
  writeFileSync(path.join(dshHome, 'profiles', 'desktop', 'cordis.patch.yml'), '# synthetic profile\n');
  writeFileSync(path.join(dshHome, 'profiles', 'desktop', 'package.json'), '{"name":"synthetic-profile"}\n');
  const run = (...args) => spawnSync(process.execPath, [installer, '--profile', 'desktop', '--dsh-home', dshHome, ...args, ...(args.includes('--activate') ? ['--no-wait'] : [])],
    { env: { ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, '.local', 'share') }, encoding: 'utf8' });
  const base = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'DSHMobile') : path.join(home, '.local', 'share', 'DSHMobile');
  const declared = () => JSON.parse(readFileSync(path.join(base, 'host', 'host.json'), 'utf8')).dshVersion;
  const profile = () => readFileSync(path.join(dshHome, 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8');
  return { run, declared, profile, base, manifest: path.join(dshHome, 'profiles', 'desktop', 'package.json') };
}

test('an explicit --dsh-version re-declares an existing installation after a DSH update', t => {
  const { run, declared, profile } = sandbox(t);
  const first = run('--dsh-version', '0.2.1-rc.2', '--activate');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(declared(), '0.2.1-rc.2');
  assert.match(profile(), /dshVersion: '0\.2\.1-rc\.2'/);

  const updated = run('--dsh-version', '0.2.1-rc.3', '--activate');
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(declared(), '0.2.1-rc.3');
  assert.match(profile(), /dshVersion: '0\.2\.1-rc\.3'/);
  assert.doesNotMatch(profile(), /0\.2\.1-rc\.2/);

  const unsupported = run('--dsh-version', '0.9.9', '--activate');
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /0\.9\.9/);
  assert.equal(declared(), '0.2.1-rc.3', 'an unsupported version leaves the configuration unchanged');
  assert.match(profile(), /dshVersion: '0\.2\.1-rc\.3'/);
});

test('--generative-ui turns on the show_interface tool in the profile block; without it the block stays as before', t => {
  const { run, profile } = sandbox(t);
  const on = run('--dsh-version', '0.2.1-rc.3', '--generative-ui', '--activate');
  assert.equal(on.status, 0, on.stderr);
  assert.match(profile(), /\n        generativeUi: true\n/);
  const off = run('--dsh-version', '0.2.1-rc.3', '--activate');
  assert.equal(off.status, 0, off.stderr);
  assert.doesNotMatch(profile(), /generativeUi/);
});

test('--nsh pins the NSH that builds generated interfaces to the one the phone runs; it must be an absolute path to a file', t => {
  const { run, profile } = sandbox(t);
  const ok = run('--dsh-version', '0.2.1-rc.3', '--generative-ui', '--nsh', process.execPath, '--activate');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(profile(), new RegExp(`\\n        nsh: ${JSON.stringify(process.execPath).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\n`));
  const relative = run('--dsh-version', '0.2.1-rc.3', '--nsh', 'nsh', '--activate');
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /--nsh/);
});

test('the profile names the stable loader and the version, so an update is a config change DSH applies live', t => {
  const { run, profile } = sandbox(t);
  const first = run('--dsh-version', '0.2.1-rc.3', '--activate');
  assert.equal(first.status, 0, first.stderr);
  const version = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'host', 'package.json'), 'utf8')).version;
  assert.match(profile(), /\n      name: "file:\/\/[^"]+\/plugin\/companion\.js"\n/);
  assert.match(profile(), new RegExp(`\\n        version: '${version.replace(/\./g, '\\.')}'\\n`));
  assert.doesNotMatch(profile(), /\/dist\/plugin\.js/);
});

test('--activate refuses a profile that already runs DSH Anywhere from "dsh plugin add", before changing anything', t => {
  const { run, profile, base, manifest } = sandbox(t);
  writeFileSync(manifest, JSON.stringify({ name: 'synthetic-profile', dependencies: { 'dsh-anywhere': 'https://example.invalid/dsh-anywhere.tgz' }, dsh: { profile: { bundles: ['dsh-anywhere'] } } }) + '\n');
  const before = profile();
  const refused = run('--dsh-version', '0.2.1-rc.3', '--activate');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /dsh plugin --profile desktop remove dsh-anywhere/);
  assert.equal(profile(), before, 'profile patch unchanged');
  assert.equal(existsSync(base), false, 'nothing was installed');
});
