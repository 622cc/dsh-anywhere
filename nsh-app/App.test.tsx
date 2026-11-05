import { expect, open, test } from 'nsh/test'

const ORIGIN = 'http://127.0.0.1:40001/dsh'
const list = { type: 'server-response', rpcId: 'x', result: { ok: true, value: { items: [
  { sessionId: 'old', updatedAt: 1_000, running: false, blank: false, cwd: '/w/alpha', projections: { asOfSeq: 1, values: { title: 'Older chat' } } },
  { sessionId: 'new', updatedAt: 2_000, running: true, blank: false, cwd: '/w/beta', projections: { asOfSeq: 1, values: { title: 'Newest chat' } } },
  { sessionId: 'child', parentSessionId: 'new', origin: 'subagent', updatedAt: 3_000, running: false, blank: false, projections: { asOfSeq: 1, values: { title: 'Subagent' } } },
] } } }
const paired = { paired: true, origin: ORIGIN, token: 'synthetic-device-token' }

test('a linked phone opens on its chats, newest first, sending the device token', async () => {
  let auth = ''
  const app = await open('./App.tsx', {
    host: { handlers: { 'link.state': paired } },
    network: { [`POST ${ORIGIN}/api/session/list`]: (req) => { auth = req.headers['authorization'] ?? ''; return { body: list } } },
  })
  await app.waitFor('text:Newest chat')
  const texts = app.texts()
  expect(texts.indexOf('Newest chat') < texts.indexOf('Older chat')).toBe(true)
  expect(texts.includes('Subagent')).toBe(false)
  expect(auth).toBe('Bearer synthetic-device-token')
})

test('an unlinked phone scans the computer\'s QR and lands on its chats', async () => {
  let pairedWith = ''
  const app = await open('./App.tsx', {
    host: { handlers: { 'link.state': { paired: false }, 'link.scan': 'dshm1:synthetic', 'link.pair': (data: { text: string }) => { pairedWith = data.text; return paired } } },
    network: { [`POST ${ORIGIN}/api/session/list`]: { body: list } },
  })
  await app.waitFor('text:Link your computer')
  await app.press('id:scan')
  await app.waitFor('text:Newest chat')
  expect(pairedWith).toBe('dshm1:synthetic')
})

test('a pairing link that opened the app pairs without a scan; a refused code says why', async () => {
  const app = await open('./App.tsx', {
    host: { params: { pair: 'dshm1:expired' }, handlers: { 'link.state': { paired: false }, 'link.pair': () => { throw new Error('link/expired') } } },
  })
  await app.waitFor('text:This pairing code has expired. Make a new one on the computer.')
  expect(app.texts().includes('Link your computer')).toBe(true)
})

test('a pasted code links with the Link button; a refused one says why and keeps the code for another try', async () => {
  const tried: string[] = []
  let refuse = true
  const app = await open('./App.tsx', {
    host: { handlers: { 'link.state': { paired: false }, 'link.pair': (data: { text: string }) => { tried.push(data.text); if (refuse) throw new Error('link/expired'); return paired } } },
    network: { [`POST ${ORIGIN}/api/session/list`]: { body: list } },
  })
  await app.waitFor('text:Link your computer')
  await app.press('id:paste')
  await app.press('id:link-code')
  expect(tried).toEqual([]) // nothing to link yet
  await app.type('id:code', '  dshm1:pasted  ')
  await app.press('id:link-code')
  await app.waitFor('id:link-error')
  expect(app.texts().includes('This pairing code has expired. Make a new one on the computer.')).toBe(true)
  expect(tried).toEqual(['dshm1:pasted'])
  refuse = false
  await app.press('id:link-code')
  await app.waitFor('text:Newest chat')
  expect(tried).toEqual(['dshm1:pasted', 'dshm1:pasted'])
})

test('a pairing link opened while linked that the computer refuses says why, and the phone stays linked', async () => {
  const app = await open('./App.tsx', {
    host: { handlers: { 'link.state': paired, 'link.pair': () => { throw new Error('link/expired') } } },
    network: { [`POST ${ORIGIN}/api/session/list`]: { body: list } },
  })
  await app.waitFor('text:Newest chat')
  await app.host.send('pair', { text: 'dshm1:expired' })
  await app.waitFor('text:This pairing code has expired. Make a new one on the computer.')
  expect(app.texts().includes('Newest chat')).toBe(true)
})

// Automation tasks (schedule/*), opened from the chats page's ⋯ menu.
const ok = (value: unknown) => ({ body: { type: 'server-response', rpcId: 'x', result: { ok: true, value } } })
const queueCheck = { id: 't1', kind: 'every', title: 'Queue check', prompt: 'Synthetic queue prompt', everySeconds: 300, scheduledAt: '2099-01-01T09:00:00.000Z', sessionId: 'new', status: 'active',
  lastDelivery: { scheduledAt: '2026-01-01T08:55:00.000Z', deliveredAt: '2026-01-01T08:55:01.000Z', messageId: 'm3' } }
