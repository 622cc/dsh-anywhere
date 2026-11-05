// What the agent waits on the person for: approvals and questions, from DSH's $events stream (docs/research/
// dsh-protocol-parity.md §5–6). A ready frame names this connection (clientId, which every answer carries); then
// pending requests (waterfall) arrive, a cancel withdraws one, and a new connection resends all that are still open.
export interface Option { label: string; description?: string }
export interface Question { id: string; question: string; detail?: string; header?: string; options: Option[]; multiSelect: boolean }
export type Request =
  | { kind: 'approval'; eventId: string; sessionId: string; tool: string; reason: string; callId?: string }
  | { kind: 'question'; eventId: string; sessionId: string; questions: Question[]; callId?: string }

const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : undefined)
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export class Pending {
  clientId = ''
  private requests = new Map<string, Request>()

  apply(frame: unknown): void {
    const f = obj(frame); if (!f) return
    if (f.type === 'ready') { this.clientId = str(f.clientId) ?? ''; this.requests.clear(); return }
    if (f.type === 'cancel') { this.requests.delete(String(f.eventId)); return }
    if (f.type !== 'waterfall') return
    const eventId = str(f.eventId), sessionId = str(f.agentId), r = obj(f.request)
    if (!eventId || !sessionId || !r) return
    if (f.event === 'approval/request') {
      const display = r.displayReason
      const reason = str(display) ?? str(obj(display)?.en) ?? str(r.reason) ?? ''
      this.requests.set(eventId, { kind: 'approval', eventId, sessionId, tool: str(r.toolName) ?? 'tool', reason, ...(str(r.callId) ? { callId: r.callId } : {}) })
    } else if (f.event === 'user-questions/request' && Array.isArray(r.questions)) {
      const questions = r.questions.flatMap((q: unknown): Question[] => {
        const o = obj(q), id = str(o?.id), text = str(o?.question)
        if (!id || !text) return []
        const options = (Array.isArray(o!.options) ? o!.options : []).flatMap((x: unknown): Option[] => { const ox = obj(x), label = str(ox?.label); return label ? [{ label, ...(str(ox?.description) ? { description: ox!.description } : {}) }] : [] })
        return [{ id, question: text, ...(str(o!.detail) ? { detail: o!.detail } : {}), ...(str(o!.header) ? { header: o!.header } : {}), options, multiSelect: o!.multiSelect === true }]
      })
      if (questions.length) this.requests.set(eventId, { kind: 'question', eventId, sessionId, questions, ...(str(obj(r.wait)?.callId) ? { callId: r.wait.callId } : {}) })
    }
  }

  forSession(sessionId: string): Request[] { return [...this.requests.values()].filter((r) => r.sessionId === sessionId) }
  sessionsWaiting(): string[] { return [...new Set([...this.requests.values()].map((r) => r.sessionId))] }
  drop(eventId: string) { this.requests.delete(eventId) }
}

export const approvalAnswer = (clientId: string, eventId: string, allow: boolean) =>
  ({ clientId, eventId, outcome: { kind: 'result', value: allow ? 'allowed-once' : 'rejected' } })

/** Every question exactly once: a choice, a typed answer (replaces a single choice, adds to multiple), or nothing (skipped). */
export function questionAnswer(clientId: string, eventId: string, request: Extract<Request, { kind: 'question' }>, picks: Record<string, { selected?: string[]; custom?: string }>) {
  const answers = request.questions.map((q) => {
    const p = picks[q.id] ?? {}, custom = p.custom?.trim()
    const selected = custom && !q.multiSelect ? [] : (p.selected ?? [])
    return custom ? { id: q.id, selected, custom } : { id: q.id, selected }
  })
  return { clientId, eventId, outcome: { kind: 'result', value: { answers } } }
}
