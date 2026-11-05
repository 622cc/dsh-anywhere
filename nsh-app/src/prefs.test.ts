// The phone's own settings: kept on the phone across launches, and what each one changes.
import { expect, test } from 'nsh/test'
import { Storage } from 'nsh'
import { allowsNotice, loadPrefs, notifyPrefs, prefsOf, setLanguage, setNotify, setTheme, tagFor, theme } from './prefs.ts'
import { language, S, stringsFor } from './strings.ts'

test('a language picked in Settings wins over the phone\'s; System follows the phone again', () => {
  expect(tagFor('system', 'en-US')).toBe('en-US')
  expect(tagFor('ru', 'en-US')).toBe('ru')
  expect(tagFor('zh', 'en-US')).toBe('zh-Hans')
  expect(tagFor('zh-Hant', 'en-US')).toBe('zh-Hant')
  expect(tagFor('ja', 'en-US')).toBe('ja')
  expect(stringsFor(tagFor('en', 'ru-RU')).settings).toBe('Settings')
  setLanguage('ru'); expect(language()).toBe('ru'); expect(S.settings).toBe('Настройки')
  setLanguage('en'); expect(S.settings).toBe('Settings')
  setLanguage('system')
})

test('settings are kept on the phone and read back; anything unreadable falls back to the defaults', async () => {
  setTheme('dark'); setNotify({ banners: false })
  await new Promise((r) => setTimeout(r, 20))
  const kept = prefsOf(await Storage.getItem('prefs'))
  expect(kept.theme).toBe('dark'); expect(kept.notify.banners).toBe(false); expect(kept.notify.answers).toBe(true)
  expect(prefsOf('{not json')).toEqual(prefsOf(null))
  for (const l of ['zh', 'zh-Hant', 'en', 'es', 'fr', 'ko', 'ja', 'ru']) expect(prefsOf(JSON.stringify({ language: l })).language).toBe(l)
  expect(prefsOf(JSON.stringify({ theme: 'purple', language: 'xx', notify: { answers: 'yes' } }))).toEqual(prefsOf(null))
  await Storage.setItem('prefs', JSON.stringify({ theme: 'light', language: 'system', notify: { decisions: false } }))
  await loadPrefs()
  expect(theme()).toBe('light'); expect(notifyPrefs().decisions).toBe(false); expect(notifyPrefs().answers).toBe(true)
  await Storage.removeItem('prefs'); await loadPrefs(); setTheme('system')
})

test('each kind of news is told only where the person left it on', () => {
  const all = prefsOf(null).notify
  expect(allowsNotice(all, 'answer', 'system')).toBe(true)
  expect(allowsNotice({ ...all, answers: false }, 'answer', 'system')).toBe(false)
  expect(allowsNotice({ ...all, answers: false }, 'failed', 'banner')).toBe(false)
  expect(allowsNotice({ ...all, decisions: false }, 'decision', 'system')).toBe(false)
  expect(allowsNotice({ ...all, banners: false }, 'decision', 'banner')).toBe(false)
  expect(allowsNotice({ ...all, banners: false }, 'decision', 'system')).toBe(true)
})
