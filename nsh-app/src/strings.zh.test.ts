import { expect, test } from 'nsh/test'
import { ZH } from './strings.zh.ts'
import { stringsFor } from './strings.ts'

test('zh has every key of en', () => {
  const en = stringsFor('en-US') as Record<string, unknown>, zh = ZH as Record<string, unknown>
  for (const k of Object.keys(en)) expect([k, typeof zh[k]]).toEqual([k, typeof en[k]])
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
})

test('a Chinese phone, or Chinese picked in Settings, gets the Chinese strings', () => {
  expect(stringsFor('zh-Hans-CN').settings).toBe('设置')
  expect(stringsFor('zh-Hans').appearance).toBe('外观')
  expect(stringsFor('ru-RU').settings).toBe('Настройки')
  expect(stringsFor('en-GB').settings).toBe('Settings')
})
