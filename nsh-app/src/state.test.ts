import { expect, test } from 'nsh/test'
import { connection, heard, interfaceRequest, network, news, reachState, started, turnErrors } from './state.ts'

test('opening a generated interface asks the shell for that call\'s package and the root key, with the device key', () => {
  expect(interfaceRequest({ origin: 'http://127.0.0.1:19446', key: 'k' }, 'call/7 x', 'Tip')).toEqual({
    url: 'http://127.0.0.1:19446/ui/package?call=call%2F7%20x', rootUrl: 'http://127.0.0.1:19446/ui/root.pub', auth: 'k', title: 'Tip',
  })
})

test('without a network on the phone the computer is out of reach, whatever the socket last said', () => {
  expect(reachState(false, 'online')).toBe('offline')
  expect(reachState(false, 'connecting')).toBe('offline')
  expect(reachState(true, 'connecting')).toBe('connecting')
  expect(reachState(true, 'online')).toBe('online')
})

test('the shown connection follows the phone\'s network', () => {
  network.set(false)
  expect(connection()).toBe('offline')
  network.set(true)
  expect(connection()).toBe('connecting')
})

test('DSH’s news on $events: a chat starting or stopping, a turn’s error; other frames are not news', () => {
  const at = news()
  heard({ type: 'emit', event: 'api-session/status', args: ['s1', false] })
  expect(news()).toBe(at + 1)
  expect(started.has('s1')).toBe(false) // a stop with no start before it says nothing
  heard({ type: 'emit', event: 'api-session/error', args: ['s1', 'The model provider refused the request'] })
  expect(turnErrors.get('s1')).toBe('The model provider refused the request')
  expect(news()).toBe(at + 2)
  heard({ type: 'emit', event: 'api-session/activity', args: ['s1', 5] })
  heard({ type: 'waterfall', event: 'approval/request' })
  expect(news()).toBe(at + 2)
  heard({ type: 'emit', event: 'api-session/status', args: ['s1', true] })
  expect(started.get('s1')).toBe('running') // the notifier's next look takes it
  heard({ type: 'emit', event: 'api-session/status', args: ['s1', false] })
  expect(started.get('s1')).toBe('finished')
})
