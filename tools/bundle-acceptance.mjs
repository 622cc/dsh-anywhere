// Offline acceptance of the install package against the code of the installed DSH Desktop app: DSH's own
// `dsh plugin add` operation (runProfilePnpm with the app's bundled pnpm) installs the package from a 127.0.0.1 URL
// into a scratch profile, then DSH's own profile loader reads it. No DSH process is started or stopped, and nothing
// outside one new temp directory is written: HOME, DSH_HOME, the profile and pnpm's store all live there.
// Run it with the app's runtime, which can read app.asar:
//   ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" tools/bundle-acceptance.mjs <dsh-anywhere-darwin-arm64.tgz>
// DSH_APP selects another app bundle; KEEP_SCRATCH=1 keeps the temp directory. Prints one JSON report; exit code 1 when a check fails.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const tarball = process.argv[2];
if (!tarball || !existsSync(tarball)) { console.error('Usage: tools/bundle-acceptance.mjs <dsh-anywhere-darwin-arm64.tgz>'); process.exit(2); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = process.env.DSH_APP ?? '/Applications/DeepSeek Harness.app';
const resources = path.join(app, 'Contents', 'Resources'), runtimeDir = path.join(resources, 'app.asar', 'dsh'), supportDir = path.join(resources, 'runtime');
const scope = path.join(runtimeDir, 'node_modules', '@deepseek-ai');
const installAnchor = path.join(scope, 'dsh', 'package.json');

// Everything DSH or pnpm would put in the user's home goes to the scratch directory. Set before DSH code loads.
const scratch = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'dsh-anywhere-acceptance-')));
const home = path.join(scratch, 'home');
Object.assign(process.env, { HOME: home, DSH_HOME: path.join(home, '.dsh'), XDG_CACHE_HOME: path.join(home, '.cache'), XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local', 'share'), XDG_STATE_HOME: path.join(home, '.local', 'state') });
mkdirSync(home, { recursive: true });

const boot = await import(pathToFileURL(path.join(scope, 'dsh-app-boot', 'lib', 'index.js')).href);
const { runProfilePnpm } = await import(pathToFileURL(path.join(scope, 'dsh-plugin-manager', 'lib', 'types', 'operations.js')).href);
const { isCompatibleDshVersion } = await import(pathToFileURL(path.join(root, 'host', 'dist', 'compatibility.js')).href);
const { runningDshVersion } = await import(pathToFileURL(path.join(root, 'host', 'dist', 'zero-config.js')).href);

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); };

// A Desktop profile as the app creates it (lib/main.js: initProfile(projectDir, WEB_PROFILE.bundles)).
const profileDir = path.join(home, '.dsh', 'profiles', 'desktop');
boot.initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);

const name = path.basename(tarball), body = readFileSync(tarball);
const server = createServer((request, response) => {
  if (request.url !== `/${name}`) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length }).end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/${name}`;

// What `dsh plugin --profile desktop …` runs (dsh/lib/plugin: runPlugin; dsh-desktop-host/lib/cli: the bundled pnpm).
const context = { profile: 'desktop', dir: profileDir, installAnchor, cwd: scratch };
// 'cli' is what `dsh plugin` uses: pnpm inherits this process's environment (the scratch HOME) and its terminal.
const options = {
  command: process.execPath, args: ['--expose-internals', path.join(supportDir, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')],
  env: { ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_NODE_EXECUTABLE: process.execPath, PATH: `${path.join(supportDir, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
    // Offline: no update check, and any registry request goes to a closed local port instead of the internet.
    npm_config_update_notifier: 'false', pnpm_config_update_notifier: 'false', npm_config_registry: 'http://127.0.0.1:9/', pnpm_config_registry: 'http://127.0.0.1:9/' },
  execution: 'cli', outputBytes: 16384, lockWaitMs: 120000, lookupTimeoutMs: 120000,
};
const store = path.join(scratch, 'pnpm-store');
const added = await runProfilePnpm(context, ['add', url, '--store-dir', store], options);
check('install exits 0', added.exitCode === 0, { exitCode: added.exitCode });

