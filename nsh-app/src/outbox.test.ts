// A sent message shows at once, before DSH's stream carries it back: "sending" until session/prompt answers,
// "queued" until the message is in the transcript, "failed" (with retry) when DSH refused it.
import { expect, test } from 'nsh/test'
import { awaitingFirstStep, outgoing, outgoingStatus, retext, settle, type Outgoing } from './outbox.ts'
import { S } from './strings.ts'
import type { Row } from './fold.ts'

const user = (id: string, text: string): Row => ({ kind: 'user', id, text, attachments: [], at: 0 })
const answer = (id: string): Row => ({ kind: 'assistant', id, text: 'ok', at: 0, streaming: false })

test('a message waits as sent until its row arrives, then hands its place to that row', () => {
  const before = [user('u1', 'hi'), answer('a1')]
  const out = [outgoing('o1', ' Fix the build ', [], before, [])]
  expect(out[0]!.text).toBe('Fix the build')
  expect(settle(out, before)).toEqual({ outbox: out, arrived: [], started: [] })
  const after = [...before, user('u2', 'Fix the build')]
  expect(settle(out, after)).toEqual({ outbox: [], arrived: [['u2', 'o1']], started: [] })
})

test('the same text sent twice waits for two rows, in order', () => {
  const before = [user('u1', 'again')]
  const first = outgoing('o1', 'again', [], before, [])
  const second = outgoing('o2', 'again', [], before, [first])
  const one = settle([first, second], [...before, user('u2', 'again')])
  expect(one.arrived).toEqual([['u2', 'o1']])
  expect(one.outbox.map((o) => o.id)).toEqual(['o2'])
  expect(settle(one.outbox, [...before, user('u2', 'again'), user('u3', 'again')]).arrived).toEqual([['u3', 'o2']])
})

test('an older row with the same text is not mistaken for the new one', () => {
  const rows = [user('u1', 'yes'), answer('a1'), user('u2', 'yes')]
  const out: Outgoing[] = [outgoing('o1', 'yes', [], rows, [])]
  expect(settle(out, rows).arrived).toEqual([])
})

test('a failed message stays until it is sent again or removed', () => {
  const rows = [user('u1', 'hi')]
  const out: Outgoing[] = [{ ...outgoing('o1', 'hello', [], rows, []), state: 'failed', error: 'offline' }]
  expect(settle(out, rows).outbox[0]!.state).toBe('failed')
})

test('a message sent while the agent works is held for the queue; edited there, it waits for a row with its new text', () => {
  const rows = [user('u1', 'hi')]
  const o = outgoing('o1', 'run the tests', [], rows, [], true)
  expect(o.held).toBe(true)
  const edited = retext(o, ' run the e2e tests ', rows, [o])
  expect(edited.text).toBe('run the e2e tests')
  expect(settle([edited], [...rows, user('u2', 'run the e2e tests')]).arrived).toEqual([['u2', 'o1']])
})

test('a queued message that reaches the chat starts its own turn: the chat goes to it as to a message just sent', () => {
  const rows = [user('u1', 'first'), answer('a1')]
  const queued = outgoing('o2', 'later', [], rows, [], true)
  const r = settle([queued], [...rows, user('u2', 'later')])
  expect(r.arrived).toEqual([['u2', 'o2']])
  expect(r.started).toEqual(['o2'])
})

// DSH gives every prompt back with the requestId it was sent with (user/message source.rpcId; 0.2.1-rc.3
// dsh-api-session-controller prompt(): source = { kind: 'user', rpcId: requestId }).
test('a message is matched to its row by its request id, ahead of a row with the same text from the computer', () => {
  const rows = [user('u1', 'hi')]
  const out = [outgoing('o1', 'hi', [], rows, [])]
  const desktop: Row = { kind: 'user', id: 'u2', text: 'hi', attachments: [], at: 0, rpcId: 'desktop-1' }
  const mine: Row = { kind: 'user', id: 'u3', text: 'hi', attachments: [], at: 0, rpcId: 'o1' }
  expect(settle(out, [...rows, desktop]).arrived).toEqual([])
  expect(settle(out, [...rows, desktop, mine]).arrived).toEqual([['u3', 'o1']])
})

test('where a message is: sending, then delivered (the computer has it), queued behind a running turn, or why it failed', () => {
  const o = { ...outgoing('o1', 'hi', [], [], []), sentAt: 0 }
  expect(outgoingStatus(o, false, 1000)).toEqual({ text: S.sending, failed: false })
  expect(outgoingStatus(o, false, 8000)).toEqual({ text: S.sendingSlow, failed: false })
  const delivered = { ...o, state: 'queued' as const, acceptedAt: 2000 }
  expect(outgoingStatus(delivered, false, 3000)).toEqual({ text: S.delivered, failed: false })
  expect(outgoingStatus(delivered, true, 3000)).toEqual({ text: S.queued, failed: false })
  expect(outgoingStatus(delivered, false, 20000)).toEqual({ text: S.deliveredIdle, failed: false })
  const failed = { ...o, state: 'failed' as const, error: S.errors.network }
  expect(outgoingStatus(failed, false, 3000)).toEqual({ text: S.notSent, reason: S.errors.network, failed: true })
})

test('after a message reaches the chat, the agent shows it is working until its first step shows', () => {
  const think: Row = { kind: 'process', id: 'p1', entries: [], at: 0 } as unknown as Row
  expect(awaitingFirstStep([user('u1', 'hi')], true)).toBe(true)
  expect(awaitingFirstStep([user('u1', 'hi')], false)).toBe(false)
  expect(awaitingFirstStep([user('u1', 'hi'), think], true)).toBe(false)
  expect(awaitingFirstStep([user('u1', 'hi'), answer('a1')], true)).toBe(false)
  expect(awaitingFirstStep([user('u1', 'hi'), answer('a1'), user('u2', 'more')], true)).toBe(true)
  expect(awaitingFirstStep([], true)).toBe(true)
})
