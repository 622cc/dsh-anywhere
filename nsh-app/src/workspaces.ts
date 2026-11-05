// Workspaces from DSH's workspace/follow stream (docs/research/dsh-protocol-parity.md §1) and the chat list grouped
// the way DSH Desktop's sidebar groups it.
/** `updatedAt`: the registry's last change of it, in ms (0 when DSH gave none). */
export interface Workspace { workspaceId: string; path: string; title: string; sessionIds: string[]; updatedAt?: number }
import { S } from './strings.ts'

export interface ChatSummary { sessionId: string; title: string; updatedAt: number; running: boolean; cwd?: string; preview?: string; /** The workspace it was just started in: a chat from the list is under its workspace already. */ project?: string }

/** The last answer's preview in DSH's turn outline projection, whose wire value is the bare array
 * [{turn, seq, prompt, response}] (dsh-session-turn-outline projection.js, `view: state => state.turns`), a response
 * of up to 120 characters, written when the turn ends. */
function lastResponse(outline: unknown): string | undefined {
  const r = Array.isArray(outline) ? (outline.at(-1) as { response?: unknown } | undefined)?.response : undefined
  return typeof r === 'string' && r.trim() ? r.trim() : undefined
}
export interface Group { id: string; title: string; workspace?: Workspace; chats: ChatSummary[] }

const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : undefined)
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
function workspaceOf(v: unknown): Workspace | undefined {
  const o = obj(v)
  return o && typeof o.workspaceId === 'string' && typeof o.path === 'string'
    ? { workspaceId: o.workspaceId, path: o.path, title: o.title === 'default-workspace' && /[\\/]deepseek-harness[\\/]default-workspace[\\/]?$/.test(o.path) ? S.defaultWorkspace : typeof o.title === 'string' && o.title ? o.title : o.path.split('/').filter(Boolean).at(-1) ?? o.path, sessionIds: ids(o.sessionIds), updatedAt: typeof o.updatedAt === 'string' ? Date.parse(o.updatedAt) || 0 : 0 }
    : undefined
}

export class Workspaces {
  private byId = new Map<string, Workspace>()
  private order: string[] = []
  archived = new Set<string>()
  pinned: string[] = []
  loaded = false

  apply(frame: unknown): void {
    const f = obj(frame); if (!f) return
    if (f.type === 'baseline' || f.type === 'replace') {
      const v = obj(f.value)
      this.byId.clear(); this.order = []
      for (const w of (Array.isArray(v?.items) ? v!.items : []).map(workspaceOf)) if (w) { this.byId.set(w.workspaceId, w); this.order.push(w.workspaceId) }
      this.archived = new Set(ids(v?.archivedSessionIds)); this.pinned = ids(v?.pinnedSessionIds); this.loaded = true
    } else if (f.type === 'upsert') {
      const w = workspaceOf(f.workspace); if (!w) return
      if (!this.byId.has(w.workspaceId)) this.order.push(w.workspaceId)
      this.byId.set(w.workspaceId, w)
    } else if (f.type === 'remove') { this.byId.delete(String(f.workspaceId)); this.order = this.order.filter((id) => id !== f.workspaceId) }
    else if (f.type === 'order') { const next = ids(f.workspaceIds).filter((id) => this.byId.has(id)); this.order = [...next, ...this.order.filter((id) => !next.includes(id))] }
    else if (f.type === 'archived') this.archived = new Set(ids(f.archivedSessionIds))
    else if (f.type === 'pinned') this.pinned = ids(f.pinnedSessionIds)
  }

  list(): Workspace[] { return this.order.flatMap((id) => (this.byId.has(id) ? [this.byId.get(id)!] : [])) }
}

export function groupChats(workspaces: Workspaces, chats: ChatSummary[]): Group[] {
  const visible = chats.filter((c) => !workspaces.archived.has(c.sessionId))
  const rank = (c: ChatSummary) => { const i = workspaces.pinned.indexOf(c.sessionId); return i < 0 ? Infinity : i }
  const sort = (list: ChatSummary[]) => list.sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)
  const claimed = new Set<string>()
  const groups: Group[] = workspaces.list().map((w) => {
    const mine = visible.filter((c) => w.sessionIds.includes(c.sessionId))
    mine.forEach((c) => claimed.add(c.sessionId))
    return { id: w.workspaceId, title: w.title, workspace: w, chats: sort(mine) }
  })
  const rest = visible.filter((c) => !claimed.has(c.sessionId))
  if (rest.length) groups.push({ id: 'other', title: S.otherChats, chats: sort(rest) })
  return groups.filter((g) => g.chats.length || g.workspace)
}

/** The archived chats, newest first: under the list's Archived header, to be brought back. */
export const archivedChats = (workspaces: Workspaces, chats: ChatSummary[]) =>
  chats.filter((c) => workspaces.archived.has(c.sessionId)).sort((a, b) => b.updatedAt - a.updatedAt)

/** Chats whose title has the query (newest first), then DSH's full-text hits (session/search) not already listed. */
export function searchChats(chats: ChatSummary[], query: string, hits: { sessionId: string; snippet: string }[] = []): (ChatSummary & { snippet?: string })[] {
  const q = query.trim().toLowerCase(); if (!q) return []
  const byId = new Map(chats.map((c) => [c.sessionId, c]))
  const titled = chats.filter((c) => c.title.toLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt)
  const hit = new Map(hits.map((h) => [h.sessionId, h.snippet]))
  const seen = new Set(titled.map((c) => c.sessionId))
  return [
    ...titled.map((c) => (hit.get(c.sessionId) ? { ...c, snippet: hit.get(c.sessionId) } : c)),
    ...hits.filter((h) => !seen.has(h.sessionId)).map((h) => ({ ...(byId.get(h.sessionId) ?? { sessionId: h.sessionId, title: '', updatedAt: 0, running: false }), snippet: h.snippet })),
  ]
}

/** The chats session/list returns, newest first, as Desktop's sidebar lists them: forks yes; subagents and blank chats no. */
export function summaries(value: unknown): ChatSummary[] {
  const items = Array.isArray((value as { items?: unknown })?.items) ? (value as { items: any[] }).items : []
  return items.filter((s) => typeof s?.sessionId === 'string' && s.origin !== 'subagent' && !s.blank)
    .map((s) => ({ sessionId: s.sessionId, title: typeof s.projections?.values?.title === 'string' && s.projections.values.title ? s.projections.values.title : S.untitled, updatedAt: Number(s.updatedAt) || 0, running: s.running === true, cwd: typeof s.cwd === 'string' ? s.cwd : undefined, preview: lastResponse(s.projections?.values?.turnOutline) }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
