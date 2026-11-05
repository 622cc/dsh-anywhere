// The running process's one line, as DSH Desktop's title: what it does, then what it is on right now. The rules are
// Desktop's (dsh-client-ui-chat 0.2.1-rc.3: processActivity, liveToolDetail, liveReasoningDetail, read 2026-11-02).
import { expect, test } from 'nsh/test'
import { Fold, liveText } from './fold.ts'
import { fieldsSoFar, reasoningDetail, steady, toolDetail } from './live.ts'
import { stringsFor } from './strings.ts'

let seq = 0
const ev = (type: string, data: unknown, surfaceOp: unknown = 'append') => ({ type: 'event', event: { type, seq: seq++, time: 1_700_000_000_000 + seq * 1000, data, surfaceOp } })
let revision = 0
const frame = (f: Record<string, unknown>) => ({ type: 'assistant-stream', frame: { attemptId: 'x', revision: ++revision, ...f } })
const chunk = (c: Record<string, unknown>) => frame({ type: 'chunk', time: 1, chunk: c })
function started() {
  seq = 0; revision = 0
  const fold = new Fold()
  fold.apply({ type: 'snapshot', header: { id: 's1' }, cursor: 0, records: [], hasMore: false, projections: { values: {} } })
  fold.apply(ev('turn/start', { turn: 1 }, undefined))
  fold.apply(frame({ type: 'start', turn: 1, step: 1 }))
  return fold
}

test('thinking: the last paragraph with words, on one line, and it changes as the thinking goes on', () => {
  const fold = started()
  expect(fold.live()).toEqual({ detail: '' })
  fold.apply(chunk({ type: 'reasoning-delta', index: 0, text: 'First **look** at\nthe map.' }))
  expect(fold.live()).toEqual({ detail: 'First look at the map.' })
  fold.apply(chunk({ type: 'reasoning-delta', index: 0, text: '\n\nThis gives the room id.\n\n  ' }))
  expect(fold.live()).toEqual({ detail: 'This gives the room id.' })
})

test('a long detail stops at 160 characters', () => {
  const detail = reasoningDetail('x'.repeat(200))
  expect([...detail].length).toBe(160)
  expect(detail.endsWith('…')).toBe(true)
  expect(reasoningDetail('y'.repeat(160))).toBe('y'.repeat(160))
})

test('the answer has started: no thinking on the line, the words are below it', () => {
  const fold = started()
  fold.apply(chunk({ type: 'reasoning-delta', index: 0, text: 'Thinking it over' }))
  fold.apply(chunk({ type: 'text-delta', index: 1, text: 'Hello' }))
  expect(fold.live()).toEqual({ detail: '' })
})

test('a tool call on its way: what it is preparing, and its detail from the arguments so far', () => {
  const fold = started()
  fold.apply(chunk({ type: 'reasoning-delta', index: 0, text: 'I should list them' }))
  fold.apply(chunk({ type: 'tool-call-delta', index: 1, id: 'c1', name: 'bash', argumentsDelta: '{"timeout":5,"desc' }))
  expect(fold.live()).toEqual({ preparing: 'commands', detail: '' })
  fold.apply(chunk({ type: 'tool-call-delta', index: 1, id: 'c1', argumentsDelta: 'ription":"List the ro' }))
  expect(fold.live()).toEqual({ preparing: 'commands', detail: 'List the ro' })
  fold.apply(chunk({ type: 'block-end', index: 1, block: { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"timeout":5,"description":"List the rooms"}' } }))
  expect(fold.live()).toEqual({ preparing: 'commands', detail: 'List the rooms' })
})

test('a tool that runs: the detail its arguments name, in Desktop\'s order; the name once nothing else can come', () => {
  const fold = started()
  fold.apply(ev('assistant/message', { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [] } }))
  fold.apply(ev('tool/call', { turn: 1, callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'ls -la', description: 'List the rooms' }) }, undefined))
  expect(fold.live()).toEqual({ detail: 'List the rooms' })
  fold.apply(ev('tool/result', { message: { id: 'r1', role: 'tool', toolCallId: 'c1', isError: false, content: [] } }))
  expect(fold.live()).toEqual({ detail: '' })
  fold.apply(ev('tool/call', { turn: 1, callId: 'c2', name: 'mystery', arguments: '{"other":1}' }, undefined))
  expect(fold.live()).toEqual({ detail: 'mystery' })
})

