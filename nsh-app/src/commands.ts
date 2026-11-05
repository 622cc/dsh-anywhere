// Commands, skills and references in the composer (DSH 0.2.1-rc.3). A line whose first word is a command runs
// through commands/execute; a skill is a "/name …" prompt; "@" inserts a file, folder or chat reference as text.
const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : undefined)
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export interface Command { name: string; description: string; hint?: string }
export interface Skill { name: string; description: string }
export type Suggestion = { kind: 'command' | 'skill'; name: string; description: string; hint?: string }
export type Reference = { kind: 'file' | 'directory'; path: string } | { kind: 'chat'; mention: string; label: string }
export const isSuggestion = (i: Suggestion | Reference): i is Suggestion => i.kind === 'command' || i.kind === 'skill'

export function commandsOf(v: unknown): Command[] {
  return (Array.isArray(v) ? v : []).flatMap((c): Command[] => {
    const o = obj(c), name = str(o?.name); if (!name) return []
    const hint = str(obj(o?.input)?.hint)
    return [{ name, description: str(o?.description) ?? '', ...(hint ? { hint } : {}) }]
  })
}

export function skillsOf(v: unknown): Skill[] {
  const list = obj(v)?.skills
  return (Array.isArray(list) ? list : []).flatMap((s): Skill[] => { const o = obj(s), name = str(o?.name); return name ? [{ name, description: str(o?.description) ?? '' }] : [] })
}

/** The name typed after a "/" that opens the message, while no space follows it yet. */
export function slashQuery(draft: string): string | undefined {
  const m = /^\/([^\s/]*)$/.exec(draft)
  return m ? m[1] : undefined
}

/** Commands then skills; within each, names that start with the query before names that contain it. A skill with a command's name is shadowed by it. */
export function suggest(query: string, commands: readonly Command[], skills: readonly Skill[]): Suggestion[] {
  const q = query.toLowerCase()
  const rank = <T extends { name: string }>(items: readonly T[]) => [...items.filter((i) => i.name.toLowerCase().startsWith(q)), ...items.filter((i) => !i.name.toLowerCase().startsWith(q) && i.name.toLowerCase().includes(q))]
  const names = new Set(commands.map((c) => c.name))
  const byName = <T extends { name: string }>(a: T, b: T) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  return [
    ...rank([...commands].sort(byName)).map((c) => ({ kind: 'command' as const, ...c })),
    ...rank([...skills].filter((s) => !names.has(s.name)).sort(byName)).map((s) => ({ kind: 'skill' as const, ...s })),
  ]
}

/** What sending `line` does: a command runs it (session/prompt would hand "/name" to the model as text). */
export function route(line: string, commands: readonly Command[]): 'command' | 'prompt' {
  const m = /^\/(\S+)/.exec(line.trim())
  return m && commands.some((c) => c.name === m[1]) ? 'command' : 'prompt'
}

/** The "@word" the caret is in, when it starts the text or follows a space. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | undefined {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([^\s@]*)$/.exec(before)
  if (!m) return undefined
  const start = before.length - m[2]!.length - 1
  // A caret inside the word takes the rest of it too, so the reference replaces the whole word.
  return { start, query: m[2]! + (/^\S*/.exec(text.slice(caret))?.[0] ?? '') }
}

/** The text with the "@word" replaced by the reference and a space, and where the caret goes. */
export function insertMention(text: string, at: { start: number; query: string }, reference: string): { text: string; caret: number } {
  const end = at.start + 1 + at.query.length
  const rest = text.slice(end).replace(/^ /, '')
  const head = text.slice(0, at.start) + reference + ' '
  return { text: head + rest, caret: head.length }
}

export function referenceText(r: Reference): string {
  if (r.kind === 'chat') return r.mention
  const path = r.kind === 'directory' ? `${r.path.replace(/\/$/, '')}/` : r.path
  return /\s/.test(path) ? `@"${path}"` : `@${path}`
}

/** fileReferences/list and sessionReferenceResolver/candidates, as one list: files and folders, then chats. */
export function referencesOf(files: unknown, chats: unknown): Reference[] {
  const f = (Array.isArray(files) ? files : []).flatMap((x): Reference[] => {
    const o = obj(x), path = str(o?.path); if (!path) return []
    return [o!.kind === 'directory' ? { kind: 'directory', path: path.replace(/\/$/, '') } : { kind: 'file', path }]
  })
  const c = (Array.isArray(chats) ? chats : []).flatMap((x): Reference[] => {
    const o = obj(x), mention = str(o?.mention); if (!mention) return []
    return [{ kind: 'chat', mention, label: str(o?.displayTitle) ?? str(o?.label) ?? mention }]
  })
  return [...f, ...c]
}
