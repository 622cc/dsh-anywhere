import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'host', 'package.json'));
const { build } = require('esbuild');
// Bundle QR/YAML dependencies after tsc. Keep the built HostError module external so
// QR and CLI use the same class identity. ws remains the sole npm runtime dependency.
for (const entry of ['qr', 'profile-patch']) await build({ entryPoints: [path.join(root, 'host', 'dist', `${entry}.js`)], outfile: path.join(root, 'host', 'dist', `${entry}.js`), allowOverwrite: true, external: ['./errors.js'], bundle: true, platform: 'node', format: 'esm', target: 'node24', minify: true, legalComments: 'inline', banner: { js: 'import { createRequire as __dshCreateRequire } from "node:module"; const require = __dshCreateRequire(import.meta.url);' } });
// Tailcat helpers (docs/TAILCAT.md) are prebuilt Go binaries from tools/build-tailcat.sh. They may
// already sit in host/dist/tailcat or be staged in build/tailcat; never fail the TypeScript build
// without them. A host configured for Tailcat refuses to start until its platform helper exists.
const { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } = await import('node:fs');
const helpers = path.join(root, 'host', 'dist', 'tailcat'), staged = path.join(root, 'build', 'tailcat');
const helperName = /^dsh-tailcat-host-(darwin-arm64|darwin-amd64|linux-amd64|windows-amd64\.exe)$/;
if (existsSync(staged)) {
  mkdirSync(helpers, { recursive: true });
  for (const name of readdirSync(staged).filter(name => helperName.test(name))) copyFileSync(path.join(staged, name), path.join(helpers, name));
}
// The Settings page is the host package's browser half. Keep the DSH module-loader
// factory wrapper intact; React comes from the client's frozen platform table.
{
  const client = await build({ entryPoints: [path.join(root, 'client', 'index.js')], bundle: true, write: false, format: 'cjs', platform: 'browser', external: ['react'], target: 'es2022', minify: true, legalComments: 'none' });
  const code = client.outputFiles[0].text;
  const { readFile } = await import('node:fs/promises');
  const name = JSON.parse(await readFile(path.join(root, 'host', 'package.json'), 'utf8')).name;
  writeFileSync(path.join(root, 'host', 'dist', 'client.js'), `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(name)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n${code}\n\t\treturn module.exports;\n\t}\n});\n`);
}
const present = existsSync(helpers) ? readdirSync(helpers).filter(name => helperName.test(name)) : [];
for (const name of present) if (!name.endsWith('.exe')) chmodSync(path.join(helpers, name), 0o755);
console.log(present.length ? `Tailcat helpers: ${present.join(', ')}` : 'Tailcat helpers not built (tools/build-tailcat.sh); direct/relay modes are unaffected.');
