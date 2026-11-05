#!/usr/bin/env node
// Owner-reviewed macOS/POSIX companion installer for the Tailcat transport (Windows: install-host.ps1).
// Never restarts DSH, changes firewall/OS trust, or prints credentials. Profile changes need --activate.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BEGIN = '# DSH-MOBILE-COMPANION-BEGIN v1 id=dsh-mobile-companion';
const END = '# DSH-MOBILE-COMPANION-END v1 id=dsh-mobile-companion';
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERN = new RegExp(`^${escape(BEGIN)}\\r?$[\\s\\S]*?^${escape(END)}\\r?$`, 'gm');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = message => { console.error(message); process.exit(1); };

function parseArgs(argv) {
  const flags = new Map(), booleans = new Set(['--activate', '--uninstall', '--help', '--generative-ui', '--no-wait']);
  const known = new Set([...booleans, '--nsh', '--dsh-home', '--profile', '--config', '--port', '--dsh-version', '--host-name']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!known.has(flag) || flags.has(flag)) fail(`Unknown or repeated option ${flag}. Use --help.`);
    if (booleans.has(flag)) flags.set(flag, true);
    else { const value = argv[++i]; if (!value || value.startsWith('--')) fail(`${flag} needs a value.`); flags.set(flag, value); }
  }
  return flags;
}
const flags = parseArgs(process.argv.slice(2));
// The NSH that type-checks and builds generated interfaces must be the one the phone app runs: their APIs differ.
if (flags.has('--nsh') && (!path.isAbsolute(flags.get('--nsh')) || !existsSync(flags.get('--nsh')))) fail('--nsh needs the absolute path of an nsh executable.');
if (flags.has('--help')) {
  console.log(`node tools/install-host.mjs [--dsh-home <DSH_HOME>] [--profile <name>] [--config <host.json>] [--port 19445] [--dsh-version auto|<v>] [--host-name <name>] [--generative-ui [--nsh <absolute nsh>]] [--activate [--no-wait] | --uninstall]
Installs the built host (host/dist with the Tailcat helper) into a private versioned directory, creates the
Tailcat configuration on first run, and prints the marked DSH profile block. Only --activate writes
$DSH_HOME/profiles/<name>/cordis.patch.yml (default web; backed up first); --uninstall removes the marked block.`);
  process.exit(0);
}
if (process.platform === 'win32') fail('On Windows use tools/install-host.ps1.');
if (flags.has('--activate') && flags.has('--uninstall')) fail('Choose --activate or --uninstall, not both.');
// `dsh plugin add …/dsh-anywhere-<v>-darwin-arm64.tgz` (tools/pack-bundle.mjs) already runs the companion in that profile,
// with the same private configuration: a second one would compete for its port and state.
if (flags.has('--activate')) {
  const home = flags.get('--dsh-home') ?? process.env.DSH_HOME, name = flags.get('--profile') ?? 'web';
  let bundles = [];
  try { if (home && path.isAbsolute(home)) bundles = JSON.parse(readFileSync(path.join(home, 'profiles', name, 'package.json'), 'utf8')).dsh?.profile?.bundles ?? []; } catch { /* checked again below */ }
  if (Array.isArray(bundles) && bundles.includes('dsh-anywhere')) fail(`The ${name} profile already runs DSH Anywhere, installed with "dsh plugin add". Keep that install, or remove it first: dsh plugin --profile ${name} remove dsh-anywhere`);
}

const base = process.platform === 'darwin'
  ? path.join(homedir(), 'Library', 'Application Support', 'DSHMobile')
  : path.join(process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : path.join(homedir(), '.local', 'share'), 'DSHMobile');
const pluginBase = path.join(base, 'plugin'), backups = path.join(base, 'backups'), receiptPath = path.join(base, 'install-receipt.json');
const configPath = path.resolve(flags.get('--config') ?? path.join(base, 'host', 'host.json'));
if (!path.isAbsolute(flags.get('--config') ?? configPath)) fail('--config must be an absolute path.');

