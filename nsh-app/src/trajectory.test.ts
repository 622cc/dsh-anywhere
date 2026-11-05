// The chat's trajectory, as Fold reads it from session/follow: every tool call, turn by turn (the `turn` DSH writes
// on each tool/call), with its title, status, start and end. Frames have the shapes dsh-agent-loop 0.2.1-rc.3 appends.
import { expect, test } from 'nsh/test'
import { Fold } from './fold.ts'

let seq = 0
const ev = (type: string, data: unknown, surfaceOp?: unknown) => ({ type: 'event', event: { type, seq: seq++, time: 1_700_000_000_000 + seq * 1000, data, surfaceOp } })
const call = (callId: string, name: string, args: unknown, turn: number) => ev('tool/call', { turn, step: 1, callId, name, arguments: JSON.stringify(args) })
const result = (callId: string, turn: number, isError = false) => ev('tool/result', { turn, step: 1, message: { id: `r-${callId}`, role: 'tool', toolCallId: callId, isError, content: [{ type: 'text', text: 'secret output' }] } }, 'append')
const user = (id: string, text: string) => ev('user/message', { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, 'append')
const snapshot = (records: unknown[]) => ({ type: 'snapshot', header: { id: 's1' }, records, hasMore: false, projections: { values: {} }, assistantStream: { revision: 0 } })
const time = (e: { event: { time: number } }) => e.event.time

test('the trajectory lists every tool call turn by turn, with its title, status, start and end; output never reaches it', () => {
  seq = 0
  const c1 = call('c1', 'bash', { command: 'npm test', description: 'Run the tests' }, 1), r1 = result('c1', 1)
  const c2 = call('c2', 'read', { file_path: '/repo/src/app.ts' }, 1), r2 = result('c2', 1, true)
  const c3 = call('c3', 'grep', { pattern: 'TODO' }, 2)
  const end2 = ev('turn/end', { turn: 2, reason: { kind: 'cancelled' } })
  const fold = new Fold()
  fold.apply(snapshot([user('u1', 'Fix the build'), ev('turn/start', { turn: 1 }), c1, r1, c2, r2, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    user('u2', 'Look for leftovers'), ev('turn/start', { turn: 2 }), c3, end2]))
  const turns = fold.trajectory()
  expect(turns.map((t) => t.turn)).toEqual([1, 2])
  expect(turns[0]!.calls.map((s) => [s.tool, s.title, s.status, s.at, s.endedAt])).toEqual([
    ['bash', 'Run the tests', 'completed', time(c1), time(r1)],
    ['read', 'Read src/app.ts', 'failed', time(c2), time(r2)],
  ])
  // A turn that ends with a call still open settles it as failed, as the chat's process does.
  expect(turns[1]!.calls.map((s) => [s.tool, s.status, s.at, s.endedAt])).toEqual([['grep', 'failed', time(c3), time(end2)]])
  expect(JSON.stringify(turns)).not.toContain('secret output')
})

test('a call still running has no end yet; a new call joins its turn live', () => {
  seq = 0
  const fold = new Fold()
  fold.apply(snapshot([ev('turn/start', { turn: 3 })]))
  expect(fold.trajectory()).toEqual([])
  fold.apply(call('c1', 'bash', { command: 'make', description: 'Build' }, 3))
  fold.apply(call('c2', 'web_fetch', { url: 'https://example.com/docs' }, 3))
  fold.apply(result('c1', 3))
  const [turn] = fold.trajectory()
  expect(turn!.turn).toBe(3)
  expect(turn!.calls.map((s) => [s.callId, s.status, s.endedAt === undefined])).toEqual([['c1', 'completed', false], ['c2', 'in_progress', true]])
})

test('a reconnect snapshot replaces the trajectory instead of adding to it', () => {
  seq = 0
  const records = [ev('turn/start', { turn: 1 }), call('c1', 'bash', { command: 'ls', description: 'List files' }, 1), result('c1', 1)]
  const fold = new Fold()
  fold.apply(snapshot(records))
  fold.apply(snapshot(records))
  expect(fold.trajectory().flatMap((t) => t.calls).map((s) => s.callId)).toEqual(['c1'])
})
