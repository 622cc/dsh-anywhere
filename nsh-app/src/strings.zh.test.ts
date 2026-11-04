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

test('zh says the pairing steps, the plugin, unlinking, the quick start and the finished count in plain words', () => {
  expect(ZH.linkHow).toBe('在 Mac 上打开 DSH，调出 DSH Anywhere 的配对码，再用这台手机扫。')
  expect(ZH.companionVersion).toBe('电脑端插件版本')
  expect(ZH.unlinkHint).toBe('断开后，要重新扫码才能再连上电脑。')
  expect(ZH.quickChatWhere).toBe('直接在 DSH 的默认工作区里开始')
  expect(ZH.jobsFinished(1)).toBe('1 个已结束')
  expect(ZH.finishedCount(1)).toBe('1 个已结束')
})
