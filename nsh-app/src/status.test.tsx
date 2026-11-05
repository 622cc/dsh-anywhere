// What the bar under each header says about reaching the computer (src/status.tsx).
import { expect, open, test } from 'nsh/test'

const start = () => open('./fixtures/connection.tsx', { clock: {} })
const bar = (app: Awaited<ReturnType<typeof start>>) => app.texts().find((t) => t.startsWith('Can’t reach') || t.startsWith('Connecting') || t.startsWith('No network')) ?? null
const late = async (app: Awaited<ReturnType<typeof start>>, step: string) => { await app.clock.runFor(100); await app.press(`id:${step}`); await app.clock.runFor(3_100) }

// Seen on the Android emulator: back from the background, the connection of before had died and the first new try
// failed too, and the red "Can’t reach your computer" showed for the second it took to get through.
test('a connection lost and found again within a few seconds says nothing', async () => {
  const app = await start()
  await app.clock.runFor(100)
  await app.press('id:offline'); await app.clock.runFor(1_000)
  expect(bar(app)).toBe(null)
  await app.press('id:connecting'); await app.clock.runFor(1_000)
  await app.press('id:online'); await app.clock.runFor(5_000)
  expect(bar(app)).toBe(null)
})

// Seen on the Android emulator: the connection failed while the app was away, so the red bar was already there when it
// came back, and stayed until the next retry, up to 15 seconds later.
test('back on screen, a connection that failed while away gets a few seconds again before the bar says so', async () => {
  const app = await start()
  await app.clock.runFor(100)
  await app.press('id:away'); await app.press('id:offline'); await app.clock.runFor(60_000)
  await app.press('id:back'); await app.clock.runFor(2_000)
  expect(bar(app)).toBe(null)
  await app.clock.runFor(1_100)
  expect(bar(app)).toBe('Can’t reach your computer. Retrying…')
})

test('a computer still out of reach after a few seconds is said, with a way to try again', async () => {
  const app = await start()
  await app.clock.runFor(100)
  await app.press('id:offline'); await app.clock.runFor(3_100)
  expect(bar(app)).toBe('Can’t reach your computer. Retrying…')
  expect(app.texts()).toContain('Try again')
  await app.press('id:online'); await app.clock.runFor(100)
  expect(bar(app)).toBe(null)
})

test('trying for a few seconds says it is still trying', async () => {
  const app = await start()
  await app.clock.runFor(100)
  await app.press('id:connecting'); await app.clock.runFor(3_100)
  expect(bar(app)).toBe('Connecting to your computer…')
})

test('a phone without a network says so at once', async () => {
  const app = await start()
  await app.clock.runFor(100)
  await app.press('id:no-network'); await app.clock.runFor(100)
  expect(bar(app)).toBe('No network on this phone')
})

// Not having to open Settings to see the connection, whether it retries, and why it fails.
for (const [step, title, why] of [
  ['blocked', 'This network can’t reach the relay', 'Try another Wi-Fi or mobile data'],
  ['computer', 'Your computer isn’t answering', 'Check that it is on, awake, and DSH is running'],
  ['companion', 'DSH on your computer isn’t answering', 'Open DSH on your computer again'],
] as const) {
  test(`${step}: the bar says why and when it tries again, and the sheet says what to do`, async () => {
    const app = await start()
    await late(app, step)
    await app.waitFor(`text:${title}`)
    await app.press('id:next-try')
    await app.clock.runFor(100)
    expect(app.texts().some((t) => /^Retrying in \d+ s$/.test(t))).toBe(true)
    await app.press('id:reconnect')
    await app.waitFor('text:retried:1 relinked:0')
    await app.press('id:connection')
    await app.clock.runFor(400)
    expect(app.texts().some((t) => t.includes(why))).toBe(true)
  })
}

test('a computer that refuses this phone: no more retries, and a way to link again', async () => {
  const app = await start()
  await late(app, 'refused')
  await app.waitFor('text:This phone is no longer linked')
  expect(app.texts()).toContain('Not retrying')
  expect(app.texts()).not.toContain('Try again')
  await app.press('id:relink')
  await app.waitFor('text:retried:0 relinked:1')
})

test('the chats page always shows the state, how it goes included; a chat only a problem, with the dot in its header', async () => {
  const app = await start()
  await app.clock.runFor(100)
  expect(app.texts()).not.toContain('Connected')
  expect(app.shows('label:Connection: Connected')).toBe(true)
  await app.press('id:direct')
  await app.press('id:chats')
  await app.clock.runFor(100)
  expect(app.texts()).toContain('Connected · Direct to your computer')
})

test('the chats page keeps saying connected through a short drop, then says what is wrong', async () => {
  const app = await start()
  await app.press('id:chats')
  await app.clock.runFor(100)
  await app.press('id:offline'); await app.clock.runFor(1_000)
  expect(app.texts()).toContain('Connected')
  await app.clock.runFor(2_100)
  expect(app.texts()).not.toContain('Connected')
  expect(bar(app)).toBe('Can’t reach your computer. Retrying…')
})

test('a slow connection is said while connected, also in a chat', async () => {
  const app = await start()
  await late(app, 'slow')
  await app.waitFor('text:Connection is slow')
  await app.press('id:connection')
  await app.clock.runFor(400)
  expect(app.texts()).toContain('About 2400 ms')
})

test('the dot opens the sheet, which goes through each part', async () => {
  const app = await start()
  await late(app, 'computer')
  await app.press('id:connection-dot')
  await app.clock.runFor(400)
  for (const t of ['Phone’s network', 'Relay', 'Your computer', 'Pairing']) expect(app.texts()).toContain(t)
})

// A computer that is off and one that removed this phone look the same to the tunnel, so both ways out are offered.
test('a computer not answering can also be linked again from the sheet', async () => {
  const app = await start()
  await late(app, 'computer')
  await app.press('id:connection')
  await app.clock.runFor(400)
  await app.press('id:reach-relink')
  await app.waitFor('text:retried:0 relinked:1')
})

