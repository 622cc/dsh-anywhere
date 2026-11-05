import { expect, open, test } from 'nsh/test'

test('the to-do list opens from its header and folds from it again', async () => {
  const app = await open('./fixtures/todos.tsx')
  await app.press('id:todos-toggle')
  await app.waitFor('text:Fix the bug')
  await app.press('id:todos-toggle')
  await app.waitUntil(() => !app.texts().includes("Fix the bug"))
  expect(app.texts().includes('Fix the bug')).toBe(false)
})

test('touching the chat (a drag or a tap) folds an open to-do list', async () => {
  const app = await open('./fixtures/todos.tsx')
  await app.press('id:todos-toggle')
  await app.waitFor('text:Fix the bug')
  await app.drag('id:message', { x: 0, y: 30 })
  await app.waitUntil(() => !app.texts().includes("Fix the bug"))
  expect(app.texts().includes('Fix the bug')).toBe(false)
})

test('the open list grows upward, so the header moves away from the finger: a press on the list folds it too', async () => {
  const app = await open('./fixtures/todos.tsx')
  await app.press('id:todos-toggle')
  await app.waitFor('text:Fix the bug')
  await app.press('id:todo-list')
  await app.waitUntil(() => !app.texts().includes('Fix the bug'))
  expect(app.texts().includes('Fix the bug')).toBe(false)
})
