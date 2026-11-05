// Scheduled tasks as DSH 0.2.1-rc.3 keeps them (dsh-schedule's `schedule` remote): schedule/catalog lists every Host
// task, enabled or inactive, with the Session it delivers to; schedule/history pages one task's saved deliveries newest
// first; schedule/delete removes a task with its records. DSH has no pause: a task turns inactive only when it can never
// run again (a one-shot that ran), and a delivery record says the message reached the chat, not what the agent did.
import { S, type Strings } from './strings.ts'

export type ScheduleUnit = 'day' | 'hour' | 'minute' | 'second'
export type TaskKind = 'after' | 'at' | 'every' | 'daily' | 'weekly' | 'cron'
export interface Delivery { scheduledAt: string; deliveredAt: string; messageId: string; prompt?: string }
export interface Task {
  id: string; kind: TaskKind; title: string; prompt: string; scheduledAt: string; sessionId: string; active: boolean
  everySeconds?: number; time?: string; timeZone?: string; weekdays?: number[]; expression?: string; lastDelivery?: Delivery
}
export interface HistoryPage { records: Delivery[]; nextBefore?: string; pruned: boolean; unavailable: boolean }
/** A page, or why there is none: schedule_not_found, delivery_cursor_not_found, or unknown for an unreadable answer. */
export type History = HistoryPage | { code: string }

/** Desktop's page size for delivery records. */
export const HISTORY_PAGE = 20

const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : undefined)
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const KINDS: TaskKind[] = ['after', 'at', 'every', 'daily', 'weekly', 'cron']

function deliveryOf(v: unknown): Delivery | undefined {
  const d = obj(v), scheduledAt = str(d?.scheduledAt), deliveredAt = str(d?.deliveredAt), messageId = str(d?.messageId)
  if (!scheduledAt || !deliveredAt || !messageId) return undefined
  return { scheduledAt, deliveredAt, messageId, ...(str(d!.prompt) !== undefined ? { prompt: d!.prompt } : {}) }
}

function taskOf(v: unknown): Task | undefined {
  const t = obj(v)
  const id = str(t?.id), title = str(t?.title), scheduledAt = str(t?.scheduledAt), sessionId = str(t?.sessionId)
  if (!id || !title || !scheduledAt || !sessionId || !KINDS.includes(t!.kind)) return undefined
  const last = deliveryOf(t!.lastDelivery)
  return {
    id, kind: t!.kind, title, prompt: str(t!.prompt) ?? '', scheduledAt, sessionId, active: t!.status !== 'inactive',
    ...(typeof t!.everySeconds === 'number' ? { everySeconds: t!.everySeconds } : {}), ...(str(t!.time) ? { time: t!.time } : {}),
    ...(str(t!.timeZone) ? { timeZone: t!.timeZone } : {}), ...(Array.isArray(t!.weekdays) ? { weekdays: t!.weekdays.filter((d: unknown) => typeof d === 'number') } : {}),
    ...(str(t!.expression) ? { expression: t!.expression } : {}), ...(last ? { lastDelivery: last } : {}),
  }
}

/** The tasks of a schedule/catalog answer: enabled ones by next run, then inactive ones, latest first. */
export function tasksOf(value: unknown): Task[] {
  if (!Array.isArray(value)) return []
  const tasks = value.flatMap((v) => { const t = taskOf(v); return t ? [t] : [] })
  const at = (t: Task) => Date.parse(t.scheduledAt) || 0
  return tasks.sort((a, b) => (a.active !== b.active ? (a.active ? -1 : 1) : a.active ? at(a) - at(b) || a.id.localeCompare(b.id) : at(b) - at(a)))
}

const UNITS: [ScheduleUnit, number][] = [['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1]]
/** "09:00:00.000" reads "09:00"; seconds stay when they are not zero. */
const clock = (time: string) => time.replace(/\.\d+$/, '').replace(/:00$/, '')

/** How often a task runs, in the rule's own zone, which is left out when it is the phone's (`zone`). */
export function frequency(task: Task, strings: Strings = S, zone?: string): string {
  const zoned = (rule: string) => (task.timeZone && task.timeZone !== zone ? strings.scheduleZone(rule, task.timeZone) : rule)
  if (task.kind === 'every' && task.everySeconds) {
    const [unit, size] = UNITS.find(([, size]) => task.everySeconds! % size === 0) ?? UNITS[3]!
    return strings.scheduleEvery(task.everySeconds / size, unit)
  }
  if (task.kind === 'daily') return zoned(strings.scheduleDaily(clock(task.time ?? '')))
  if (task.kind === 'weekly') return zoned(strings.scheduleWeekly((task.weekdays ?? []).map((d) => strings.weekdays[d - 1] ?? String(d)).join(strings.listSep), clock(task.time ?? '')))
  if (task.kind === 'cron') return zoned(strings.scheduleCron(task.expression ?? ''))
  return strings.scheduleOnce
}

/** A moment as a month, day and time on the phone's clock (the rule's own zone is in its frequency). */
export function formatAt(iso: string, strings: Strings = S): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString(strings.ago.date, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** When an enabled task runs next: soon in minutes or hours, later as a date; undefined for an inactive task. */
export function nextRun(task: Task, now = Date.now(), strings: Strings = S): string | undefined {
  if (!task.active) return undefined
  const ms = Date.parse(task.scheduledAt) - now
  if (Number.isNaN(ms)) return undefined
  if (ms <= 0) {
    const late = -ms / 1000
    if (late < 60) return strings.scheduleDue
    return late < 3_600 ? strings.scheduleOverdue(Math.floor(late / 60), 'minute') : late < 86_400 ? strings.scheduleOverdue(Math.floor(late / 3_600), 'hour') : strings.scheduleOverdue(Math.floor(late / 86_400), 'day')
  }
  if (ms < 3_600_000) return strings.scheduleIn(Math.ceil(ms / 60_000), 'minute')
  if (ms < 86_400_000) return strings.scheduleIn(Math.floor(ms / 3_600_000), 'hour')
  return formatAt(task.scheduledAt, strings)
}

/** "now", "5 min", "3 h", or the date, in `strings`' words (ago in strings.ts, for any language). */
function since(at: number, now: number, strings: Strings): string {
  const s = Math.max(0, (now - at) / 1000), t = strings.ago
  if (s < 60) return t.now
  if (s < 3600) return t.minutes(Math.floor(s / 60))
  if (s < 86400) return t.hours(Math.floor(s / 3600))
  return new Date(at).toLocaleDateString(t.date, { month: 'short', day: 'numeric' })
}

/** The task's last result: when DSH last put its message in the chat. */
export function lastSent(task: Task, now = Date.now(), strings: Strings = S): string {
  const at = task.lastDelivery ? Date.parse(task.lastDelivery.deliveredAt) : NaN
  return Number.isNaN(at) ? strings.scheduleNever : strings.scheduleLast(since(at, now, strings))
}

/** One schedule/history answer. */
export function historyOf(value: unknown): History {
  const v = obj(value)
  if (typeof v?.code === 'string') return { code: v.code }
  if (!v || !Array.isArray(v.records)) return { code: 'unknown' }
  return {
    records: v.records.flatMap((r: unknown) => { const d = deliveryOf(r); return d ? [d] : [] }),
    ...(str(v.nextBefore) ? { nextBefore: v.nextBefore } : {}), pruned: v.earlierRecordsPruned === true, unavailable: v.earlierRecordsUnavailable === true,
  }
}

/** Whether a schedule/delete answer says the task is gone; `{deleted: false}` comes with schedule_not_found. */
export const deleted = (value: unknown) => obj(value)?.deleted === true
