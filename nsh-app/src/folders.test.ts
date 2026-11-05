// The folder picker's logic: recent projects first, filtering as one types, a typed path told from a search, where the
// listing comes from, and adding a folder that turns out not to exist. Synthetic paths and answers only.
import { expect, test } from 'nsh/test'
import { DshError } from './dsh.ts'
import { addFolder, createAndAdd, FolderSource, listingOf, matching, quickWorkspace, recentProjects, typedPath, type FolderCalls } from './folders.ts'
import type { Workspace } from './workspaces.ts'

const W = (id: string, updatedAt: number, sessionIds: string[] = []): Workspace => ({ workspaceId: id, path: `/home/me/${id}`, title: id, sessionIds, updatedAt })
const listing = (path: string, names: string[]) => ({ path, home: '/home/me', crumbs: [{ name: '/home/me', path: '/home/me', hidden: false }], entries: names.map((name) => ({ name, path: `${path}/${name}`, hidden: name.startsWith('.') })), truncated: false })

/** Calls answered from tables; each call is recorded as "rpc method" or "companion method". */
function calls(rpc: Record<string, (args: any) => unknown>, companion: Record<string, (args: any) => unknown> = {}) {
  const seen: string[] = []
  const answer = async (kind: string, table: Record<string, (args: any) => unknown>, method: string, args: any) => {
    seen.push(`${kind} ${method}`)
    const f = table[method]; if (!f) throw new DshError('http/404', 'HTTP 404')
    return f(args)
  }
  const io = { rpc: (m: string, a: any) => answer("rpc", rpc, m, a), companion: (m: string, a: any) => answer("companion", companion, m, a) } as FolderCalls
  return { io, seen }
}
const refuse = (code: string) => () => { throw new DshError(code, code) }

test('recent projects: the one used last first, by its chats\' last activity or its own last change, ties as DSH lists them', () => {
  const chats = [{ sessionId: 's1', updatedAt: 500 }, { sessionId: 's2', updatedAt: 900 }, { sessionId: 's3', updatedAt: 100 }]
  const list = recentProjects([W('a', 50, ['s1']), W('b', 50, ['s3']), W('c', 700), W('d', 50, ['s2']), W('e', 0)], chats)
  expect(list.map((w) => w.workspaceId)).toEqual(['d', 'c', 'a', 'b', 'e'])
})

test('search: any part of a name, any case; recent projects match on their title and folder', () => {
  expect(matching('PRO', ['projects', 'Pictures', 'my-proto'], (n) => [n])).toEqual(['projects', 'my-proto'])
  expect(matching('', ['b', 'a'], (n) => [n])).toEqual(['b', 'a'])
  expect(matching('  ', ['b'], (n) => [n])).toEqual(['b'])
  const w = { ...W('x', 0), title: 'Website', path: '/home/me/code/site' }
  expect(matching('code', [w], (v) => [v.title, v.path]).length).toBe(1)
})

test('a path is typed when it starts at the root or at home; anything else is a search', () => {
  expect(typedPath('/srv/app', '/home/me')).toBe('/srv/app')
  expect(typedPath('  /srv/app/  ', '/home/me')).toBe('/srv/app')
  expect(typedPath('~', '/home/me')).toBe('/home/me')
  expect(typedPath('~/code/new', '/home/me')).toBe('/home/me/code/new')
  expect(typedPath('~/code', undefined)).toBe(undefined)
  expect(typedPath('/', '/home/me')).toBe('/')
  expect(typedPath('code', '/home/me')).toBe(undefined)
  expect(typedPath('C:\\Users\\me\\code', 'C:\\Users\\me')).toBe('C:\\Users\\me\\code')
  expect(typedPath('~\\code', 'C:\\Users\\me')).toBe('C:\\Users\\me\\code')
})

test('a listing keeps only well-formed rows', () => {
  const l = listingOf({ path: '/home/me', home: '/home/me', crumbs: [{ name: '/home/me', path: '/home/me' }], entries: [{ name: 'a', path: '/home/me/a', hidden: false }, { name: 7 }, null, { name: '.b', path: '/home/me/.b', hidden: true }], truncated: true })
  expect(l.entries.map((e) => e.name)).toEqual(['a', '.b'])
  expect(l.truncated).toBe(true)
  expect(l.crumbs[0]!.hidden).toBe(false)
})

