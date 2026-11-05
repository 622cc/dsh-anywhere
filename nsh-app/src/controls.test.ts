// The chat's controls, from DSH's own values (session/projections): plan mode (`plan`), the permission preset
// (`permissions`, with permissionPresets/catalog) and the goal (`goal`). Each control sends the command line the
// Desktop's composer would.
import { expect, test } from 'nsh/test'
import { confirmationFor, controlsOf, goalLine, permissionLine, planLine, presetLabel, presetsOf } from './controls.ts'

test('controls read plan mode, the preset and the goal; missing values read as off and none', () => {
  const values = { plan: { active: true, pending: false }, permissions: { currentValue: 'workspace-write' },
    goal: { goal: { id: 'g1', revision: 2, objective: 'Ship the queue', phase: 'paused', maxGoalRounds: 5 }, roundsStarted: 1, createdAt: 0, updatedAt: 0 } }
  expect(controlsOf({ kind: 'sequenced', values })).toEqual({ plan: true, planPending: false, preset: 'workspace-write', goal: { objective: 'Ship the queue', phase: 'paused' } })
  expect(controlsOf(null)).toEqual({ plan: false, planPending: false, preset: undefined, goal: undefined })
  expect(controlsOf({ values: { goal: null, plan: { active: false, pending: true } } })).toEqual({ plan: false, planPending: true, preset: undefined, goal: undefined })
})

test('presets in DSH\'s order, with their labels and descriptions', () => {
  expect(presetsOf({ options: [{ value: 'read-only', name: 'Read only' }, { value: 'workspace-write', name: 'Workspace', description: 'Write inside the workspace.' }, { name: 'broken' }], defaultOptions: [], defaultPreset: 'workspace-write' }))
    .toEqual([{ value: 'read-only', name: 'Read only', description: '' }, { value: 'workspace-write', name: 'Workspace', description: 'Write inside the workspace.' }])
})

test('the command lines the controls send', () => {
  expect(planLine(true)).toBe('/plan')
  expect(planLine(false)).toBe('/plan off')
  expect(permissionLine('read-only')).toBe('/permission read-only')
  expect(goalLine({ set: ' Ship it ' })).toBe('/goal Ship it')
  expect(goalLine({ edit: 'Ship it today' })).toBe('/goal edit Ship it today')
  expect(goalLine('pause')).toBe('/goal pause')
  expect(goalLine('resume')).toBe('/goal resume')
  expect(goalLine('clear')).toBe('/goal clear')
})

test('presets read as DSH Desktop names them, and Full access and Auto review ask first, with its words', () => {
  expect(presetLabel('read-only', 'read-only')).toBe('Read Only')
  expect(presetLabel('workspace-write', 'workspace-write')).toBe('Workspace Write')
  expect(presetLabel('danger-full-access', 'danger-full-access')).toBe('Full access')
  expect(presetLabel('auto', 'auto')).toBe('Auto review')
  expect(presetLabel('team-safe', 'team-safe')).toBe('Team Safe')
  expect(presetLabel('read-only', 'Locked down')).toBe('Locked down')
  expect(confirmationFor('workspace-write')).toBe(undefined)
  expect(confirmationFor('danger-full-access')?.enable).toBe('Enable Full access')
  expect(confirmationFor('auto')?.title).toBe('Enable Auto review (experimental)?')
})