const releaseReview = { id: 't2', kind: 'at', title: 'Release review', prompt: 'Synthetic release prompt', scheduledAt: '2025-01-01T09:00:00.000Z', sessionId: 'old', status: 'inactive' }
const args = (body: string | undefined) => JSON.parse(body ?? '{}').payload?.args
const openTasks = async (network: Record<string, unknown>) => {
  const app = await open('./App.tsx', { host: { handlers: { 'link.state': paired } }, network: { [`POST ${ORIGIN}/api/session/list`]: { body: list }, ...network } as any })
  await app.waitFor('text:Newest chat')
  await app.press('id:more')
  await app.press('id:menu-schedules')
  return app
}

test('the ⋯ menu opens the automation tasks: each with how often and when it runs, whether it is enabled, and its last delivery', async () => {
  let sent: unknown
  const app = await openTasks({ [`POST ${ORIGIN}/api/schedule/catalog`]: (req: { body?: string }) => { sent = args(req.body); return ok([releaseReview, queueCheck]) } })
  await app.waitFor('text:Queue check')
  const texts = app.texts()
  expect(sent).toEqual({})
  expect(texts.indexOf('Queue check') < texts.indexOf('Release review')).toBe(true)
  for (const t of ['Every 5 minutes', 'Enabled', 'Once', 'Inactive', 'Not sent yet']) expect(texts.includes(t)).toBe(true)
  expect(texts.some((t) => t.startsWith('Next run: '))).toBe(true)
  expect(texts.some((t) => t.startsWith('Last sent: '))).toBe(true)
})

test('a task opens to its delivery records, newest first, and loads earlier ones on request', async () => {
  const asked: any[] = []
  const record = (n: number) => ({ scheduledAt: `2026-01-0${n}T09:00:00.000Z`, deliveredAt: `2026-01-0${n}T09:00:01.000Z`, messageId: `m${n}`, prompt: `Synthetic run ${n}` })
  const app = await openTasks({
    [`POST ${ORIGIN}/api/schedule/catalog`]: ok([queueCheck]),
    [`POST ${ORIGIN}/api/schedule/history`]: (req: { body?: string }) => {
      const a = args(req.body); asked.push(a)
      return ok(a.request.before ? { id: 't1', records: [record(1)], earlierRecordsUnavailable: false, earlierRecordsPruned: false, retention: { days: 30, records: 200 } }
        : { id: 't1', records: [record(3), record(2)], earlierRecordsUnavailable: false, earlierRecordsPruned: false, retention: { days: 30, records: 200 }, nextBefore: 'm2' })
    },
  })
  await app.waitFor('text:Queue check')
  await app.press('id:schedule-t1')
  await app.waitFor('text:Synthetic run 3')
  expect(app.texts().indexOf('Synthetic run 3') < app.texts().indexOf('Synthetic run 2')).toBe(true)
  expect(asked[0]).toEqual({ request: { sessionId: 'new', id: 't1', limit: 20 } })
  await app.press('id:schedule-more')
  await app.waitFor('text:Synthetic run 1')
  expect(asked[1]).toEqual({ request: { sessionId: 'new', id: 't1', limit: 20, before: 'm2' } })
  expect(app.texts().includes('Load more')).toBe(false)
})

test('deleting a task asks first; confirmed, the computer deletes it and it leaves the list', async () => {
  let removed: unknown
  const app = await openTasks({
    [`POST ${ORIGIN}/api/schedule/catalog`]: () => ok(removed ? [releaseReview] : [queueCheck, releaseReview]),
    [`POST ${ORIGIN}/api/schedule/history`]: ok({ id: 't1', records: [], earlierRecordsUnavailable: false, earlierRecordsPruned: false, retention: { days: 30, records: 200 } }),
    [`POST ${ORIGIN}/api/schedule/delete`]: (req: { body?: string }) => { removed = args(req.body); return ok({ id: 't1', deleted: true }) },
  })
  await app.waitFor('text:Queue check')
  await app.press('id:schedule-t1')
  await app.waitFor('text:No delivery record available')
  await app.press('id:schedule-delete')
  await app.waitFor('text:Delete this task?')
  expect(removed).toBe(undefined)
  await app.press('id:schedule-delete-confirm')
  await app.waitUntil(() => !app.texts().includes('Queue check'))
  expect(removed).toEqual({ request: { sessionId: 'new', id: 't1' } })
  expect(app.texts().includes('Release review')).toBe(true)
})

test('a failed read says why and tries again; no tasks says where they come from', async () => {
  let reads = 0
  const app = await openTasks({ [`POST ${ORIGIN}/api/schedule/catalog`]: () => (++reads === 1 ? { status: 502, body: '' } : ok([])) })
  await app.waitFor('text:The computer answered with an error (502). Try again.')
  await app.press('id:schedules-retry')
  await app.waitFor('text:No tasks yet. Tasks created in your sessions appear here.')
  expect(app.texts().includes('The computer answered with an error (502). Try again.')).toBe(false)
})

