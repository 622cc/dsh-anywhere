// A chat's workspace, read-only, through DSH's workspaceFiles calls (@deepseek-ai/dsh-api-workspace-files, DSH
// 0.2.1-rc.3). Paths are workspace paths: '' is the root on the phone, '.' on the wire (DSH refuses an empty path),
// and a child is its folder joined with its name by "/". DSH gives names, kinds and sizes; no modified times.
import { DshError } from './dsh.ts'
import { insertMention, referenceText } from './commands.ts'

export type EntryType = 'file' | 'directory' | 'other'
export interface FileEntry { name: string; type: EntryType; size?: number }
export interface Listing { path: string; entries: FileEntry[]; truncated: boolean }

export const listPath = (path: string) => path || '.'
export const childPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)
export const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

const ORDER: Record<EntryType, number> = { directory: 0, file: 1, other: 2 }
const byName = (a: FileEntry, b: FileEntry) => { const x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0 }

/** workspaceFiles/list's value, folders first, then files, then the rest (DSH leaves the order to the caller). */
export function listingOf(v: unknown): Listing {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const entries = (Array.isArray(o.entries) ? o.entries : []).flatMap((e): FileEntry[] => {
    const x = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
    if (typeof x.name !== 'string' || !x.name || (x.type !== 'file' && x.type !== 'directory' && x.type !== 'other')) return []
    return [{ name: x.name, type: x.type, ...(typeof x.size === 'number' ? { size: x.size } : {}) }]
  })
  entries.sort((a, b) => ORDER[a.type] - ORDER[b.type] || byName(a, b))
  return { path: typeof o.path === 'string' ? o.path : '', entries, truncated: o.truncated === true }
}

/** A deep path for one line: its first folder, "…", and as many of its last names as fit in `max` characters. */
export function shortPath(path: string, max = 28): string {
  const parts = path.split('/')
  if (path.length <= max || parts.length <= 2) return path
  const head = `${parts[0]}/…/`
  let tail = parts.at(-1)!
  for (let i = parts.length - 2; i >= 1 && (head + parts[i] + '/' + tail).length <= max; i--) tail = `${parts[i]}/${tail}`
  return tail.length + parts[0]!.length + 1 >= path.length ? path : head + tail
}

export type PreviewKind = 'text' | 'image' | 'other'
const IMAGES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
// Not worth a text read: DSH would refuse them as not-text anyway, or they are PDFs, which the phone does not show.
const BINARY = new Set(['pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'jar', 'apk', 'dmg', 'iso', 'exe', 'dll', 'so', 'dylib', 'o', 'a', 'class', 'wasm',
  'bin', 'dat', 'db', 'sqlite', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'ico', 'bmp', 'tif', 'tiff', 'heic', 'psd', 'mp3', 'wav', 'flac', 'ogg', 'm4a', 'mp4', 'mov', 'avi', 'mkv', 'webm',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'key', 'numbers', 'pages'])
const extension = (name: string) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : '' }

export const imageType = (name: string): string | undefined => IMAGES[extension(name)]
/** How a file is shown: the four image types as a picture, text as lines; DSH says when a file is not text after all. */
export function previewKind(entry: FileEntry): PreviewKind {
  if (entry.type !== 'file') return 'other'
  const ext = extension(entry.name)
  return IMAGES[ext] ? 'image' : BINARY.has(ext) ? 'other' : 'text'
}
/** "ZIP" for out.zip; nothing for a name without an extension. */
export const typeLabel = (name: string) => extension(name).toUpperCase()

/** Lines per workspaceFiles/read: well under DSH's default maxLines (5000), so a long file arrives as it is scrolled. */
export const PAGE_LINES = 400
export interface Page { offset: number; text: string; lines: number; eof: boolean; version: string }
export interface Line { n: number; text: string }
export interface Doc { lines: Line[]; eof: boolean; version: string; next?: number }

export function pageOf(v: unknown): Page {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return { offset: typeof o.offset === 'number' ? o.offset : 1, text: typeof o.text === 'string' ? o.text : '', lines: typeof o.lines === 'number' ? o.lines : 0, eof: o.eof !== false, version: typeof o.version === 'string' ? o.version : '' }
}
/** A page's lines with their numbers. `text` is "" both past the end and for one empty line; `lines` tells them apart. */
export const numbered = (p: Page): Line[] => (p.lines ? p.text.split('\n').slice(0, p.lines).map((text, i) => ({ n: p.offset + i, text })) : [])
/** The range to read after `page` (the first one without it); none once the file's last line came. */
export function nextRange(page: Page | undefined): { offset: number; limit: number } | undefined {
  if (!page) return { offset: 1, limit: PAGE_LINES }
  return page.eof || !page.lines ? undefined : { offset: page.offset + page.lines, limit: PAGE_LINES }
}
/** The file so far with `page` after it; undefined when the file changed in between and must be read from the start. */
export function addPage(doc: Doc | undefined, page: Page): Doc | undefined {
  if (doc && doc.version !== page.version) return undefined
  return { lines: [...(doc?.lines ?? []), ...numbered(page)], eof: !nextRange(page), version: page.version, next: nextRange(page)?.offset }
}
/** DSH refuses a page over its byte cap (2 MiB by default) instead of cutting it: ask for fewer lines, down to one. */
export const smallerLimit = (limit: number) => (limit > 1 ? Math.max(1, Math.floor(limit / 4)) : undefined)

export type Problem = 'not-found' | 'denied' | 'not-directory' | 'not-file' | 'not-text' | 'too-large' | 'outside' | 'offline' | 'other'
const CODES: Record<string, Problem> = {
  'workspace-file/not-found': 'not-found', 'workspace-file/not-directory': 'not-directory', 'workspace-file/not-regular-file': 'not-file',
  'workspace-file/not-text': 'not-text', 'workspace-file/too-large': 'too-large', 'workspace-file/outside-workspace': 'outside',
}
export function problemOf(e: unknown): Problem {
  const code = e instanceof DshError ? e.code : undefined
  if (!code) return 'other'
  if (code === 'network' || code === 'timeout') return 'offline'
  // dsh-fs-local's FS_PERMISSION_DENIED is no RemoteError: the gateway sends it as gateway/internal with its message.
  if (code === 'gateway/internal' && /permission denied/i.test(e instanceof Error ? e.message : '')) return 'denied'
  return CODES[code] ?? 'other'
}

/** The draft with `path` mentioned after it, spelled as the composer's "@" picker spells a file. */
export function withMention(draft: string, path: string): { text: string; caret: number } {
  const head = draft && !/\s$/.test(draft) ? `${draft} ` : draft
  return insertMention(head, { start: head.length, query: '' }, referenceText({ kind: 'file', path }))
}

const composers = new Map<string, (path: string) => void>()
/** A chat's composer takes mentions from the browser while it is open; returns the way to stop. */
export function mentionsInto(sessionId: string, draft: () => string, set: (text: string, caret: number) => void): () => void {
  const take = (path: string) => { const next = withMention(draft(), path); set(next.text, next.caret) }
  composers.set(sessionId, take)
  return () => { if (composers.get(sessionId) === take) composers.delete(sessionId) }
}
/** Mentions `path` in the chat's draft; false when no composer of that chat is open. */
export function mention(sessionId: string, path: string): boolean {
  const take = composers.get(sessionId); if (!take) return false
  take(path); return true
}