function outsideGit(target) {
  for (let walk = target; ; walk = path.dirname(walk)) {
    if (existsSync(path.join(walk, '.git'))) fail('Private companion files must stay outside every Git worktree.');
    if (walk === path.dirname(walk)) return;
  }
}
/** Owner-only directory; existing weak permissions are reported, never repaired silently. */
function privateDirectory(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const info = lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) fail(`${dir} must be an owner-only (0700) directory owned by you.`);
}
function files(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) fail(`Refusing symbolic link in the build: ${path.join(prefix, entry.name)}`);
    return entry.isDirectory() ? files(path.join(dir, entry.name), path.join(prefix, entry.name)) : [path.join(prefix, entry.name)];
  });
}
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

// 1. Verify the build, including this platform's Tailcat helper.
const host = path.join(root, 'host'), pkg = JSON.parse(readFileSync(path.join(host, 'package.json'), 'utf8'));
for (const required of ['dist/plugin.js', 'dist/cli.js', 'dist/profile-patch.js', 'node_modules/ws/package.json'])
  if (!existsSync(path.join(host, required))) fail(`Missing ${required}. Run "npm ci && npm run build" in host/ first.`);
const goarch = process.arch === 'x64' ? 'amd64' : process.arch, helperName = `dsh-tailcat-host-${process.platform}-${goarch}`;
if (!existsSync(path.join(host, 'dist', 'tailcat', helperName))) fail(`Missing host/dist/tailcat/${helperName}. Run tools/build-tailcat.sh, then "npm run build" in host/.`);
const sources = [...files(path.join(host, 'dist')).map(name => path.join('dist', name)), 'package.json', ...files(path.join(host, 'node_modules', 'ws')).map(name => path.join('node_modules', 'ws', name))];
const inventory = { formatVersion: 1, version: pkg.version, files: Object.fromEntries(sources.sort().map(name => [name.split(path.sep).join('/'), sha256(path.join(host, name))])) };

// 2. Install an immutable versioned directory; an existing different build is never overwritten.
outsideGit(base); outsideGit(path.dirname(configPath));
privateDirectory(base); privateDirectory(pluginBase);
const directory = path.join(pluginBase, pkg.version), inventoryName = 'dsh-mobile-host-release.json';
if (existsSync(directory)) {
  const saved = existsSync(path.join(directory, inventoryName)) ? readFileSync(path.join(directory, inventoryName), 'utf8') : '';
  if (saved !== JSON.stringify(inventory, null, 2) + '\n') fail(`${directory} holds a different build. Bump the host version or remove that directory after review.`);
  for (const [name, digest] of Object.entries(inventory.files)) if (!existsSync(path.join(directory, name)) || sha256(path.join(directory, name)) !== digest) fail(`${directory} was modified; it is not reused.`);
  console.log(`Verified existing ${directory}.`);
} else {
  const staging = path.join(pluginBase, `.${pkg.version}-${randomUUID()}`);
  mkdirSync(staging, { mode: 0o700 });
  try {
    for (const name of sources) { mkdirSync(path.dirname(path.join(staging, name)), { recursive: true, mode: 0o700 }); copyFileSync(path.join(host, name), path.join(staging, name)); }
    writeFileSync(path.join(staging, inventoryName), JSON.stringify(inventory, null, 2) + '\n', { mode: 0o600 });
    renameSync(staging, directory);
  } catch (error) { rmSync(staging, { recursive: true, force: true }); fail(`Install failed: ${error.message}`); }
  console.log(`Installed ${directory}.`);
}
const helper = path.join(directory, 'dist', 'tailcat', helperName);
chmodSync(helper, 0o755);
// A browser-downloaded build carries Gatekeeper quarantine; the plugin spawns this helper non-interactively.
if (process.platform === 'darwin') spawnSync('/usr/bin/xattr', ['-d', 'com.apple.quarantine', helper], { stdio: 'ignore' });