const manifest = JSON.parse(readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
check('package added to dsh.profile.bundles', manifest.dsh?.profile?.bundles?.includes('dsh-anywhere'), manifest.dsh?.profile?.bundles);
check('dependency recorded as the URL', manifest.dependencies?.['dsh-anywhere'] === url, manifest.dependencies);

const profile = boot.loadProfileDirectory('dsh', profileDir, installAnchor);
const layer = profile.layers.find(entry => entry.packageName === 'dsh-anywhere');
check('loadProfileDirectory: no skipped bundles', profile.skippedBundles.length === 0, profile.skippedBundles);
check('loadProfileDirectory: dsh-anywhere layer loaded', !!layer, profile.layers.map(entry => entry.packageName));
const rows = boot.composeEntries([profile.layers.flatMap(entry => entry.patches), profile.patches]);
const row = rows.find(entry => entry.id === 'dsh-anywhere');
check('composed entries hold the plugin row', !!row, row);
const rowFile = row && layer ? fileURLToPath(new URL(row.name, pathToFileURL(layer.patchPaths[0]))) : undefined;
check('row name resolves to a file in the installed package', rowFile && existsSync(rowFile) && rowFile.startsWith(realpathSync.native(layer.packageDir)), rowFile && path.relative(scratch, rowFile));

const installed = layer ? JSON.parse(readFileSync(path.join(layer.packageDir, 'package.json'), 'utf8')) : {};
const runtime = boot.getDshRuntimeVersion();
check('DSH finds the package compatible with this app', layer && boot.evaluatePluginCompatibility(installed) === undefined, { runtime, range: installed.engines?.dsh });
const versions = ['0.2.0-rc.1', '0.2.0-rc.2', '0.2.0', '0.2.1-alpha.1', '0.2.1-beta.1', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.5', '0.2.1-rc.17', '0.2.1-nightly.1', '0.2.1', '0.2.2-alpha.1', '0.2.2', '0.3.0'];
const disagree = versions.filter(version => (boot.evaluatePluginCompatibility(installed, {}, version) === undefined) !== isCompatibleDshVersion(version));
check('engines.dsh, evaluated by DSH, agrees with isCompatibleDshVersion', disagree.length === 0, { versions: versions.length, disagree });
const helper = layer ? path.join(layer.packageDir, 'dist', 'tailcat', 'dsh-tailcat-host-darwin-arm64') : '';
check('Tailcat helper installed with mode 755', existsSync(helper) && (statSync(helper).mode & 0o777) === 0o755, existsSync(helper) ? (statSync(helper).mode & 0o777).toString(8) : 'missing');
let imported;
try { imported = await import(pathToFileURL(rowFile).href); } catch (error) { imported = error; }
check('the row module imports in the app runtime', typeof imported?.apply === 'function', imported instanceof Error ? String(imported) : undefined);
check('companion reads the running DSH version from the installation anchor', runningDshVersion({ installAnchor }) === runtime, { found: runningDshVersion({ installAnchor }), runtime });

const removed = await runProfilePnpm(context, ['remove', 'dsh-anywhere', '--store-dir', store], options);
const after = JSON.parse(readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
check('remove exits 0 and drops the bundle', removed.exitCode === 0 && !after.dsh?.profile?.bundles?.includes('dsh-anywhere') && !after.dependencies?.['dsh-anywhere'], { exitCode: removed.exitCode, bundles: after.dsh?.profile?.bundles });

server.close();
const failed = checks.filter(entry => !entry.ok);
console.log(JSON.stringify({ app: path.basename(app), dsh: runtime, tarball: name, scratch: '<temp>/' + path.basename(scratch), checks, passed: checks.length - failed.length, failed: failed.length }, null, 2));
process.exitCode = failed.length ? 1 : 0;
if (!process.env.KEEP_SCRATCH) rmSync(scratch, { recursive: true, force: true }); // KEEP_SCRATCH=1 keeps it for inspection
