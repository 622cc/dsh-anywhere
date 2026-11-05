import { expect, test } from 'nsh/test'
import { catalogOf, modelLabel } from './models.ts'

const catalog = catalogOf({ default: { provider: 'deepseek', model: 'v4-flash' }, groups: [
  { id: 'deepseek', name: 'DeepSeek', models: [
    { id: 'v4-flash', name: 'DeepSeek V4 Flash' },
    { id: 'v4-pro', name: 'DeepSeek V4 Pro', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } },
  ] },
  { id: 'broken', name: 'Broken' },
] })

test('a selection reads as the model\'s name and its thinking depth, as the Desktop picker does', () => {
  expect(modelLabel(catalog, { provider: 'deepseek', model: 'v4-pro', reasoningEffort: 'high' })).toBe('DeepSeek V4 Pro (High)')
  expect(modelLabel(catalog, { provider: 'deepseek', model: 'v4-pro' })).toBe('DeepSeek V4 Pro (Low)')
  expect(modelLabel(catalog, { provider: 'deepseek', model: 'v4-flash' })).toBe('DeepSeek V4 Flash')
  expect(modelLabel(catalog, undefined)).toBe('DeepSeek V4 Flash')
  expect(modelLabel(catalog, { provider: 'other', model: 'x-1' })).toBe('x-1')
})

test('a malformed catalog group is dropped, not fatal', () => {
  expect(catalog.groups.map((g) => [g.name, g.models.length])).toEqual([['DeepSeek', 2], ['Broken', 0]])
})
