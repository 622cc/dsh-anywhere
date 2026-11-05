// When the phone tells the person about a chat, and where: a finished answer or a question the agent waits on, as a
// banner inside the app or a system notification while the app is away; never for the chat on screen.
import { expect, test } from 'nsh/test'
import { alertsBetween, placeOf, type Seen } from './attention.ts'

const seen = (entries: [string, Partial<Seen>][]) => new Map(entries.map(([id, s]) => [id, { running: false, waiting: false, failed: false, title: id, ...s }]))

test('the first look at the chats tells nothing: what finished before the app looked is not news', () => {
  expect(alertsBetween(undefined, seen([['a', { waiting: true }], ['b', { running: true }]]))).toEqual([])
})

test('a chat that stops running has its answer ready', () => {
  expect(alertsBetween(seen([['a', { running: true }]]), seen([['a', {}]]))).toEqual([{ kind: 'answer', sessionId: 'a', title: 'a' }])
})

test('a chat whose agent starts waiting on the person needs a decision, once', () => {
  const before = seen([['a', { running: true }]]), during = seen([['a', { running: true, waiting: true }]])
  expect(alertsBetween(before, during)).toEqual([{ kind: 'decision', sessionId: 'a', title: 'a' }])
  expect(alertsBetween(during, during)).toEqual([])
})

test('a chat that stops while it still waits on the person reports the decision, not an answer', () => {
  expect(alertsBetween(seen([['a', { running: true, waiting: true }]]), seen([['a', { waiting: true }]]))).toEqual([])
})

test('a question answered, a chat gone: the decision is withdrawn', () => {
  expect(alertsBetween(seen([['a', { running: true, waiting: true }]]), seen([['a', { running: true }]]))).toEqual([{ kind: 'withdrawn', sessionId: 'a', title: 'a' }])
  expect(alertsBetween(seen([['a', { waiting: true }]]), seen([]))).toEqual([{ kind: 'withdrawn', sessionId: 'a', title: 'a' }])
})

test('a chat that appears already running is watched, not announced', () => {
  expect(alertsBetween(seen([]), seen([['n', { running: true }]]))).toEqual([])
  expect(alertsBetween(seen([['n', { running: true }]]), seen([['n', {}]]))).toEqual([{ kind: 'answer', sessionId: 'n', title: 'n' }])
})

test('the chat on screen gets nothing; another chat a banner; with the app away, the system notification', () => {
  const answer = { kind: 'answer' as const, sessionId: 'a', title: 'a' }
  expect(placeOf(answer, { active: true, visible: 'a' })).toBe('none')
  expect(placeOf(answer, { active: true, visible: 'b' })).toBe('banner')
  expect(placeOf(answer, { active: true, visible: undefined })).toBe('banner')
  expect(placeOf(answer, { active: false, visible: 'a' })).toBe('system')
})

test('an answer that ended in an error says it failed', () => {
  expect(alertsBetween(seen([['a', { running: true }]]), seen([['a', { failed: true }]]))).toEqual([{ kind: 'failed', sessionId: 'a', title: 'a' }])
})
