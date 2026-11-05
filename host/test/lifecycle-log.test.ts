// The companion's private lifecycle log: what DSH's hot reload did to it, readable by the installer and by people,
// because DSH Desktop shows no log. One line per event, error codes only, owner-only file, bounded size.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { lifecycleLog, lastLifecycle } from '../src/lifecycle-log.ts';

test('events are appended as lines, the file is private, and the newest event of a version is found', t => {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = lifecycleLog(dir);
  log('starting', '0.7.9'); log('running', '0.7.9'); log('stopping', '0.7.9'); log('starting', '0.8.0'); log('failed', '0.8.0', 'conflict');
  const lines = readFileSync(join(dir, 'companion.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 5);
  assert.match(lines[4]!, /^\d{4}-\d\d-\d\dT[\d:.]+Z failed 0\.8\.0 conflict$/);
  assert.equal(statSync(join(dir, 'companion.log')).mode & 0o777, 0o600);
  assert.deepEqual(lastLifecycle(dir, '0.8.0'), { event: 'failed', detail: 'conflict', at: Date.parse(lines[4]!.split(' ')[0]!) });
  assert.equal(lastLifecycle(dir, '0.7.9')?.event, 'stopping');
  assert.equal(lastLifecycle(dir, '9.9.9'), undefined);
});

test('the log keeps only its recent end', t => {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'companion.log'), 'x'.repeat(70_000) + '\n', { mode: 0o600 });
  lifecycleLog(dir)('running', '0.8.0');
  assert.ok(statSync(join(dir, 'companion.log')).size < 40_000);
  assert.equal(lastLifecycle(dir, '0.8.0')?.event, 'running');
});
