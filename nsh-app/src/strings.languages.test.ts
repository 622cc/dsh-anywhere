// The app's eight languages: each has every word, with the same blanks to fill, in its own script and its own way of
// writing lists, dates and "3 minutes ago".
import { expect, test } from 'nsh/test'
import { ago, language, stringsFor, type Language, type Strings } from './strings.ts'

const LANGUAGES: { id: Language; tag: string; name: string }[] = [
  { id: 'zh', tag: 'zh-Hans', name: 'Simplified Chinese' }, { id: 'zh-Hant', tag: 'zh-Hant', name: 'Traditional Chinese' }, { id: 'en', tag: 'en', name: 'English' },
  { id: 'es', tag: 'es', name: 'Spanish' }, { id: 'fr', tag: 'fr', name: 'French' }, { id: 'ko', tag: 'ko', name: 'Korean' }, { id: 'ja', tag: 'ja', name: 'Japanese' }, { id: 'ru', tag: 'ru', name: 'Russian' },
]
type Tree = Record<string, unknown>
const leaves = (o: Tree, at = ''): [string, unknown][] => Object.keys(o).sort().flatMap((k) => {
  const v = o[k], path = at ? `${at}.${k}` : k
  return typeof v === 'object' && v && !Array.isArray(v) ? leaves(v as Tree, path) : [[path, v] as [string, unknown]]
})
const en = stringsFor('en')
const words = (t: Strings) => leaves(t as unknown as Tree).filter(([, v]) => typeof v === 'string' && /\p{L}{2}/u.test(v as string)) as [string, string][]

const WITH_A_UNIT = /unit\b/
// Names and codes every language writes the same way.
const SAME_EVERYWHERE = /^(?:DSH\b.*|DeepSeek.*|MCP|API|Bash|PTC|GB|MB|KB|Mac|QR|Tailcat|OK|URL|Enter|Esc|en|ja|ko|es|fr|ru|zh|.*-[A-Z]{2}|.*\.\w+)$/

for (const { tag, name } of LANGUAGES) {
  test(`${name}: every word is there, of the same kind as the English`, () => {
    const t = stringsFor(tag)
    expect(leaves(t as unknown as Tree).map(([k, v]) => `${k}:${Array.isArray(v) ? `list${(v as unknown[]).length}` : typeof v}`))
      .toEqual(leaves(en as unknown as Tree).map(([k, v]) => `${k}:${Array.isArray(v) ? `list${(v as unknown[]).length}` : typeof v}`))
  })

  test(`${name}: a sentence with blanks keeps every blank the English one fills`, () => {
    const mine = new Map(leaves(stringsFor(tag) as unknown as Tree))
    for (const [key, fill] of leaves(en as unknown as Tree)) {
      if (typeof fill !== 'function') continue
      if (WITH_A_UNIT.test(fill.toString())) { // a count and a unit, which each language spells its own way: the count stays
        const translated = (mine.get(key) as (n: number, unit: string) => string)(7, 'minute')
        expect([key, translated.includes('7')]).toEqual([key, true])
        continue
      }
      const given = ['⟦a⟧', '⟦b⟧', '⟦c⟧', '⟦d⟧'].slice(0, fill.length)
      let english: unknown
      try { english = fill(...given) } catch { continue } // takes a list or a record, not words: its own tests read it
      if (typeof english !== 'string') continue
      const translated = (mine.get(key) as (...a: string[]) => string)(...given)
      expect([key, given.filter((g) => translated.includes(g))]).toEqual([key, given.filter((g) => english.includes(g as string))])
    }
  })
}

const share = (t: Strings, pick: (text: string, key: string) => boolean) => { const all = words(t).filter(([, v]) => !SAME_EVERYWHERE.test(v)); return all.filter(([k, v]) => pick(v, k)).length / all.length }
const notEnglish = (t: Strings) => { const original = new Map(words(en)); return words(t).filter(([k, v]) => !SAME_EVERYWHERE.test(v) && original.get(k) === v).map(([k]) => k) }

test('no language leaves its words in English', () => {
  for (const { tag } of LANGUAGES.filter((l) => l.id !== 'en')) expect([tag, notEnglish(stringsFor(tag)).length <= 12 ? [] : notEnglish(stringsFor(tag))]).toEqual([tag, []])
})

test('each is written in its own script', () => {
  const hangul = /\p{Script=Hangul}/u, kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u, han = /\p{Script=Han}/u, cyrillic = /\p{Script=Cyrillic}/u
  expect(share(stringsFor('ko'), (v) => hangul.test(v)) > 0.9).toBe(true)
  expect(share(stringsFor('ko'), (v) => han.test(v) || kana.test(v))).toBe(0)
  expect(share(stringsFor('ja'), (v) => kana.test(v)) > 0.75).toBe(true)
  expect(share(stringsFor('es'), (v) => han.test(v) || hangul.test(v) || kana.test(v) || cyrillic.test(v))).toBe(0)
  expect(share(stringsFor('fr'), (v) => han.test(v) || hangul.test(v) || kana.test(v) || cyrillic.test(v))).toBe(0)
  expect(share(stringsFor('zh-Hant'), (v) => han.test(v)) > 0.9).toBe(true)
  for (const tag of ['zh-Hans', 'zh-Hant', 'es', 'fr', 'ko', 'ja', 'en']) expect([tag, share(stringsFor(tag), (v) => cyrillic.test(v))]).toEqual([tag, 0])
})

