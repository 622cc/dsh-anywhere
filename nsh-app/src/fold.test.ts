// The phone folds DSH's own session/follow stream (snapshot, durable records, assistant-stream frames)
// into what DSH Desktop shows: the person's messages, the agent's answers, and one turn process per run
// of thinking and tool calls. Frames below have the shapes DSH 0.2.1 sends (dsh-web-app follow stream).
import { expect, test } from 'nsh/test'
import { doneTitle, failureCopy, Fold, headline, keepUnchanged, turnEnds, type Row, type Step } from './fold.ts'
import { stringsFor } from './strings.ts'

let seq = 0
const ev = (type: string, data: unknown, surfaceOp: unknown = 'append') => ({ type: 'event', event: { type, seq: seq++, time: 1_700_000_000_000 + seq * 1000, data, surfaceOp } })
const user = (id: string, text: string, kind = 'user') => ev('user/message', { id, role: 'user', content: [{ type: 'text', text }], source: { kind } })
const assistant = (id: string, text: string, reasoning?: string, turn = 1) => ev('assistant/message', { turn, step: 1, message: { id, role: 'assistant', content: [...(reasoning ? [{ type: 'reasoning', text: reasoning }] : []), ...(text ? [{ type: 'text', text }] : [])] } })
const call = (callId: string, name: string, args: unknown, turn = 1) => ev('tool/call', { turn, callId, name, arguments: JSON.stringify(args) }, undefined)
const result = (callId: string, isError = false) => ev('tool/result', { message: { id: `r-${callId}`, role: 'tool', toolCallId: callId, isError, content: [{ type: 'text', text: 'secret output' }] } })
const snapshot = (records: unknown[], extra: Record<string, unknown> = {}) => ({ type: 'snapshot', header: { id: 's1' }, cursor: seq - 1, records, hasMore: false, projections: { values: { title: 'Fix the build' } }, assistantStream: { revision: 0 }, ...extra })

test('a finished turn: the question, one completed process with its tool calls, the answer; tool output never shown', () => {
  seq = 0
  const records = [user('u1', 'Fix the build'), ev('turn/start', { turn: 1 }, undefined), assistant('a0', '', 'Look at the failing test first'),
    call('c1', 'bash', { command: 'npm test', description: 'Run the tests' }), result('c1'),
    call('c2', 'read', { file_path: '/repo/src/app.ts' }), result('c2'), assistant('a1', 'Fixed: the import was wrong.'), ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, undefined)]
  const fold = new Fold(); fold.apply(snapshot(records))
  const rows = fold.rows()
  expect(rows.map((r) => r.kind)).toEqual(['user', 'process', 'assistant'])
  const process = rows[1]!
  if (process.kind !== 'process') throw new Error('process expected')
  expect(process.entries.map((e) => e.kind === 'think' ? `think:${e.text}` : `step:${e.step.title}`)).toEqual(['think:Look at the failing test first', 'step:Run the tests', 'step:Read src/app.ts'])
  expect(process.steps.map((s) => [s.title, s.status])).toEqual([['Run the tests', 'completed'], ['Read src/app.ts', 'completed']])
  expect(headline(process, false)).toEqual({ label: 'done', toolCalls: 2 })
  expect(JSON.stringify(rows)).not.toContain('secret output')
  expect(fold.title).toBe('Fix the build')
})

