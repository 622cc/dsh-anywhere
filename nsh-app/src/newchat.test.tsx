// Adding a workspace in the new-chat sheet: recent projects first, then the computer's folders level by level, a
// search that filters both, a typed path, and a folder that does not exist, created only once the person says so.
// DSH answers as a DSH Desktop on its own computer does (its picker is the native one: directory-picker/unavailable),
// so the companion lists (host/src/folders.ts). Synthetic folders only.
import { expect, open, test } from 'nsh/test'

const API = 'http://127.0.0.1:40001/dsh/api', OWN = 'http://127.0.0.1:40001/dsh/companion'
const ok = (value: unknown) => ({ body: { type: 'server-response', rpcId: 'x', result: { ok: true, value } } })
const refused = (code: string, message = '') => ({ body: { type: 'server-response', rpcId: 'x', result: { ok: false, error: { code, message, details: {} } } } })
const argsOf = (req: { body?: string | null }) => JSON.parse(req.body ?? '{}').payload.args
const HOME = '/home/me'
const tree: Record<string, string[]> = { [HOME]: ['.config', 'code', 'Documents', 'site', 'api'], [`${HOME}/code`]: ['app', 'empty'], [`${HOME}/code/app`]: [], [`${HOME}/code/empty`]: [], [`${HOME}/api`]: ['src'], [`${HOME}/Documents`]: [] }
const crumbsOf = (path: string) => { const out = [{ name: HOME, path: HOME, hidden: false }]; let at = HOME; for (const part of path.slice(HOME.length).split('/').filter(Boolean)) { at = `${at}/${part}`; out.push({ name: part, path: at, hidden: false }) } return out }
const listing = (path: string) => ({ path, home: HOME, crumbs: crumbsOf(path), entries: tree[path]!.map((name) => ({ name, path: `${path}/${name}`, hidden: name.startsWith('.') })), truncated: false })

/** DSH and the companion as a test sees them: every call is recorded, folders/list answers from `tree`. */
function computer(overrides: Record<string, (req: any) => unknown> = {}) {
  const asked: { call: string; args: any }[] = []
  const at = (call: string, answer: (req: any) => unknown) => (req: any) => { asked.push({ call, args: argsOf(req) }); return answer(req) }
  const routes: Record<string, (req: any) => unknown> = {
    'agentPresets/list': () => ok({ presets: [] }),
    'directoryPicker/list': () => refused('directory-picker/unavailable', 'directoryPicker.list needs the browse capability; the composed picker serves "native"'),
    'folders/list': (req) => { const path = argsOf(req).path ?? HOME; return tree[path] ? ok(listing(path)) : refused('directory-picker/not-found') },
    'workspace/create': (req) => ok({ workspace: { workspaceId: `new:${argsOf(req).request.path}` }, created: true }),
    'session/create': (req) => ok({ sessionId: `chat-in:${argsOf(req).request.workspaceId}` }),
    ...overrides,
  }
  const network: Record<string, unknown> = {}
  for (const [call, answer] of Object.entries(routes)) network[`POST ${call.startsWith('folders/') ? OWN : API}/${call}`] = at(call, answer)
  return { asked, network, calls: () => asked.map((a) => a.call) }
}
const sheet = async (c: ReturnType<typeof computer>) => {
  const app = await open('./fixtures/newchat.tsx', { network: c.network as any })
  await app.press('id:add-workspace')
  await app.waitFor('text:Recent projects')
  await app.waitFor('text:Documents')
  return app
}

test('Add workspace opens on the recent projects, the one used last first, then the folders in home without hidden ones', async () => {
  const c = computer()
  const app = await sheet(c)
  const t = app.texts()
  expect(t.indexOf('api') < t.indexOf('site')).toBe(true)
  expect(t.indexOf('Recent projects') < t.indexOf('api')).toBe(true)
  expect(t.indexOf('Folders in Home') > t.indexOf('site')).toBe(true)
  expect(t.includes('.config')).toBe(false)
  expect(c.calls().slice(-2)).toEqual(['directoryPicker/list', 'folders/list'])
  await app.press('id:show-hidden')
  await app.waitFor('text:.config')
})

test('down level by level, back up by the crumbs; Add this folder adds the folder shown, and the chat starts in it', async () => {
  const c = computer()
  const app = await sheet(c)
  await app.press('id:folder-code')
  await app.waitFor('id:folder-app')
  expect(app.shows('id:recent-w-api')).toBe(false)
  await app.press('id:folder-app')
  await app.waitFor('text:No folders here')
  await app.press('id:crumb-1')
  await app.waitFor('id:folder-empty')
  await app.press('id:folder-up')
  await app.waitFor('id:folder-Documents')
  await app.press('id:folder-code')
  await app.waitFor('id:folder-app')
  await app.press('id:use-folder')
  await app.waitFor('id:start-chat')
  expect(c.asked.find((a) => a.call === 'workspace/create')?.args).toEqual({ request: { path: `${HOME}/code` } })
  await app.press('id:start-chat')
  await app.waitFor(`text:chat-in:new:${HOME}/code`)
})

