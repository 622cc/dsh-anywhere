// DSH's session/follow stream folded into what DSH Desktop draws: the person's messages, the agent's
// answers, and a turn process for each run of thinking and tool calls. Frame shapes are DSH 0.2.1's
// (inspected in the companion's dsh-adapter and in sorsama/deepseek-harness-mobile's DTOs).
// Tool arguments become a title through stepTitle and, while a call runs, its detail through live.ts; tool output never
// reaches a row.
import { presentUserText } from '../../host/src/message-presentation.ts'
import { reasoningText, stepTitle, type StepKind, type StepStatus } from '../../host/src/step-presentation.ts'
import { fieldsSoFar, reasoningDetail, toolDetail } from './live.ts'
import { selectionOf, type Selection } from './models.ts'
import { inboxOf, splice, type Inbox } from './queue.ts'
import { S, stringsFor, type Strings } from './strings.ts'
import { catalogAdd, catalogOf, type Subagent } from './subagents.ts'

/** One of the agent's to-dos (the `todos` projection; todo/write replaces the whole list). */
export interface Todo { content: string; status: 'pending' | 'in_progress' | 'completed' }
export function todosOf(v: unknown): Todo[] {
  return (Array.isArray(v) ? v : []).flatMap((t) => typeof obj(t)?.content === 'string' ? [{ content: obj(t)!.content, status: ['in_progress', 'completed'].includes(obj(t)!.status) ? obj(t)!.status : 'pending' } as Todo] : [])
}
export interface Step { callId: string; tool: string; title: string; kind: StepKind; status: StepStatus; at: number }
/** A tool call as the trajectory lists it: a step, and when it settled. */
export interface Call extends Step { endedAt?: number }
/** The tool calls of one turn, by the turn number DSH writes on each call. */
export interface Turn { id: string; turn: number | undefined; calls: Call[] }
export type Row =
  | { kind: 'user'; id: string; text: string; attachments: Attached[]; at: number; rpcId?: string }
  | { kind: 'notice'; id: string; text: string; at: number }
  | { kind: 'assistant'; id: string; text: string; at: number; streaming: boolean }
  | { kind: 'process'; id: string; steps: Step[]; entries: Entry[]; at: number }
  | { kind: 'command'; id: string; line: string; state: CommandState; text: string; at: number }
  /** A turn that ended in an error or was stopped: what Desktop shows under it (`failureCopy` words it). */
  | { kind: 'failure'; id: string; code?: string; message: string; at: number }
export type CommandState = 'running' | 'success' | 'error'
/** What a turn did, in order, as DSH Desktop lists it when the turn is opened. */
export type Entry = { kind: 'think'; id: string; text: string } | { kind: 'step'; id: string; step: Step }
/** A photo or file sent with a message; a photo's bytes come from session/attachment. */
export interface Attached { kind: 'image' | 'file'; attachmentId: string; name: string; bytes: number; width?: number; height?: number }
export type ProcessLabel = 'analyzing' | 'commands' | 'read' | 'edit' | 'search' | 'web' | 'plan' | 'tools' | 'done'

type Item =
  | { type: 'user'; id: string; text: string; attachments: Attached[]; at: number; rpcId?: string }
  | { type: 'notice' | 'assistant' | 'thought'; id: string; text: string; at: number }
  | { type: 'step'; step: Step; turn?: number; endedAt?: number }
  | { type: 'command'; id: string; line: string; state: CommandState; text: string; at: number }
  | { type: 'failure'; id: string; code?: string; message: string; at: number }
interface Node { seq: number; items: Item[] }
interface Attempt { id: string; turn: number; step: number; blocks: Map<number, string>; thinking: Map<number, string>; tools: Map<number, StreamedCall>; at: number }
/** A tool call the model is still writing. Its detail comes from the first arguments, however long the rest (a file being written). */
interface StreamedCall { name: string; raw: string; closed: boolean }
const RAW_LIMIT = 8192

