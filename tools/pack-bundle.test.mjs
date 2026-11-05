// The one-command install package (tools/pack-bundle.mjs). Needs the built host with the darwin-arm64 Tailcat helper
// (tools/build-tailcat.sh, then npm run build in host/).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'tools', 'pack-bundle.mjs');
const host = JSON.parse(readFileSync(path.join(root, 'host', 'package.json'), 'utf8'));
const yaml = createRequire(path.join(root, 'host', 'package.json'))('js-yaml');
const { isCompatibleDshVersion } = await import(pathToFileURL(path.join(root, 'host', 'dist', 'compatibility.js')).href);

function temp(t, prefix) {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const pack = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
/** Reads a ustar archive: name → { mode, type, data }. */
function untar(gz) {
  const tar = gunzipSync(gz), entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const prefix = field(345, 155), name = (prefix ? prefix + '/' : '') + field(0, 100);
    const size = parseInt(field(124, 12).trim() || '0', 8), mode = parseInt(field(100, 8).trim(), 8), type = field(156, 1) || '0';
    entries.set(name, { mode, type, data: tar.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}
/** SemVer 2.0 precedence, for canonical versions only. */
function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match) throw new Error(`not canonical: ${version}`);
  return { main: match.slice(1, 4).map(Number), pre: match[4] === undefined ? [] : match[4].split('.') };
}
function compare(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.main[i] !== y.main[i]) return x.main[i] - y.main[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (Number(p) !== Number(q)) return Number(p) - Number(q); }
    else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}
/** node-semver `satisfies(version, range, { includePrerelease: true })` for ranges built from =, >=, < comparators. */
function satisfies(version, range) {
  return range.split('||').some(set => set.trim().split(/\s+/).every(comparator => {
    const [, op, bound] = /^(>=|<|=)?(.+)$/.exec(comparator);
    const order = compare(version, bound);
    return op === '>=' ? order >= 0 : op === '<' ? order < 0 : order === 0;
  }));
}

