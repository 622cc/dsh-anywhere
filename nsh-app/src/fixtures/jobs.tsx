// The background jobs sheet on its own (src/views.test.tsx): one job running, one finished (synthetic).
import { mount } from 'nsh'
import { JobsSheet } from '../jobs.tsx'
import type { Job } from '../jobs.ts'

const now = Date.now()
const jobs: Job[] = [
  { id: 'j1', kind: 'bash', label: 'npm run dev', status: 'running', startedAt: now - 30_000 },
  { id: 'j2', kind: 'bash', label: 'npm test', status: 'completed', startedAt: now - 90_000, finishedAt: now - 60_000 },
]

mount(() => <JobsSheet open={() => true} onClose={() => {}} sessionId="s1" jobs={() => jobs} />)