const SURFACE = new Set(['user/message', 'assistant/message', 'system/message', 'developer/message', 'tool/result'])
const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : undefined)
const attachmentsOf = (content: unknown): Attached[] => (Array.isArray(content) ? content : []).flatMap((b): Attached[] => {
  const kind = obj(b)?.type, a = obj(obj(b)?.attachment)
  if ((kind !== 'image' && kind !== 'file') || typeof a?.attachmentId !== 'string') return []
  return [{ kind, attachmentId: a.attachmentId, name: typeof a.name === 'string' ? a.name : kind === 'image' ? 'image' : 'file', bytes: Number(a.bytes) || 0,
    ...(kind === 'image' && Number(a.width) && Number(a.height) ? { width: Number(a.width), height: Number(a.height) } : {}) }]
})
const textOf = (content: unknown) => (Array.isArray(content) ? content.map((b) => (obj(b)?.type === 'text' && typeof obj(b)?.text === 'string' ? obj(b)!.text : '')).join('') : '')

/** What the process row says while it runs, as DSH Desktop does ("Running commands"); a finished one takes `doneTitle`. */
export function headline(row: Extract<Row, { kind: 'process' }>, turnRunning: boolean): { label: ProcessLabel; toolCalls: number } {
  const current = [...row.steps].reverse().find((s) => s.status === 'in_progress')
  const toolCalls = row.steps.length
  if (!turnRunning && !current) return { label: 'done', toolCalls }
  const label: ProcessLabel = !current ? 'analyzing'
    : current.kind === 'execute' ? 'commands' : current.kind === 'read' ? 'read'
    : ['edit', 'delete', 'move'].includes(current.kind) ? 'edit' : current.kind === 'search' ? 'search'
    : current.kind === 'fetch' ? 'web' : current.kind === 'think' ? 'plan' : 'tools'
  return { label, toolCalls }
}

export type Activity = 'thinking' | 'read' | 'readImage' | 'write' | 'search' | 'edit' | 'commands' | 'code' | 'webSearch' | 'webFetch' | 'subagents' | 'plan' | 'questions' | 'tools'
export type ToolActivity = Exclude<Activity, 'thinking'>
/** Which of Desktop's activities a tool is (dsh-client-ui-chat `activity`). */
export function activity(tool: string): ToolActivity {
  if (tool === 'read') return 'read'
  if (tool === 'read_image') return 'readImage'
  if (tool === 'grep' || tool === 'glob' || tool.endsWith('_inspect')) return 'search'
  if (tool === 'write') return 'write'
  if (tool === 'edit' || tool === 'apply_patch') return 'edit'
  if (['bash', 'pwsh', 'exec_command', 'write_stdin'].includes(tool) || tool.startsWith('terminal_')) return 'commands'
  if (tool === 'run_code') return 'code'
  if (tool === 'web_search') return 'webSearch'
  if (tool === 'web_fetch') return 'webFetch'
  if (tool === 'subagent' || tool.startsWith('subagent_')) return 'subagents'
  if (['todo_write', 'create_goal', 'update_goal', 'get_goal'].includes(tool)) return 'plan'
  if (tool === 'ask_user_question' || tool === 'request_user_input') return 'questions'
  return 'tools'
}
/** What the running turn is on now: a tool call the model is still writing (`preparing`) and the detail that keeps changing. */
export interface LiveLine { preparing?: ToolActivity; detail: string }
/** A running process's title, as Desktop's: what it does, a dot, what it is on. */
export function liveText(line: LiveLine, label: ProcessLabel, t: Strings = S): string {
  const head = line.preparing ? t.prepare[line.preparing] : t.process[label]
  return line.detail ? `${head} · ${line.detail}` : head
}

