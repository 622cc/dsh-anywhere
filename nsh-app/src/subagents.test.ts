// A chat's subagents, as DSH 0.2.1-rc.3 publishes them: the parent's subagentCatalog projection lists the children;
// session/list says which run (dsh-subagent, dsh-client-ui-subagent).
import { expect, test } from 'nsh/test'
import { addressOf, catalogOf, children, composerOf, followUp, opens } from './subagents.ts'

test('the catalog lists children with their mode; malformed entries are dropped', () => {
  expect(catalogOf([{ id: 'c1', createdAt: 5, mode: 'continuable', label: 'Review' }, { id: 'c2', createdAt: 9, mode: 'nope' }, { createdAt: 1 }]))
    .toEqual([{ id: 'c1', createdAt: 5, mode: 'continuable', label: 'Review' }, { id: 'c2', createdAt: 9, mode: 'unknown' }])
  expect(catalogOf(null)).toEqual([])
})

test('children run as session/list says; newest first', () => {
  const list = { items: [{ sessionId: 'c1', parentSessionId: 'p', origin: 'subagent', running: true }, { sessionId: 'c2', parentSessionId: 'p', origin: 'subagent', running: false }, { sessionId: 'x', running: true }] }
  const kids = children(catalogOf([{ id: 'c1', createdAt: 5, mode: 'one-shot' }, { id: 'c2', createdAt: 9, mode: 'continuable' }]), list)
  expect(kids.map((k) => [k.id, k.running])).toEqual([['c2', false], ['c1', true]])
})

test('a child row is named by its label, else its own title, else its id', () => {
  const list = { items: [{ sessionId: 'c2', projections: { values: { title: 'Scan the logs' } } }] }
  const kids = children(catalogOf([{ id: 'c1', createdAt: 3, mode: 'continuable', label: 'Review' }, { id: 'c2', createdAt: 2, mode: 'one-shot' }, { id: 'c3', createdAt: 1, mode: 'one-shot' }]), list)
  expect(kids.map((k) => k.name)).toEqual(['Review', 'Scan the logs', 'c3'])
})

test('a child is read through the subagent address; an external task reads as unknown mode', () => {
  expect(addressOf('p', { id: 'c', createdAt: 0, mode: 'continuable' })).toEqual({ kind: 'subagent', parentSessionId: 'p', childSessionId: 'c', mode: 'continuable' })
  expect(addressOf('p', { id: 'c', createdAt: 0, mode: 'external' }).mode).toBe('unknown')
})

test('as on Desktop, only a continuable child takes follow-ups; a one-shot one is a record and an unknown one is read-only', () => {
  expect(composerOf('continuable')).toBe('compose')
  expect(composerOf('one-shot')).toBe('one-shot')
  expect(composerOf('unknown')).toBe('read-only')
  expect(composerOf('external')).toBe('read-only')
})

test('external tasks are listed but do not open', () => {
  expect(opens({ id: 'e', createdAt: 0, mode: 'external' })).toBe(false)
  expect(opens({ id: 'c', createdAt: 0, mode: 'one-shot' })).toBe(true)
})

test('a follow-up to a child queues in its inbox through the parent', () => {
  expect(followUp('p', 'c', 'r1', [{ type: 'text', text: 'hi' }])).toEqual({ request: { requestId: 'r1', parentSessionId: 'p', childSessionId: 'c', mode: 'continuable', delivery: 'queue', content: [{ type: 'text', text: 'hi' }] } })
})