test('a reopened chat picks up a turn in the middle: thinking and a call on its way come back from the snapshot', () => {
  const fold = new Fold()
  fold.apply({ type: 'snapshot', header: { id: 's1' }, cursor: 0, records: [], hasMore: false, projections: { values: {} }, assistantStream: { revision: 3, activeAttempt: { attemptId: 'x', turn: 1, step: 1, stream: [
    { type: 'reasoning-chunks', time0: 1, index: 0, dt: [1], texts: ['Look at ', 'the map'] },
  ] } } })
  expect(fold.live()).toEqual({ detail: 'Look at the map' })
  fold.apply({ type: 'snapshot', header: { id: 's1' }, cursor: 0, records: [], hasMore: false, projections: { values: {} }, assistantStream: { revision: 3, activeAttempt: { attemptId: 'x', turn: 1, step: 1, stream: [
    { type: 'tool-call-chunks', time0: 1, index: 1, dt: [1], id: 'c1', name: 'read', args: ['{"file_pa', 'th":"src/a.ts"'] },
  ] } } })
  expect(fold.live()).toEqual({ preparing: 'read', detail: 'src/a.ts' })
})

test('Desktop\'s order of details, questions and lists included', () => {
  expect(toolDetail('t', { path: 'b', title: 'a' }, true)).toBe('a')
  expect(toolDetail('t', { title: '  ', path: 'b' }, true)).toBe('b')
  expect(toolDetail('t', { queries: ['one', 'two'] }, true)).toBe('one, two')
  expect(toolDetail('t', { questions: [{ question: 'Which room?' }] }, true)).toBe('Which room?')
  expect(toolDetail('t', { other: 1 }, false)).toBe('')
  expect(toolDetail('t', { other: 1 }, true)).toBe('t')
})

test('arguments cut anywhere still give what has arrived, and never throw', () => {
  expect(fieldsSoFar('{"a":"b\\n\\u00e9\\"c')).toEqual({ a: 'b\né"c' })
  expect(fieldsSoFar('{"a":[1,"x,]"],"b":{"c":1},"d":"e"}')).toEqual({ a: [1, 'x,]'], b: { c: 1 }, d: 'e' })
  expect(fieldsSoFar('{"a":[1,')).toEqual({})
  for (const cut of ['', '{', '{"', '{"a', '{"a"', '{"a":', '{"a":"', '{"a":"\\', '{"a":"\\u00', 'nonsense', '[1]']) expect(typeof fieldsSoFar(cut)).toBe('object')
})

test('the line reads as Desktop\'s: the words, a dot, the detail', () => {
  const en = stringsFor('en'), zh = stringsFor('zh'), ru = stringsFor('ru')
  expect(liveText({ detail: 'This gives the room id' }, 'analyzing', en)).toBe('Analyzing the request · This gives the room id')
  expect(liveText({ detail: '' }, 'commands', en)).toBe('Running commands')
  expect(liveText({ preparing: 'write', detail: 'notes.md' }, 'analyzing', en)).toBe('Preparing to write files · notes.md')
  expect(liveText({ preparing: 'commands', detail: '' }, 'analyzing', zh)).toBe('准备运行命令')
  expect(Object.keys(ru.prepare).sort()).toEqual(Object.keys(en.prepare).sort())
  expect(Object.keys(zh.prepare).sort()).toEqual(Object.keys(en.prepare).sort())
})

test('a line changing with every token stays up long enough to read; the latest one wins', async () => {
  const shown: string[] = []
  const show = steady<string>((v) => shown.push(v), 40)
  show('a'); show('b'); show('c'); show('c')
  expect(shown).toEqual(['a'])
  await new Promise((r) => setTimeout(r, 80))
  expect(shown).toEqual(['a', 'c'])
  show('c')
  await new Promise((r) => setTimeout(r, 60))
  expect(shown).toEqual(['a', 'c'])
})
