import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('the admin CLI runs when started through a symlinked directory (macOS /var, /tmp)', t => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-mobile-entry-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const linked = join(root, 'linked-src');
  symlinkSync(fileURLToPath(new URL('../src', import.meta.url)), linked, 'junction');
  // A silent exit 0 here once let `revoke` report nothing and revoke nothing.
  const run = spawnSync(process.execPath, [join(linked, 'cli.ts')], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /DSH Anywhere local administration/);
});
