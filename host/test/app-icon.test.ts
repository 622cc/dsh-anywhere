// The app's mark: every place that draws it uses one outline, on one tile colour.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const app = join(import.meta.dirname, '..', '..', 'nsh-app');
const read = (...path: string[]) => readFileSync(join(app, ...path), 'utf8');
const MARK = 'M136 216c0-53 43-96 96-96h48c53 0 96 43 96 96v12c0 53-43 96-96 96H236l-62 54c-7 6-18 1-18-8v-46h-20c-27 0-48-22-48-48V216zM230 222a26 26 0 1 0 52 0a26 26 0 1 0-52 0z';
const TILE = '#46484D', FOREGROUND = '#F9FAFB';
const sources = [['assets', 'brand', 'icon.svg'], ['assets', 'brand', 'icon-foreground.svg'], ['assets', 'brand', 'icon-monochrome.svg'],
  ['android', 'app', 'src', 'main', 'res', 'drawable', 'ic_launcher_foreground.xml']];

for (const path of sources) test(`${path.at(-1)} draws the app's mark`, () => assert.ok(read(...path).includes(MARK)));

test('the launcher tile has one colour on Android and iOS, and the icon is full bleed for each platform to cut', () => {
  const icon = read('assets', 'brand', 'icon.svg');
  assert.match(icon, new RegExp(`<rect width="1024" height="1024" fill="${TILE}"/>`));
  assert.match(read('android', 'app', 'src', 'main', 'res', 'values', 'ic_launcher.xml'), new RegExp(`<color name="ic_launcher_background">${TILE}</color>`));
});

test('the mark has one colour on the tile and on the dark icon', () => {
  for (const path of [sources[0], sources[1], sources[3]]) assert.ok(read(...path).includes(FOREGROUND), path.at(-1));
});
