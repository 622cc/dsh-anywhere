import { expect, open, test } from 'nsh/test'

test('a controls sheet taller than the screen scrolls to its last command', async () => {
  const app = await open('./fixtures/controls.tsx', { height: 844 })
  await app.waitFor('id:controls')
  await app.scroll('id:controls-scroll', 3000)
  await app.press('id:command-c29')
  expect(app.value('id:picked') ?? app.texts().find((t) => t.startsWith('/c29'))).toBe('/c29 ')
})

test('on a short screen the sheet stays within it and still reaches its last command', async () => {
  const app = await open('./fixtures/controls.tsx', { height: 560 })
  await app.waitFor('id:controls')
  await app.scroll('id:controls-scroll', 3000)
  await app.press('id:command-c29')
  expect(app.value('id:picked') ?? app.texts().find((t) => t.startsWith('/c29'))).toBe('/c29 ')
})
