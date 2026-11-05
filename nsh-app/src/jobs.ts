// Background jobs of a chat (a long command, a dev server, a watcher), as DSH 0.2.1-rc.3 streams them:
// job/list sends the whole set again after each burst of changes; job/follow opens one job's output and then sends
// output chunks and status changes; job/kill asks it to stop (dsh-api-job-controller).
import { S } from './strings.ts'

export type JobStatus = 'running' | 'stopping' | 'completed' | 'failed' | 'killed'
export interface Job { id: string; kind: string; label: string; status: JobStatus; startedAt: number; finishedAt?: number; detail?: string }
export interface JobOutput { text: string; next: number; job?: Job }

const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : undefined)
const STATUSES: JobStatus[] = ['running', 'stopping', 'completed', 'failed', 'killed']
/** The phone keeps the end of a job's output. */
const KEEP = 64 * 1024

function jobOf(v: unknown): Job | undefined {
  const j = obj(v)
  if (typeof j?.id !== 'string') return undefined
  return {
    id: j.id, kind: typeof j.kind === 'string' ? j.kind : '', label: typeof j.label === 'string' && j.label ? j.label : j.id,
    status: STATUSES.includes(j.status) ? j.status : 'failed', startedAt: Number(j.startedAt) || 0,
    ...(typeof j.finishedAt === 'number' ? { finishedAt: j.finishedAt } : {}), ...(typeof j.detail === 'string' && j.detail ? { detail: j.detail } : {}),
  }
}

/** The jobs of a job/list `rows` frame; undefined for any other frame. */
export function jobsOf(frame: unknown): Job[] | undefined {
  const f = obj(frame)
  if (f?.type !== 'rows' || !Array.isArray(f.jobs)) return undefined
  return f.jobs.flatMap((j: unknown) => { const v = jobOf(j); return v ? [v] : [] })
}

export const isLive = (j: Job) => j.status === 'running' || j.status === 'stopping'
/** Running jobs, newest first, then finished ones, latest finish first. */
export function sections(jobs: Job[]): { live: Job[]; settled: Job[] } {
  return {
    live: jobs.filter(isLive).sort((a, b) => b.startedAt - a.startedAt),
    settled: jobs.filter((j) => !isLive(j)).sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt)),
  }
}

/** A job's output after one job/follow frame. */
export function followJob(o: JobOutput, frame: unknown): JobOutput {
  const f = obj(frame)
  if (f?.type === 'opened') return { text: '', next: Number(f.from) || 0, ...(jobOf(f.job) ? { job: jobOf(f.job) } : {}) }
  if (f?.type === 'status') { const job = jobOf(f.job); return job ? { ...o, job } : o }
  if (f?.type !== 'output' || !Array.isArray(f.chunks)) return o
  let text = o.text
  for (const c of f.chunks) {
    if (typeof obj(c)?.text !== 'string') continue
    if (c.gapBefore) text += `${text && !text.endsWith('\n') ? '\n' : ''}${S.jobGap}\n`
    text += c.text
  }
  return { ...o, text: text.length > KEEP ? text.slice(text.length - KEEP) : text, next: typeof f.next === 'number' ? f.next : o.next }
}

/** "42s", "2m 5s", "3h 7m". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? S.jobHours(h, m) : m ? S.jobMinutes(m, s % 60) : S.jobSeconds(s)
}
