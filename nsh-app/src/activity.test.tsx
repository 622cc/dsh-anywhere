import { expect, open, test } from 'nsh/test'

test('the header button keeps the to-dos’ progress in sight, marks running work and shows the context in use', async () => {
  const app = await open('./fixtures/activity.tsx')
  await app.waitFor('id:activity')
  expect(app.texts()).toContain('1/3') // 1 of 3 to-dos completed
  expect(app.shows('id:activity-live')).toBe(true) // a job runs
  expect(app.texts()).toContain('42%')
})

test('the panel reads context, goal, to-dos, subagents, background jobs; the to-dos say how many are done', async () => {
  const app = await open('./fixtures/activity.tsx')
  await app.press('id:activity')
  await app.waitFor('id:activity-panel')
  const t = app.texts()
  const order = ['Context', 'Goal', 'To-dos', 'Subagent sessions', 'Background jobs'].map((x) => t.indexOf(x))
  expect(order.every((i) => i >= 0)).toBe(true)
  expect([...order].sort((x, y) => x - y)).toEqual(order)
  expect(t).toContain('1 of 3 done')
})

test('the panel lists active items and folds the finished ones until asked', async () => {
  const app = await open('./fixtures/activity.tsx')
  await app.press('id:activity')
  await app.waitFor('id:activity-panel')
  // The header button above shows the percentage; the panel adds the counts, once.
  expect(app.shows('text:54K / 128K')).toBe(true)
  expect(app.texts().filter((t) => t.includes('42%')).length).toBe(1)
  expect(app.shows('text:Ship the mobile app')).toBe(true)
  expect(app.shows('text:Active')).toBe(true)
  expect(app.shows('text:Wire the screen')).toBe(true)
  expect(app.shows('text:npm run dev')).toBe(true)
  expect(app.shows('text:Write the parser')).toBe(false)
  expect(app.shows('text:npm test')).toBe(false)
  expect(app.shows('text:Read the docs')).toBe(false)
  await app.press('id:activity-todos-done')
  await app.waitFor('text:Write the parser')
  // What runs breathes: the to-do in progress and the running job, not the pending to-do or the finished ones.
  expect(app.count('id:live-dot')).toBe(3) // and the button's
})

test('a job in the panel opens the jobs sheet and closes the panel', async () => {
  const app = await open('./fixtures/activity.tsx')
  await app.press('id:activity')
  await app.press('text:npm run dev')
  await app.waitFor('text:jobs')
  await app.waitUntil(() => !app.shows('id:activity-panel'))
})

test('pinning moves the whole panel above the message box; unpinning puts it back in the header', async () => {
  const app = await open('./fixtures/activity.tsx')
  expect(app.shows('id:activity-dock')).toBe(false)
  await app.press('id:activity')
  await app.press('id:activity-pin')
  await app.waitFor('id:activity-dock')
  await app.waitUntil(() => !app.shows('id:activity-panel'))
  expect(app.shows('id:activity')).toBe(false) // its button has nothing more to open
  const t = app.texts()
  for (const x of ['Context', 'Goal', 'To-dos', 'Subagent sessions', 'Background jobs', 'Wire the screen', 'npm run dev']) expect(t).toContain(x)
  expect(app.shows('text:npm test')).toBe(false) // finished ones stay folded there too
  await app.press('text:npm run dev')
  await app.waitFor('text:jobs')
  await app.press('id:activity-dock-menu')
  await app.press('id:action-unpin')
  await app.waitUntil(() => !app.shows('id:activity-dock'))
  expect(app.shows('id:activity')).toBe(true)
})

test('while typing, the pinned panel is one line with its progress; a tap opens it until typing stops', async () => {
  const app = await open('./fixtures/activity.tsx')
  await app.press('id:activity')
  await app.press('id:activity-pin')
  await app.waitFor('id:activity-dock')
  await app.press('id:typing')
  await app.waitUntil(() => !app.shows('text:Goal'))
  expect(app.shows('id:activity-dock')).toBe(true)
  expect(app.texts()).toContain('1/3')
  expect(app.texts()).toContain('42%')
  await app.press('id:activity-dock-line')
  await app.waitFor('text:Goal')
  await app.press('id:not-typing')
  await app.press('id:typing')
  await app.waitUntil(() => !app.shows('text:Goal'))
  await app.press('id:activity-dock-menu')
  await app.press('id:action-unpin')
})

test('pinned, the panel has the percentage itself: the header button is gone', async () => {
  const app = await open('./fixtures/activity.tsx')
  await app.press('id:activity')
  await app.press('id:activity-pin')
  await app.waitFor('id:activity-dock')
  await app.waitUntil(() => !app.shows('id:activity'))
  expect(app.shows('text:54K / 128K (42%)')).toBe(true)
  await app.press('id:activity-dock-menu')
  await app.press('id:action-unpin')
})

test('the pinned panel’s menu turns the one line while typing off and on, kept on the phone', async () => {
  const app = await open('./fixtures/activity.tsx')
  await app.press('id:activity')
  await app.press('id:activity-pin')
  await app.press('id:typing')
  await app.waitUntil(() => !app.shows('text:Goal'))
  await app.press('id:activity-dock-menu')
  await app.waitFor('id:action-fold')
  expect(app.shows('id:action-fold-on')).toBe(true) // on unless turned off
  await app.press('id:action-fold')
  await app.waitFor('text:Goal')
  expect(app.storage().activityFold).toBe('0')
  await app.press('id:activity-dock-menu')
  await app.waitFor('id:action-fold')
  expect(app.shows('id:action-fold-on')).toBe(false)
  await app.press('id:action-fold')
  await app.waitUntil(() => !app.shows('text:Goal'))
  expect(app.storage().activityFold).toBe(undefined)
  await app.press('id:activity-dock-menu')
  await app.press('id:action-unpin')
})
