// The new-chat sheet's folder picker: folders on the computer, recent projects first. A level is listed by DSH's own
// picker (directoryPicker/list) where DSH composes its browse backend; DSH Desktop on its own computer composes the
// native one, which refuses the phone with directory-picker/unavailable, and then the companion lists
// (companion/folders/list: the same listing, inside the owner's home and workspace folders; host/src/folders.ts).
// A folder is added with DSH's workspace/create, which refuses a missing path with workspace/invalid-path; the
// companion then says what is missing (folders/check), and after the person confirms it creates the last folder of the
// path only (folders/create): a mistyped folder higher up is never made on the way.
import { DshError } from './dsh.ts'
import type { Workspace } from './workspaces.ts'

export interface FolderEntry { name: string; path: string; hidden: boolean }
export interface FolderListing { path: string; home: string; crumbs: FolderEntry[]; entries: FolderEntry[]; truncated: boolean }
export interface FolderCalls {
  rpc<T = any>(method: string, args: Record<string, unknown>): Promise<T>
  companion<T = any>(method: string, args: Record<string, unknown>): Promise<T>
}
export interface Missing { path: string; parent: string; name: string }
export type AddOutcome =
  | { kind: 'added'; workspaceId: string }
  | ({ kind: 'missing' } & Missing)
  | { kind: 'missing-parent'; path: string; parent: string }
  | { kind: 'not-directory'; path: string }

const rows = (v: unknown): FolderEntry[] => (Array.isArray(v) ? v : []).flatMap((e) => {
  const x = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
  return typeof x.name === 'string' && x.name && typeof x.path === 'string' ? [{ name: x.name, path: x.path, hidden: x.hidden === true }] : []
})
/** directoryPicker/list's value, and the companion's, which has the same shape. */
export function listingOf(v: unknown): FolderListing {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return { path: typeof o.path === 'string' ? o.path : '', home: typeof o.home === 'string' ? o.home : '', crumbs: rows(o.crumbs), entries: rows(o.entries), truncated: o.truncated === true }
}

/** Where levels come from: DSH while it lists, else the companion (decided by DSH's first answer). */
export class FolderSource {
  private dsh: boolean | undefined
  constructor(private readonly io: FolderCalls) {}
  async list(path?: string): Promise<FolderListing> {
    const args = path ? { path } : {}
    if (this.dsh !== false) {
      try { const v = listingOf(await this.io.rpc('directoryPicker/list', args)); this.dsh = true; return v }
      catch (e) { if (this.dsh || !(e instanceof DshError && e.code === 'directory-picker/unavailable')) throw e; this.dsh = false }
    }
    return listingOf(await this.io.companion('folders/list', args))
  }
}

/** When a workspace was last used: its chats' last activity (session/list updatedAt) or its own last change (the
 * registry stamps updatedAt when a chat joins or leaves it, or it is renamed: dsh-workspace 0.2.1-rc.3 `mutate`). */
const lastUsed = (w: Workspace, chats: Map<string, number>) => Math.max(w.updatedAt ?? 0, ...w.sessionIds.map((id) => chats.get(id) ?? 0))
export function recentProjects(workspaces: Workspace[], chats: { sessionId: string; updatedAt: number }[]): Workspace[] {
  const at = new Map(chats.map((c) => [c.sessionId, c.updatedAt]))
  return workspaces.map((w, i) => ({ w, i, t: lastUsed(w, at) })).sort((a, b) => b.t - a.t || a.i - b.i).map((x) => x.w)
}

/** The items whose texts contain the query, any case; all of them for an empty query. */
export function matching<T>(query: string, items: T[], texts: (item: T) => string[]): T[] {
  const q = query.trim().toLowerCase()
  return q ? items.filter((item) => texts(item).some((t) => t.toLowerCase().includes(q))) : items
}

/** The folder a typed text names when it is a path (from the root, a drive, or home "~"), else undefined: a search. */
export function typedPath(text: string, home: string | undefined): string | undefined {
  let t = text.trim()
  if (t === '~' || t.startsWith('~/') || t.startsWith('~\\')) { if (!home) return undefined; t = home + t.slice(1) }
  else if (!t.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(t)) return undefined
  return t.replace(/(?<=[^/\\:])[/\\]+$/, '')
}

/** Adds the folder as a workspace, or says what stands in the way: a folder that is not there, its parent not there
 * either, or a file. Only DSH's own "invalid path" refusal asks the companion; whatever it cannot tell, DSH's stands. */
