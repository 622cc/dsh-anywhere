// The trajectory page's view on its own (src/views.test.tsx): `host.params.state` picks loading, a failure that a
// retry clears, an empty chat, or two turns of synthetic tool calls.
import { host, mount, signal } from 'nsh'
import { TrajectoryView } from '../trajectory.tsx'
import type { Turn } from '../fold.ts'

const T = 1_767_258_000_000
const turns: Turn[] = [
  { id: 't1', turn: 1, calls: [
    { callId: 'c1', tool: 'bash', title: 'Run the tests', kind: 'execute', status: 'completed', at: T, endedAt: T + 4_000 },
    { callId: 'c2', tool: 'read', title: 'Read src/app.ts', kind: 'read', status: 'failed', at: T + 5_000, endedAt: T + 6_000 },
  ] },
  { id: 't2', turn: 2, calls: [{ callId: 'c3', tool: 'grep', title: 'Search TODO', kind: 'search', status: 'in_progress', at: T + 60_000 }] },
]

function App() {
  const state = (host.params as { state?: string } | undefined)?.state
  const error = signal(state === 'error' ? 'The computer did not answer. Try again.' : '')
  const loaded = signal(state !== 'loading' && state !== 'error')
  return <TrajectoryView turns={() => (state === 'empty' || !loaded() ? [] : turns)} loaded={loaded} error={error} retry={() => { error.set(''); loaded.set(true) }} />
}
mount(App)
