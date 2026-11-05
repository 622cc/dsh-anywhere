// Where the chat stands after a message is sent (src/scroll.ts, used by chat.tsx): at its end, right above the
// composer, while the sent message and its reply fit on screen; once they outgrow it, the sent message stays at the top.
import { expect, test } from 'nsh/test'
import { followsEnd } from './scroll.ts'

test('a sent message and a reply that fit on screen keep the chat at its end, with no room left under them', () => {
  expect(followsEnd(200, 600)).toBe(true)
  expect(followsEnd(584, 600)).toBe(true) // 16: the list's top and bottom padding
})

test('a reply that outgrows the screen stops following, so the sent message stays at the top to read from', () => {
  expect(followsEnd(585, 600)).toBe(false)
  expect(followsEnd(2000, 600)).toBe(false)
})

test('with nothing sent, or the screen not measured yet, the chat does not move', () => {
  expect(followsEnd(-1, 600)).toBe(false)
  expect(followsEnd(200, 0)).toBe(false)
})
