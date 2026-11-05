// Why the phone can't reach the computer, read from which part answers (link.diagnose, then the companion itself).
// A computer that is off and one that no longer allows this phone look the same to the tunnel: Tailcat gives a client
// it does not allow no reply (tailcat v0.6.0), so 'computer' says both.
import type { ConnectionState } from './dsh.ts'

export type Cause = 'connected' | 'slow' | 'trying' | 'no-network' | 'blocked' | 'computer' | 'companion' | 'refused'
export interface Check { relay?: 'reachable' | 'unreachable'; computer?: 'reachable' | 'unreachable'; access?: 'ok' | 'refused' | 'failed'; latencyMs?: number }

/** An answer slower than this reads as a slow connection. The first answer on a fresh connection takes several round trips. */
export const SLOW_MS = 2000

export function causeOf(s: { connection: ConnectionState; network: boolean; check?: Check }): Cause {
  const c = s.check
  if (!s.network) return 'no-network'
  if (c?.access === 'refused') return 'refused'
  if (s.connection === 'online') return (c?.latencyMs ?? 0) >= SLOW_MS ? 'slow' : 'connected'
  if (c?.relay === 'unreachable') return 'blocked'
  if (c?.computer === 'unreachable') return 'computer'
  if (c?.access === 'failed') return 'companion'
  return 'trying'
}
