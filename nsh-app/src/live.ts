// What the running process is on right now, the part of its title that keeps changing: DSH Desktop's rules
// (dsh-client-ui-chat 0.2.1-rc.3: liveToolDetail, liveReasoningDetail, useStableLiveProcessTitle).

/** The arguments Desktop reads a tool's detail from: the first with words in it. */
const KEYS = ['title', 'description', 'objective', 'task', 'task_name', 'name', 'question', 'questions', 'prompt', 'message', 'command', 'cmd', 'queries', 'query', 'pattern', 'url', 'uri', 'file_path', 'path', 'target', 'action', 'status']
const MAX = 160

const oneLine = (value: unknown): string => {
  const text = typeof value === 'string' ? value : Array.isArray(value) && value.every((v) => typeof v === 'string') ? value.join(', ') : ''
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= MAX) return line
  const chars = [...line]
  return chars.length <= MAX ? line : `${chars.slice(0, MAX - 1).join('').trimEnd()}…`
}

/** A tool's detail from the arguments so far. Its name stands in once no further argument can arrive (`closed`). */
export function toolDetail(name: string, fields: Record<string, unknown>, closed: boolean): string {
  for (const key of KEYS) {
    if (!(key in fields)) continue
    const value = fields[key]
    const detail = key === 'questions' ? (Array.isArray(value) ? value.map((q) => oneLine((q as { question?: unknown } | null)?.question)).find(Boolean) ?? '' : '') : oneLine(value)
    if (detail) return detail
  }
  return closed ? oneLine(name) : ''
}

/** Thinking's last paragraph with words in it. */
export function reasoningDetail(text: string): string {
  const paragraphs = text.split(/\r?\n[\t ]*\r?\n/)
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const detail = oneLine(paragraphs[i]!.replaceAll('**', ''))
    if (detail) return detail
  }
  return ''
}

/** The fields of a JSON object still arriving, a string cut short included. A value that is not a string counts once whole. */
export function fieldsSoFar(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const n = raw.length
  let i = 0
  const blank = () => { while (i < n && ' \n\r\t'.includes(raw[i]!)) i++ }
  const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }
  const string = (): { text: string; whole: boolean } => {
    let text = ''
    for (i++; i < n;) {
      const c = raw[i]!
      if (c === '"') { i++; return { text, whole: true } }
      if (c !== '\\') { text += c; i++; continue }
      const e = raw[i + 1]
      if (e === undefined || (e === 'u' && i + 6 > n)) break
      if (e === 'u') { text += String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16)); i += 6 } else { text += ESCAPES[e] ?? e; i += 2 }
    }
    return { text, whole: false }
  }
  /** Past a value that is not a string; false when it is cut off. */
  const skip = (): boolean => {
    let depth = 0
    while (i < n) {
      const c = raw[i]!
      if (c === '"') { if (!string().whole) return false; if (depth === 0) return true; continue }
      if (depth === 0 && (c === ',' || c === '}')) return true
      if (c === '[' || c === '{') depth++
      else if (c === ']' || c === '}') { depth--; if (depth === 0) { i++; return true } }
      i++
    }
    return false
  }
  blank()
  if (raw[i] !== '{') return out
  i++
  while (true) {
    blank()
    if (raw[i] === ',') { i++; blank() }
    if (raw[i] !== '"') return out
    const key = string()
    if (!key.whole) return out
    blank()
    if (raw[i] !== ':') return out
    i++; blank()
    if (i >= n) return out
    if (raw[i] === '"') { const value = string(); out[key.text] = value.text; if (!value.whole) return out; continue }
    const start = i
    if (!skip()) return out
    try { out[key.text] = JSON.parse(raw.slice(start, i)) } catch { return out }
  }
}

/** Shows each value at least `ms` (150 on Desktop), so a line changing with every token can be read; the latest one wins. */
export function steady<T>(show: (value: T) => void, ms = 150): (value: T) => void {
  let shown = '', at = 0, latest: T, timer: ReturnType<typeof setTimeout> | undefined
  const commit = () => { timer = undefined; shown = JSON.stringify(latest); at = Date.now(); show(latest) }
  return (value) => {
    latest = value
    if (timer !== undefined || JSON.stringify(value) === shown) return
    const left = ms - (Date.now() - at)
    if (left <= 0) commit(); else timer = setTimeout(commit, left)
  }
}
