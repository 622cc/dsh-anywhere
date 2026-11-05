// What the agent is waiting on (approvals, questions), as DSH's $events stream sends it: a ready frame naming this
// connection, then pending requests, withdrawn by cancel; a new connection resends whatever is still pending.
import { expect, test } from 'nsh/test'
import { Pending, approvalAnswer, questionAnswer } from './events.ts'

const approval = (id: string, agentId = 's1') => ({ type: 'waterfall', event: 'approval/request', eventId: id, agentId, request: { toolName: 'bash', callId: 'c1', reason: 'Runs rm -rf build', displayReason: { en: 'Deletes the build folder', zh: '删除构建目录' } } })
const question = (id: string) => ({ type: 'waterfall', event: 'user-questions/request', eventId: id, agentId: 's1', request: { questions: [{ id: 'q1', question: 'Which database?', options: [{ label: 'SQLite' }, { label: 'Postgres', description: 'needs a server' }] }, { id: 'q2', question: 'Anything else?' }] } })

test('pending requests per chat, withdrawn by cancel, replaced by a new connection', () => {
  const p = new Pending()
  p.apply({ type: 'ready', clientId: 'gen1', host: {} })
  p.apply(approval('e1')); p.apply(question('e2')); p.apply(approval('e3', 's2'))
  expect(p.forSession('s1').map((r) => [r.kind, r.eventId])).toEqual([['approval', 'e1'], ['question', 'e2']])
  expect(p.sessionsWaiting()).toEqual(['s1', 's2'])
  const a = p.forSession('s1')[0]!
  if (a.kind !== 'approval') throw new Error('approval expected')
  expect([a.tool, a.reason]).toEqual(['bash', 'Deletes the build folder'])
  p.apply({ type: 'cancel', eventId: 'e1' })
  expect(p.forSession('s1').map((r) => r.eventId)).toEqual(['e2'])
  p.apply({ type: 'ready', clientId: 'gen2', host: {} })
  expect(p.forSession('s1')).toEqual([])
  expect(p.clientId).toBe('gen2')
})

test('a plain-string reason is shown too (the web client accepts both)', () => {
  const p = new Pending(); p.apply({ type: 'ready', clientId: 'g' })
  p.apply({ ...approval('e1'), request: { toolName: 'web_fetch', displayReason: 'Fetches example.com' } })
  const a = p.forSession('s1')[0]!
  expect(a.kind === 'approval' ? a.reason : '').toBe('Fetches example.com')
})

test('answers have the shapes $events/result takes', () => {
  expect(approvalAnswer('g', 'e1', true)).toEqual({ clientId: 'g', eventId: 'e1', outcome: { kind: 'result', value: 'allowed-once' } })
  expect(approvalAnswer('g', 'e1', false)).toEqual({ clientId: 'g', eventId: 'e1', outcome: { kind: 'result', value: 'rejected' } })
  const p = new Pending(); p.apply({ type: 'ready', clientId: 'g' }); p.apply(question('e2'))
  const q = p.forSession('s1')[0]!
  if (q.kind !== 'question') throw new Error('question expected')
  expect(q.questions.map((x) => [x.id, x.options.map((o) => o.label)])).toEqual([['q1', ['SQLite', 'Postgres']], ['q2', []]])
  expect(questionAnswer('g', 'e2', q, { q1: { selected: ['Postgres'] }, q2: { custom: 'use migrations' } })).toEqual({ clientId: 'g', eventId: 'e2', outcome: { kind: 'result', value: { answers: [{ id: 'q1', selected: ['Postgres'] }, { id: 'q2', selected: [], custom: 'use migrations' }] } } })
})
