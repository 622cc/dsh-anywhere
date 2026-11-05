// Commands, skills and references in the composer, as DSH 0.2.1-rc.3 serves them: commands/list and
// commands/execute (dsh-commands), skills/list (sent as "/name …" prompts), fileReferences/list and
// sessionReferenceResolver/candidates for "@".
import { expect, test } from 'nsh/test'
import { commandsOf, insertMention, mentionAt, referencesOf, referenceText, route, skillsOf, slashQuery, suggest } from './commands.ts'

const commands = commandsOf([
  { name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]' } },
  { name: 'compact', description: 'Compact older conversation history' },
  { name: 'permission', description: 'Switch the permission preset', input: { hint: '<preset>' } },
  { bad: true },
])
const skills = skillsOf({ skills: [{ name: 'pdf', description: 'Read and write PDFs' }, { name: 'compact', description: 'shadowed by the command' }, { name: 'plan-review', description: 'Review a plan' }] })

test('the lists DSH returns, keeping only well-formed entries', () => {
  expect(commands.map((c) => [c.name, c.hint])).toEqual([['plan', '[off|message]'], ['compact', undefined], ['permission', '<preset>']])
  expect(skillsOf(undefined)).toEqual([])
  expect(commandsOf('nope')).toEqual([])
})

test('a "/" at the start of the message, before any space, asks for suggestions', () => {
  expect(slashQuery('/')).toBe('')
  expect(slashQuery('/pl')).toBe('pl')
  expect(slashQuery('/plan off')).toBe(undefined)
  expect(slashQuery('see /plan')).toBe(undefined)
  expect(slashQuery('')).toBe(undefined)
})

test('suggestions: names that start with the query first, then names that contain it; a skill a command shadows is left out', () => {
  expect(suggest('pl', commands, skills).map((s) => `${s.kind}:${s.name}`)).toEqual(['command:plan', 'skill:plan-review'])
  expect(suggest('', commands, skills).map((s) => s.name)).toEqual(['compact', 'permission', 'plan', 'pdf', 'plan-review'])
  expect(suggest('act', commands, skills).map((s) => s.name)).toEqual(['compact'])
})

test('a line naming a command runs it; anything else, a skill included, is a prompt', () => {
  expect(route('/compact', commands)).toBe('command')
  expect(route('  /plan off ', commands)).toBe('command')
  expect(route('/pdf read this', commands)).toBe('prompt')
  expect(route('/unknown', commands)).toBe('prompt')
  expect(route('plan this', commands)).toBe('prompt')
})

test('"@" before the caret asks for references; a reference goes in quoted when its path has a space', () => {
  expect(mentionAt('look at @src/ma', 15)).toEqual({ start: 8, query: 'src/ma' })
  expect(mentionAt('look at @src/ma more', 15)).toEqual({ start: 8, query: 'src/ma' })
  expect(mentionAt('mail me@example.com', 19)).toBe(undefined)
  expect(mentionAt('done @x y', 9)).toBe(undefined)
  expect(insertMention('look at @src/ma', { start: 8, query: 'src/ma' }, '@src/main.ts')).toEqual({ text: 'look at @src/main.ts ', caret: 21 })
  expect(insertMention('@my', { start: 0, query: 'my' }, '@"my notes/a.md"').text).toBe('@"my notes/a.md" ')
})

test('references are written as DSH reads them: @path, @"path" with a space, a folder ending in "/", a chat by its mention', () => {
  expect(referenceText({ kind: 'file', path: 'src/main.ts' })).toBe('@src/main.ts')
  expect(referenceText({ kind: 'directory', path: 'src/main' })).toBe('@src/main/')
  expect(referenceText({ kind: 'file', path: 'my notes/a.md' })).toBe('@"my notes/a.md"')
  expect(referenceText({ kind: 'chat', mention: '@[Login bug](dsh-session:s1)', label: 'Login bug' })).toBe('@[Login bug](dsh-session:s1)')
  expect(referencesOf([{ path: 'src/main.kt', kind: 'file' }, { path: 'src/main/', kind: 'directory' }, { nope: 1 }], [{ mention: '@[Login bug](dsh-session:s1)', label: 'Login bug', sessionId: 's1' }]))
    .toEqual([{ kind: 'file', path: 'src/main.kt' }, { kind: 'directory', path: 'src/main' }, { kind: 'chat', mention: '@[Login bug](dsh-session:s1)', label: 'Login bug' }])
})
