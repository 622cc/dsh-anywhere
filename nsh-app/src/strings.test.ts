import { expect, test } from 'nsh/test'
import { DshError } from './dsh.ts'
import { readable, stringsFor } from './strings.ts'

test('a language the app does not have reads English', () => {
  expect(stringsFor('en-US').chats).toBe('Chats')
  expect(stringsFor('en-GB').chats).toBe('Chats')
  expect(stringsFor('ru-RU').chats).toBe('Чаты')
  expect(stringsFor('zh-Hans-CN').chats).toBe('会话')
  expect(stringsFor('de-DE').chats).toBe('Chats')
  expect(stringsFor('').chats).toBe('Chats')
})

test('the Russian strings have everything the English ones have, and the same kinds of values', () => {
  const en = stringsFor('en') as Record<string, unknown>, ru = stringsFor('ru') as Record<string, unknown>
  const shape = (o: Record<string, unknown>): string[] => Object.keys(o).sort().map((k) => {
    const v = o[k]
    return typeof v === 'object' && v ? `${k}{${shape(v as Record<string, unknown>).join(',')}}` : `${k}:${typeof v}`
  })
  expect(shape(ru)).toEqual(shape(en))
})

test('an error reads as what went wrong for the person: the phone\'s own failures in its words, DSH\'s in DSH\'s', () => {
  const en = stringsFor('en-US')
  expect(readable(new DshError('timeout', 'x'), en)).toBe('The computer did not answer. Try again.')
  expect(readable(new DshError('network', 'x'), en)).toBe('Can’t reach your computer. Check that it is on and DSH is running.')
  expect(readable(new DshError('unauthorized', 'x'), en)).toBe('The computer no longer accepts this phone. Link it again.')
  expect(readable(new DshError('http/502', 'HTTP 502'), en)).toBe('The computer answered with an error (502). Try again.')
  expect(readable(new DshError('session/steer-unavailable', 'Steering is unavailable now'), en)).toBe('Steering is unavailable now')
  expect(readable(new Error(''), en)).toBe('Something went wrong. Try again.')
  expect(readable('odd', en)).toBe('Something went wrong. Try again.')
  expect(readable(new DshError('timeout', 'x'), stringsFor('ru-RU'))).toBe('Компьютер не ответил. Попробуйте ещё раз.')
})

test('what the phone\'s shell refuses arrives as a code and reads in the phone\'s language', () => {
  const en = stringsFor('en-US'), ru = stringsFor('ru-RU')
  const shell = (code: string) => new Error(code)
  expect(readable(shell('link/expired'), en)).toBe('This pairing code has expired. Make a new one on the computer.')
  expect(readable(shell('link/invalid'), en)).toBe('This is not a DSH pairing code.')
  expect(readable(shell('link/certificate'), en)).toBe('The computer’s certificate does not match its pairing code. Make a new code on the computer.')
  expect(readable(shell('link/not-linked'), en)).toBe('This phone is not linked to a computer yet.')
  expect(readable(shell('link/refused:403'), en)).toBe('The computer refused the pairing (403).')
  expect(readable(shell('link/tunnel:no route'), en)).toBe('Can’t open the connection to your computer. Try again.')
  expect(readable(shell('upload/failed:413'), en)).toBe('The upload failed (413). Try again.')
  expect(readable(shell('file/unreadable'), en)).toBe('This file can’t be read.')
  expect(readable(shell('ui/download:404'), en)).toBe('The interface could not be loaded (404). Try again.')
  expect(readable(shell('link/expired'), ru)).toBe('Срок действия кода истёк. Создайте новый на компьютере.')
  expect(readable(shell('link/nonsense'), en)).toBe('Something went wrong. Try again.')
})

test('the to-do header counts each state that has items, as Desktop does', () => {
  const en = stringsFor('en-US'), ru = stringsFor('ru-RU')
  const t = (...s: string[]) => s.map((status) => ({ content: status, status: status as 'pending' }))
  expect(en.todoProgress(t('completed', 'completed', 'in_progress', 'pending'))).toBe('2 completed, 1 in progress, 1 pending')
  expect(en.todoProgress(t('pending', 'pending'))).toBe('2 pending')
  expect(ru.todoProgress(t('completed', 'in_progress', 'pending', 'pending', 'pending', 'pending', 'pending'))).toBe('1 выполнена, 1 в работе, 5 ожидают')
})

test('where Desktop words a DSH refusal itself, the phone uses Desktop\'s words', () => {
  const en = stringsFor('en-US')
  expect(readable(new DshError('session/fork-unavailable', 'x'), en)).toBe('This session has no completed turn')
  expect(readable(new DshError('session/migration-required', 'x'), en)).toBe('Open the original session on the computer to complete migration before creating a branch.')
})

test('the subagent count reads as Desktop words it, and in Russian with its plural', () => {
  const en = stringsFor('en-US'), ru = stringsFor('ru-RU')
  expect([en.subagents(1, 3), en.subagents(0, 1), en.subagents(0, 2)]).toEqual(['1 subagent running', '1 subagent', '2 subagents'])
  expect([ru.subagents(2, 3), ru.subagents(0, 5), ru.subagents(0, 21)]).toEqual(['2 субагента работают', '5 субагентов', '21 субагент'])
})
