// The id the stores and the phone's system see: one id for the app on Android and iOS.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const app = join(import.meta.dirname, '..', '..', 'nsh-app');
const ID = 'io.jingtao.dshanywhere';

test('Android takes its application id from nsh.json, which is the app id', () => {
  assert.equal(JSON.parse(readFileSync(join(app, 'nsh.json'), 'utf8')).id, ID);
  assert.match(readFileSync(join(app, 'android', 'app', 'build.gradle'), 'utf8'), /applicationId app\.id\b/);
});

test('iOS bundle ids and the prefix any new target would inherit are under the same id', () => {
  const project = readFileSync(join(app, 'ios', 'project.yml'), 'utf8');
  assert.deepEqual([...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER: (\S+)/g)].map(m => m[1]), [ID, `${ID}.uitests`]);
  assert.equal(project.match(/bundleIdPrefix: (\S+)/)?.[1], 'io.jingtao');
});

test('the iPhone keeps its link in a keychain item named with the same id', () => {
  assert.match(readFileSync(join(app, 'ios', 'DSH', 'Vault.swift'), 'utf8'), new RegExp(`kSecAttrService as String: "${ID}"`));
});

