// A chat row swiped left to its actions, with t3code's thresholds (docs/research/mobile-ux-feel.md): the actions show
// past 42% of their width, and a swipe past max(actions + 44, 58% of the row) acts when the finger lets go. Acting
// waits for the release and takes the finger's position only (destructive actions do not ride a fling); opening
// and closing take the fling into account, as a 0.2 s projection.

export interface Thresholds { width: number; actions: number; reveal: number; full: number }

export function swipeThresholds(rowWidth: number, actionsWidth: number): Thresholds {
  return { width: rowWidth, actions: actionsWidth, reveal: actionsWidth * 0.42, full: Math.min(rowWidth, Math.max(actionsWidth + 44, rowWidth * 0.58)) }
}

/** Where the row goes for a drag of `dx` from `start`: leftwards only, at most its width. */
export const dragTo = (start: number, dx: number, rowWidth: number) => Math.max(-rowWidth, Math.min(0, start + dx))

export function release(offset: number, velocity: number, t: Thresholds): 'act' | 'open' | 'closed' {
  if (-offset >= t.full) return 'act'
  return -(offset + velocity * 0.2) >= t.reveal ? 'open' : 'closed'
}
