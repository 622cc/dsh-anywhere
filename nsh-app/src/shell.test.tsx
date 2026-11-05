import { expect, open, test } from 'nsh/test'

test('the terminal says what state its shell is in and offers what fits it', async () => {
  const app = await open('./fixtures/terminal.tsx')
  await app.waitFor('text:Connecting…')
  await app.press('id:set-live')
  await app.waitUntil(() => !app.shows('id:terminal-status'))
  await app.press('id:set-readOnly')
  await app.waitFor('text:Another window has the input.')
  await app.press('id:take-control')
  expect(app.value('id:log') ?? app.texts().find((t) => t === 'take')).toBe('take')
  await app.press('id:set-exited')
  await app.waitFor('text:The shell exited with code 3.')
  expect(app.shows('id:take-control')).toBe(false)
  await app.press('id:set-failed')
  await app.waitFor('text:The terminal could not start. boom')
  await app.press('id:terminal-retry')
  await app.waitUntil(() => app.texts().includes('retry'))
})

test('the key bar sends Esc, Tab and the arrows, and Ctrl stays lit until the next key', async () => {
  const app = await open('./fixtures/terminal.tsx')
  for (const k of ['esc', 'tab', 'left', 'down', 'up', 'right']) {
    await app.press(`id:key-${k}`)
    await app.waitUntil(() => app.texts().includes(`key:${k}`))
  }
  await app.press('id:key-ctrl')
  await app.waitUntil(() => app.texts().includes('key:ctrl'))
})

const ORIGIN = 'http://127.0.0.1:40001/dsh'
const paired = { paired: true, origin: ORIGIN, token: 'synthetic-device-token' }
const ok = (value: unknown) => ({ body: { type: 'server-response', rpcId: 'x', result: { ok: true, value } } })
const sessions = ok({ items: [{ sessionId: 's1', updatedAt: 1_000, running: false, blank: false, cwd: '/w/alpha', projections: { asOfSeq: 1, values: { title: 'A chat' } } }] })
const shell = { id: 't1', title: 'zsh', shell: { path: '/bin/zsh', args: [], name: 'zsh' }, cwd: '/w/alpha', cols: 80, rows: 24, state: 'running', exitCode: null }

test('a chat\'s ⋯ menu opens its terminals, which say the shell is outside the agent\'s sandbox, and opens one', async () => {
  let asked: unknown
  const app = await open('../App.tsx', {
    host: { handlers: { 'link.state': paired } },
    network: {
      [`POST ${ORIGIN}/api/session/list`]: sessions,
      [`POST ${ORIGIN}/api/terminal/list`]: (req) => { asked = JSON.parse(req.body!).payload.args; return ok([shell]) },
    },
  })
  await app.press('text:A chat')
  await app.press('id:chat-more')
  await app.press('id:menu-terminal')
  await app.waitFor('text:zsh')
  expect(asked).toEqual({ sessionId: 's1' })
  expect(app.texts()).toContain('Commands run on your computer as your user, without the agent’s sandbox or approvals.')
  expect(app.texts()).toContain('Running, /w/alpha')
  await app.press('id:terminal-t1')
  await app.waitFor('id:terminal-screen')
  expect(app.shows('id:key-esc')).toBe(true)
})

test('no terminals yet says so, and a failed list can be tried again', async () => {
  let reads = 0
  const app = await open('../App.tsx', {
    host: { handlers: { 'link.state': paired } },
    network: {
      [`POST ${ORIGIN}/api/session/list`]: sessions,
      [`POST ${ORIGIN}/api/terminal/list`]: () => (++reads === 1 ? { status: 502, body: '' } : ok([])),
    },
  })
  await app.press('text:A chat')
  await app.press('id:chat-more')
  await app.press('id:menu-terminal')
  await app.waitFor('id:terminals-retry')
  await app.press('id:terminals-retry')
  await app.waitFor('text:No terminals in this chat yet.')
  expect(app.shows('id:new-terminal')).toBe(true)
})
