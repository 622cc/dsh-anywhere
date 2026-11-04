// Try it: a computer that lives in this file, for someone with no computer to link, such as an App Store reviewer. It
// answers the calls and streams of dsh.ts in DSH's own frames (see fold.ts, events.ts, workspaces.ts), so every screen
// runs as it does when linked, on sample chats. Nothing here opens a socket or makes a request, and nothing is kept: the
// sample starts over each time.
import type { SocketLike } from './dsh.ts'
import { S } from './strings.ts'

export const TRY_ORIGIN = 'http://try-it.invalid/dsh'
export const TRY_KEY = 'try-it'

const WORKSPACE = 'try-workspace', PATH = '/sample-project'
const STEP_MS = 400
interface Chat { id: string; title: string; updatedAt: number; running: boolean; blank: boolean; records: unknown[]; turn: number }
type Open = { kind: 'approval' | 'question'; eventId: string; sessionId: string; callId: string; frame: unknown }
interface Stream { id: string; send: (value: unknown) => void }

const respond = (body: unknown) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body }) as unknown as Response
const text = (t: string) => [{ type: 'text', text: t }]
const FILES: Record<string, { name: string; type: 'file' | 'directory'; size?: number }[]> = {
  '.': [{ name: 'src', type: 'directory' }, { name: 'README.md', type: 'file', size: 64 }],
  src: [{ name: 'login.ts', type: 'file', size: 92 }, { name: 'login.test.ts', type: 'file', size: 118 }],
}
const CODE: Record<string, string> = {
  'src/login.ts': "export function login(password: string) {\n  if (!password) throw new Error('Enter your password')\n}\n",
  'src/login.test.ts': "import { login } from './login'\n\ntest('an empty password is refused', () => {\n  expect(() => login('')).toThrow('Enter your password')\n})\n",
}

