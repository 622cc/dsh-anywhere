// The action sheet at the bottom (src/ui.tsx chooseAction) over a focused input.
import { expect, open, test } from 'nsh/test'

// Seen on the iOS simulator (2026-10-30): asked while typing, the sheet opened behind the keyboard.
test('asking with the sheet while typing puts the keyboard away first, so the sheet is not behind it', async () => {
  const app = await open('./fixtures/sheet.tsx')
  await app.type('id:field', 'hi')
  expect(app.texts()).not.toContain('left the field')
  await app.press('id:ask')
  await app.waitFor('id:action-one')
  await app.waitFor('text:left the field')
})
