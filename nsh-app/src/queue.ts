// Messages waiting for the agent. DSH keeps them in the session's inbox: `next-turn` (queued, taken when the turn
// ends) and `next-step` (steering, taken at the agent's next step). The follow snapshot carries the `inbox`
// projection; agent/inbox/spliced events change it (dsh-agent-loop's inbox projection, DSH 0.2.1-rc.3).
import type { Outgoing } from './outbox.ts'

type Message = Record<string, any>
export interface Inbox { 'next-turn': Message[]; 'next-step': Message[] }
/** One message the person typed that the agent has not taken yet. */
export interface Queued { id: string; text: string; rpcId?: string; steering: boolean }
/** A row of the queue above the composer: a message on its way there, or already in DSH's inbox (`item`). */
export interface Waiting { id: string; text: string; state: Outgoing['state']; item?: Queued; error?: string }

const TARGETS = ['next-turn', 'next-step'] as const
const list = (v: unknown): Message[] => (Array.isArray(v) ? v.filter((m) => m && typeof m === 'object' && typeof m.id === 'string') : [])

export function inboxOf(v: unknown): Inbox {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return { 'next-turn': list(o['next-turn']), 'next-step': list(o['next-step']) }
}

/** The inbox after one agent/inbox/spliced event; an event that does not fit leaves it as it was. */
export function splice(inbox: Inbox, data: unknown): Inbox {
  const d = data && typeof data === 'object' ? (data as Record<string, any>) : {}
  const target = TARGETS.find((t) => t === d.target)
  if (!target) return inbox
  const items = inbox[target], start = d.start, removed = d.removedCount ?? 0
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(removed) || removed < 0 || start + removed > items.length) return inbox
  return { ...inbox, [target]: items.toSpliced(start, removed, ...list(d.inserted)) }
}

const textOf = (content: unknown) => (Array.isArray(content) ? content.map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('').trim() : '')

/** What the person typed, steering first (it is taken sooner); question replies and other input are not theirs to manage. */
export function queued(inbox: Inbox): Queued[] {
  const of = (m: Message, steering: boolean): Queued[] => {
    if (m.source?.kind !== 'user') return []
    const rpcId = typeof m.source.rpcId === 'string' ? m.source.rpcId : undefined
    return [{ id: m.id, text: textOf(m.content), ...(rpcId ? { rpcId } : {}), steering }]
  }
  return [...inbox['next-step'].flatMap((m) => of(m, true)), ...inbox['next-turn'].flatMap((m) => of(m, false))]
}

/** The queue above the composer: messages sent while the agent worked (`held`), in DSH's inbox or still on their
 * way, and the inbox items typed elsewhere. A message sent to an idle agent passes through the inbox unseen. */
export function waiting(inbox: Inbox, outbox: readonly Outgoing[]): Waiting[] {
  const items = queued(inbox), sent = new Map(outbox.map((o) => [o.id, o]))
  const listed: Waiting[] = items.flatMap((q) => {
    const o = q.rpcId ? sent.get(q.rpcId) : undefined
    if (o && !o.held) return []
    return [{ id: o?.id ?? q.id, text: q.text, state: 'queued' as const, item: q }]
  })
  const inInbox = new Set(items.map((q) => q.rpcId))
  for (const o of outbox) if (o.held && !inInbox.has(o.id) && o.state !== 'queued') listed.push({ id: o.id, text: o.text, state: o.state, ...(o.error ? { error: o.error } : {}) })
  return listed
}