/** A finished process's title, as Desktop's: its three activities with the most calls (ties by first call); the rest are in the open process. */
export function doneTitle(steps: Step[], t: Strings = S): string {
  const counts = new Map<Activity, number>()
  for (const s of steps) counts.set(activity(s.tool), (counts.get(activity(s.tool)) ?? 0) + 1)
  const labels = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => t.done[a])
  const lower = (l: string) => l.charAt(0).toLowerCase() + l.slice(1)
  if (!labels.length) return t.done.thinking
  if (labels.length === 2) return t.joinTwo(labels[0], lower(labels[1]))
  return [labels[0], ...labels.slice(1).map(lower)].join(t.listSep)
}

/** Tool name as DSH Desktop labels a row ("Bash", "Web fetch"). */
export const toolLabel = (tool: string) => { const s = tool.split(/[_-]/).filter(Boolean).join(' '); return s.charAt(0).toUpperCase() + s.slice(1) }

/** Messages the person wrote: typed, or an answer to the agent's question (DSH takes it as next-step input). */
const PERSON = new Set(['user', 'user-question-reply'])
/** What DSH Desktop titles a turn that DSH itself started (a goal round, a schedule, a webhook…), by its source. */
function triggerTitle(source: Record<string, any>): string {
  return S.triggers[source.kind === 'webhook' && source.provider === 'github' ? 'webhook:github' : source.kind] ?? S.triggers.default
}

const NO_TODOS: Todo[] = []

function callDetail(name: string, args: unknown): string {
  let fields: Record<string, unknown> = {}
  try { const parsed: unknown = typeof args === 'string' ? JSON.parse(args) : args; if (obj(parsed)) fields = obj(parsed)! } catch { /* the model's own malformed arguments: the name stands in */ }
  return toolDetail(name, fields, true)
}

export class Fold {
  title = ''
  running = false
  /** The step the running turn is on: what DSH sends in step 1 started the turn. */
  private step = 0
  /** The model the next turn uses (the session's modelSelection projection: next, else last used). */
  model: Selection | undefined
  /** The agent's to-dos, as it last wrote them; none once a turn ends without touching them (the list is left behind). */
  get todos(): Todo[] { return this.todosLeft ? NO_TODOS : this.list }
  private list: Todo[] = []
  private todosLeft = false
  private todosTouched = false
  /** The chat's subagents (the subagentCatalog projection). */
  subagents: Subagent[] = []
  /** Messages waiting for the agent (the session's inbox projection). */
  inbox: Inbox = inboxOf(undefined)
  private nodes: Node[] = []
  private attempt: Attempt | undefined
  /** What each tool call of this chat is on, from its arguments. */
  private details = new Map<string, string>()
  private revision = 0
  /** A settled message keeps the key its streamed row had, so the list updates that cell instead of swapping it. */
  private keys = new Map<string, string>()

  apply(frame: unknown): void {
    const f = obj(frame); if (!f) return
    if (f.type === 'snapshot') return this.snapshot(f)
    if (f.type === 'assistant-stream') return this.stream(obj(f.frame))
    if (f.type === 'event' && obj(f.event)?.type === 'agent/inbox/spliced') this.inbox = splice(this.inbox, obj(f.event)?.data)
    // The snapshot's projection already holds the catalog (without a fork's inherited children); live events add to it.
    if (f.type === 'event' && obj(f.event)?.type === 'subagent/catalog') this.subagents = catalogAdd(this.subagents, obj(f.event)?.data)
    if (f.type === 'event' || f.type === 'chunks') this.event(obj(f.event))
  }

