import { expect, open, test } from 'nsh/test'

// Was it sent, did the computer get it, is it working?
test('a sent message says where it is, a failed one says why, and a working agent shows it is on it', async () => {
  const app = await open('./fixtures/sent.tsx', { locale: 'en-US' })
  await app.waitFor('text:Delivered')
  const texts = app.texts()
  expect(texts.includes('Sending…')).toBe(true)
  expect(texts.includes('Not sent. Tap to try again')).toBe(true)
  expect(texts.includes('Can’t reach your computer. Check that it is on and DSH is running.')).toBe(true)
  expect(texts.includes('Analyzing the request · This gives the room id')).toBe(true)
})