test('injected context and runtime snapshots are hidden, as on the Desktop', () => {
  seq = 0
  const fold = new Fold()
  fold.apply(snapshot([user('u1', 'hello'), user('ctx', 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\ncwd', 'runtime-context')]))
  expect(fold.rows().map((r) => r.kind === 'user' ? r.text : r.kind)).toEqual(['hello'])
})

test('live: a running bash step heads the process as "Running commands"; streamed text shows as it arrives and the settlement replaces it', () => {
  seq = 0
  const fold = new Fold()
  fold.apply(snapshot([user('u1', 'Deploy'), ev('turn/start', { turn: 1 }, undefined)]))
  fold.apply(call('c1', 'bash', { command: 'make deploy', description: 'Deploy the app' }))
  let process = fold.rows().at(-1)!
  if (process.kind !== 'process') throw new Error('process expected')
  expect(headline(process, true)).toEqual({ label: 'commands', toolCalls: 1 })
  fold.apply(result('c1'))
  fold.apply({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'x', revision: 1, startedAfterSeq: seq - 1, turn: 1, step: 2 } })
  fold.apply({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'x', revision: 2, index: 0, time: 1, chunk: { type: 'text-delta', index: 0, text: 'Deployed ' } } })
  fold.apply({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'x', revision: 3, index: 1, time: 2, chunk: { type: 'text-delta', index: 0, text: 'to staging.' } } })
  const live = fold.rows().at(-1)!
  expect([live.kind, (live as { text?: string }).text, (live as { streaming?: boolean }).streaming]).toEqual(['assistant', 'Deployed to staging.', true])
  expect(fold.running).toBe(true)
  fold.apply(assistant('a1', 'Deployed to staging.'))
  fold.apply({ type: 'assistant-stream', frame: { type: 'end', attemptId: 'x', revision: 4, index: 2, outcome: { kind: 'committed', seq: seq - 1 } } })
  fold.apply(ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, undefined))
  const rows = fold.rows()
  expect(rows.filter((r) => r.kind === 'assistant').map((r) => [r.text, (r as { streaming?: boolean }).streaming])).toEqual([['Deployed to staging.', false]])
  expect(fold.running).toBe(false)
  process = rows[1]!
  if (process.kind !== 'process') throw new Error('process expected')
  expect(headline(process, false)).toEqual({ label: 'done', toolCalls: 1 })
})

test('a turn that ends with a call still open marks it failed', () => {
  seq = 0
  const fold = new Fold()
  fold.apply(snapshot([user('u1', 'x'), ev('turn/start', { turn: 1 }, undefined), call('c1', 'grep', { pattern: 'TODO' })]))
  fold.apply(ev('turn/end', { turn: 1, reason: { kind: 'interrupted' } }, undefined))
  expect(fold.rows().map((r) => r.kind)).toEqual(['user', 'process', 'failure'])
  const process = fold.rows()[1]!
  if (process.kind !== 'process') throw new Error('process expected')
  expect(process.steps.map((s) => [s.title, s.status])).toEqual([['Search TODO', 'failed']])
})

test('a reconnect snapshot replaces everything (no duplicates), and a compaction replace drops the replaced span', () => {
  seq = 0
  const records = [user('u1', 'one'), assistant('a1', 'first answer'), user('u2', 'two'), assistant('a2', 'second answer')]
  const fold = new Fold(); fold.apply(snapshot(records)); fold.apply(snapshot(records))
  expect(fold.rows().length).toBe(4)
  fold.apply(ev('user/message', { id: 'cp', role: 'user', content: [{ type: 'text', text: 'checkpoint' }], source: { kind: 'compact-checkpoint' } }, { op: 'replace', startSeq: 0, endSeq: 1 }))
  expect(fold.rows().map((r) => (r as { text?: string }).text)).toEqual(['two', 'second answer'])
})

test('a generated interface is a step titled by the agent, so the phone can show its card once it is built', () => {
  seq = 0
  const fold = new Fold()
  fold.apply(snapshot([user('u1', 'tip?'), ev('turn/start', { turn: 1 }, undefined), call('ui1', 'show_interface', { title: 'Tip calculator', source: 'import { mount } from "nsh"' }), result('ui1')]))
  const process = fold.rows().at(-1)!
  if (process.kind !== 'process') throw new Error('process expected')
  expect(process.steps.map((s) => [s.tool, s.title, s.status])).toEqual([['show_interface', 'Tip calculator', 'completed']])
  expect(JSON.stringify(process)).not.toContain('import')
})

test('a streamed reply keeps its row when the final message lands, so the list never swaps the cell', () => {
  seq = 0
  const fold = new Fold()
  fold.apply(snapshot([user('u1', 'hi'), ev('turn/start', { turn: 1 }, undefined)]))
  fold.apply({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'x', revision: 1, startedAfterSeq: seq - 1, turn: 1, step: 1 } })
  fold.apply({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'x', revision: 2, index: 0, time: 1, chunk: { type: 'text-delta', index: 0, text: 'Hel' } } })
  const streaming = fold.rows().at(-1)!.id
  fold.apply(assistant('a1', 'Hello', undefined, 1))
  expect(fold.rows().at(-1)!.id).toBe(streaming)
})

