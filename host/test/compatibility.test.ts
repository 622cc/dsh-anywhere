import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCompatibleDshVersion, SUPPORTED_DSH_VERSIONS } from '../src/compatibility.ts';

test('every 0.2.1 release and pre-release is accepted, so a DSH update every other day does not cut the phone off', () => {
  for (const version of ['0.2.1-alpha.1', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1-rc.5', '0.2.1-rc.17', '0.2.1-beta.1', '0.2.1']) {
    assert.equal(isCompatibleDshVersion(version), true, version);
  }
});

test('0.2.0-rc.2 stays accepted; other lines and anything that is not a plain version are refused', () => {
  assert.equal(isCompatibleDshVersion('0.2.0-rc.2'), true);
  for (const version of ['0.2.0-rc.3', '0.2.0', '0.2.2-alpha.2', '0.2.2', '0.3.0', '1.0.0', '0.2.10', '0.2.1-rc', '0.2.1-rc.4 ', ' 0.2.1', 'v0.2.1', '0.2.1-rc.4+build', '0.2.1-nightly.1', '^0.2.1', '>=0.2.1', '0.2.1-rc.01', '']) {
    assert.equal(isCompatibleDshVersion(version), false, JSON.stringify(version));
  }
});

test('the supported versions read the same in errors and the installer', () => {
  assert.equal(SUPPORTED_DSH_VERSIONS, '0.2.0-rc.2 and every 0.2.1 release or pre-release');
});
