// The chat's Trajectory and Details pages, opened from its ⋯ menu: what they show, and their loading, empty and error states.
import { expect, open, test } from 'nsh/test'

test('the trajectory shows each turn with its count, and every tool call with its title, status and time', async () => {
  const app = await open('./fixtures/trajectory.tsx')
  await app.waitFor('text:Turn 1')
  const texts = app.texts()
  for (const t of ['2 tool calls', 'Bash', 'Run the tests', 'Completed, 4s', 'Read src/app.ts', 'Failed, 1s', 'Turn 2', '1 tool call', 'Search TODO', 'Running']) expect(texts).toContain(t)
  expect(texts.indexOf('Turn 1') < texts.indexOf('Run the tests') && texts.indexOf('Run the tests') < texts.indexOf('Turn 2')).toBe(true)
  expect(app.count('label:Bash, Run the tests, Completed, 4s')).toBe(1)
})

test('the trajectory says when it is loading, when the chat has no tool calls, and why it failed, with a retry', async () => {
  expect((await open('./fixtures/trajectory.tsx', { host: { params: { state: 'loading' } } })).texts()).toContain('Loading trajectory…')
  expect((await open('./fixtures/trajectory.tsx', { host: { params: { state: 'empty' } } })).texts()).toContain('No tool calls yet')
  const app = await open('./fixtures/trajectory.tsx', { host: { params: { state: 'error' } } })
  expect(app.texts()).toContain('The computer did not answer. Try again.')
  await app.press('id:trajectory-retry')
  await app.waitFor('text:Turn 1')
})

test('details show the model and effort, context use and its parts, the tokens, plan mode, the preset, the goal and the jobs', async () => {
  const app = await open('./fixtures/details.tsx')
  await app.waitFor('text:Model A')
  const texts = app.texts()
  for (const t of ['High', '42% of context used', '~54K / 128K', 'System prompt', '~6K', 'Tool definitions', '~9K', 'Messages', '~39K',
    'Input', '120K', 'Cached', '900K', 'Cache created', '40K', 'Output', '8.5K', 'Plan mode', 'On', 'Permissions', 'Workspace Write',
    'Ship the release', 'Active', 'npm run dev', 'npm test']) expect(texts).toContain(t)
  expect(app.count('label:42% of context used, ~54K / 128K')).toBe(1)
})

test('details of a chat DSH reported nothing for say so; loading and a failure with a retry', async () => {
  const bare = await open('./fixtures/details.tsx', { host: { params: { state: 'bare' } } })
  for (const t of ['Not reported yet', 'No goal', 'No background jobs']) expect(bare.texts()).toContain(t)
  expect(bare.texts().includes('Plan mode')).toBe(false)
  expect((await open('./fixtures/details.tsx', { host: { params: { state: 'loading' } } })).texts()).toContain('Loading…')
  const app = await open('./fixtures/details.tsx', { host: { params: { state: 'error' } } })
  expect(app.texts()).toContain('The computer did not answer. Try again.')
  await app.press('id:details-retry')
  await app.waitFor('text:Model A')
})

test('in the dark theme, on a narrow phone, in Russian, the details still read whole', async () => {
  const app = await open('./fixtures/details.tsx', { colorScheme: 'dark', width: 320, locale: 'ru-RU' })
  await app.waitFor('text:Контекст занят на 42%')
  expect(app.texts()).toContain('Ship the release')
})

const ORIGIN = 'http://127.0.0.1:40001/dsh'
const paired = { paired: true, origin: ORIGIN, token: 'synthetic-device-token' }
const ok = (value: unknown) => ({ body: { type: 'server-response', rpcId: 'x', result: { ok: true, value } } })
const list = ok({ items: [{ sessionId: 's1', updatedAt: 1_000, running: false, blank: false, cwd: '/w/alpha', projections: { asOfSeq: 1, values: { title: 'A chat' } } }] })
const projections = ok({ kind: 'sequenced', asOfSeq: 4, values: { modelSelection: { lastUsed: { provider: 'deepseek', model: 'model-a' }, next: null }, contextPressure: { pressureTokens: 54_000, contextWindow: 128_000 } } })

test('the chat\'s ⋯ menu opens Details, read from session/projections for that chat, and Trajectory', async () => {
  let asked = ''
  const app = await open('../App.tsx', {
    host: { handlers: { 'link.state': paired } },
    network: {
      [`POST ${ORIGIN}/api/session/list`]: list,
      [`POST ${ORIGIN}/api/session/projections`]: (req) => { asked = JSON.parse(req.body!).payload.args.request.sessionId; return projections },
    },
  })
  await app.press('text:A chat')
  await app.press('id:chat-more')
  await app.press('id:menu-details')
  await app.waitFor('text:42% of context used')
  expect(asked).toBe('s1')
  expect(app.texts()).toContain('model-a')
  await app.back()
  await app.wait(400) // ⋯ ignores a press within 300 ms of its menu closing
  await app.press('id:chat-more')
  await app.press('id:menu-trajectory')
  await app.waitFor('text:Loading trajectory…')
})

// A job's status and time, on the details page and in the jobs sheet: Chinese joins them with its own comma and no space.
for (const [where, fixture, ready] of [['details', './fixtures/details.tsx', 'npm test'], ['jobs sheet', './fixtures/jobs.tsx', 'npm test']] as const) {
  for (const [locale, running, finished] of [
    ['zh-Hans-CN', /^运行中，\d+ 秒$/, '已完成，30 秒'],
    ['zh-Hant-TW', /^執行中，\d+ 秒$/, '已完成，30 秒'],
    ['en-US', /^running, \d+s$/, 'completed, 30s'],
    ['ja-JP', /^実行中, \d+\s?秒$/, /^完了, 30\s?秒$/],
  ] as const) {
    test(`${where} in ${locale}: a job's status and time are joined the way the language writes them`, async () => {
      const app = await open(fixture, { locale })
      await app.waitFor(`text:${ready}`)
      const texts = app.texts()
      expect(texts.some((t) => running.test(t))).toBe(true)
      expect(texts.some((t) => (typeof finished === 'string' ? t === finished : finished.test(t)))).toBe(true)
    })
  }
}

test('the jobs sheet in Chinese counts the finished jobs number first', async () => {
  const app = await open('./fixtures/jobs.tsx', { locale: 'zh-Hans-CN' })
  await app.waitFor('text:1 个已结束')
})

// A tool call's status and time on the trajectory page follow the same rule as a job's.
for (const [locale, completed, failed] of [
  ['zh-Hans-CN', '已完成，4 秒', '失败，1 秒'],
  ['zh-Hant-TW', '已完成，4 秒', '失敗，1 秒'],
  ['en-US', 'Completed, 4s', 'Failed, 1s'],
] as const) {
  test(`the trajectory in ${locale}: a tool call's status and time are joined the way the language writes them`, async () => {
    const app = await open('./fixtures/trajectory.tsx', { locale })
    await app.waitFor(`text:${completed}`)
    expect(app.texts()).toContain(failed)
  })
}