  private snapshot(f: Record<string, any>): void {
    this.nodes = []; this.attempt = undefined; this.running = false; this.step = 0; this.details.clear()
    const values = obj(obj(f.projections)?.values)
    const title = values?.title ?? obj(f.header)?.title
    const ms = obj(values?.modelSelection)
    this.model = selectionOf(ms?.next) ?? selectionOf(ms?.lastUsed)
    // The projection already holds the splices among the records.
    this.inbox = inboxOf(values?.inbox)
    this.list = todosOf(values?.todos); this.todosLeft = false; this.todosTouched = false
    this.subagents = catalogOf(values?.subagentCatalog)
    if (typeof title === 'string') this.title = title
    for (const r of Array.isArray(f.records) ? f.records : []) this.event(obj(obj(r)?.event))
    const baseline = obj(f.assistantStream)
    this.revision = typeof baseline?.revision === 'number' ? baseline.revision : 0
    const active = obj(baseline?.activeAttempt)
    if (active && typeof active.attemptId === 'string') {
      this.attempt = { id: active.attemptId, turn: active.turn, step: active.step, blocks: new Map(), thinking: new Map(), tools: new Map(), at: Date.now() }
      this.running = true
      for (const rec of Array.isArray(active.stream) ? active.stream : []) {
        const r = obj(rec)
        if (r?.type === 'text-chunks' && Array.isArray(r.texts)) this.chunk({ type: 'text-delta', index: r.index, text: r.texts.filter((t: unknown) => typeof t === 'string').join('') })
        else if (r?.type === 'reasoning-chunks' && Array.isArray(r.texts)) this.chunk({ type: 'reasoning-delta', index: r.index, text: r.texts.filter((t: unknown) => typeof t === 'string').join('') })
        else if (r?.type === 'tool-call-chunks' && Array.isArray(r.args)) this.chunk({ type: 'tool-call-delta', index: r.index, name: r.name, argumentsDelta: r.args.filter((t: unknown) => typeof t === 'string').join('') })
        else if (r?.type === 'chunk') this.chunk(obj(r.chunk))
      }
    }
  }

  private event(e: Record<string, any> | undefined): void {
    if (!e || typeof e.type !== 'string' || typeof e.seq !== 'number') return
    const data = obj(e.data), at = typeof e.time === 'number' ? e.time : 0
    switch (e.type) {
      case 'turn/start': this.running = true; this.step = 0; this.todosTouched = false; return
      case 'step/start': if (typeof data?.step === 'number') this.step = data.step; return
      case 'turn/end': {
        this.running = false; this.attempt = undefined; this.settle(() => true, 'failed', at); if (!this.todosTouched) this.todosLeft = true
        const failure = failureOf(obj(data?.reason))
        if (failure) this.nodes.push({ seq: e.seq, items: [{ type: 'failure', id: `failure:${e.seq}`, ...failure, at }] })
        return
      }
      case 'todo/write': this.list = todosOf(data?.todos); this.todosLeft = false; this.todosTouched = true; return
      case 'session/title': if (typeof data?.title === 'string') this.title = data.title; return
      // A command typed on the phone or the Desktop: logged as it starts, settled with its result.
      case 'command/run':
        if (typeof data?.commandId === 'string' && typeof data.name === 'string') {
          const args = typeof data.args === 'string' ? data.args.trim() : ''
          this.nodes.push({ seq: e.seq, items: [{ type: 'command', id: data.commandId, line: `/${data.name}${args ? ` ${args}` : ''}`, state: 'running', text: '', at }] })
        }
        return
      case 'command/done':
        for (const n of this.nodes) for (const it of n.items) if (it.type === 'command' && it.id === data?.commandId) {
          it.state = data.kind === 'success' ? 'success' : 'error'; it.text = typeof data.text === 'string' ? data.text : ''
        }
        return
      case 'tool/call':
        if (typeof data?.callId === 'string' && typeof data.name === 'string') {
          const { title, kind } = stepTitle(data.name, data.arguments)
          this.details.set(data.callId, callDetail(data.name, data.arguments))
          this.nodes.push({ seq: e.seq, items: [{ type: 'step', step: { callId: data.callId, tool: data.name, title, kind, status: 'in_progress', at }, ...(typeof data.turn === 'number' ? { turn: data.turn } : {}) }] })
        }
        return
    }
    if (e.type === 'tool/result') {
      const m = obj(data?.message); if (typeof m?.toolCallId === 'string') this.settle((s) => s.callId === m.toolCallId, m.isError === true ? 'failed' : 'completed', at)
    }
    if ((e.type === 'assistant/message' || e.type === 'assistant/attempt') && this.attempt && this.attempt.turn === data?.turn && this.attempt.step === data?.step) {
      const id = obj(data?.message)?.id
      if (typeof id === 'string' && this.attempt.blocks.size) this.keys.set(id, `live:${this.attempt.id}`)
      this.attempt = undefined
    }
    if (!SURFACE.has(e.type)) return
    this.surface(e.seq, e.surfaceOp, this.items(e.type, data, at))
  }