test('folders are listed by DSH when its picker lists; when DSH says it has no listing, by the companion from then on', async () => {
  const dsh = calls({ 'directoryPicker/list': () => listing('/home/me', ['a']) })
  const own = new FolderSource(dsh.io)
  expect((await own.list()).entries.map((e) => e.name)).toEqual(['a'])
  expect(dsh.seen).toEqual(['rpc directoryPicker/list'])

  const native = calls({ 'directoryPicker/list': refuse('directory-picker/unavailable') }, { 'folders/list': (a) => listing(a.path ?? '/home/me', ['b']) })
  const source = new FolderSource(native.io)
  expect((await source.list()).entries.map((e) => e.name)).toEqual(['b'])
  expect((await source.list('/home/me/b')).path).toBe('/home/me/b')
  expect(native.seen).toEqual(['rpc directoryPicker/list', 'companion folders/list', 'companion folders/list'])
})

test('a failure other than "no listing here" is the listing\'s failure, and DSH is asked again next time', async () => {
  let n = 0
  const c = calls({ 'directoryPicker/list': () => { if (++n === 1) throw new DshError('network', 'x'); return listing('/home/me', []) } })
  const source = new FolderSource(c.io)
  let code = ''
  try { await source.list() } catch (e) { code = (e as DshError).code }
  expect(code).toBe('network')
  expect((await source.list()).path).toBe('/home/me')
})

test('adding a folder that exists adds it; DSH validates the path itself, so nothing else is asked', async () => {
  const c = calls({ 'workspace/create': (a) => ({ workspace: { workspaceId: `w:${a.request.path}` }, created: true }) })
  expect(await addFolder(c.io, '/home/me/code')).toEqual({ kind: 'added', workspaceId: 'w:/home/me/code' })
  expect(c.seen).toEqual(['rpc workspace/create'])
})

test('a folder that is not there: the phone learns what is missing and whether its parent exists; a file is not a folder', async () => {
  const states: Record<string, unknown> = {
    '/home/me/new': { path: '/home/me/new', state: 'missing', parent: '/home/me', name: 'new', parentExists: true },
    '/home/me/no/new': { path: '/home/me/no/new', state: 'missing', parent: '/home/me/no', name: 'new', parentExists: false },
    '/home/me/notes.txt': { path: '/home/me/notes.txt', state: 'not-directory' },
  }
  const c = calls({ 'workspace/create': refuse('workspace/invalid-path') }, { 'folders/check': (a) => states[a.path] })
  expect(await addFolder(c.io, '/home/me/new')).toEqual({ kind: 'missing', path: '/home/me/new', parent: '/home/me', name: 'new' })
  expect(await addFolder(c.io, '/home/me/no/new')).toEqual({ kind: 'missing-parent', path: '/home/me/no/new', parent: '/home/me/no' })
  expect(await addFolder(c.io, '/home/me/notes.txt')).toEqual({ kind: 'not-directory', path: '/home/me/notes.txt' })
})

test('when the companion cannot check (an older one, or the path is outside home), DSH\'s own refusal stands', async () => {
  const old = calls({ 'workspace/create': refuse('workspace/invalid-path') })
  let code = ''
  try { await addFolder(old.io, '/home/me/new') } catch (e) { code = (e as DshError).code }
  expect(code).toBe('workspace/invalid-path')
  const outside = calls({ 'workspace/create': refuse('workspace/invalid-path') }, { 'folders/check': refuse('directory-picker/outside-home') })
  try { await addFolder(outside.io, '/srv/new') } catch (e) { code = (e as DshError).code }
  expect(code).toBe('workspace/invalid-path')
  const other = calls({ 'workspace/create': refuse('session/whatever') })
  try { await addFolder(other.io, '/home/me/x') } catch (e) { code = (e as DshError).code }
  expect(code).toBe('session/whatever')
  expect(other.seen).toEqual(['rpc workspace/create'])
})

