// A chat's details, from DSH's own values (session/projections, rc.3's dsh-api-session-controller descriptor):
// the model and effort (`modelSelection`), context use (`contextPressure`, `contextBreakdown`), the tokens spent
// (`tokenUsage`), plan mode (`plan`), the preset (`permissions`) and the goal (`goal`, as controls.ts reads it).
// A key DSH leaves out is a capability it does not have at this cut: it reads as undefined and the page hides it.
import { controlsOf, type GoalPhase } from './controls.ts'
import { selectionOf, type Selection } from './models.ts'

const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export interface Details {
  model: Selection | undefined
  context: { used: number; window: number; percent: number } | undefined
  breakdown: { system: number; tools: number; messages: number } | undefined
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number } | undefined
  plan: { active: boolean; pending: boolean } | undefined
  preset: string | undefined
  goal: { objective: string; phase: GoalPhase } | undefined
}

export function detailsOf(projections: unknown): Details {
  const values = obj(obj(projections)?.values)
  const ms = obj(values?.modelSelection), pressure = obj(values?.contextPressure), parts = obj(values?.contextBreakdown), usage = obj(values?.tokenUsage), plan = obj(values?.plan)
  // Desktop's meter (contextOccupancy): the projected next prompt, else the last one, over the route's window.
  const used = num(pressure?.projectedTokens) ?? num(pressure?.pressureTokens), window = num(pressure?.contextWindow)
  const system = num(parts?.systemTokens), tools = num(parts?.toolsTokens), messages = num(parts?.messageTokens)
  const input = num(usage?.uncachedInputTokens), output = num(usage?.outputTokens), cacheRead = num(usage?.cacheReadTokens), cacheWrite = num(usage?.cacheWriteTokens)
  const controls = controlsOf(projections)
  return {
    model: selectionOf(ms?.next) ?? selectionOf(ms?.lastUsed),
    context: used !== undefined && window ? { used, window, percent: Math.min(100, Math.round((used / window) * 100)) } : undefined,
    breakdown: system !== undefined && tools !== undefined && messages !== undefined ? { system, tools, messages } : undefined,
    usage: input !== undefined && output !== undefined && cacheRead !== undefined && cacheWrite !== undefined ? { input, output, cacheRead, cacheWrite } : undefined,
    plan: plan ? { active: plan.active === true, pending: plan.pending === true } : undefined,
    preset: controls.preset,
    goal: controls.goal,
  }
}

/** "999", "1.2K", "128K", "1.5M", as Desktop's formatTokens writes them. */
export function tokens(n: number): string {
  const scaled = (v: number) => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1e3) return String(n)
  return n < 1e6 ? `${scaled(n / 1e3)}K` : `${scaled(n / 1e6)}M`
}
