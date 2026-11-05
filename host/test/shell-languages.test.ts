// The app's languages are nsh-app/src/strings.ts (English, Russian) and strings.<language>.ts. The native shells have a
// few words of their own (the Done button, the scan title, notifications), kept apart from those: a language added to
// the app and not to a shell shows the person the default language there, which no test of the app can see.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const app = new URL('../../nsh-app/', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, app), 'utf8')

const languages = ['ru', 'en', ...readdirSync(new URL('src/', app)).flatMap((f) => /^strings\.([a-z-]+)\.ts$/.exec(f)?.[1] ?? []).filter((l) => l !== 'test')]
/** The folder each platform looks in. Apple's Chinese needs its script, or a Chinese phone does not match it. */
const android = (l: string) => (l === 'en' ? 'values' : l === 'zh-hant' ? 'values-b+zh+Hant' : `values-${l}`)
const apple = (l: string) => (l === 'zh' ? 'zh-Hans' : l === 'zh-hant' ? 'zh-Hant' : l)
const cyrillic = /\p{Script=Cyrillic}/u

const androidWords = (l: string) => new Map([...read(`android/app/src/main/res/${android(l)}/strings.xml`).matchAll(/<string name="([^"]+)">([^<]*)<\/string>/g)].map((m) => [m[1]!, m[2]!]))
const appleWords = (l: string, file: string) => new Map([...read(`ios/DSH/${apple(l)}.lproj/${file}`).matchAll(/^"([^"]+)" = "([^"]*)";$/gm)].map((m) => [m[1]!, m[2]!]))
const sameKeys = (a: Map<string, string>, b: Map<string, string>) => assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort())

test('the check below covers the eight languages', () => assert.deepEqual([...languages].sort(), ['en', 'es', 'fr', 'ja', 'ko', 'ru', 'zh', 'zh-hant']))

for (const l of languages) {
  test(`${l}: Android has all the shell's words`, () => {
    assert.ok(existsSync(new URL(`android/app/src/main/res/${android(l)}/strings.xml`, app)))
    sameKeys(androidWords(l), androidWords('en'))
  })
  test(`${l}: iOS has all the shell's words and declares the language`, () => {
    sameKeys(appleWords(l, 'Localizable.strings'), appleWords('en', 'Localizable.strings'))
    sameKeys(appleWords(l, 'InfoPlist.strings'), appleWords('en', 'InfoPlist.strings'))
    // project.yml, which generates Info.plist at each build.
    const declared = /CFBundleLocalizations: \[(.*?)\]/.exec(read('ios/project.yml'))![1]!.split(/,\s*/)
    assert.ok(declared.includes(apple(l)), `project.yml does not list ${apple(l)}, so iOS gives the app another language`)
  })
}

const script: Record<string, RegExp> = { zh: /\p{Script=Han}/u, 'zh-hant': /\p{Script=Han}/u, ko: /\p{Script=Hangul}/u, ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u, es: /[a-z]/ }
for (const [l, own] of Object.entries(script)) {
  test(`${l}: the shell's words are in that language, with no Russian left behind`, () => {
    const words = [...androidWords(l), ...appleWords(l, 'Localizable.strings'), ...appleWords(l, 'InfoPlist.strings')].filter(([key]) => key !== 'app_label')
    for (const [key, text] of words) {
      assert.ok(own.test(text), `${key}: ${text}`)
      assert.ok(!cyrillic.test(text), `${key}: ${text}`)
    }
    if (l !== 'es' && l !== 'fr') assert.ok(words.every(([, text]) => !/^[a-zA-Z ]+$/.test(text)))
  })
}

test('a language neither shell has reads English', () => {
  assert.ok(!cyrillic.test(read('android/app/src/main/res/values/strings.xml')))
  assert.ok(!existsSync(new URL('android/app/src/main/res/values-en', app)))
  assert.match(read('ios/project.yml'), /developmentLanguage: en\b/)
  assert.match(read('ios/project.yml'), /CFBundleDevelopmentRegion: en\b/)
})