test('the package installs with no scripts and no dependencies and declares its bundle, client and DSH range', t => {
  const out = temp(t, 'dsh-anywhere-pack-');
  const result = pack('--out', out);
  assert.equal(result.status, 0, result.stderr);
  const file = path.join(out, `dsh-anywhere-darwin-arm64.tgz`);
  assert.equal(result.stdout.trim().split('\n').at(-1), file);
  const entries = untar(readFileSync(file));
  for (const name of entries.keys()) assert.match(name, /^package\//, name);
  const manifest = JSON.parse(entries.get('package/package.json').data.toString('utf8'));
  assert.equal(manifest.name, 'dsh-anywhere');
  assert.equal(manifest.version, host.version);
  assert.equal(manifest.type, 'module');
  for (const key of ['scripts', 'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies', 'bin'])
    assert.equal(manifest[key], undefined, key);
  assert.deepEqual(manifest.dsh.bundle, { patch: './cordis.patch.yml' });
  assert.deepEqual(manifest.dsh.client, host.dsh.client);
  assert.ok(entries.has('package/' + manifest.exports['./client'].replace(/^\.\//, '')), 'client bundle is in the package');
  assert.match(entries.get('package/dist/client.js').data.toString('utf8'), /^window\.__ModuleLoader__\.load\(\{\n\tid: "dsh-anywhere",/, 'the browser module is registered under the package name');
  const helper = entries.get('package/dist/tailcat/dsh-tailcat-host-darwin-arm64');
  assert.ok(helper, 'Tailcat helper is packed');
  assert.equal(helper.mode & 0o777, 0o755);

  const rows = yaml.load(entries.get('package/cordis.patch.yml').data.toString('utf8'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].insert.length, 1);
  const row = rows[0].insert[0];
  assert.equal(row.id, 'dsh-anywhere');
  assert.deepEqual(row.config, {}, 'no configuration: the companion sets itself up');
  assert.ok(entries.has(path.posix.join('package', row.name)), `row ${row.name} points at a file in the package`);

  const versions = ['0.2.0-rc.1', '0.2.0-rc.2', '0.2.0-rc.3', '0.2.0', '0.2.1-0', '0.2.1-alpha.0', '0.2.1-alpha.1', '0.2.1-beta.1', '0.2.1-rc.0', '0.2.1-rc.2',
    '0.2.1-rc.3', '0.2.1-rc.5', '0.2.1-rc.17', '0.2.1-nightly.1', '0.2.1-dev.3', '0.2.1-rc.x', '0.2.1', '0.2.2-alpha.1', '0.2.2-rc.1', '0.2.2', '0.2.10', '0.3.0', '1.0.0'];
  for (const version of versions) assert.equal(satisfies(version, manifest.engines.dsh), isCompatibleDshVersion(version), `${version} against ${manifest.engines.dsh}`);
  // A range cannot say "one number after the tag": DSH would load a 0.2.1-rc.1.2, and the companion then refuses to start.
  assert.equal(satisfies('0.2.1-rc.1.2', manifest.engines.dsh), true);
  assert.equal(isCompatibleDshVersion('0.2.1-rc.1.2'), false);
});

test('the packed plugin loads without node_modules: ws is bundled', async t => {
  const out = temp(t, 'dsh-anywhere-load-');
  assert.equal(pack('--out', out).status, 0);
  const entries = untar(readFileSync(path.join(out, `dsh-anywhere-darwin-arm64.tgz`)));
  for (const [name, entry] of entries) {
    mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
    writeFileSync(path.join(out, name), entry.data);
  }
  const code = readFileSync(path.join(out, 'package', 'dist', 'plugin.js'), 'utf8');
  const specifiers = [...code.matchAll(/^\s*import\s[^;]*?\sfrom\s*["']([^"']+)["']/gm), ...code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map(match => match[1]);
  assert.ok(specifiers.length > 0, 'the import scan sees the bundle\'s own imports');
  const bare = specifiers.filter(name => !name.startsWith('node:'));
  assert.deepEqual(bare, [], 'only node: built-ins are imported');
  const plugin = await import(pathToFileURL(path.join(out, 'package', 'dist', 'plugin.js')).href);
  assert.equal(typeof plugin.apply, 'function');
  assert.deepEqual(plugin.inject, ['sessionController', 'agentPresets']);
});

test('the package does not depend on, or record, where it was packed from', t => {
  const out = temp(t, 'dsh-anywhere-place-'), elsewhere = temp(t, 'dsh-anywhere-cwd-');
  mkdirSync(path.join(out, 'a')); mkdirSync(path.join(out, 'b'));
  const name = 'dsh-anywhere-darwin-arm64.tgz';
  assert.equal(pack('--out', path.join(out, 'a')).status, 0);
  const moved = spawnSync(process.execPath, [tool, '--out', path.join(out, 'b')], { encoding: 'utf8', cwd: elsewhere });
  assert.equal(moved.status, 0, moved.stderr);
  const code = untar(readFileSync(path.join(out, 'b', name))).get('package/dist/plugin.js').data.toString('utf8');
  assert.ok(code.includes('node_modules/ws/lib/constants.js'), 'the scan sees the bundle\'s module comments');
  assert.doesNotMatch(code, /\.\.\/\.\.\//, 'no module path climbs out of the host folder');
  assert.equal(code.includes(elsewhere), false);
  assert.equal(code.includes(root), false);
  assert.ok(readFileSync(path.join(out, 'a', name)).equals(readFileSync(path.join(out, 'b', name))), 'any folder, same bytes');
});

test('packing is reproducible and refuses a build without the darwin-arm64 Tailcat helper', t => {
  const out = temp(t, 'dsh-anywhere-repro-');
  mkdirSync(path.join(out, 'a')); mkdirSync(path.join(out, 'b'));
  assert.equal(pack('--out', path.join(out, 'a')).status, 0);
  assert.equal(pack('--out', path.join(out, 'b')).status, 0);
  const name = `dsh-anywhere-darwin-arm64.tgz`;
  assert.ok(readFileSync(path.join(out, 'a', name)).equals(readFileSync(path.join(out, 'b', name))), 'same build, same bytes');

  const bare = path.join(out, 'host');
  mkdirSync(bare);
  cpSync(path.join(root, 'host', 'package.json'), path.join(bare, 'package.json'));
  cpSync(path.join(root, 'host', 'dist'), path.join(bare, 'dist'), { recursive: true, filter: source => !source.includes(`${path.sep}tailcat`) });
  const refused = pack('--host', bare, '--out', path.join(out, 'c'));
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /dsh-tailcat-host-darwin-arm64/);
  assert.equal(existsSync(path.join(out, 'c', name)), false);
});