  private items(type: string, data: Record<string, any> | undefined, at: number): Item[] {
    if (type === 'user/message' && typeof data?.id === 'string') {
      const source = obj(data.source), shown = presentUserText(textOf(data.content), source?.kind)
      const attachments = attachmentsOf(data.content)
      // DSH appends what started a turn in its first step: that is the turn's trigger. What it adds later is context.
      if (shown.kind !== 'context' && typeof source?.kind === 'string' && !PERSON.has(source.kind)) return this.step > 1 ? [] : [{ type: 'notice', id: data.id, text: triggerTitle(source), at }]
      if (shown.kind === 'context' || (!shown.text && !attachments.length)) return []
      if (shown.kind === 'agent_event') return [{ type: 'notice', id: data.id, text: shown.text, at }]
      return [{ type: 'user', id: data.id, text: shown.text, attachments, at, ...(typeof source?.rpcId === 'string' ? { rpcId: source.rpcId } : {}) }]
    }
    if (type === 'assistant/message') {
      const m = obj(data?.message); if (typeof m?.id !== 'string') return []
      const thought = reasoningText(m.content), text = textOf(m.content)
      return [...(thought ? [{ type: 'thought' as const, id: `thought:${m.id}`, text: thought, at }] : []), ...(text ? [{ type: 'assistant' as const, id: m.id, text, at }] : [])]
    }
    return []
  }

  /** DSH's surface ops: append, or replace the span startSeq..endSeq (compaction) with this node. */
  private surface(seq: number, op: unknown, items: Item[]): void {
    const node = { seq, items }
    const replace = obj(op)
    if (replace?.op !== 'replace') { this.nodes.push(node); return }
    const start = this.nodes.findIndex((n) => n.seq === replace.startSeq), end = this.nodes.findIndex((n) => n.seq === replace.endSeq)
    if (start >= 0 && end >= start) this.nodes.splice(start, end - start + 1, node)
    else if (end >= 0) this.nodes.splice(0, end + 1, node)
    else this.nodes.push(node)
  }

  private settle(match: (s: Step) => boolean, status: StepStatus, at: number): void {
    for (const n of this.nodes) for (const it of n.items) if (it.type === 'step' && it.step.status === 'in_progress' && match(it.step)) { it.step = { ...it.step, status }; it.endedAt = at }
  }

  /** Every tool call in the chat's loaded history, turn by turn, as Desktop's Trajectory lists them. */
  trajectory(): Turn[] {
    const out: Turn[] = []
    for (const n of this.nodes) for (const it of n.items) {
      if (it.type !== 'step') continue
      let t = out.at(-1)
      if (!t || t.turn !== it.turn) out.push(t = { id: `turn:${it.turn ?? ''}:${it.step.callId}`, turn: it.turn, calls: [] })
      t.calls.push(it.endedAt === undefined ? it.step : { ...it.step, endedAt: it.endedAt })
    }
    return out
  }

  private stream(f: Record<string, any> | undefined): void {
    if (!f || typeof f.revision !== 'number' || typeof f.attemptId !== 'string') return
    if (f.type === 'start' && f.revision === 1) this.revision = 0
    if (f.revision <= this.revision) return
    this.revision = f.revision
    if (f.type === 'start') { this.attempt = { id: f.attemptId, turn: f.turn, step: f.step, blocks: new Map(), thinking: new Map(), tools: new Map(), at: Date.now() }; this.running = true; return }
    if (!this.attempt || this.attempt.id !== f.attemptId) return
    if (f.type === 'chunk') { if (this.attempt.blocks.size === 0 && typeof f.time === 'number') this.attempt.at = f.time; this.chunk(obj(f.chunk)) }
    if (f.type === 'end') this.attempt = undefined
  }

