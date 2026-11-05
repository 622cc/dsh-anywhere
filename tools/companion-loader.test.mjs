// The profile names one stable loader; the installed version is in its config. DSH applies a config change by running
// the plugin again, so an update takes effect without restarting DSH: the loader then imports the new version's code.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const loaderSource = path.join(path.dirname(fileURLToPath(import.meta.url)), 'companion-loader.js');

function plugins(t) {
  const base = mkdtempSync(path.join(tmpdir(), 'companion-loader-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (const version of ['1.0.0', '1.0.1']) {
    mkdirSync(path.join(base, version, 'dist'), { recursive: true });
    writeFileSync(path.join(base, version, 'dist', 'plugin.js'), `export async function apply(ctx, config) { ctx.ran.push(['${version}', config]); return async () => { ctx.ran.push(['stop ${version}']); }; }\n`);
  }
  copyFileSync(loaderSource, path.join(base, 'companion.js'));
  writeFileSync(path.join(base, 'package.json'), '{"type":"module"}\n');
  return base;
}

test('the loader runs the version its config names, with the rest of the config', async t => {
  const loader = await import(pathToFileURL(path.join(plugins(t), 'companion.js')).href);
  assert.equal(loader.name, 'dsh-mobile-companion');
  assert.deepEqual(loader.inject, ['sessionController', 'agentPresets']);
  const ctx = { ran: [] };
  const stop = await loader.apply(ctx, { version: '1.0.0', dshVersion: '0.2.1-rc.3', configPath: '/x/host.json' });
  await stop();
  const again = await loader.apply(ctx, { version: '1.0.1', dshVersion: '0.2.1-rc.3', configPath: '/x/host.json' });
  await again();
  assert.deepEqual(ctx.ran, [['1.0.0', { dshVersion: '0.2.1-rc.3', configPath: '/x/host.json' }], ['stop 1.0.0'], ['1.0.1', { dshVersion: '0.2.1-rc.3', configPath: '/x/host.json' }], ['stop 1.0.1']]);
});

test('a missing or path-like version is refused before anything is imported', async t => {
  const loader = await import(pathToFileURL(path.join(plugins(t), 'companion.js')).href);
  await assert.rejects(loader.apply({ ran: [] }, { dshVersion: 'x' }), /version/);
  await assert.rejects(loader.apply({ ran: [] }, { version: '../../evil' }), /version/);
});
