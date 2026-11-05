// The phone tells the person about chats they are not looking at (src/notify.tsx): a banner in the app, the system
// notification while the app is away, nothing for the chat on screen; a notification's tap opens its chat.
// Headless only: the test plays the shell (host.handlers), which `--target` runs do not have.
import { expect, open, test } from 'nsh/test'

const ORIGIN = 'http://127.0.0.1:40001/dsh'
const paired = { paired: true, origin: ORIGIN, token: 'synthetic-device-token' }
const chat = (sessionId: string, title: string, running: boolean, updatedAt: number) =>
  ({ sessionId, updatedAt, running, blank: false, cwd: '/w/alpha', projections: { asOfSeq: 1, values: { title, turnOutline: running ? [] : [{ turn: 1, seq: 4, prompt: 'Fix it', response: 'The build passes again.' }] } } })
const listOf = (items: unknown[]) => ({ type: 'server-response', rpcId: 'x', result: { ok: true, value: { items } } })

/** The app over a chat list that `running` decides at each look, with the shell's notify.* answered and recorded. */
async function start(running: { build: boolean; notes: boolean }, active = true, read: string[] = []) {
  const app = await open('../App.tsx', {
    clock: {},
    host: { handlers: {
      'link.state': paired, 'app.state': { active }, 'notify.show': { shown: true }, 'notify.clear': null, 'notify.watch': null,
      'notify.request': { granted: true }, 'notify.permission': { granted: true },
    } },
    network: {
      [`POST ${ORIGIN}/api/session/list`]: () => ({ body: listOf([chat('build', 'Fix the build', running.build, 2_000), chat('notes', 'Release notes', running.notes, 1_000)]) }),
      // The chat that opens reads its own projections: which chat is open.
      [`POST ${ORIGIN}/api/session/projections`]: (req) => { read.push(JSON.parse(req.body ?? '{}').payload.args.request.sessionId); return { status: 500, body: '' } },
    },
  })
  await app.clock.runFor(100)
  await app.waitFor('text:Fix the build')
  return app
}
const calls = (app: Awaited<ReturnType<typeof start>>, name: string) => app.host.calls().filter((c) => c.name === name).map((c) => c.data)

test('away from the app, a chat that finishes posts the system notification; the watch ends with the last running chat', async () => {
  const running = { build: true, notes: false }
  const app = await start(running, false)
  await app.clock.runFor(4_100)
  expect(calls(app, 'notify.watch').at(-1)).toEqual({ title: 'An agent is working', body: 'Fix the build' })
  running.build = false
  await app.clock.runFor(4_100)
  await app.clock.runFor(1_600) // the answer's preview is read once more
  expect(calls(app, 'notify.show')).toEqual([{ id: 'build', kind: 'answer', title: 'Fix the build', body: 'The build passes again.' }])
  expect(calls(app, 'notify.watch').at(-1)).toBe(null)
  expect(app.shows('id:attention-banner')).toBe(false)
})

test('in the app, another chat’s answer is a banner, not a notification; its tap opens that chat', async () => {
  const running = { build: true, notes: false }
  const app = await start(running)
  await app.clock.runFor(4_100)
  running.build = false
  await app.clock.runFor(5_700)
  await app.waitFor('id:attention-banner')
  expect(app.shows('text:The build passes again.')).toBe(true)
  expect(calls(app, 'notify.show')).toEqual([])
  await app.press('id:attention-banner')
  await app.waitFor('id:composer')
  expect(app.shows('id:attention-banner')).toBe(false)
  expect(calls(app, 'notify.clear').some((d) => (d as { id?: string }).id === 'build')).toBe(true) // the chat on screen: its notification goes
})

test('the chat on screen gets no word when its answer is ready', async () => {
  const running = { build: true, notes: false }
  const app = await start(running)
  await app.press('text:Fix the build')
  await app.waitFor('id:composer')
  await app.clock.runFor(4_100)
  running.build = false
  await app.clock.runFor(5_700)
  expect(app.shows('id:attention-banner')).toBe(false)
  expect(calls(app, 'notify.show')).toEqual([])
})

test('the person’s own chat starting to work is when the phone asks, once, whether it may notify', async () => {
  const running = { build: false, notes: false }
  const app = await start(running)
  await app.press('text:Fix the build')
  await app.waitFor('id:composer')
  await app.clock.runFor(4_100)
  expect(calls(app, 'notify.request')).toEqual([])
  running.build = true
  await app.clock.runFor(4_100)
  running.build = false
  await app.clock.runFor(4_100)
  running.build = true
  await app.clock.runFor(4_100)
  expect(calls(app, 'notify.request').length).toBe(1)
})

test('a tapped notification opens its chat from any page', async () => {
  const read: string[] = []
  const app = await start({ build: false, notes: false }, true, read)
  await app.press('text:Fix the build')
  await app.waitFor('id:composer')
  await app.host.send('notify.open', { id: 'notes' })
  await app.clock.runFor(500)
  expect(read.at(-1)).toBe('notes')
})

test('a notification that started the app opens its chat', async () => {
  const app = await open('../App.tsx', {
    host: { params: { open: 'notes' }, handlers: { 'link.state': paired, 'app.state': { active: true }, 'notify.clear': null, 'notify.watch': null } },
    network: { [`POST ${ORIGIN}/api/session/list`]: { body: listOf([chat('notes', 'Release notes', false, 1_000)]) } },
  })
  await app.waitFor('id:composer')
})

