// The details page's view on its own (src/views.test.tsx): `host.params.state` picks loading, a failure that a retry
// clears, a chat DSH reported nothing for, or a chat with every value set (synthetic).
import { host, mount, signal } from 'nsh'
import { DetailsView } from '../details.tsx'
import type { Details } from '../details.ts'
import type { Catalog } from '../models.ts'
import type { Job } from '../jobs.ts'

const full: Details = {
  model: { provider: 'deepseek', model: 'model-a', reasoningEffort: 'high' },
  context: { used: 54_000, window: 128_000, percent: 42 },
  breakdown: { system: 6_000, tools: 9_000, messages: 39_000 },
  usage: { input: 120_000, output: 8_500, cacheRead: 900_000, cacheWrite: 40_000 },
  plan: { active: true, pending: false }, preset: 'workspace-write', goal: { objective: 'Ship the release', phase: 'active' },
}
const bare: Details = { model: undefined, context: undefined, breakdown: undefined, usage: undefined, plan: undefined, preset: undefined, goal: undefined }
const catalog: Catalog = { groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'model-a', name: 'Model A', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] }] }] }
const now = Date.now()
const jobs: Job[] = [
  { id: 'j1', kind: 'bash', label: 'npm run dev', status: 'running', startedAt: now - 30_000 },
  { id: 'j2', kind: 'bash', label: 'npm test', status: 'completed', startedAt: now - 90_000, finishedAt: now - 60_000 },
]

function App() {
  const state = (host.params as { state?: string } | undefined)?.state
  const error = signal(state === 'error' ? 'The computer did not answer. Try again.' : '')
  const details = signal<Details | undefined>(state === 'loading' || state === 'error' ? undefined : state === 'bare' ? bare : full)
  return <DetailsView details={details} catalog={() => catalog} jobs={() => (state === 'bare' ? [] : jobs)} error={error} retry={() => { error.set(''); details.set(full) }} />
}
mount(App)
