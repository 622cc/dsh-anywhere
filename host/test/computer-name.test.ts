// The name the phone's Settings shows for the computer: the one the owner gave it (macOS Sharing: ComputerName),
// else the machine's host name without the local-network suffix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computerName } from '../src/computer-name.ts';

test('macOS names the computer as its Sharing settings do', async () => {
  assert.equal(await computerName({ platform: 'darwin', hostname: () => 'studio.local', run: async (file, args) => { assert.deepEqual([file, args], ['/usr/sbin/scutil', ['--get', 'ComputerName']]); return 'Studio\n'; } }), 'Studio');
});

test('without a ComputerName, or elsewhere, the host name without .local', async () => {
  assert.equal(await computerName({ platform: 'darwin', hostname: () => 'studio.local', run: async () => { throw new Error('no name'); } }), 'studio');
  assert.equal(await computerName({ platform: 'linux', hostname: () => 'box', run: async () => { throw new Error('not called'); } }), 'box');
  assert.equal(await computerName({ platform: 'linux', hostname: () => '', run: async () => '' }), '');
});
