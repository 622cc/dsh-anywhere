// The chat's controls, read from DSH's own values (session/projections): plan mode (`plan`), the permission
// preset (`permissions`; the choices come from permissionPresets/catalog) and the goal (`goal`). Each control
// sends the command line the Desktop's composer would, so DSH logs and applies it the same way.
import { ENGLISH_PRESETS, S } from './strings.ts'
const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : undefined)
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export type GoalPhase = 'active' | 'paused' | 'blocked' | 'complete'
export interface Controls { plan: boolean; planPending: boolean; preset: string | undefined; goal: { objective: string; phase: GoalPhase } | undefined }
export interface Preset { value: string; name: string; description: string }

export function controlsOf(projections: unknown): Controls {
  const values = obj(obj(projections)?.values)
  const plan = obj(values?.plan), goal = obj(obj(values?.goal)?.goal)
  const objective = str(goal?.objective), phase = goal?.phase
  return {
    plan: plan?.active === true, planPending: plan?.pending === true,
    preset: str(obj(values?.permissions)?.currentValue),
    goal: objective && ['active', 'paused', 'blocked', 'complete'].includes(phase) ? { objective, phase } : undefined,
  }
}

export function presetsOf(catalog: unknown): Preset[] {
  const options = obj(catalog)?.options
  return (Array.isArray(options) ? options : []).flatMap((o): Preset[] => {
    const value = str(obj(o)?.value); if (!value) return []
    return [{ value, name: str(o.name) ?? value, description: str(o.description) ?? '' }]
  })
}

export const planLine = (on: boolean) => (on ? '/plan' : '/plan off')
export const permissionLine = (preset: string) => `/permission ${preset}`
export function goalLine(action: { set: string } | { edit: string } | 'pause' | 'resume' | 'clear'): string {
  if (typeof action === 'string') return `/goal ${action}`
  return 'set' in action ? `/goal ${action.set.trim()}` : `/goal edit ${action.edit.trim()}`
}

// DSH Desktop's names for the built-in presets and its risk gate (dsh-client-ui-permission-presets).
export function presetLabel(value: string, name: string): string {
  const label = S.presets[value]
  if (label && (name === value || name === ENGLISH_PRESETS[value])) return label
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : name
}
export interface Confirmation { title: string; description: string; enable: string }
export function confirmationFor(value: string): Confirmation | undefined {
  return value === 'danger-full-access' ? S.confirmFull : value === 'auto' ? S.confirmAuto : undefined
}
