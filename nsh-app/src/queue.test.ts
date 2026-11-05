// Messages waiting for the agent: DSH keeps them in the session's inbox (the `inbox` projection of the follow
// snapshot, then agent/inbox/spliced events). Shapes are DSH 0.2.1-rc.3's (dsh-agent-loop inbox projection).
import { expect, test } from 'nsh/test'
import { inboxOf, queued, splice, waiting } from './queue.ts'
import type { Outgoing } from './outbox.ts'

const message = (id: string, text: string, kind = 'user', rpcId?: string) => ({ id, role: 'user', content: [{ type: 'text', text }], source: { kind, ...(rpcId ? { rpcId } : {}) } })
const sent = (id: string, text: string, state: Outgoing['state'], held = true): Outgoing => ({ id, text, drafts: [], state, ahead: 0, held })

test('the queue lists what the person typed: steering first, then the next turn; other pending input is left out', () => {
  const inbox = inboxOf({ 'next-turn': [message('m1', 'then run the tests', 'user', 'r1')], 'next-step': [message('m2', 'use pnpm', 'user', 'r2'), message('m3', 'Answer: yes', 'user-question-reply')] })
  expect(queued(inbox)).toEqual([{ id: 'm2', text: 'use pnpm', rpcId: 'r2', steering: true }, { id: 'm1', text: 'then run the tests', rpcId: 'r1', steering: false }])
  expect(queued(inboxOf(undefined))).toEqual([])
  expect(queued(inboxOf({ 'next-turn': 'broken' }))).toEqual([])
})

test('splices insert, remove and replace items as DSH applies them', () => {
  let inbox = inboxOf(undefined)
  inbox = splice(inbox, { target: 'next-turn', start: 0, inserted: [message('m1', 'one'), message('m2', 'two')] })
  inbox = splice(inbox, { target: 'next-turn', start: 0, removedCount: 1, inserted: [] })
  expect(queued(inbox).map((q) => q.text)).toEqual(['two'])
  inbox = splice(inbox, { target: 'next-turn', start: 0, removedCount: 1, inserted: [message('m2', 'two, edited')] })
  inbox = splice(inbox, { target: 'next-step', start: 0, inserted: [message('m3', 'steer')] })
  expect(queued(inbox).map((q) => [q.text, q.steering])).toEqual([['steer', true], ['two, edited', false]])
  expect(splice(inbox, { target: 'elsewhere', start: 0, inserted: [] })).toBe(inbox)
  expect(splice(inbox, { target: 'next-turn', start: 5, inserted: [] })).toBe(inbox)
})

test('a message sent while the agent works waits in the queue: "sending" until DSH has it, then the item itself', () => {
  const inbox = inboxOf({ 'next-turn': [message('m1', 'next', 'user', 'phone-1')], 'next-step': [] })
  const outbox = [sent('phone-1', 'next', 'queued'), sent('phone-2', 'after that', 'sending'), sent('phone-3', 'idle send', 'queued', false)]
  expect(waiting(inbox, outbox).map((w) => [w.text, w.state])).toEqual([['next', 'queued'], ['after that', 'sending']])
  expect(waiting(inbox, outbox)[0]!.item?.id).toBe('m1')
})

test('a message sent to an idle agent passes through the inbox without showing in the queue', () => {
  const inbox = inboxOf({ 'next-turn': [message('m1', 'hello', 'user', 'phone-1')], 'next-step': [] })
  expect(waiting(inbox, [sent('phone-1', 'hello', 'queued', false)])).toEqual([])
})