test('Traditional Chinese is its own: no Simplified characters, and Taiwan\'s words where they differ from a letter-by-letter conversion', () => {

  const onlySimplified = /[这们为发设务网络软连历关开启时间计图应请选显错误输复贴创还过让话点击试动态档结运读写项标]/
  const convertedOnly = /文件|信息|默认|默認|设置|設置|服务器|服務器|网络|網絡|软件|軟件|屏幕|菜单|菜單|视频|視頻|程序|硬件|硬體件|账号|賬號|登录|登錄|粘贴|粘貼|智能体|智能體/

  const wrong = words(stringsFor('zh-Hant')).filter(([, v]) => onlySimplified.test(v) || convertedOnly.test(v)).map(([k, v]) => `${k}: ${v}`)
  expect(wrong).toEqual([])
})

test('a phone\'s language finds its strings; Traditional by script or by region, Spanish in any country', () => {
  const settings = (tag: string) => stringsFor(tag).settings
  for (const tag of ['zh-Hant', 'zh-Hant-TW', 'zh-TW', 'zh-HK', 'zh-MO']) expect([tag, settings(tag)]).toEqual([tag, settings('zh-Hant')])
  for (const tag of ['zh', 'zh-Hans', 'zh-Hans-CN', 'zh-CN', 'zh-SG']) expect([tag, settings(tag)]).toEqual([tag, '设置'])
  expect(settings('zh-Hant') === '设置').toBe(false)
  for (const [a, b] of [['es-ES', 'es'], ['es-MX', 'es'], ['es-419', 'es'], ['fr-FR', 'fr'], ['fr-CA', 'fr'], ['fr-BE', 'fr'], ['ko-KR', 'ko'], ['ja-JP', 'ja']]) expect(settings(a!)).toBe(settings(b!))
  expect(new Set(LANGUAGES.map((l) => stringsFor(l.tag).newChat)).size).toBe(8) // settings is 設定 in both Japanese and Traditional Chinese
})

test('lists are written the language\'s own way', () => {
  expect(LANGUAGES.map((l) => [l.id, stringsFor(l.tag).listSep, stringsFor(l.tag).factSep])).toEqual([
    ['zh', '、', '，'], ['zh-Hant', '、', '，'], ['en', ', ', ', '], ['es', ', ', ', '], ['fr', ', ', ', '], ['ko', ', ', ', '], ['ja', '、', '、'], ['ru', ', ', ', '],
  ])
})

test('how long ago, and dates, in the language\'s own way', () => {
  const now = new Date(2026, 9, 28, 12).getTime(), old = new Date(2026, 9, 15, 12).getTime()
  const said = (id: Language) => { language.set(id); const out = [ago(now - 5_000, now), ago(now - 180_000, now), ago(now - 7_200_000, now), ago(old, now)]; language.set('system'); return out }
  expect(said('zh')).toEqual(['刚刚', '3 分钟前', '2 小时前', '10月15日'])
  expect(said('zh-Hant')).toEqual(['剛剛', '3 分鐘前', '2 小時前', '10月15日'])
  expect(said('ja')).toEqual(['たった今', '3分前', '2時間前', '10月15日'])
  expect(said('ko')).toEqual(['방금', '3분 전', '2시간 전', '10월 15일'])
  expect(said('es')).toEqual(['ahora', 'hace 3 min', 'hace 2 h', '15 oct'])
  expect(said('fr')).toEqual(['à l’instant', 'il y a\u00a03\u00a0min', 'il y a\u00a02\u00a0h', '15 oct.'])
  expect(said('en')).toEqual(['now', '3 min', '2 h', 'Oct 15'])
  expect(said('ru')).toEqual(['сейчас', '3 мин', '2 ч', '15.10'])
})

test('folders in a place: Chinese and Japanese put a space only beside Latin letters', () => {
  expect(stringsFor('zh-Hans').foldersIn('主目录')).toBe('主目录中的文件夹')
  expect(stringsFor('zh-Hans').foldersIn('code')).toBe('code 中的文件夹')
  expect(stringsFor('zh-Hant').foldersIn('主目錄')).toBe('主目錄中的資料夾')
  expect(stringsFor('zh-Hant').foldersIn('code')).toBe('code 中的資料夾')
  expect(stringsFor('ja').foldersIn('ホーム')).toBe('ホーム内のフォルダ')
  expect(stringsFor('ja').foldersIn('code')).toBe('code 内のフォルダ')
})

test('French: a no-break space before the double marks and inside the quotation marks, so none starts a line; zero and one are singular; the typed apostrophe', () => {
  const fr = stringsFor('fr')
  const said = words(fr).map(([, v]) => v)
  expect(said.filter((v) => / [?!:;»]/.test(v) || /« /.test(v))).toEqual([])
  expect(said.filter((v) => v.includes("'"))).toEqual([])
  expect(fr.allowTool('bash')).toBe('Autoriser bash\u00a0?')
  expect(fr.createIn('code', '/w')).toBe('Créer «\u00a0code\u00a0» dans /w\u00a0?')
  expect(fr.completedCount(0)).toBe('0 terminée')
  expect(fr.completedCount(1)).toBe('1 terminée')
  expect(fr.completedCount(2)).toBe('2 terminées')
  expect(fr.scheduleEvery(1, 'hour')).toBe('Chaque heure')
  expect(fr.scheduleEvery(5, 'minute')).toBe('Toutes les 5 minutes')
  expect(fr.scheduleEvery(3, 'day')).toBe('Tous les 3 jours')
  expect(fr.joinTwo('Fichiers lus', 'commandes exécutées')).toBe('Fichiers lus et commandes exécutées')
})

test('a language the app does not have reads English', () => {
  for (const tag of ['it-IT', 'de', 'pt-BR', 'ar', 'und']) expect(stringsFor(tag)).toBe(stringsFor('en'))
  expect(stringsFor('ru-RU').settings).toBe('Настройки')
})

