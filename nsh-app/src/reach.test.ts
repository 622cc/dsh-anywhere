// Why the phone can't reach the computer, from what each part answers. The state on screen all
// the time, whether it is retrying, and why: a slow network, a pairing no longer valid, a blocked network.
import { expect, test } from 'nsh/test'
import { causeOf, SLOW_MS } from './reach.ts'

const offline = { connection: 'offline' as const, network: true }

test('no network on the phone comes first, whatever else is known', () => {
  expect(causeOf({ connection: 'offline', network: false, check: { relay: 'reachable', computer: 'reachable' } })).toBe('no-network')
})

test('nothing checked yet is only trying', () => {
  expect(causeOf({ connection: 'connecting', network: true })).toBe('trying')
  expect(causeOf(offline)).toBe('trying')
})

test('a relay the network does not let through is a blocked network', () => {
  expect(causeOf({ ...offline, check: { relay: 'unreachable', computer: 'unreachable' } })).toBe('blocked')
})

test('a relay that answers and a computer that does not is the computer', () => {
  expect(causeOf({ ...offline, check: { relay: 'reachable', computer: 'unreachable' } })).toBe('computer')
})

test('a computer that answers and refuses this phone is the pairing, also on a live connection', () => {
  expect(causeOf({ ...offline, check: { relay: 'reachable', computer: 'reachable', access: 'refused' } })).toBe('refused')
  expect(causeOf({ connection: 'online', network: true, check: { access: 'refused' } })).toBe('refused')
})

test('a computer that answers while the companion does not is the companion', () => {
  expect(causeOf({ ...offline, check: { relay: 'reachable', computer: 'reachable', access: 'failed' } })).toBe('companion')
})

test('everything answers and the socket is not back yet is still trying', () => {
  expect(causeOf({ ...offline, check: { relay: 'reachable', computer: 'reachable', access: 'ok' } })).toBe('trying')
})

test('online is connected, or slow from the time an answer takes', () => {
  expect(causeOf({ connection: 'online', network: true })).toBe('connected')
  expect(causeOf({ connection: 'online', network: true, check: { access: 'ok', latencyMs: SLOW_MS - 1 } })).toBe('connected')
  expect(causeOf({ connection: 'online', network: true, check: { access: 'ok', latencyMs: SLOW_MS } })).toBe('slow')
})