test('unchanged rows keep their identity across updates; changed rows are new', () => {
  const a = { kind: 'user' as const, id: 'u', text: 'hi', at: 1 }
  const b = { kind: 'assistant' as const, id: 'r', text: 'Hel', at: 2, streaming: true }
  const next = keepUnchanged([a, b], [{ ...a }, { ...b, text: 'Hello' }])
  expect(next[0] === a).toBe(true)
  expect(next[1] === b).toBe(false)
  expect((next[1] as { text: string }).text).toBe('Hello')
})

test('the chat knows its model: the next selection, else the last one used', () => {
  seq = 0
  const fold = new Fold()
  fold.apply(snapshot([], { projections: { values: { title: 't', modelSelection: { lastUsed: { provider: 'deepseek', model: 'v4-flash' }, next: { provider: 'deepseek', model: 'v4-pro', reasoningEffort: 'high' } } } } }))
  expect(fold.model).toEqual({ provider: 'deepseek', model: 'v4-pro', reasoningEffort: 'high' })
  fold.apply(snapshot([], { projections: { values: { modelSelection: { lastUsed: { provider: 'deepseek', model: 'v4-flash' } } } } }))
  expect(fold.model).toEqual({ provider: 'deepseek', model: 'v4-flash' })
})

test('a message\'s photos and files are shown with it; a message of only a photo still shows', () => {
  seq = 0
  const photo = { type: 'image', attachment: { attachmentId: 'img1', mediaType: 'image/jpeg', bytes: 2048, width: 640, height: 480, name: 'photo.jpg' } }
  const file = { type: 'file', attachment: { attachmentId: 'f1', name: 'report.pdf', bytes: 12345 } }
  const fold = new Fold()
  fold.apply(snapshot([
    ev('user/message', { id: 'u1', role: 'user', content: [{ type: 'text', text: 'what is this?' }, photo, file], source: { kind: 'user' } }),
    ev('user/message', { id: 'u2', role: 'user', content: [photo], source: { kind: 'user' } }),
  ]))
  const rows = fold.rows()
  expect(rows.map((r) => r.kind === 'user' ? [r.text, r.attachments.map((a) => `${a.kind}:${a.name}`)] : r.kind)).toEqual([
    ['what is this?', ['image:photo.jpg', 'file:report.pdf']],
    ['', ['image:photo.jpg']],
  ])
  const first = rows[0]!
  if (first.kind !== 'user') throw new Error('user expected')
  expect(first.attachments[0]).toEqual({ kind: 'image', attachmentId: 'img1', name: 'photo.jpg', bytes: 2048, width: 640, height: 480 })
})

test('the last answer of each finished turn is where its Copy goes; a streaming answer or the running turn has none', () => {
  const a = (id: string, streaming = false) => ({ kind: 'assistant', id, text: id, streaming }) as Row
  const u = (id: string) => ({ kind: 'user', id, text: id }) as Row
  const p = (id: string) => ({ kind: 'process', id, entries: [], steps: [] }) as unknown as Row
  expect([...turnEnds([u('u1'), a('a1'), p('p1'), a('a2'), u('u2'), a('a3')], false)]).toEqual(['a2', 'a3'])
  expect([...turnEnds([u('u1'), a('a1'), u('u2'), a('a2')], true)]).toEqual(['a1'])
  expect([...turnEnds([u('u1'), a('a1', true)], false)]).toEqual([])
})

