// What is news about a chat between two looks at all of them (the chat list and the questions the agent waits on),
// and where the person hears it. The first look announces nothing: what finished before the app looked is not news.

export interface Seen { running: boolean; waiting: boolean; failed: boolean; title: string }
export type Alert = { kind: 'answer' | 'failed' | 'decision' | 'withdrawn'; sessionId: string; title: string }
export type Place = 'none' | 'banner' | 'system'

export function alertsBetween(before: Map<string, Seen> | undefined, now: Map<string, Seen>): Alert[] {
  if (!before) return []
  const out: Alert[] = []
  for (const [sessionId, s] of now) {
    const was = before.get(sessionId)
    if (!was) continue // appeared running or not: watched from now on
    if (s.waiting && !was.waiting) out.push({ kind: 'decision', sessionId, title: s.title })
    else if (!s.waiting && was.waiting) out.push({ kind: 'withdrawn', sessionId, title: s.title })
    // An answer is ready when the turn ends and nothing waits on the person (a waiting chat already said so); a turn
    // that DSH reported an error for ended in it.
    if (was.running && !s.running && !s.waiting && !was.waiting) out.push({ kind: s.failed ? 'failed' : 'answer', sessionId, title: s.title })
  }
  for (const [sessionId, was] of before) if (was.waiting && !now.has(sessionId)) out.push({ kind: 'withdrawn', sessionId, title: was.title })
  return out
}

/** The chat on screen needs no word; another chat gets a banner in the app; with the app away, the system tells. */
export function placeOf(alert: Alert, app: { active: boolean; visible: string | undefined }): Place {
  if (!app.active) return 'system'
  return app.visible === alert.sessionId ? 'none' : 'banner'
}
