// Try it, on the pairing screen: the whole app on sample data on this phone, for someone with no computer to link, such
// as an App Store reviewer. No pairing, no socket, no request: every test ends by checking that.
import { expect, open, test, type App } from 'nsh/test'

const PRIVACY = 'https://dsh-anywhere.jingtao.io/privacy/'
const trying = async (extra: Record<string, unknown> = {}) => {
  const app = await open('./fixtures/tryit/App.tsx', { host: { handlers: { 'link.state': { paired: false }, ...extra } }, network: {} })
  await app.waitFor('id:try-it')
  await app.press('id:try-it')
  await app.waitFor('id:try-banner')
  return app
}
const stayedOnThePhone = (app: App) => {
  expect(app.requests().map((r) => r.url)).toEqual([])
  expect(app.host.posts().filter((p) => p.name === 'test.socket')).toEqual([])
  expect(app.host.calls().map((c) => c.name).filter((n) => /^(link\.(pair|scan|forget|reset|path|diagnose)|ui\.open|files\.pick)$/.test(n))).toEqual([])
}

test('the pairing screen offers Try it, and it lists sample chats without pairing or any network', async () => {
  const app = await trying()
  await app.waitFor('text:Fix the failing login test')
  expect(app.texts().includes('Delete the old build folder')).toBe(true)
  expect(app.texts().includes('Pick a name for the release')).toBe(true)
  expect(app.shows('id:scan')).toBe(false)
  stayedOnThePhone(app)
})

test('the sample notice is the first thing seen: no attention banner covers it, and no notification is asked for', async () => {
  const app = await trying()
  await app.waitFor('text:Pick a name for the release')
  await new Promise((done) => setTimeout(done, 1_500))
  expect(app.shows('id:attention-banner')).toBe(false)
  expect(app.shows('id:try-banner')).toBe(true)
  expect(app.host.calls().map((c) => c.name).filter((n) => n.startsWith('notify'))).toEqual([])
  stayedOnThePhone(app)
})

test('a sample chat reads as a real one: the person, what the agent did, the answer', async () => {
  const app = await trying()
  await app.press('text:Fix the failing login test')
  await app.waitFor('text:The test expected the old error message. I updated it, and all 24 tests pass.')
  expect(app.texts().includes('The login test fails. Can you fix it?')).toBe(true)
  stayedOnThePhone(app)
})

test('a message sent in a sample chat gets a sample answer that says what the real app would do', async () => {
  const app = await trying()
  await app.press('text:Fix the failing login test')
  await app.waitFor('id:composer')
  await app.type('id:composer', 'Hello from the review')
  await app.press('id:send')
  await app.waitFor('text:Hello from the review')
  await app.waitFor('text:This is a sample answer. In the real app, your message goes to the agent on your computer and its answer comes back here.')
  stayedOnThePhone(app)
})

test('an approval waits in a sample chat; Allow lets the agent go on, and it does not ask again', async () => {
  const app = await trying()
  await app.press('text:Delete the old build folder')
  await app.waitFor('id:allow')
  await app.press('id:allow')
  await app.waitFor('text:Done. The old build folder is gone.')
  expect(app.shows('id:allow')).toBe(false)
  stayedOnThePhone(app)
})

test('Reject stops the agent there', async () => {
  const app = await trying()
  await app.press('text:Delete the old build folder')
  await app.waitFor('id:reject')
  await app.press('id:reject')
  await app.waitFor('text:OK, I left the folder alone.')
  stayedOnThePhone(app)
})

test('a question waits in a sample chat; the answer goes into the agent\'s reply', async () => {
  const app = await trying()
  await app.waitFor('text:Pick a name for the release')
  await app.press('text:Pick a name for the release >> nth=0')
  await app.waitFor('id:option-name-Harbor')
  await app.press('id:option-name-Harbor')
  await app.press('id:submit-answer')
  await app.waitFor('text:Good choice. The release is now called Harbor.')
  stayedOnThePhone(app)
})

test('a new chat starts, answers, and joins the list', async () => {
  const app = await trying()
  await app.press('id:new-chat')
  await app.waitFor('id:start-chat')
  await app.press('id:start-chat')
  await app.waitFor('id:composer')
  await app.type('id:composer', 'A new question')
  await app.press('id:send')
  await app.waitFor('text:This is a sample answer. In the real app, your message goes to the agent on your computer and its answer comes back here.')
  stayedOnThePhone(app)
})

