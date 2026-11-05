// The phone's own settings (Settings page): appearance, language and which news it tells. Kept on the phone in
// Storage under one key and applied at launch; DSH's own settings stay on the computer.
import { setColorScheme, signal, Storage } from 'nsh'
import { language, type Language } from './strings.ts'

export type Theme = 'system' | 'light' | 'dark'
/** `answers`: an answer is ready or a turn stopped; `decisions`: the agent waits on the person; `banners`: news of
 * another chat while the app is open; `background`: the shell keeps watching running agents while the app is away. */
export interface NotifyPrefs { answers: boolean; decisions: boolean; banners: boolean; background: boolean }
export interface Prefs { theme: Theme; language: Language; notify: NotifyPrefs }

const KEY = 'prefs'
const THEMES: readonly Theme[] = ['system', 'light', 'dark']
const LANGUAGES: readonly Language[] = ['system', 'zh', 'zh-Hant', 'en', 'es', 'fr', 'ko', 'ja', 'ru']
const DEFAULT_NOTIFY: NotifyPrefs = { answers: true, decisions: true, banners: true, background: true }

/** What was kept, field by field: a value that is not one of the choices is the default. */
export function prefsOf(raw: string | null): Prefs {
  let v: Record<string, any> = {}
  try { const o = raw ? JSON.parse(raw) : {}; if (o && typeof o === 'object') v = o } catch {}
  const n = v.notify && typeof v.notify === 'object' ? v.notify : {}
  const notify = Object.fromEntries(Object.entries(DEFAULT_NOTIFY).map(([k, d]) => [k, typeof n[k] === 'boolean' ? n[k] : d])) as unknown as NotifyPrefs
  return { theme: THEMES.includes(v.theme) ? v.theme : 'system', language: LANGUAGES.includes(v.language) ? v.language : 'system', notify }
}

export const theme = signal<Theme>('system')
export const notifyPrefs = signal<NotifyPrefs>(DEFAULT_NOTIFY)

/** The tag the strings follow: the picked language, else the phone's. */
export const tagFor = (choice: Language, system: string) => (choice === 'system' ? system : choice === 'zh' ? 'zh-Hans' : choice)

const save = () => { Storage.setItem(KEY, JSON.stringify({ theme: theme(), language: language(), notify: notifyPrefs() })).catch(() => {}) }
export function setTheme(t: Theme) { theme.set(t); setColorScheme(t); save() }
export function setLanguage(l: Language) { language.set(l); save() }
export function setNotify(change: Partial<NotifyPrefs>) { notifyPrefs.set({ ...notifyPrefs(), ...change }); save() }

/** Reads what was kept and applies it (the appearance at once; the strings follow `language`). */
export async function loadPrefs() {
  let raw: string | null = null
  try { raw = await Storage.getItem(KEY) } catch {}
  const p = prefsOf(raw)
  theme.set(p.theme); language.set(p.language); notifyPrefs.set(p.notify)
  if (p.theme !== 'system') setColorScheme(p.theme)
}

/** Whether a piece of news is told there: its kind left on, and banners left on for a banner. */
export function allowsNotice(p: NotifyPrefs, kind: 'answer' | 'failed' | 'decision', place: 'banner' | 'system'): boolean {
  if (!(kind === 'decision' ? p.decisions : p.answers)) return false
  return place !== 'banner' || p.banners
}