export function tryComputer(): { fetch: typeof fetch; socket: (url: string) => SocketLike } {
  const t = S.tryIt
  let seq = 0, counter = 0
  const now = Date.now()
  const chats = new Map<string, Chat>()
  const opens = new Map<string, Open>()
  const follows = new Map<string, Set<Stream>>()
  const events = new Set<Stream>()
  const workspaces = new Set<Stream>()
  const timers = new Map<string, ReturnType<typeof setTimeout>[]>()
  let pinned: string[] = [], archived: string[] = []

  const ev = (type: string, data: unknown, at: number, surfaceOp?: unknown) => ({ type: 'event', event: { type, seq: seq++, time: at, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) } })
  const user = (id: string, words: string, at: number, rpcId?: string) => ev('user/message', { id, role: 'user', content: text(words), source: { kind: 'user', ...(rpcId ? { rpcId } : {}) } }, at, 'append')
  const answerOf = (id: string, words: string, turn: number, at: number) => ev('assistant/message', { turn, step: 1, message: { id, role: 'assistant', content: text(words) } }, at, 'append')
  const call = (callId: string, name: string, args: unknown, turn: number, at: number) => ev('tool/call', { turn, callId, name, arguments: JSON.stringify(args) }, at)
  const result = (callId: string, at: number, isError = false) => ev('tool/result', { message: { id: `r-${callId}`, role: 'tool', toolCallId: callId, isError, content: text('') } }, at, 'append')
  const turnEnd = (turn: number, at: number, kind = 'completed') => ev('turn/end', { turn, reason: { kind } }, at)
  const add = (id: string, title: string, updatedAt: number, running: boolean, records: unknown[], turn: number) => chats.set(id, { id, title, updatedAt, running, blank: false, records, turn })

  const hour = 3_600_000
  add('try-fix', t.fixTitle, now - hour, false, [
    user('u-fix', t.fixAsk, now - hour - 60_000), ev('turn/start', { turn: 1 }, now - hour - 59_000),
    call('c-read', 'read', { file_path: 'src/login.test.ts' }, 1, now - hour - 50_000), result('c-read', now - hour - 49_000),
    call('c-edit', 'edit', { file_path: 'src/login.test.ts' }, 1, now - hour - 40_000), result('c-edit', now - hour - 39_000),
    call('c-test', 'bash', { command: 'npm test' }, 1, now - hour - 30_000), result('c-test', now - hour - 10_000),
    answerOf('a-fix', t.fixAnswer, 1, now - hour), turnEnd(1, now - hour),
  ], 1)
  add('try-delete', t.deleteTitle, now - 120_000, true, [
    user('u-delete', t.deleteAsk, now - 180_000), ev('turn/start', { turn: 1 }, now - 179_000),
    call('c-delete', 'bash', { command: 'rm -rf build/old' }, 1, now - 120_000),
  ], 1)
  add('try-name', t.nameTitle, now - 60_000, true, [
    user('u-name', t.nameAsk, now - 90_000), ev('turn/start', { turn: 1 }, now - 89_000),
    call('c-name', 'ask_user_question', { question: t.nameQuestion }, 1, now - 60_000),
  ], 1)
  opens.set('try-approval', { kind: 'approval', eventId: 'try-approval', sessionId: 'try-delete', callId: 'c-delete',
    frame: { type: 'waterfall', event: 'approval/request', eventId: 'try-approval', agentId: 'try-delete', request: { toolName: 'bash', displayReason: t.deleteReason, callId: 'c-delete' } } })
  opens.set('try-question', { kind: 'question', eventId: 'try-question', sessionId: 'try-name', callId: 'c-name',
    frame: { type: 'waterfall', event: 'user-questions/request', eventId: 'try-question', agentId: 'try-name',
      request: { questions: [{ id: 'name', question: t.nameQuestion, options: t.nameOptions.map((label) => ({ label })), multiSelect: false }], wait: { callId: 'c-name' } } } })

  const emit = (frame: unknown, chat: Chat) => {
    chat.records.push(frame); chat.updatedAt = Date.now()
    for (const s of follows.get(chat.id) ?? []) s.send(frame)
  }
  const status = (chat: Chat, running: boolean) => { chat.running = running; for (const s of events) s.send({ type: 'emit', event: 'api-session/status', args: [chat.id, running] }) }
  const later = (chat: Chat, ms: number, run: () => void) => { const l = timers.get(chat.id) ?? []; l.push(setTimeout(run, ms)); timers.set(chat.id, l) }
  const finish = (chat: Chat, words: string, callId?: string, rejected = false) => {
    const turn = chat.turn
    later(chat, STEP_MS, () => {
      if (callId) emit(result(callId, Date.now(), rejected), chat)
      emit(answerOf(`a-${counter++}`, words, turn, Date.now()), chat)
      emit(turnEnd(turn, Date.now()), chat)
      status(chat, false)
    })
  }

  const answered = (args: { eventId?: string; outcome?: { value?: any } }) => {
    const open = opens.get(args.eventId ?? ''); if (!open) return
    opens.delete(open.eventId)
    const chat = chats.get(open.sessionId)!
    if (open.kind === 'approval') {
      const allowed = args.outcome?.value === 'allowed-once'
      return finish(chat, allowed ? t.deleteAnswer : t.deleteRejected, open.callId, !allowed)
    }
    const picked = args.outcome?.value?.answers?.[0]
    finish(chat, t.nameAnswer(picked?.custom ?? picked?.selected?.[0] ?? t.nameOptions[0]!), open.callId)
  }

  const prompt = (r: { requestId: string; sessionId: string; content: { type?: string; text?: string }[] }) => {
    const chat = chats.get(r.sessionId); if (!chat) return
    const words = (Array.isArray(r.content) ? r.content : []).map((b) => (b?.type === 'text' ? b.text ?? '' : '')).join('')
    if (chat.blank) { chat.blank = false; chat.title = words.slice(0, 48) || t.fixTitle; emit(ev('session/title', { title: chat.title }, Date.now()), chat) }
    const turn = ++chat.turn
    emit(user(`u-${counter++}`, words, Date.now(), r.requestId), chat)
    emit(ev('turn/start', { turn }, Date.now()), chat)
    status(chat, true)
    const callId = `c-${counter++}`
    later(chat, STEP_MS, () => emit(call(callId, 'read', { file_path: 'README.md' }, turn, Date.now()), chat))
    later(chat, STEP_MS * 2, () => finish(chat, t.reply, callId))
  }

  const cancel = (sessionId: string) => {
    const chat = chats.get(sessionId); if (!chat?.running) return
    for (const timer of timers.get(sessionId) ?? []) clearTimeout(timer)
    timers.delete(sessionId)
    for (const open of [...opens.values()]) if (open.sessionId === sessionId) { opens.delete(open.eventId); for (const s of events) s.send({ type: 'cancel', eventId: open.eventId }) }
    emit(turnEnd(chat.turn, Date.now(), 'interrupted'), chat)
    status(chat, false)
  }

  const listed = () => ({ items: [...chats.values()].map((c) => ({ sessionId: c.id, updatedAt: c.updatedAt, running: c.running, blank: c.blank, cwd: PATH, projections: { asOfSeq: seq, values: { title: c.title } } })) })
  const baseline = () => ({ type: 'baseline', value: { items: [{ workspaceId: WORKSPACE, path: PATH, title: t.workspace, sessionIds: [...chats.keys()], updatedAt: now }], archivedSessionIds: archived, pinnedSessionIds: pinned } })
  const toWorkspaces = (frame: unknown) => { for (const s of workspaces) s.send(frame) }

  const rpc = (method: string, args: any): unknown => {
    const r = args?.request
    switch (method) {
      case 'session/list': return listed()
      case 'session/create': { const id = `try-${counter++}`; chats.set(id, { id, title: '', updatedAt: Date.now(), running: false, blank: true, records: [], turn: 0 }); toWorkspaces(baseline()); return { sessionId: id } }
      case 'session/fork': { const from = chats.get(r?.sessionId), id = `try-${counter++}`; add(id, from?.title ?? t.fixTitle, Date.now(), false, [...(from?.records ?? [])].filter((f) => !from?.running || f !== from.records.at(-1)), from?.turn ?? 0); toWorkspaces(baseline()); return { sessionId: id } }
      case 'session/rename': { const c = chats.get(r?.sessionId); if (c) c.title = r.title; return { title: r?.title } }
      case 'session/prompt': prompt(r); return {}
      case 'session/cancel': cancel(r?.sessionId); return {}
      case 'session/modelCatalog': return { groups: [{ id: 'sample', name: t.computer, models: [{ id: 'sample-model', name: t.model }] }] }
      case '$events/result': answered(args); return {}
      case 'workspace/pinSession': pinned = [...pinned, r?.sessionId]; toWorkspaces({ type: 'pinned', pinnedSessionIds: pinned }); return {}
      case 'workspace/unpinSession': pinned = pinned.filter((id) => id !== r?.sessionId); toWorkspaces({ type: 'pinned', pinnedSessionIds: pinned }); return {}
      case 'workspace/archiveSession': archived = [...archived, r?.sessionId]; toWorkspaces({ type: 'archived', archivedSessionIds: archived }); return {}
      case 'workspace/unarchiveSession': archived = archived.filter((id) => id !== r?.sessionId); toWorkspaces({ type: 'archived', archivedSessionIds: archived }); return {}
      case 'workspaceFiles/list': return { path: args?.path === '.' ? '' : args?.path, entries: FILES[args?.path] ?? [], truncated: false }
      case 'workspaceFiles/read': { const body = args?.path === 'README.md' ? t.readme : CODE[args?.path] ?? ''; const lines = body.split('\n'); return { offset: 1, text: body, lines: lines.length, totalLines: lines.length } }
      case 'schedule/catalog': return [{ id: 'try-task', kind: 'daily', title: t.taskTitle, prompt: t.taskPrompt, scheduledAt: new Date(now + 8 * hour).toISOString(), sessionId: 'try-fix', status: 'active', time: '09:00' }]
      case 'schedule/history': return { items: [] }
      case 'terminal/list': return []
      default: return {} // what the sample has nothing for: empty, as a computer with none of it answers
    }
  }

  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url.endsWith('/v1/capabilities')) return respond({ computerName: t.computer, hostVersion: '', upstreamVersion: '' })
    const method = String(url).replace(/^.*?\/(api|companion)\//, '')
    const args = JSON.parse(String(init?.body ?? '{}'))?.payload?.args ?? {}
    return respond({ result: { ok: true, value: rpc(method, args) } })
  }) as unknown as typeof fetch

  const socket = (): SocketLike => {
    const streams = new Map<string, () => void>()
    const s: SocketLike = {
      onopen: null, onmessage: null, onclose: null, onerror: null, readyState: 0,
      send(raw) {
        const m = JSON.parse(raw)
        if (m.type === 'cancel') { streams.get(m.streamId)?.(); streams.delete(m.streamId); return }
        if (m.type !== 'open') return
        const stream: Stream = { id: m.streamId, send: (value) => { if (s.readyState === 1) s.onmessage?.({ data: JSON.stringify({ type: 'item', streamId: m.streamId, value }) }) } }
        const endStream = () => s.onmessage?.({ data: JSON.stringify({ type: 'end', streamId: m.streamId }) })
        const args = m.payload?.args
        if (m.endpoint === '$events') {
          events.add(stream); streams.set(m.streamId, () => events.delete(stream))
          stream.send({ type: 'ready', clientId: 'try-it' })
          for (const open of opens.values()) stream.send(open.frame)
        } else if (m.endpoint === 'workspace/follow') {
          workspaces.add(stream); streams.set(m.streamId, () => workspaces.delete(stream))
          stream.send(baseline())
        } else if (m.endpoint === 'session/follow') {
          const id = args?.request?.address?.sessionId, chat = chats.get(id)
          const set = follows.get(id) ?? new Set(); set.add(stream); follows.set(id, set)
          streams.set(m.streamId, () => set.delete(stream))
          stream.send({ type: 'snapshot', header: { id }, cursor: seq, records: chat?.records ?? [], hasMore: false, projections: { values: { title: chat?.title ?? '' } }, assistantStream: { revision: 0 } })
        } else if (m.endpoint === 'job/list') stream.send({ type: 'rows', jobs: [] })
        else endStream()
      },
      close() { s.readyState = 3; for (const stop of streams.values()) stop(); streams.clear(); s.onclose?.() },
    }
    setTimeout(() => { if (s.readyState === 0) { s.readyState = 1; s.onopen?.() } }, 0)
    return s
  }
  return { fetch: fetcher, socket }
}
