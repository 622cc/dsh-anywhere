// Messages on their way to DSH. A sent message shows at once in the chat; DSH's stream carries it back as a
// user row, which then takes its place (its cell keeps the outgoing id, so the list does not swap it).
// DSH gives the prompt back with the requestId it was sent with (user/message source.rpcId), so the row is found
// by that id; a row without one (a child's follow-up) is found by its text: the first row with that text beyond those
// that were there (or already on their way) when it was sent.
import type { Draft } from './attach.ts'
import type { Row } from './fold.ts'
import { S } from './strings.ts'

export type OutgoingState = 'sending' | 'queued' | 'failed'
/** `held`: sent while the agent worked, so it waits in the queue above the composer instead of the chat. */
/** `sentAt`: when this try went out; `acceptedAt`: when the computer answered that it has the message. */
export interface Outgoing { id: string; text: string; drafts: Draft[]; state: OutgoingState; error?: string; ahead: number; held?: boolean; sentAt?: number; acceptedAt?: number }

/** Rows a message without a request id could be: those with its text and no request id of their own. */
const sameText = (rows: readonly Row[], text: string) => rows.filter((r) => r.kind === 'user' && !r.rpcId && r.text.trim() === text).length

/** A message as it is sent: `ahead` counts the rows and earlier outgoing messages with its text. */
export function outgoing(id: string, text: string, drafts: Draft[], rows: readonly Row[], outbox: readonly Outgoing[], held = false): Outgoing {
  const t = text.trim()
  return { id, text: t, drafts, state: 'sending', ahead: sameText(rows, t) + outbox.filter((o) => o.text === t).length, ...(held ? { held } : {}) }
}

/** The message after it was edited in the queue: it now waits for a row with the new text. */
export function retext(o: Outgoing, text: string, rows: readonly Row[], outbox: readonly Outgoing[]): Outgoing {
  const t = text.trim()
  return { ...o, text: t, ahead: sameText(rows, t) + outbox.filter((x) => x.id !== o.id && x.text === t).length }
}

/** The messages still on their way, and [row id, outgoing id] for those whose rows arrived. */
/** `started`: queued messages that reached the chat, each starting a turn of its own. */
export function settle(outbox: readonly Outgoing[], rows: readonly Row[]): { outbox: Outgoing[]; arrived: [string, string][]; started: string[] } {
  const arrived: [string, string][] = [], started: string[] = []
  const left = outbox.filter((o) => {
    if (o.state === 'failed') return true
    const row = rows.find((r) => r.kind === 'user' && r.rpcId === o.id)
      ?? rows.filter((r) => r.kind === 'user' && !r.rpcId && r.text.trim() === o.text)[o.ahead]
    if (!row) return true
    arrived.push([row.id, o.id]); if (o.held) started.push(o.id)
    return false
  })
  return { outbox: left.length === outbox.length ? (outbox as Outgoing[]) : left, arrived, started }
}

/** No answer for this long while sending: say so, the computer may be slow or unreachable. */
export const SLOW_MS = 6000
/** Delivered to an idle agent this long ago without its turn starting: say the agent has not started. */
export const IDLE_MS = 15000

/** Where a message is, in words under its bubble. */
export function outgoingStatus(o: Outgoing, busy: boolean, now: number): { text: string; reason?: string; failed: boolean } {
  if (o.state === 'failed') return { text: S.notSent, ...(o.error ? { reason: o.error } : {}), failed: true }
  if (o.state === 'sending') return { text: now - (o.sentAt ?? now) >= SLOW_MS ? S.sendingSlow : S.sending, failed: false }
  if (busy) return { text: S.queued, failed: false }
  return { text: now - (o.acceptedAt ?? now) >= IDLE_MS ? S.deliveredIdle : S.delivered, failed: false }
}

/** The agent works, and nothing of this turn shows yet since the last message: it is reading the request. */
export function awaitingFirstStep(rows: readonly Row[], running: boolean): boolean {
  if (!running) return false
  for (let i = rows.length - 1; i >= 0; i--) {
    const k = rows[i]!.kind
    if (k === 'user') return true
    if (k === 'process' || k === 'assistant' || k === 'failure' || k === 'command') return false
  }
  return true
}
