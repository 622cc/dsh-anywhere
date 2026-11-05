import { expect, open, test } from 'nsh/test'

// An expired provider key failed three turns and the chat showed nothing under the messages.
test('a failed turn shows Desktop’s row: the title, the reason in words, and the code (none for an interruption)', async () => {
  const app = await open('./fixtures/failure.tsx', { locale: 'en-US' })
  await app.waitFor('text:API key is invalid')
  const texts = app.texts()
  expect(texts.includes('This turn failed')).toBe(true)
  expect(texts.includes('AUTH')).toBe(true)
  expect(texts.includes('Task stopped')).toBe(true)
  expect(texts.includes('INTERRUPTED')).toBe(false)
})