test('a recent project opens at its folder', async () => {
  const c = computer()
  const app = await sheet(c)
  await app.press('id:recent-w-api')
  await app.waitFor('id:folder-src')
  expect(c.asked.at(-1)).toEqual({ call: 'folders/list', args: { path: `${HOME}/api` } })
})

test('search filters the recent projects and the folders as one types', async () => {
  const app = await sheet(computer())
  await app.type('id:folder-search', 'co')
  await app.waitUntil(() => !app.texts().includes('Documents'))
  expect(app.shows('id:folder-code')).toBe(true)
  expect(app.shows('id:recent-w-api')).toBe(false)
  await app.clear('id:folder-search')
  await app.type('id:folder-search', 'SIT')
  await app.waitFor('id:recent-w-site')
  expect(app.shows('id:folder-site')).toBe(true)
  expect(app.shows('id:folder-code')).toBe(false)
  await app.clear('id:folder-search')
  await app.type('id:folder-search', 'zzz')
  await app.waitFor('text:No folders match')
})

test('a typed path that does not exist: the phone says so and asks; Cancel creates nothing', async () => {
  const c = computer({
    'workspace/create': () => refused('workspace/invalid-path', 'cannot create a Workspace at "/home/me/code/new-thing": ENOENT'),
    'folders/check': () => ok({ path: `${HOME}/code/new-thing`, state: 'missing', parent: `${HOME}/code`, name: 'new-thing', parentExists: true }),
  })
  const app = await sheet(c)
  await app.type('id:folder-search', '~/code/new-thing')
  await app.waitFor(`text:Add ${HOME}/code/new-thing`)
  await app.press('id:add-typed')
  await app.waitFor('text:This folder doesn’t exist')
  await app.waitFor(`text:Create “new-thing” in ${HOME}/code?`)
  await app.press('id:cancel-create')
  await app.waitUntil(() => !app.texts().includes('This folder doesn’t exist'))
  expect(c.calls().includes('folders/create')).toBe(false)
  expect(app.shows('id:folder-search')).toBe(true)
})

test('Create folder makes the one missing folder, then adds it as the workspace', async () => {
  let made = false
  const c = computer({
    'workspace/create': (req) => (made ? ok({ workspace: { workspaceId: `new:${argsOf(req).request.path}` }, created: true }) : refused('workspace/invalid-path')),
    'folders/check': () => ok({ path: `${HOME}/code/new-thing`, state: 'missing', parent: `${HOME}/code`, name: 'new-thing', parentExists: true }),
    'folders/create': () => { made = true; return ok({ path: `${HOME}/code/new-thing` }) },
  })
  const app = await sheet(c)
  await app.type('id:folder-search', `${HOME}/code/new-thing`)
  await app.press('id:add-typed')
  await app.waitFor('id:create-folder')
  await app.press('id:create-folder')
  await app.waitFor('id:start-chat')
  expect(c.asked.find((a) => a.call === 'folders/create')?.args).toEqual({ path: `${HOME}/code`, name: 'new-thing' })
  expect(c.calls().filter((x) => x === 'workspace/create').length).toBe(2)
  await app.press('id:start-chat')
  await app.waitFor(`text:chat-in:new:${HOME}/code/new-thing`)
})

test('when the parent is missing too, the phone says which and offers nothing to create', async () => {
  const c = computer({
    'workspace/create': () => refused('workspace/invalid-path'),
    'folders/check': () => ok({ path: `${HOME}/cdoe/app`, state: 'missing', parent: `${HOME}/cdoe`, name: 'app', parentExists: false }),
  })
  const app = await sheet(c)
  await app.type('id:folder-search', '~/cdoe/app')
  await app.press('id:add-typed')
  await app.waitFor(`text:The folder ${HOME}/cdoe doesn’t exist either. Check the path.`)
  expect(app.shows('id:create-folder')).toBe(false)
})

test('a file is not a folder', async () => {
  const c = computer({ 'workspace/create': () => refused('workspace/invalid-path'), 'folders/check': () => ok({ path: `${HOME}/notes.txt`, state: 'not-directory' }) })
  const app = await sheet(c)
  await app.type('id:folder-search', '~/notes.txt')
  await app.press('id:add-typed')
  await app.waitFor('text:This is a file, not a folder.')
})

test('offline, the listing says the computer can\'t be reached and Try again lists it; the typed path stays available', async () => {
  let n = 0
  const c = computer({ 'folders/list': (req) => (++n === 1 ? { error: 'unreachable' } : ok(listing(argsOf(req).path ?? HOME))) })
  const app = await open('./fixtures/newchat.tsx', { network: c.network as any })
  await app.press('id:add-workspace')
  await app.waitFor('text:Can’t reach your computer. Check that it is on and DSH is running.')
  expect(app.shows('id:folder-search')).toBe(true)
  expect(app.shows('id:recent-w-api')).toBe(true)
  await app.press('id:folders-retry')
  await app.waitFor('id:folder-Documents')
})