test('a chat\'s ⋯ menu opens its workspace files; a file mentioned there lands in that chat\'s draft', async () => {
  const listed: unknown[] = []
  const app = await open('./App.tsx', {
    host: { handlers: { 'link.state': paired } },
    network: {
      [`POST ${ORIGIN}/api/session/list`]: { body: list },
      [`POST ${ORIGIN}/api/workspaceFiles/list`]: (req) => { listed.push(JSON.parse(req.body ?? '{}').payload.args); return { body: { type: 'server-response', rpcId: 'x', result: { ok: true, value: { path: '', truncated: false, entries: [{ name: 'out.zip', type: 'file', size: 10 }] } } } } },
    },
  })
  await app.waitFor('text:Newest chat')
  await app.press('text:Newest chat')
  await app.press('id:chat-more')
  await app.press('id:menu-files')
  await app.waitFor('text:out.zip')
  expect(listed[0]).toEqual({ workspaceFileScopeId: 'new', path: '.' })
  await app.press('text:out.zip')
  await app.press('id:mention')
  await app.waitUntil(() => app.value('id:composer') === '@out.zip ')
  expect(app.value('id:composer')).toBe('@out.zip ')
})

// The connection's state with what each part answers (src/status.tsx, src/state.ts look).
const unreachable = (handlers: Record<string, unknown>, network: Record<string, unknown> = {}) => open('./App.tsx', {
  host: { handlers: { 'link.state': paired, ...handlers } },
  network: { [`POST ${ORIGIN}/api/session/list`]: { body: list }, ...network } as any,
})

test('a network that blocks the relay is said on the chats page', async () => {
  const app = await unreachable({ 'link.diagnose': { relay: 'unreachable', computer: 'unreachable' } })
  await app.waitFor('text:This network can’t reach the relay', { timeout: 12_000 })
})

test('a computer that refuses this phone is said, without retrying, and the phone can link again', async () => {
  let diagnosed = 0
  const app = await unreachable({ 'link.diagnose': () => { diagnosed++; return { relay: 'reachable', computer: 'reachable' } }, 'link.forget': null },
    { 'GET http://127.0.0.1:40001/v1/capabilities': { status: 401, body: '' } })
  await app.waitFor('text:This phone is no longer linked', { timeout: 12_000 })
  expect(app.texts()).toContain('Not retrying')
  expect(diagnosed > 0).toBe(true)
  await app.press('id:relink')
  await app.waitFor('text:Link your computer')
})

test('relinking does not wait for a computer that does not answer: the link screen is up while the computer is still being told', async () => {
  let upWhileTelling = false
  const app: any = await unreachable({ 'link.diagnose': { relay: 'reachable', computer: 'reachable' },
    'link.forget': () => new Promise((answer) => setTimeout(() => { upWhileTelling = app.texts().includes('Link your computer'); answer(null) }, 1_000)) },
    { 'GET http://127.0.0.1:40001/v1/capabilities': { status: 401, body: '' } })
  await app.waitFor('text:This phone is no longer linked', { timeout: 12_000 })
  await app.press('id:relink')
  await app.waitFor('text:Link your computer')
  expect(upWhileTelling).toBe(true)
})

// Linking again while the chats page is up (a pairing link opened from outside) replaces the connection under it. Seen on
// the emulator on 2026-11-03: chats came back through their poll, but workspace/follow stayed on the closed connection, so
// every chat sat under Other and New chat offered no workspace.
test('a new link while on the chats page: the workspaces come from the new connection', async () => {
  const app = await open('./src/fixtures/relinked/App.tsx', {
    host: { handlers: { 'link.state': { paired: true, origin: ORIGIN, token: 'one' }, 'link.pair': { paired: true, origin: ORIGIN, token: 'two' } } },
    network: { [`POST ${ORIGIN}/api/session/list`]: { body: { type: 'server-response', rpcId: 'x', result: { ok: true, value: { items: [] } } } } },
  })
  await app.press('id:new-chat')
  await app.waitFor('text:linked-one')
  await app.host.send('pair', { text: 'dshm1:another' })
  await app.waitFor('text:linked-two')
  expect(app.texts().includes('linked-one')).toBe(false)
})

test('a new link while a chat is open: back to the new computer\'s chats', async () => {
  const app = await open('./src/fixtures/relinked/App.tsx', {
    host: { handlers: { 'link.state': { paired: true, origin: ORIGIN, token: 'one' }, 'link.pair': { paired: true, origin: ORIGIN, token: 'two' } } },
    network: { [`POST ${ORIGIN}/api/session/list`]: { body: list } },
  })
  await app.waitFor('text:Newest chat')
  await app.press('text:Newest chat')
  await app.waitFor('id:chat-more')
  await app.host.send('pair', { text: 'dshm1:another' })
  await app.waitFor('id:new-chat')
  expect(app.shows('id:chat-more')).toBe(false)
})