export async function addFolder(io: FolderCalls, path: string): Promise<AddOutcome> {
  try {
    const v = await io.rpc<{ workspace: { workspaceId: string } }>('workspace/create', { request: { path } })
    return { kind: 'added', workspaceId: v.workspace.workspaceId }
  } catch (e) {
    if (!(e instanceof DshError) || e.code !== 'workspace/invalid-path') throw e
    let c: { state?: string; parent?: string; name?: string; parentExists?: boolean } | undefined
    try { c = await io.companion('folders/check', { path }) } catch { throw e }
    if (c?.state === 'missing' && typeof c.parent === 'string' && typeof c.name === 'string') return c.parentExists ? { kind: 'missing', path, parent: c.parent, name: c.name } : { kind: 'missing-parent', path, parent: c.parent }
    if (c?.state === 'not-directory') return { kind: 'not-directory', path }
    throw e
  }
}

/** After the person confirmed: the last folder of the path, then the workspace. One made meanwhile is just added. */
export async function createAndAdd(io: FolderCalls, missing: Missing): Promise<AddOutcome> {
  try { await io.companion('folders/create', { path: missing.parent, name: missing.name }) }
  catch (e) { if (!(e instanceof DshError && e.code === 'directory-picker/exists')) throw e }
  return addFolder(io, missing.path)
}

/** DSH's Default workspace folder under a home: <Documents>/deepseek-harness/default-workspace (dsh-api-workspace-controller). */
const DEFAULT_PARTS = ['Documents', 'deepseek-harness', 'default-workspace']
const isDefault = (path: string) => /[\\/]deepseek-harness[\\/]default-workspace[\\/]?$/.test(path)

/** The home folder most registered projects are in (/Users/<name>, /home/<name>, C:\\Users\\<name>), or ''. */
function homeOf(workspaces: Workspace[]): string {
  const count = new Map<string, number>()
  for (const w of workspaces) { const m = /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[\\/]|$)/.exec(w.path); if (m) count.set(m[1]!, (count.get(m[1]!) ?? 0) + 1) }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

/** The workspace for a chat started without picking a project: DSH's Default workspace, as DSH Desktop names it.
 * The one registered; else the one DSH registers itself (only on a fresh install, workspace/initializeDefault); else
 * its folder under the owner's home, made one level at a time where it is not there, and added. */
export async function quickWorkspace(io: FolderCalls, workspaces: Workspace[]): Promise<string> {
  const known = workspaces.find((w) => isDefault(w.path))
  if (known) return known.workspaceId
  try { const v = await io.rpc<{ workspace?: { workspaceId?: string } } | undefined>('workspace/initializeDefault', {}); if (v?.workspace?.workspaceId) return v.workspace.workspaceId } catch {}
  // The owner's home from the folder listing; a companion before 0.7.13 lists none: the home its projects are in.
  let home = ''
  try { home = (await new FolderSource(io).list()).home } catch (e) { home = homeOf(workspaces); if (!home) throw e }
  if (!home) throw new DshError('directory-picker/unreadable', 'no home folder')
  const sep = home.includes('\\') && !home.includes('/') ? '\\' : '/'
  const path = [home.replace(/[\\/]+$/, ''), ...DEFAULT_PARTS].join(sep)
  for (let tries = 0; tries < DEFAULT_PARTS.length + 1; tries++) {
    const outcome = await addFolder(io, path)
    if (outcome.kind === 'added') return outcome.workspaceId
    if (outcome.kind === 'not-directory') throw new DshError('workspace/invalid-path', path)
    // The deepest missing folder whose parent is there is made first; then the next one down.
    let missing = outcome.kind === 'missing' ? { parent: outcome.parent, name: outcome.name } : undefined
    if (!missing) {
      let at = outcome.parent
      for (;;) {
        const c = await io.companion<{ state?: string; parent?: string; name?: string; parentExists?: boolean }>('folders/check', { path: at })
        if (c?.state !== 'missing' || typeof c.parent !== 'string' || typeof c.name !== 'string') throw new DshError('workspace/invalid-path', path)
        if (c.parentExists) { missing = { parent: c.parent, name: c.name }; break }
        at = c.parent
      }
    }
    try { await io.companion('folders/create', { path: missing.parent, name: missing.name }) } catch (e) { if (!(e instanceof DshError && e.code === 'directory-picker/exists')) throw e }
  }
  throw new DshError('workspace/invalid-path', path)
}
