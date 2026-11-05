// A chat's details, read from session/projections as DSH 0.2.1-rc.3 describes them
// (dsh-api-session-controller typert.remote-client.js: modelSelection, contextPressure, contextBreakdown,
// tokenUsage, plan, permissions, goal). A key DSH leaves out reads as not there.
import { expect, test } from 'nsh/test'
import { detailsOf, tokens } from './details.ts'

const values = {
  modelSelection: { lastUsed: { provider: 'deepseek', model: 'model-a', reasoningEffort: 'high' }, next: null },
  contextPressure: { pressureTokens: 50_000, projectedTokens: 54_000, contextWindow: 128_000 },
  contextBreakdown: { systemTokens: 6_000, toolsTokens: 9_000, messageTokens: 39_000 },
  tokenUsage: { uncachedInputTokens: 120_000, outputTokens: 8_500, cacheReadTokens: 900_000, cacheWriteTokens: 40_000 },
  plan: { active: true, pending: false },
  permissions: { currentValue: 'workspace-write' },
  goal: { goal: { id: 'g1', revision: 1, objective: 'Ship the release', phase: 'active', maxGoalRounds: 5 }, roundsStarted: 2, createdAt: 0, updatedAt: 0 },
}

test('details read the model and effort, context use as Desktop counts it, its parts, the usage, plan mode, the preset and the goal', () => {
  expect(detailsOf({ kind: 'sequenced', asOfSeq: 9, values })).toEqual({
    model: { provider: 'deepseek', model: 'model-a', reasoningEffort: 'high' },
    // Desktop's meter: the projected next prompt, else the last one, over the route's window.
    context: { used: 54_000, window: 128_000, percent: 42 },
    breakdown: { system: 6_000, tools: 9_000, messages: 39_000 },
    usage: { input: 120_000, output: 8_500, cacheRead: 900_000, cacheWrite: 40_000 },
    plan: { active: true, pending: false },
    preset: 'workspace-write',
    goal: { objective: 'Ship the release', phase: 'active' },
  })
})

test('the next model wins over the last one; context needs both a count and a window', () => {
  const d = detailsOf({ values: { modelSelection: { lastUsed: { provider: 'p', model: 'old' }, next: { provider: 'p', model: 'new' } }, contextPressure: { pressureTokens: 10 } } })
  expect(d.model).toEqual({ provider: 'p', model: 'new' })
  expect(d.context).toBe(undefined)
  expect(detailsOf({ values: { contextPressure: { pressureTokens: 300_000, contextWindow: 128_000 } } }).context).toEqual({ used: 300_000, window: 128_000, percent: 100 })
})

test('a chat with nothing reported reads as nothing there', () => {
  const none = { model: undefined, context: undefined, breakdown: undefined, usage: undefined, plan: undefined, preset: undefined, goal: undefined }
  expect(detailsOf(null)).toEqual(none)
  expect(detailsOf({ kind: 'migration-required', values: {} })).toEqual(none)
})

test('token counts read as Desktop writes them', () => {
  expect(tokens(999)).toBe('999')
  expect(tokens(1_234)).toBe('1.2K')
  expect(tokens(54_000)).toBe('54K')
  expect(tokens(128_000)).toBe('128K')
  expect(tokens(1_500_000)).toBe('1.5M')
})