test('the chat keeps DSH\'s inbox: the snapshot\'s projection, then live splices (splices already in the snapshot\'s records are not applied twice)', () => {
  seq = 0
  const m = (id: string, text: string) => ({ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', rpcId: `r-${id}` } })
  const spliced = (data: unknown) => ev('agent/inbox/spliced', data, undefined)
  const fold = new Fold()
  fold.apply(snapshot([spliced({ target: 'next-turn', start: 0, inserted: [m('m1', 'queued before')] })], { projections: { values: { title: 't', inbox: { 'next-turn': [m('m1', 'queued before')], 'next-step': [] } } } }))
  expect(fold.inbox['next-turn'].map((x) => x.id)).toEqual(['m1'])
  fold.apply(spliced({ target: 'next-turn', start: 1, inserted: [m('m2', 'and this')] }))
  fold.apply(spliced({ target: 'next-turn', start: 0, removedCount: 1, inserted: [] }))
  expect(fold.inbox['next-turn'].map((x) => x.id)).toEqual(['m2'])
  fold.apply(snapshot([]))
  expect(fold.inbox).toEqual({ 'next-turn': [], 'next-step': [] })
})

test('a command shows in the chat as DSH logs it: "/name args" while it runs, then its result', () => {
  seq = 0
  const fold = new Fold()
  fold.apply(snapshot([user('u1', 'hi')]))
  fold.apply(ev('command/run', { commandId: 'c1', name: 'plan', args: '', source: { kind: 'user' } }, undefined))
  const running = fold.rows().at(-1)!
  expect(running.kind === 'command' ? [running.id, running.line, running.state, running.text] : running.kind).toEqual(['c1', '/plan', 'running', ''])
  fold.apply(ev('command/done', { commandId: 'c1', kind: 'success', text: 'plan mode on' }, undefined))
  fold.apply(ev('command/run', { commandId: 'c2', name: 'permission', args: 'nope', source: { kind: 'user' } }, undefined))
  fold.apply(ev('command/done', { commandId: 'c2', kind: 'error', text: 'unknown preset "nope"' }, undefined))
  expect(fold.rows().slice(1).map((r) => r.kind === 'command' ? [r.line, r.state, r.text] : r.kind)).toEqual([['/plan', 'success', 'plan mode on'], ['/permission nope', 'error', 'unknown preset "nope"']])
})

test('a turn DSH started itself (a goal round, a schedule, a webhook) reads as the Desktop titles it; what DSH adds in a later step stays hidden', () => {
  seq = 0
  const fold = new Fold()
  const sent = (id: string, text: string, source: Record<string, unknown>) => ev('user/message', { id, role: 'user', content: [{ type: 'text', text }], source })
  const turn = (n: number, ...steps: unknown[][]) => [ev('turn/start', { turn: n }), ...steps.flatMap((s, i) => [ev('step/start', { turn: n, step: i + 1 }), ...s]), ev('turn/end', { turn: n })]
  fold.apply(snapshot([
    ...turn(1, [sent('g1', '<goal_round>\nWork on: ship it\n</goal_round>', { kind: 'goal', round: 1 })], [sent('g2', 'keep going', { kind: 'goal', round: 1 })]),
    ...turn(2, [sent('w1', 'push to main', { kind: 'webhook', provider: 'github' })]),
    ...turn(3, [sent('s1', 'nightly', { kind: 'schedule' })]),
    ...turn(4, [sent('x1', 'odd', { kind: 'something-new' })]),
    ...turn(5, [sent('j1', 'background job bash-1 finished [status: completed]', { kind: 'tool-jobs' })], [sent('j2', 'background job bash-2 finished', { kind: 'tool-jobs' })]),
  ]))
  expect(fold.rows().map((r) => [r.kind, (r as { text: string }).text])).toEqual([['notice', 'Continuing goal'], ['notice', 'GitHub event received'], ['notice', 'Automation task'], ['notice', 'Execution requested'], ['notice', 'Background task updated']])
})

test('a finished process is titled by what it did, as Desktop does: the three kinds called most, most first', () => {
  const steps = (...tools: string[]) => tools.map((tool, i) => ({ callId: `c${i}`, tool, title: tool, kind: 'other', status: 'completed', at: i })) as Step[]
  expect(doneTitle(steps())).toBe('Analysis completed')
  expect(doneTitle(steps('bash', 'bash'))).toBe('Ran commands')
  expect(doneTitle(steps('read', 'bash', 'bash'))).toBe('Ran commands and read files')
  expect(doneTitle(steps('grep', 'edit', 'apply_patch', 'web_fetch'))).toBe('Edited files, searched code, visited web pages')
  expect(doneTitle(steps('grep', 'edit', 'web_fetch', 'todo_write', 'my_tool'))).toBe('Searched code, edited files, visited web pages')
})

test('a finished process\'s title lists its activities in the language\'s own way: 、 in Chinese', () => {
  const steps = (...tools: string[]) => tools.map((tool, i) => ({ callId: `c${i}`, tool, title: tool, kind: 'other', status: 'completed', at: i })) as Step[]
  const three = steps('grep', 'edit', 'web_fetch')
  expect(doneTitle(three, stringsFor('zh'))).toBe('已搜索代码、修改了文件、已访问网页')
  expect(doneTitle(three, stringsFor('en'))).toBe('Searched code, edited files, visited web pages')
  expect(doneTitle(steps('grep', 'edit'), stringsFor('zh'))).toBe('已搜索代码并修改了文件')
  expect(doneTitle(steps(), stringsFor('zh'))).toBe('已完成分析')
})

test('an answer to the agent\'s question shows as the person\'s message, in whichever step DSH takes it', () => {
  seq = 0
  const fold = new Fold()
  const reply = (id: string) => ev('user/message', { id, role: 'user', content: [{ type: 'text', text: 'Approve' }], source: { kind: 'user-question-reply' } })
  fold.apply(snapshot([ev('turn/start', { turn: 1 }), ev('step/start', { turn: 1, step: 1 }), reply('a1'), ev('step/start', { turn: 1, step: 2 }), reply('a2')]))
  expect(fold.rows().filter((r) => r.kind === 'user').map((r) => r.id)).toEqual(['a1', 'a2'])
})

test('the chat keeps the agent\'s to-dos: the snapshot\'s projection, then each todo/write replaces the list', () => {
  seq = 0
  const fold = new Fold()
  const list = [{ content: 'Read the code', status: 'completed' }, { content: 'Fix the bug', status: 'in_progress' }, { content: 'Run tests', status: 'pending' }]
  fold.apply(snapshot([], { projections: { values: { title: 't', todos: list } } }))
  expect(fold.todos.map((t) => t.status)).toEqual(['completed', 'in_progress', 'pending'])
  fold.apply(ev('todo/write', { todos: [{ content: 'Fix the bug', status: 'completed' }, { content: 'Odd', status: 'weird' }, { content: 3 }] }))
  expect(fold.todos).toEqual([{ content: 'Fix the bug', status: 'completed' }, { content: 'Odd', status: 'pending' }])
  fold.apply(snapshot([], { projections: { values: { title: 't', todos: null } } }))
  expect(fold.todos).toEqual([])
})

test('a to-do list that a finished turn never touched is left behind: the chat stops showing it until the agent writes one again', () => {
  seq = 0
  const fold = new Fold()
  const list = [{ content: 'Record the list', status: 'in_progress' }, { content: 'Reply', status: 'pending' }]
  fold.apply(snapshot([user('u1', 'Make three to-dos'), ev('turn/start', { turn: 1 }), ev('todo/write', { todos: list }), ev('turn/end', { turn: 1 })], { projections: { values: { title: 't', todos: list } } }))
  expect(fold.todos.length).toBe(2) // the turn that wrote it has ended: it is that turn's result
  fold.apply(ev('turn/start', { turn: 2 }))
  expect(fold.todos.length).toBe(2) // while a turn runs the agent may still update it
  fold.apply(ev('turn/end', { turn: 2 }))
  expect(fold.todos).toEqual([])
  fold.apply(ev('turn/start', { turn: 3 }))
  fold.apply(ev('todo/write', { todos: [{ content: 'Again', status: 'pending' }] }))
  expect(fold.todos.map((t) => t.content)).toEqual(['Again'])
})

test('a snapshot whose records hold a finished turn after the list was written shows no list', () => {
  seq = 0
  const fold = new Fold()
  const list = [{ content: 'Old', status: 'in_progress' }]
  fold.apply(snapshot([user('u1', 'Reply DONE'), ev('turn/start', { turn: 4 }), ev('turn/end', { turn: 4 })], { projections: { values: { title: 't', todos: list } } }))
  expect(fold.todos).toEqual([])
})

test('the snapshot carries the chat\'s subagent catalog', () => {
  const fold = new Fold()
  fold.apply(snapshot([], { projections: { values: { title: 't', subagentCatalog: [{ id: 'c1', createdAt: 5, mode: 'continuable', label: 'Review' }] } } }))
  expect(fold.subagents).toEqual([{ id: 'c1', createdAt: 5, mode: 'continuable', label: 'Review' }])
  fold.apply(ev('subagent/catalog', { version: 1, childId: 'c2', childCreatedAt: 9, mode: 'one-shot' }))
  fold.apply(ev('subagent/catalog', { version: 1, childId: 'c2', childCreatedAt: 9, mode: 'one-shot' }))
  expect(fold.subagents.map((c) => [c.id, c.mode])).toEqual([['c1', 'continuable'], ['c2', 'one-shot']])
  fold.apply(snapshot([], { projections: { values: { title: 't' } } }))
  expect(fold.subagents).toEqual([])
})

test('catalog events among the snapshot records are already in its projection', () => {
  const fold = new Fold()
  fold.apply(snapshot([{ type: 'event', event: { type: 'subagent/catalog', seq: 1, time: 0, data: { version: 1, childId: 'inherited', childCreatedAt: 1, mode: 'one-shot' } } }], { projections: { values: { title: 't', subagentCatalog: [] } } }))
  expect(fold.subagents).toEqual([])
})

// DSH Desktop's turn-error row (dsh-client-ui-chat 0.2.1-rc.3, conversation-nodes/turn-error): a turn that ends with
// an error, a sign-out stop or an interruption says so under the turn. An expired provider key
// ended three phone turns with turn/end {kind:'error', error:{code:'AUTH'}}, and the phone showed nothing at all.
const expired = { kind: 'error', error: { code: 'AUTH', message: '401: {"type":"authentication_error","code":"api_key_expired"}' } }

test('a turn that fails says so in the chat, after the message that started it, as Desktop does', () => {
  seq = 0
  const fold = new Fold()
  fold.apply(snapshot([user('u1', 'What is the pwd'), ev('turn/start', { turn: 3 }, undefined), ev('turn/end', { turn: 3, reason: expired }, undefined)]))
  fold.apply(user('u2', 'Are we connected?'))
  fold.apply(ev('turn/start', { turn: 4 }, undefined))
  fold.apply(ev('turn/end', { turn: 4, reason: expired }, undefined))
  expect(fold.rows().map((r) => r.kind === 'failure' ? [r.kind, r.code, r.message] : [r.kind])).toEqual([
    ['user'], ['failure', 'AUTH', ''], ['user'], ['failure', 'AUTH', ''],
  ])
  expect(fold.running).toBe(false)
})

test('the failure reads as Desktop words it: AUTH is an invalid key, a sign-out or an interruption stopped the task, anything else keeps its message', () => {
  seq = 0
  const fold = new Fold()
  fold.apply(snapshot([user('u1', 'x'),
    ev('turn/start', { turn: 1 }, undefined), ev('turn/end', { turn: 1, reason: expired }, undefined),
    ev('turn/start', { turn: 2 }, undefined), ev('turn/end', { turn: 2, reason: { kind: 'error', error: { code: 'NETWORK', message: 'socket hang up' } } }, undefined),
    ev('turn/start', { turn: 3 }, undefined), ev('turn/end', { turn: 3, reason: { kind: 'aborted', reason: { kind: 'hook', reason: 'deepseek-account/signed-out' } } }, undefined),
    ev('turn/start', { turn: 4 }, undefined), ev('turn/end', { turn: 4, reason: { kind: 'interrupted' } }, undefined),
    ev('turn/start', { turn: 5 }, undefined), ev('turn/end', { turn: 5, reason: { kind: 'aborted', reason: { kind: 'user' } } }, undefined),
    ev('turn/start', { turn: 6 }, undefined), ev('turn/end', { turn: 6, reason: { kind: 'completed' } }, undefined),
    ev('turn/start', { turn: 7 }, undefined), ev('turn/end', { turn: 7, reason: { kind: 'error', error: { code: 'QUOTA', message: 'x' } } }, undefined),
  ]))
  const copies = fold.rows().flatMap((r) => r.kind === 'failure' ? [failureCopy(r, 'en')] : [])
  expect(copies).toEqual([
    { title: 'This turn failed', message: 'API key is invalid', code: 'AUTH' },
    { title: 'This turn failed', message: 'socket hang up', code: 'NETWORK' },
    { title: 'Task stopped', message: 'Stopped because you signed out of DeepSeek.', code: 'ACCOUNT_SIGNED_OUT' },
    { title: 'Task stopped', message: 'The DSH process exited before this turn finished (for example, it was killed, crashed, or timed out while shutting down), so the turn was closed when DSH restarted. Unfinished tool calls have unknown outcomes.' },
    { title: 'This turn failed', message: 'Request quota exhausted.', code: 'QUOTA' },
  ])
  expect(failureCopy(fold.rows().find((r) => r.kind === 'failure')!, 'ru').title).toBe('Ход завершился ошибкой')
})

test('a sent message\'s row keeps the request id it was sent with, so the phone finds its own message', () => {
  seq = 0
  const fold = new Fold()
  fold.apply(snapshot([ev('user/message', { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user', rpcId: 'phone-1' } }), user('u2', 'hi')]))
  expect(fold.rows().map((r) => (r.kind === 'user' ? r.rpcId : undefined))).toEqual(['phone-1', undefined])
})
