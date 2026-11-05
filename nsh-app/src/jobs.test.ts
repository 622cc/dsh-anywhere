// Background jobs of a chat, as DSH 0.2.1-rc.3 streams them: job/list sends the whole set after each burst of
// changes; job/follow opens a job's output, then output chunks and status changes (dsh-api-job-controller).
import { expect, test } from 'nsh/test'
import { duration, followJob, jobsOf, sections, type JobOutput } from './jobs.ts'

const job = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'bash', label: `job ${id}`, status, startedAt: 1_000, output: { total: 0, earliest: 0 }, ...extra })

test('job/list rows become the chat\'s jobs; frames that are not rows change nothing', () => {
  expect(jobsOf({ type: 'rows', jobs: [job('a', 'running'), { id: 3 }, job('b', 'odd')] })?.map((j) => [j.id, j.status])).toEqual([['a', 'running'], ['b', 'failed']])
  expect(jobsOf({ type: 'other' })).toBe(undefined)
})

test('running jobs come first, newest first; finished ones after, latest finish first', () => {
  const s = sections(jobsOf({ type: 'rows', jobs: [job('a', 'completed', { finishedAt: 5_000 }), job('b', 'running', { startedAt: 2_000 }), job('c', 'stopping', { startedAt: 3_000 }), job('d', 'killed', { finishedAt: 9_000 })] })!)
  expect(s.live.map((j) => j.id)).toEqual(['c', 'b'])
  expect(s.settled.map((j) => j.id)).toEqual(['d', 'a'])
})

test('a followed job\'s output: chunks join in order, a gap is marked, a status frame updates the job', () => {
  let o: JobOutput = { text: '', next: 0 }
  o = followJob(o, { type: 'opened', job: job('a', 'running'), from: 0 })
  o = followJob(o, { type: 'output', chunks: [{ at: 1, text: 'one\n' }, { at: 2, text: 'two\n', gapBefore: true }], next: 8 })
  expect(o.text).toBe('one\n… earlier output dropped …\ntwo\n')
  expect(o.next).toBe(8)
  o = followJob(o, { type: 'status', job: job('a', 'completed', { finishedAt: 4_000 }) })
  expect(o.job?.status).toBe('completed')
})

test('a long output keeps its end', () => {
  let o: JobOutput = { text: '', next: 0 }
  o = followJob(o, { type: 'output', chunks: [{ at: 1, text: 'x'.repeat(70_000) + 'END' }], next: 1 })
  expect(o.text.length <= 64 * 1024).toBe(true)
  expect(o.text.endsWith('END')).toBe(true)
})

test('durations read as Desktop writes them', () => {
  expect(duration(42_000)).toBe('42s')
  expect(duration(125_000)).toBe('2m 5s')
  expect(duration(3 * 3_600_000 + 7 * 60_000)).toBe('3h 7m')
})
