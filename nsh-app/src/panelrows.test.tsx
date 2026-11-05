import { expect, open, test } from 'nsh/test'

// The panel's "Pin to the chat" text started 4 pt right of the section
// headings above it (a 12 pt gap after its icon, 8 pt after theirs).
test('the Pin row’s text starts where the section headings’ text does', async () => {
  const app = await open('./fixtures/panelrows.tsx')
  await app.waitUntil(() => ['section', 'pin'].every((k) => app.storage()[k]))
  expect(Number(app.storage().pin)).toBe(Number(app.storage().section))
})