// 3. Private Tailcat configuration: created once, then only verified.
const cli = path.join(directory, 'dist', 'cli.js');
if (!existsSync(configPath)) {
  const args = [cli, 'setup-tailcat', '--config', configPath, '--dsh-version', flags.get('--dsh-version') ?? 'auto'];
  if (flags.has('--port')) args.push('--port', flags.get('--port'));
  if (flags.has('--host-name')) args.push('--host-name', flags.get('--host-name'));
  if (spawnSync(process.execPath, args, { stdio: 'inherit' }).status !== 0) fail('setup-tailcat failed; partial state is preserved for review, never regenerated automatically.');
} else if (spawnSync(process.execPath, [cli, 'verify-config', '--config', configPath], { stdio: 'inherit' }).status !== 0) fail('Existing private configuration failed validation; unchanged.');
if (!existsSync(configPath)) fail(`setup-tailcat created no ${configPath}; nothing was activated.`);
// After a DSH update the owner re-declares the version; only an inspected, allowlisted one is accepted.
const requested = flags.get('--dsh-version');
if (requested && requested !== 'auto') {
  const { isCompatibleDshVersion, SUPPORTED_DSH_VERSIONS } = await import(pathToFileURL(path.join(directory, 'dist', 'compatibility.js')).href);
  if (!isCompatibleDshVersion(requested)) fail(`DSH ${requested} is not supported by this companion (supported: ${SUPPORTED_DSH_VERSIONS}); nothing changed.`);
  const current = JSON.parse(readFileSync(configPath, 'utf8'));
  if (current.dshVersion !== requested) {
    const staged = `${configPath}.${randomUUID()}.tmp`;
    writeFileSync(staged, JSON.stringify({ ...current, dshVersion: requested }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(staged, configPath);
    if (spawnSync(process.execPath, [cli, 'verify-config', '--config', configPath], { stdio: 'inherit' }).status !== 0) fail('Updated configuration failed validation.');
    console.log(`Declared DSH ${requested} (was ${current.dshVersion}).`);
  }
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (!config.tailcat) fail(`${configPath} is not a Tailcat configuration. Use a new --config path for the Tailcat transport.`);

// 4. The stable loader DSH's profile names (tools/companion-loader.js) and the package manifest beside it, which
// declares the browser half (dsh.client) of the version being installed. Written in place only when they change.
const loaderPath = path.join(pluginBase, 'companion.js');
const writePrivate = (file, text) => {
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
  const staged = `${file}.${randomUUID()}.tmp`;
  writeFileSync(staged, text, { mode: 0o600, flag: 'wx' }); renameSync(staged, file);
};
writePrivate(loaderPath, readFileSync(path.join(root, 'tools', 'companion-loader.js'), 'utf8'));
writePrivate(path.join(pluginBase, 'package.json'), JSON.stringify({ name: pkg.name, private: true, type: 'module', exports: { '.': './companion.js', './client': `./${pkg.version}/dist/client.js`, './package.json': './package.json' }, dsh: pkg.dsh }, null, 2) + '\n');

// 5. Marked profile block. `version` picks the companion the loader runs. (install-host.ps1 still writes the older
// per-version block; Windows has no loader yet.)
const block = `${BEGIN}\n- insert:\n    - id: dsh-mobile-companion\n      name: ${JSON.stringify(pathToFileURL(loaderPath).href)}\n      config:\n        version: '${pkg.version}'\n        dshVersion: '${config.dshVersion}'\n        configPath: ${JSON.stringify(configPath)}\n${flags.has('--generative-ui') ? '        generativeUi: true\n' : ''}${flags.has('--nsh') ? `        nsh: ${JSON.stringify(flags.get('--nsh'))}\n` : ''}${END}`;
console.log('\nProfile block (no credentials):\n' + block + '\n');
if (!flags.has('--activate') && !flags.has('--uninstall')) {
  console.log('Prepared only. Review the block, then rerun with --activate (and --dsh-home if DSH_HOME is not set).');
  process.exit(0);
}
const dshHome = flags.get('--dsh-home') ?? process.env.DSH_HOME;
if (!dshHome || !path.isAbsolute(dshHome)) fail('Set DSH_HOME or pass --dsh-home <absolute DSH home>. Confirm it; it is not guessed.');
const profileName = flags.get('--profile') ?? 'web';
if (!/^[a-z][a-z0-9-]*$/.test(profileName)) fail('--profile must be a simple DSH profile name.');
const profile = path.join(dshHome, 'profiles', profileName);
if (!existsSync(path.join(profile, 'package.json'))) fail(`${profile} is not an existing DSH profile; nothing changed.`);
const patchPath = path.join(profile, 'cordis.patch.yml');
const readPatch = () => {
  if (!existsSync(patchPath)) return '';
  if (statSync(patchPath).size > 1048576) fail('Profile patch is too large.');
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(patchPath));
};
function validate(text, rejectCompanion) {
  const result = spawnSync(process.execPath, [path.join(directory, 'dist', 'profile-patch.js'), '--base64', ...(rejectCompanion ? ['--reject-companion'] : [])], { input: Buffer.from(text, 'utf8').toString('base64'), stdio: ['pipe', 'ignore', 'ignore'], timeout: 15000 });
  if (result.status === 2 && rejectCompanion) fail('An unmarked companion insertion exists; review/migrate it manually.');
  if (result.status !== 0) fail('The resulting profile patch is not a valid additive sequence; unchanged.');
}
function marked(text) {
  const matches = [...text.matchAll(PATTERN)];
  if (matches.length > 1 || text.split(BEGIN).length - 1 !== matches.length || text.split(END).length - 1 !== matches.length) fail('Duplicate or malformed companion markers; no profile changes made.');
  validate(text.replace(PATTERN, ''), true);
  return matches[0]?.[0];
}
function write(expected, next) {
  if (readPatch() !== expected) fail('Concurrent profile change detected; no overwrite.');
  validate(next, false);
  if (next === expected) { console.log('Profile already up to date.'); return false; }
  privateDirectory(backups);
  writeFileSync(path.join(backups, `cordis.patch-${randomUUID()}.yml`), expected, { mode: 0o600, flag: 'wx' });
  if (readPatch() !== expected) fail('Concurrent profile change detected after backup; no overwrite.');
  const temporary = `${patchPath}.dsh-mobile-${randomUUID()}`;
  writeFileSync(temporary, next, { flag: 'wx', mode: existsSync(patchPath) ? statSync(patchPath).mode & 0o777 : 0o644 });
  renameSync(temporary, patchPath);
  console.log('Profile backed up; only the marked companion block changed.');
  return true;
}
const current = readPatch(), existing = marked(current);
if (flags.has('--uninstall')) {
  if (!existing) { console.log('Companion block not present; nothing changed.'); process.exit(0); }
  write(current, current.replace(new RegExp(PATTERN.source + '\\r?\\n?', 'gm'), ''));
  console.log('Companion unmounted by profile hot reload. Private configuration and state are kept.');
  process.exit(0);
}
let next;
if (existing) next = current.replace(PATTERN, () => block);
else {
  let document = current.replace(/^﻿/, '');
  const bom = current.startsWith('﻿') ? '﻿' : '';
  if (document.trim() === '[]') document = '';
  if (document.trim() && !/^\s*(#|-)/.test(document)) fail('Profile patch must be a YAML sequence. Convert JSON/mapping manually first.');
  next = bom + document + (document && !document.endsWith('\n') ? '\n' : '') + block + '\n';
}
const changed = write(current, next);
const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : null;
writeFileSync(receiptPath, JSON.stringify({ activeDirectory: directory, previousDirectory: receipt?.activeDirectory !== directory ? receipt?.activeDirectory ?? null : receipt?.previousDirectory ?? null, configPath, dshVersion: config.dshVersion, profile: profileName, transport: 'tailcat' }, null, 2) + '\n', { mode: 0o600 });
// DSH hot-reloads the profile (dsh-hmr, a 2 s write-stability wait, then recomposition). The companion's lifecycle
// log (dist/lifecycle-log.js) says whether this version came up, so the result is checked, not assumed.
const activatedAt = Date.now();
const { lastLifecycle } = await import(pathToFileURL(path.join(directory, 'dist', 'lifecycle-log.js')).href);
let outcome;
for (let waited = 0; changed && !flags.has('--no-wait') && waited < 45_000; waited += 500) {
  const last = lastLifecycle(path.dirname(configPath), pkg.version);
  if (last && last.at >= activatedAt - 1000 && (last.event === 'running' || last.event === 'failed')) { outcome = last; break; }
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!changed) console.log(lastLifecycle(path.dirname(configPath), pkg.version)?.event === 'running' ? `DSH is already running the companion ${pkg.version}.` : `Activated. DSH loads ${pkg.version} when it next starts.`);
else if (outcome?.event === 'running') console.log(`Activated: DSH is running the companion ${pkg.version}.`);
else if (outcome?.event === 'failed') { console.error(`DSH loaded the companion ${pkg.version}, but it failed to start (${outcome.detail ?? 'unknown'}). Its log: ${path.join(path.dirname(configPath), 'companion.log')}`); process.exitCode = 1; }
else console.log(flags.has('--no-wait') ? 'Activated.' : `Activated. DSH has not loaded ${pkg.version} within 45 s: it loads it when it next starts (is DSH running?).`);
