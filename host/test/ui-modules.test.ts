// Generative UI: the DSH agent writes an NSH TSX module; the companion type-checks it, builds and signs it with
// its own root (nsh check / nsh publish, the real CLI), and keeps the package for the phone, keyed by the tool call.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createUiModules, importProblem } from '../src/ui-modules.ts';

const nsh = ['/usr/local/bin/nsh', `${process.env.HOME}/.local/bin/nsh`, `${process.env.HOME}/.nsh/bin/nsh`].find(existsSync);
const COUNTER = `import { mount, signal, Text, View } from 'nsh'
function App() { const n = signal(0); return <View class="flex-1 items-center justify-center bg-background" onPress={() => n.update((x) => x + 1)}><Text class="text-foreground">{n()}</Text></View> }
mount(App)`;

test('only the NSH runtime may be imported: a module cannot pull files of this computer into the package', () => {
  assert.equal(importProblem(COUNTER), null);
  assert.equal(importProblem(`import { Input } from 'nsh/base'\nimport { mount } from "nsh"`), null);
  assert.match(importProblem(`import secrets from '../../.ssh/id_ed25519'`) ?? '', /only import/);
  assert.match(importProblem(`const s = require('fs')`) ?? '', /only import/);
  assert.match(importProblem(`export * from '../host.json'`) ?? '', /only import/);
});

test('a valid module is checked, built and signed under the companion root; a broken one comes back as errors and leaves nothing', { skip: !nsh && 'nsh CLI not installed' }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-modules-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ui = createUiModules({ dir, nsh: nsh! });
  const ok = await ui.create('call_1/a', { title: 'Counter', source: COUNTER });
  assert.equal(ok.ok, true, ok.ok ? '' : ok.errors);
  const pkg = ui.packagePath('call_1/a')!;
  assert.ok(existsSync(pkg));
  const root = join(dir, 'keys', 'root.pub');
  assert.equal((await ui.rootKey()).length > 20, true);
  const verified = execFileSync(nsh!, ['verify', pkg, '--root', root], { encoding: 'utf8' });
  assert.match(verified, /dev\.dshmobile\.ui\./);
  const bad = await ui.create('call_2', { title: 'Broken', source: `import { mount } from 'nsh'\nconst n: number = 'x'\nmount(() => null)` });
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? '' : bad.errors, /number|string/i);
  assert.equal(ui.packagePath('call_2'), undefined);
  assert.deepEqual(readdirSync(join(dir, 'modules')).filter(f => !f.endsWith('.nshpkg')), [], 'no build folders left behind');
});

test('the agent tool: a plain DSH tool definition keyed by its call; build errors go back to the agent as an error', async () => {
  const { uiTool } = await import('../src/ui-modules.ts');
  const built: string[] = [];
  const tool = uiTool({ create: async (callId, input) => { built.push(callId); return input.source.includes('bad') ? { ok: false, errors: 'App.tsx(1,1): error TS2322' } : { ok: true }; }, packagePath: () => undefined, rootKey: async () => '' });
  assert.equal(tool.name, 'show_interface');
  assert.deepEqual(tool.parameters.required, ['title', 'source']);
  assert.equal(typeof tool.output.render, 'function');
  const value = await tool.execute({ title: 'Tip', source: COUNTER }, { callId: 'c1' });
  assert.deepEqual(built, ['c1']);
  assert.match(tool.output.render({}, value)[0].text, /Tip/);
  await assert.rejects(tool.execute({ title: 'X', source: 'bad' }, { callId: 'c2' }), /TS2322/);
  await assert.rejects(tool.execute({ title: 'X' }, { callId: 'c3' }), /source/);
});
