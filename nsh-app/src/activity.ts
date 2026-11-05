// What a chat is doing, for the status button in its header and the panel it opens, as Claude's app shows a chat's
// work in its top right corner: the context in use, then to-dos, background jobs and subagents. Counts are of what is
// still active; finished items fold away under their own line.
import { isLive, type Job } from './jobs.ts'
import type { Todo } from './fold.ts'
import type { Child } from './subagents.ts'

import type { GoalPhase } from './controls.ts'

export interface Activity { todos: Todo[]; jobs: Job[]; children: Child[]; context?: { used: number; window: number; percent: number }; goal?: { objective: string; phase: GoalPhase } }

export function activeOf(a: Activity) {
  const todos = a.todos.filter((t) => t.status !== 'completed').length
  const jobs = a.jobs.filter(isLive).length
  const subagents = a.children.filter((c) => c.running).length
  return { todos, jobs, subagents, total: todos + jobs + subagents }
}

/** Open to-dos, the one in progress first, and the completed ones. */
export function todoParts(todos: Todo[]) {
  return {
    active: [...todos.filter((t) => t.status === 'in_progress'), ...todos.filter((t) => t.status === 'pending')],
    done: todos.filter((t) => t.status === 'completed'),
  }
}

export const shows = (a: Activity) => !!a.context || !!a.goal || a.todos.length > 0 || a.jobs.length > 0 || a.children.length > 0
