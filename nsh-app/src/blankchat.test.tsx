import { expect, open, test } from 'nsh/test'

// A chat just started read only "New chat", with no sign of the project it was started in.
test('a chat with nothing in it says which project it is in, and where that is', async () => {
  const app = await open('./fixtures/blankchat.tsx')
  await app.waitFor('id:blank-chat')
  expect(app.texts()).toEqual(['payments-api', '/home/me/code/payments-api'])
})