test('creating after the person confirms: one folder in its parent, then the workspace; one made meanwhile is just added', async () => {
  const made: string[] = []
  const c = calls({ 'workspace/create': (a) => ({ workspace: { workspaceId: `w:${a.request.path}` } }) }, { 'folders/create': (a) => { made.push(`${a.path}|${a.name}`); return { path: `${a.path}/${a.name}` } } })
  expect(await createAndAdd(c.io, { path: '/home/me/new', parent: '/home/me', name: 'new' })).toEqual({ kind: 'added', workspaceId: 'w:/home/me/new' })
  expect(made).toEqual(['/home/me|new'])
  expect(c.seen).toEqual(['companion folders/create', 'rpc workspace/create'])
  const raced = calls({ 'workspace/create': () => ({ workspace: { workspaceId: 'w' } }) }, { 'folders/create': refuse('directory-picker/exists') })
  expect(await createAndAdd(raced.io, { path: '/home/me/new', parent: '/home/me', name: 'new' })).toEqual({ kind: 'added', workspaceId: 'w' })
  const refused = calls({}, { 'folders/create': refuse('directory-picker/create-failed') })
  let code = ''
  try { await createAndAdd(refused.io, { path: '/home/me/new', parent: '/home/me', name: 'new' }) } catch (e) { code = (e as DshError).code }
  expect(code).toBe('directory-picker/create-failed')
  expect(refused.seen).toEqual(['companion folders/create'])
})

// DSH has no chat without a workspace in its UI; its own fallback is the Default workspace, <Documents>/deepseek-harness/
// default-workspace, which workspace/initializeDefault registers on a fresh install only (dsh-workspace 0.2.1-rc.3).
test('a quick chat goes to DSH\'s Default workspace: the one registered, else the one DSH makes, else its folder added', async () => {
  const registered = { workspaceId: 'dw', path: '/home/me/Documents/deepseek-harness/default-workspace', title: 'default-workspace', sessionIds: [] }
  const a = calls({})
  expect(await quickWorkspace(a.io, [W('a', 0), registered])).toBe('dw')
  expect(a.seen).toEqual([])

  const b = calls({ 'workspace/initializeDefault': () => ({ workspace: { workspaceId: 'made' } }) })
  expect(await quickWorkspace(b.io, [])).toBe('made')

  const created: string[] = []
  const c = calls({
    'workspace/initializeDefault': () => undefined,
    'directoryPicker/list': () => listing('/home/me', []),
    'workspace/create': (args) => { if (!created.includes(args.request.path)) throw new DshError('workspace/invalid-path', 'invalid'); return { workspace: { workspaceId: 'added' } } },
  }, {
    'folders/check': (args) => ({ state: 'missing', parent: args.path.replace(/\/[^/]+$/, ''), name: args.path.replace(/^.*\//, ''), parentExists: created.includes(args.path.replace(/\/[^/]+$/, '')) || args.path.endsWith('/deepseek-harness') }),
    'folders/create': (args) => { created.push(`${args.path}/${args.name}`); return {} },
  })
  expect(await quickWorkspace(c.io, [W('a', 0)])).toBe('added')
  expect(created).toEqual(['/home/me/Documents/deepseek-harness', '/home/me/Documents/deepseek-harness/default-workspace'])
})

test('a companion that cannot list folders (before 0.7.13): the home is the one the registered projects are in', async () => {
  const c = calls({
    'workspace/initializeDefault': () => undefined,
    'directoryPicker/list': refuse('directory-picker/unavailable'),
    'workspace/create': (args) => ({ workspace: { workspaceId: `w:${args.request.path}` } }),
  })
  expect(await quickWorkspace(c.io, [W('a', 0), { workspaceId: 'x', path: '/home/me/code/app', title: 'app', sessionIds: [] }])).toBe('w:/home/me/Documents/deepseek-harness/default-workspace')
  const none = calls({ 'workspace/initializeDefault': () => undefined, 'directoryPicker/list': refuse('directory-picker/unavailable') })
  let code = ''
  try { await quickWorkspace(none.io, []) } catch (e) { code = (e as DshError).code }
  expect(code).toBe('http/404')
})