test('a folder outside home is refused in the phone\'s words', async () => {
  const c = computer({ 'folders/list': (req) => (argsOf(req).path ? refused('directory-picker/outside-home', 'outside the home folder and the workspaces') : ok(listing(HOME))) })
  const app = await sheet(c)
  await app.press('id:folder-code')
  await app.waitFor('text:The phone opens folders only in your home folder and your workspaces.')
})

test('rows and buttons say what they are to a screen reader', async () => {
  const app = await sheet(computer())
  expect(app.shows('label:code, Folder')).toBe(true)
  expect(app.shows('label:api, /home/me/api')).toBe(true)
  expect(app.shows('label:Show hidden files')).toBe(true)
})

test('in Russian, dark, on a narrow phone, on Android as on iOS: the picker reads whole and asks before creating', async () => {
  for (const platform of ['ios', 'android'] as const) {
    const c = computer({ 'workspace/create': () => refused('workspace/invalid-path'), 'folders/check': () => ok({ path: `${HOME}/code/новая`, state: 'missing', parent: `${HOME}/code`, name: 'новая', parentExists: true }) })
    const app = await open('./fixtures/newchat.tsx', { network: c.network as any, colorScheme: 'dark', width: 320, locale: 'ru-RU', platform })
    await app.press('id:add-workspace')
    await app.waitFor('text:Недавние проекты')
    await app.waitFor('text:Папки: Домашняя папка')
    await app.type('id:folder-search', '~/code/новая')
    await app.press('id:add-typed')
    await app.waitFor('text:Такой папки нет')
    await app.waitFor(`text:Создать «новая» в ${HOME}/code?`)
    expect(app.shows('label:Создать папку')).toBe(true)
  }
})

// A chat right away, without picking a project. DSH's place for it is its Default workspace.
test('Chat without a project starts at once in DSH\'s Default workspace, adding its folder when DSH has none', async () => {
  const c = computer({ 'workspace/initializeDefault': () => ok(undefined), 'folders/check': (req) => ok({ state: 'missing', parent: argsOf(req).path.replace(/\/[^/]+$/, ''), name: argsOf(req).path.replace(/^.*\//, ''), parentExists: true }) })
  const app = await open('./fixtures/newchat.tsx', { network: c.network as any })
  await app.waitFor('text:Chat without a project')
  await app.press('id:quick-chat')
  await app.waitFor(`text:chat-in:new:${HOME}/Documents/deepseek-harness/default-workspace`)
  expect(c.calls().includes('workspace/initializeDefault')).toBe(true)
})

// The sheet's height jumped in one frame between the panel and the picker, and at each folder.
const glides = (app: { texts(): string[] }) => Number(app.texts().find((t) => t.startsWith('glides:'))?.slice(7))
const glidesOn = async (app: any, step: () => Promise<unknown>) => {
  const before = glides(app)
  await step()
  await app.waitUntil(() => glides(app) > before)
}

test('the sheet changes height smoothly: into the picker, at each folder, up and back again', async () => {
  const app = await open('./fixtures/newchat.tsx', { network: computer().network as any })
  await glidesOn(app, () => app.press('id:add-workspace'))
  await app.waitFor('text:Documents')
  await glidesOn(app, async () => { await app.press('id:folder-code'); await app.waitFor('text:empty') })
  await glidesOn(app, async () => { await app.press('id:folder-up'); await app.waitFor('text:Documents') })
  await glidesOn(app, () => app.press('id:show-hidden'))
  await glidesOn(app, () => app.press('id:folders-back'))
})

test('back from the picker together with the new workspace: the panel waits for the list to have it, and changes height once', async () => {
  const c = computer({ 'workspace/create': () => ok({ workspace: { workspaceId: 'w-new' }, created: true }) })
  const app = await sheet(c)
  const before = glides(app)
  await app.press('id:use-folder')
  expect(app.shows('id:start-chat')).toBe(false)
  await app.host.send('workspace', { workspaceId: 'w-new', path: `${HOME}/code`, title: 'code', sessionIds: [], updatedAt: 100 })
  await app.waitFor('id:start-chat')
  expect(app.shows('id:workspace-w-new')).toBe(true)
  await app.waitUntil(() => glides(app) === before + 1)
  expect(app.texts().filter((t: string) => t === '✓').length).toBe(1)
})

test('a list that does not hear of the new workspace still comes back to the panel', async () => {
  const app = await sheet(computer())
  await app.press('id:use-folder')
  await app.waitFor('id:start-chat')
})

test('the Agent row arriving changes the sheet\'s height smoothly', async () => {
  const presets = [{ id: 'a', name: 'Default', isDefault: true }, { id: 'b', name: 'Review' }]
  const c = computer({ 'agentPresets/list': () => ({ ...ok({ presets }), delay: 300 }) })
  const app = await open('./fixtures/newchat.tsx', { network: c.network as any })
  await app.waitFor('id:preset-b')
  await app.waitUntil(() => glides(app) === 1)
})

test('a started chat is told which workspace it is in', async () => {
  const app = await open('./fixtures/newchat.tsx', { network: computer().network as any })
  await app.press('id:workspace-w-api')
  await app.press('id:start-chat')
  await app.waitFor('text:chat-in:w-api in api at /home/me/api')
})
