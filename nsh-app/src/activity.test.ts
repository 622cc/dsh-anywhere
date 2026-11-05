// What the chat's status button counts and how its panel orders things: what still runs first, the finished folded.
import { expect, test } from 'nsh/test'
import { activeOf, todoParts, shows } from './activity.ts'
import type { Job } from './jobs.ts'
import type { Child } from './subagents.ts'
import type { Todo } from './fold.ts'

const job = (id: string, status: Job['status']): Job => ({ id, kind: 'shell', label: id, status, startedAt: 0 })
const kid = (id: string, running: boolean): Child => ({ id, createdAt: 0, mode: 'continuable', running, name: id })
const todos: Todo[] = [
  { content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }, { content: 'c', status: 'in_progress' }, { content: 'd', status: 'completed' },
]

test('counts only what is still active: open to-dos, running or stopping jobs, running subagents', () => {
  const a = activeOf({ todos, jobs: [job('1', 'running'), job('2', 'stopping'), job('3', 'completed'), job('4', 'failed')], children: [kid('x', true), kid('y', false)] })
  expect(a).toEqual({ todos: 2, jobs: 2, subagents: 1, total: 5 })
})

test('nothing active when everything finished', () => {
  expect(activeOf({ todos: [{ content: 'a', status: 'completed' }], jobs: [job('1', 'killed')], children: [kid('x', false)] }).total).toBe(0)
})

test('to-dos in progress come first, then pending, each in the agent’s order; completed ones apart', () => {
  const p = todoParts(todos)
  expect(p.active.map((t) => t.content)).toEqual(['c', 'b'])
  expect(p.done.map((t) => t.content)).toEqual(['a', 'd'])
})

test('the button shows once there is a context reading or anything to list', () => {
  expect(shows({ todos: [], jobs: [], children: [] })).toBe(false)
  expect(shows({ todos: [], jobs: [], children: [], context: { used: 1, window: 10, percent: 10 } })).toBe(true)
  expect(shows({ todos: [], jobs: [job('1', 'completed')], children: [] })).toBe(true)
  expect(shows({ todos: [], jobs: [], children: [], goal: { objective: 'Ship', phase: 'active' } })).toBe(true)
})