  private chunk(c: Record<string, any> | undefined): void {
    const a = this.attempt; if (!c || !a || typeof c.index !== 'number') return
    if (c.type === 'text-delta' && typeof c.text === 'string') a.blocks.set(c.index, (a.blocks.get(c.index) ?? '') + c.text)
    else if (c.type === 'block-end' && obj(c.block)?.type === 'text' && typeof c.block.text === 'string') a.blocks.set(c.index, c.block.text)
    else if (c.type === 'reasoning-delta' && typeof c.text === 'string') a.thinking.set(c.index, (a.thinking.get(c.index) ?? '') + c.text)
    else if (c.type === 'block-end' && obj(c.block)?.type === 'reasoning' && typeof c.block.text === 'string') a.thinking.set(c.index, c.block.text)
    else if (c.type === 'tool-call-delta') {
      const t = a.tools.get(c.index)
      a.tools.set(c.index, { name: typeof c.name === 'string' ? c.name : t?.name ?? '', raw: ((t?.raw ?? '') + (typeof c.argumentsDelta === 'string' ? c.argumentsDelta : '')).slice(0, RAW_LIMIT), closed: false })
    } else if (c.type === 'block-end' && obj(c.block)?.type === 'tool-call') {
      a.tools.set(c.index, { name: typeof c.block.name === 'string' ? c.block.name : '', raw: typeof c.block.arguments === 'string' ? c.block.arguments.slice(0, RAW_LIMIT) : '', closed: true })
    }
  }

  /** What the running turn is on now, as Desktop's process title reads it: the call being written or running last, else the thinking. */
  live(): LiveLine {
    const a = this.attempt
    const latest = <T>(blocks: Map<number, T> | undefined) => [...(blocks ?? new Map<number, T>()).entries()].sort((x, y) => y[0] - x[0]).map(([, v]) => v)
    const writing = latest(a?.tools)[0]
    if (writing) return { preparing: activity(writing.name), detail: toolDetail(writing.name, fieldsSoFar(writing.raw), writing.closed) }
    for (let n = this.nodes.length - 1; n >= 0; n--) {
      const items = this.nodes[n]!.items
      for (let i = items.length - 1; i >= 0; i--) { const it = items[i]!; if (it.type === 'step' && it.step.status === 'in_progress') return { detail: this.details.get(it.step.callId) ?? '' } }
    }
    // Once the answer is coming its words are on screen; the thinking before it is done.
    if (!a || a.blocks.size) return { detail: '' }
    for (const text of latest(a.thinking)) { const detail = reasoningDetail(text); if (detail) return { detail } }
    return { detail: '' }
  }

  rows(): Row[] {
    const out: Row[] = []
    let group: Extract<Row, { kind: 'process' }> | undefined
    const groupFor = (id: string, at: number) => { if (!group) { group = { kind: 'process', id: `process:${id}`, steps: [], entries: [], at }; out.push(group) } return group }
    for (const n of this.nodes) for (const it of n.items) {
      if (it.type === 'step') { const g = groupFor(it.step.callId, it.step.at); g.steps.push(it.step); g.entries.push({ kind: 'step', id: `step:${it.step.callId}`, step: it.step }) }
      else if (it.type === 'thought') groupFor(it.id, it.at).entries.push({ kind: 'think', id: it.id, text: it.text })
      else if (it.type === 'command') { group = undefined; out.push({ kind: 'command', id: it.id, line: it.line, state: it.state, text: it.text, at: it.at }) }
      else if (it.type === 'failure') { group = undefined; out.push({ kind: 'failure', id: it.id, ...(it.code === undefined ? {} : { code: it.code }), message: it.message, at: it.at }) }
      else { group = undefined; out.push(it.type === 'assistant' ? { kind: 'assistant', id: this.keys.get(it.id) ?? it.id, text: it.text, at: it.at, streaming: false } : it.type === 'user' ? { kind: 'user', id: it.id, text: it.text, attachments: it.attachments, at: it.at, ...(it.rpcId ? { rpcId: it.rpcId } : {}) } : { kind: it.type, id: it.id, text: it.text, at: it.at }) }
    }
    const live = this.attempt ? [...this.attempt.blocks.entries()].sort((x, y) => x[0] - y[0]).map(([, t]) => t).join('') : ''
    if (this.attempt && live) out.push({ kind: 'assistant', id: `live:${this.attempt.id}`, text: live, at: this.attempt.at, streaming: true })
    return out
  }
}

