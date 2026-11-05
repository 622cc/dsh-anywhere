// The workspace browser against DSH's workspaceFiles calls, answered as DSH 0.2.1-rc.3 answers them. Synthetic data.
import { expect, open, test } from 'nsh/test'

const API = 'http://127.0.0.1:40001/dsh/api'
const ok = (value: unknown) => ({ body: { type: 'server-response', rpcId: 'x', result: { ok: true, value } } })
const refused = (code: string, message = '') => ({ body: { type: 'server-response', rpcId: 'x', result: { ok: false, error: { code, message, details: {} } } } })
const argsOf = (req: { body?: string | null }) => JSON.parse(req.body ?? '{}').payload.args
const listings: Record<string, unknown> = {
  '.': { path: '', truncated: false, entries: [{ name: 'README.md', type: 'file', size: 2_000 }, { name: 'src', type: 'directory' }, { name: 'build', type: 'directory' }] },
  src: { path: 'src', truncated: false, entries: [{ name: 'app.ts', type: 'file', size: 120 }] },
  empty: { path: 'empty', truncated: false, entries: [] },
}
const list = (req: { body?: string | null }) => { const l = listings[argsOf(req).path]; return l ? ok(l) : refused('workspace-file/not-found', 'no entry') }
const fixture = (params: Record<string, unknown>, network: Record<string, unknown>) => open('./fixtures/files.tsx', { host: { params }, network: network as any })

test('the browser opens at the chat\'s workspace root: folders first, then files with their sizes', async () => {
  const asked: unknown[] = []
  const app = await fixture({}, { [`POST ${API}/workspaceFiles/list`]: (req: any) => { asked.push(argsOf(req)); return list(req) } })
  await app.waitFor('text:README.md')
  const t = app.texts()
  expect(t.indexOf('build') < t.indexOf('src') && t.indexOf('src') < t.indexOf('README.md')).toBe(true)
  expect(t.includes('2 KB')).toBe(true)
  expect(asked[0]).toEqual({ workspaceFileScopeId: 's1', path: '.' })
})

test('a folder opens on a page of its own, and back goes up', async () => {
  const app = await fixture({}, { [`POST ${API}/workspaceFiles/list`]: list })
  await app.waitFor('text:src')
  await app.press('text:src')
  await app.waitFor('text:app.ts')
  await app.back()
  await app.waitFor('text:README.md')
  expect(app.texts().includes('app.ts')).toBe(false)
})

test('an empty folder says so', async () => {
  const app = await fixture({ path: 'empty' }, { [`POST ${API}/workspaceFiles/list`]: list })
  await app.waitFor('text:This folder is empty')
})

test('a folder that is gone, or that the computer will not read, says why', async () => {
  const gone = await fixture({ path: 'old' }, { [`POST ${API}/workspaceFiles/list`]: list })
  await gone.waitFor('text:This file or folder is no longer there.')
  const denied = await fixture({ path: 'secret' }, { [`POST ${API}/workspaceFiles/list`]: () => refused('gateway/internal', 'cannot list "/w/project/secret": permission denied') })
  await denied.waitFor('text:The computer does not allow reading this.')
})

test('offline, it says the computer can\'t be reached, and Try again lists the folder', async () => {
  let calls = 0
  const app = await fixture({}, { [`POST ${API}/workspaceFiles/list`]: (req: any) => (++calls === 1 ? { error: 'unreachable' } : list(req)) })
  await app.waitFor('text:Can’t reach your computer. Check that it is on and DSH is running.')
  await app.press('id:files-retry')
  await app.waitFor('text:README.md')
})

test('a text file shows in lines with their numbers, read a page at a time', async () => {
  const asked: { offset: number; limit: number }[] = []
  const page = (offset: number, count: number, eof: boolean) => ({ offset, text: Array.from({ length: count }, (_, i) => `line ${offset + i}`).join('\n'), lines: count, eof, absolutePath: '/w/project/src/app.ts', version: 'v1', bytes: 9_000 })
  const app = await fixture({ path: 'src/app.ts', file: { name: 'app.ts', type: 'file', size: 9_000 } }, {
    [`POST ${API}/workspaceFiles/read`]: (req: any) => { const r = argsOf(req).range; asked.push(r); return ok(r.offset === 1 ? page(1, 400, false) : page(401, 2, true)) },
  })
  await app.waitFor('text:line 1')
  expect(app.texts().includes('1')).toBe(true)
  expect(asked[0]).toEqual({ offset: 1, limit: 400 })
  for (let i = 0; i < 40 && !app.texts().includes('line 402'); i++) await app.scroll('id:lines', 4000)
  await app.waitFor('text:line 402')
  expect(asked[1]).toEqual({ offset: 401, limit: 400 })
})

test('an image shows as a picture from its bytes', async () => {
  const meta = JSON.stringify({ type: 'server-response', rpcId: 'x', result: { ok: true, value: { offset: 0, data: null, eof: true, absolutePath: '/w/project/logo.png', version: 'v1', bytes: 4 } }, attachments: [{ path: ['data'], codec: 'bytes', part: 'bytes-0' }] })
  const body = ['--b', 'Content-Disposition: form-data; name="bytes-0"; filename="blob"', 'Content-Type: application/octet-stream', '', 'GIF8', '--b', 'Content-Disposition: form-data; name="metadata"', '', meta, '--b--', ''].join('\r\n')
  let asked: unknown
  const app = await fixture({ path: 'logo.png', file: { name: 'logo.png', type: 'file', size: 4 } }, {
    [`POST ${API}/workspaceFiles/readBytes`]: (req: any) => { asked = argsOf(req); return { headers: { 'content-type': 'multipart/form-data; boundary=b' }, body } },
  })
  await app.waitFor('id:file-image')
  expect(asked).toEqual({ workspaceFileScopeId: 's1', path: 'logo.png', options: {} })
})

test('any other file shows its size and type, and Mention in chat puts it in the draft as "@" does', async () => {
  const app = await fixture({ path: 'build/out.zip', file: { name: 'out.zip', type: 'file', size: 2_500_000 } }, {})
  await app.waitFor('text:ZIP, 2.5 MB')
  await app.press('text:Mention in chat')
  await app.waitFor('text:@build/out.zip')
})

test('a file DSH says is not text is described instead', async () => {
  const app = await fixture({ path: 'data.bin2', file: { name: 'data.bin2', type: 'file', size: 10 } }, {
    [`POST ${API}/workspaceFiles/read`]: () => refused('workspace-file/not-text', '"data.bin2" contains NUL bytes'),
  })
  await app.waitFor('text:Mention in chat')
  expect(app.texts().includes('No preview for this file')).toBe(true)
})

test('a very long name and a deep path stay readable', async () => {
  const deep = 'one/two/three/four/five/six/seven/eight/nine/ten'
  const long = `${'a-very-long-generated-file-name-'.repeat(4)}final.ts`
  const app = await fixture({ path: deep }, { [`POST ${API}/workspaceFiles/list`]: () => ok({ path: deep, truncated: false, entries: [{ name: long, type: 'file', size: 5 }] }) })
  await app.waitFor(`text:${long}`)
  expect(app.texts().includes('one/…/seven/eight/nine/ten')).toBe(true)
  expect(app.texts().includes('5 B')).toBe(true)
})