test('every page a chat opens works on the sample: files, a file, trajectory, details, terminals', async () => {
  const app = await trying()
  await app.press('text:Fix the failing login test')
  await app.waitFor('id:chat-more')
  for (const page of ['files', 'trajectory', 'details', 'terminal']) {
    const item = `text:${{ files: 'Files', trajectory: 'Trajectory', details: 'Details', terminal: 'Terminal' }[page]}`
    // App.tsx ignores ⋯ for 300 ms after its menu closes, however late the close comes on a busy machine.
    for (let tries = 0; tries < 20 && !app.shows(item); tries++) {
      await app.press('id:chat-more')
      await new Promise((done) => setTimeout(done, 400))
    }
    await app.press(item)
    if (page === 'files') {
      await app.waitFor('text:README.md')
      await app.press('text:README.md')
      await app.waitFor('text:# Sample project')
      await app.back()
    }
    await app.waitFor(`text:${{ files: 'README.md', trajectory: 'Turn 1', details: 'Context', terminal: 'No terminals in this chat yet.' }[page]}`)
    await app.back()
    await app.waitFor('id:chat-more')
  }
  stayedOnThePhone(app)
})

test('schedules list a sample task, and attaching a file says it needs a computer instead of opening the picker', async () => {
  const app = await trying()
  await app.press('id:more')
  await app.press('text:Automation tasks')
  await app.waitFor('text:Check dependencies')
  await app.back()
  await app.press('text:Fix the failing login test')
  await app.waitFor('id:attach')
  await app.press('id:attach')
  await app.press('text:File')
  await app.waitFor('text:Attaching files needs a linked computer.')
  stayedOnThePhone(app)
})

test('with the phone offline, the sample still reads as working', async () => {
  const app = await trying({ 'network.state': { online: false } })
  await app.press('text:Fix the failing login test')
  await app.waitFor('text:The test expected the old error message. I updated it, and all 24 tests pass.')
  expect(app.texts().includes('Your phone is offline')).toBe(false)
  stayedOnThePhone(app)
})

test('Settings says it is a sample and how to leave; leaving goes back to pairing and unlinks nothing', async () => {
  const app = await trying()
  await app.press('id:more')
  await app.press('text:Settings')
  await app.waitFor('text:Sample computer')
  expect(app.shows('id:settings-unlink')).toBe(false)
  await app.press('id:try-exit')
  await app.waitFor('id:scan')
  expect(app.shows('id:try-banner')).toBe(false)
  stayedOnThePhone(app)
})

test('the banner on the chat list leads to pairing, and a real pairing then leaves the sample behind', async () => {
  const paired = { paired: true, origin: 'http://127.0.0.1:40001/dsh', token: 'synthetic-device-token' }
  const app = await trying({ 'link.pair': paired })
  await app.host.send('pair', { text: 'dshm1:synthetic' })
  await app.waitFor('id:new-chat')
  await app.waitUntil(() => !app.shows('id:try-banner'))
  expect(app.host.calls().some((c) => c.name === 'link.pair')).toBe(true)
})

test('Try it is not kept: the next launch opens on pairing', async () => {
  const app = await trying()
  const storage = app.storage()
  const again = await open('./fixtures/tryit/App.tsx', { storage, host: { handlers: { 'link.state': { paired: false } } }, network: {} })
  await again.waitFor('id:scan')
  expect(again.shows('id:try-banner')).toBe(false)
})

test('the privacy policy opens from the pairing screen and from Settings', async () => {
  const app = await open('./fixtures/tryit/App.tsx', { host: { handlers: { 'link.state': { paired: false } } }, network: {} })
  await app.waitFor('id:privacy')
  await app.press('id:privacy')
  expect(app.openedUrls()).toEqual([PRIVACY])
  await app.press('id:try-it')
  await app.waitFor('id:more')
  await app.press('id:more')
  await app.press('text:Settings')
  await app.waitFor('id:settings-privacy')
  await app.press('id:settings-privacy')
  expect(app.openedUrls()).toEqual([PRIVACY, PRIVACY])
})
