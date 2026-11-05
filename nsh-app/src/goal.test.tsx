import { expect, open, test } from 'nsh/test'

// A phone crashed on tapping the goal field in the controls sheet; run with --target android.
test('tapping the goal field in the controls sheet focuses it and takes typing', async () => {
  const app = await open('./fixtures/controls.tsx', { height: 844 })
  await app.waitFor('id:goal-input')
  await app.type('id:goal-input', 'Ship the iOS app')
  expect(app.value('id:goal-input')).toBe('Ship the iOS app')
  await app.waitFor('id:controls')
})

test('a goal typed in Chinese stays as typed', async () => {
  const app = await open('./fixtures/controls.tsx', { height: 844 })
  await app.waitFor('id:goal-input')
  await app.type('id:goal-input', '测试一下功能')
  expect(app.value('id:goal-input')).toBe('测试一下功能')
})
