#!/usr/bin/env node
// Packs the built host (host/dist with the darwin-arm64 Tailcat helper) as the package DSH Desktop installs with one
// command: `dsh plugin --profile desktop add <url of dsh-anywhere-darwin-arm64.tgz>`.
//   node tools/pack-bundle.mjs [--out <dir>] [--host <built host dir>]
// npm-pack layout (`package/` prefix). No scripts and no dependencies: DSH's bundled pnpm refuses packages with
// install scripts, and ws is bundled into dist/plugin.js. The archive is byte-for-byte reproducible from one build.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = message => { console.error(message); process.exit(1); };
const args = process.argv.slice(2), flags = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (!['--out', '--host'].includes(args[i]) || !args[i + 1] || flags.has(args[i])) fail('Usage: node tools/pack-bundle.mjs [--out <dir>] [--host <built host dir>]');
  flags.set(args[i], path.resolve(args[i + 1]));
}
const host = flags.get('--host') ?? path.join(root, 'host'), out = flags.get('--out') ?? path.join(root, 'build', 'bundle');

const NAME = 'dsh-anywhere', ROW_ID = 'dsh-anywhere', HELPER = 'dsh-tailcat-host-darwin-arm64';
const pkg = JSON.parse(readFileSync(path.join(host, 'package.json'), 'utf8'));
for (const required of ['dist/plugin.js', 'dist/client.js', 'dist/compatibility.js'])
  if (!existsSync(path.join(host, required))) fail(`Missing ${required}. Run "npm ci && npm run build" in host/ first.`);
const helper = path.join(host, 'dist', 'tailcat', HELPER);
if (!existsSync(helper)) fail(`Missing dist/tailcat/${HELPER}. Run tools/build-tailcat.sh, then "npm run build" in host/; nothing was packed.`);
const { DSH_ENGINES_RANGE } = await import(pathToFileURL(path.join(host, 'dist', 'compatibility.js')).href);

// 1. The host half: one ES module with ws inside. ws loads its optional native addons with require() in a try block,
// so they stay external and are simply absent; the banner gives the bundle a require for that and for node built-ins.
const { build } = createRequire(path.join(root, 'host', 'package.json'))('esbuild');
// absWorkingDir: esbuild writes each module's path, relative to this folder, into the bundle's comments.
const bundled = await build({ absWorkingDir: path.resolve(host), entryPoints: [path.join(host, 'dist', 'plugin.js')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24',
  external: ['bufferutil', 'utf-8-validate'], legalComments: 'inline', logLevel: 'error',
  banner: { js: 'import { createRequire as __dshAnywhereRequire } from "node:module"; const require = __dshAnywhereRequire(import.meta.url);' } });
const plugin = bundled.outputFiles[0].contents;

// 2. The browser half (Settings → Mobile). DSH registers a client module under its package's name.
const client = readFileSync(path.join(host, 'dist', 'client.js'), 'utf8');
const header = `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(pkg.name)},`;
if (!client.startsWith(header)) fail('dist/client.js does not start with the module-loader header tools/build-host.mjs writes.');
const renamed = `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(NAME)},` + client.slice(header.length);

// 3. Manifest and bundle patch. The row has no configuration: the companion finds the running DSH version and creates
// its private Tailcat configuration on first start (host/src/zero-config.ts).
const manifest = {
  name: NAME, version: pkg.version, description: 'DSH Anywhere: use DeepSeek Harness on this Mac from your phone', license: 'MIT', type: 'module',
  engines: { dsh: DSH_ENGINES_RANGE },
  exports: { '.': './dist/plugin.js', './client': './dist/client.js', './package.json': './package.json' },
  dsh: { bundle: { patch: './cordis.patch.yml' }, client: pkg.dsh.client },
};
const patch = `# DSH Anywhere ${pkg.version}. DSH applies this before the profile's own cordis.patch.yml.\n- insert:\n    - id: ${ROW_ID}\n      name: ./dist/plugin.js\n      config: {}\n`;

const files = [
  ['package/package.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), 0o644],
  ['package/cordis.patch.yml', Buffer.from(patch), 0o644],
  ['package/LICENSE', readFileSync(path.join(root, 'LICENSE')), 0o644],
  ['package/dist/plugin.js', Buffer.from(plugin), 0o644],
  ['package/dist/client.js', Buffer.from(renamed), 0o644],
  [`package/dist/tailcat/${HELPER}`, readFileSync(helper), 0o755],
];

// 4. ustar archive with fixed owner and time (npm pack uses the same date), gzip without a timestamp.
const MTIME = Math.floor(Date.UTC(1985, 9, 26, 8, 15) / 1000);
function header512(name, size, mode) {
  if (Buffer.byteLength(name) > 100) fail(`Path too long for the archive: ${name}`);
  const block = Buffer.alloc(512);
  const put = (text, offset, length) => block.write(text, offset, length, 'utf8');
  const octal = (value, length) => value.toString(8).padStart(length - 1, '0') + '\0';
  put(name, 0, 100); put(octal(mode, 8), 100, 8); put(octal(0, 8), 108, 8); put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12); put(octal(MTIME, 12), 136, 12); put('        ', 148, 8); put('0', 156, 1);
  put('ustar\0', 257, 6); put('00', 263, 2);
  let sum = 0; for (const byte of block) sum += byte;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return block;
}
const parts = [];
for (const [name, data, mode] of files) parts.push(header512(name, data.length, mode), data, Buffer.alloc((512 - data.length % 512) % 512));
parts.push(Buffer.alloc(1024));
const archive = gzipSync(Buffer.concat(parts), { level: 9 });

mkdirSync(out, { recursive: true });
const target = path.join(out, `${NAME}-darwin-arm64.tgz`), staged = `${target}.${process.pid}.tmp`;
writeFileSync(staged, archive); renameSync(staged, target);
console.log(`Packed ${files.length} files, ${statSync(target).size} bytes, engines.dsh "${DSH_ENGINES_RANGE}".`);
console.log(target);