/** The next rows, reusing the previous object of every row that did not change: unchanged cells are not redrawn. */
export function keepUnchanged<T extends { id: string }>(previous: readonly T[], next: T[]): T[] {
  const old = new Map(previous.map((r) => [r.id, r]))
  return next.map((r) => { const p = old.get(r.id); return p && JSON.stringify(p) === JSON.stringify(r) ? p : r })
}

/** The answers that end a finished turn: the last answer before the person's next message, and the chat's last one once the agent stopped. */
export function turnEnds(rows: readonly Row[], running: boolean): Set<string> {
  const out = new Set<string>()
  rows.forEach((r, i) => {
    if (r.kind !== 'assistant' || (r as { streaming?: boolean }).streaming) return
    if (i === rows.length - 1 ? !running : rows[i + 1]!.kind === 'user') out.add(r.id)
  })
  return out
}

/** How a failure row reads, as Desktop's TurnErrorItem: its title, the message (Desktop's words for the codes it knows),
 * and the code, except for an interruption. */
export function failureCopy(row: Extract<Row, { kind: 'failure' }>, tag?: string): { title: string; message: string; code?: string } {
  const t = tag === undefined ? S : stringsFor(tag), code = row.code
  const title = code === 'ACCOUNT_SIGNED_OUT' || code === 'INTERRUPTED' ? t.taskStopped : t.turnError
  const message = code === 'ACCOUNT_SIGNED_OUT' ? t.failure.accountSignedOut : code === 'INTERRUPTED' ? t.failure.interrupted
    : code === 'ACCOUNT_SIGN_IN_REQUIRED' ? t.failure.accountSignInRequired : code === 'QUOTA' || code === 'ACCOUNT_QUOTA' ? t.failure.quota
    : code === 'AUTH' ? t.failure.auth : row.message
  return { title, message, ...(code !== undefined && code !== 'INTERRUPTED' ? { code } : {}) }
}

/** What ended a turn, when Desktop shows it as a failure (dsh-client-ui-chat turn-error `endFailure` + `displayFailure`):
 * a recorded error, a stop on signing out of DeepSeek, or a turn closed because the DSH process exited. */
function failureOf(reason: Record<string, any> | undefined): { code?: string; message: string } | undefined {
  if (reason?.kind === 'interrupted') return { code: 'INTERRUPTED', message: '' }
  if (reason?.kind === 'aborted') return obj(reason.reason)?.kind === 'hook' && obj(reason.reason)?.reason === 'deepseek-account/signed-out' ? { code: 'ACCOUNT_SIGNED_OUT', message: '' } : undefined
  if (reason?.kind !== 'error') return undefined
  const error = reason.error
  if (!error || typeof error !== 'object') return { message: String(error) }
  const code = typeof error.code === 'string' ? error.code : undefined
  // Desktop never shows the provider's raw text for AUTH: it can carry the key's own details.
  if (code === 'AUTH') return { code, message: '' }
  return { ...(code === undefined ? {} : { code }), message: typeof error.message === 'string' ? error.message : JSON.stringify(error) }
}
