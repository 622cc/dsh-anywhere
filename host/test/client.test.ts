// The companion's DSH Desktop half (client/index.js): the show_interface card and the slots it registers, built as
// tools/build-host.mjs builds it, with a stand-in React that records elements instead of rendering.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..', '..');
const { build } = createRequire(join(root, 'host', 'package.json'))('esbuild');

async function load() {
  const react = 'export default { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }), useState: (v) => [v, () => {}], useCallback: (f) => f, useEffect: () => {} }';
  const out = await build({ entryPoints: [join(root, 'client', 'index.js')], bundle: true, write: false, format: 'esm', platform: 'neutral',
    plugins: [{ name: 'react', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: react })); } }] });
  return import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);
}
const text = (node: any): string => typeof node === 'string' ? node : (node?.children ?? []).map(text).join(' ');

test('the show_interface card names the interface and says where it opens', async () => {
  const { InterfaceCard } = await load();
  const ready = InterfaceCard({ phase: 'result', block: { kind: 'result', isError: false, call: { argsRaw: JSON.stringify({ title: 'Tip calculator', source: 'import …' }) } } });
  assert.match(text(ready), /Tip calculator/); assert.match(text(ready), /DSH Anywhere/);
  assert.doesNotMatch(text(ready), /import/, 'the module source is not shown');
  const building = InterfaceCard({ phase: 'start', block: { argsRaw: '{"title":"Tip calc' } });
  assert.match(text(building), /Building/);
  const failed = InterfaceCard({ phase: 'result', block: { kind: 'result', isError: true, call: { argsRaw: '{"title":"Tip"}' } } });
  assert.match(text(failed), /did not build/);
});

test('the client registers the Mobile settings page and the show_interface card', async () => {
  const { apply } = await load();
  const registered: { name: string; key?: string; id?: string }[] = [];
  apply({ effect: (f: () => unknown) => f(), slots: { inject: (_name: string, f: () => unknown) => f(), register: (entry: { name: string }) => { registered.push(entry); return () => {}; } } });
  assert.deepEqual(registered.map(r => [r.name, r.id ?? r.key]), [['settings.section', 'mobile'], ['tool.call.toolview', 'show_interface']]);
});

test('the Mobile page counts phones in plain English', async () => {
  const { pairedPhones } = await load();
  assert.deepEqual([0, 1, 2].map(pairedPhones), ['0 paired phones', '1 paired phone', '2 paired phones']);
});
