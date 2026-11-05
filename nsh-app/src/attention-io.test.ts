// The watcher's words for each kind of news (src/notify.tsx createAttention), over a chat list and errors the test
// plays, with the app away: what reaches the shell's notify.show.
import { Storage } from 'nsh'
import { expect, test } from 'nsh/test'
import { createAttention } from './notify.tsx'
import type { ChatSummary } from './workspaces.ts'

const settle = () => new Promise((r) => setTimeout(r, 0))

test('a turn that DSH reported an error for says it stopped with an error, and what went wrong; the next turn forgets it', async () => {
  let chats: ChatSummary[] = [{ sessionId: 'build', title: 'Fix the build', updatedAt: 1, running: true }]
  const shown: unknown[] = []
  const errors = new Map([['build', 'The model provider refused the request\nstatus 429']])
  const a = createAttention({
    list: async () => chats, requests: () => [], waiting: () => [], errors, everyMs: 1e9, settleMs: 0,
    call: async (name, args) => { if (name === 'notify.show') shown.push(args); return null },
  }, { active: () => false, visible: () => undefined })
  await settle()
  chats = [{ ...chats[0]!, running: false }]
  await a.poll()
  expect(shown).toEqual([{ id: 'build', kind: 'failed', title: 'Fix the build', body: 'The model provider refused the request' }])
  expect(errors.has('build')).toBe(false)
  chats = [{ ...chats[0]!, running: true }]; await a.poll()
  chats = [{ ...chats[0]!, running: false, preview: 'Fixed.' }]; await a.poll(); await settle(); await settle()
  expect(shown.at(-1)).toEqual({ id: 'build', kind: 'answer', title: 'Fix the build', body: 'Fixed.' })
})

test('a question’s own words, or the tool an approval is for, are the decision’s words', async () => {
  let waiting: string[] = []
  const shown: unknown[] = []
  const chats: ChatSummary[] = [{ sessionId: 'q', title: 'Plan the trip', updatedAt: 1, running: true }]
  const a = createAttention({
    list: async () => chats, waiting: () => waiting, everyMs: 1e9,
    requests: () => [{ kind: 'question', eventId: 'e', sessionId: 'q', questions: [{ id: '1', question: 'Which city first?', options: [], multiSelect: false }] }],
    call: async (name, args) => { if (name === 'notify.show') shown.push(args); return null },
  }, { active: () => false, visible: () => undefined })
  await settle()
  waiting = ['q']; a.look()
  expect(shown).toEqual([{ id: 'q', kind: 'decision', title: 'Plan the trip', body: 'Which city first?' }])
})

test('the answer’s words come from a second look: DSH writes the preview when the turn ends, just after it stops', async () => {
  let chats: ChatSummary[] = [{ sessionId: 'a', title: 'Fix the build', updatedAt: 1, running: true }]
  const shown: unknown[] = []
  const a = createAttention({
    list: async () => chats, requests: () => [], waiting: () => [], everyMs: 1e9, settleMs: 0,
    call: async (name, args) => { if (name === 'notify.show') shown.push(args); return null },
  }, { active: () => false, visible: () => undefined })
  await settle()
  chats = [{ ...chats[0]!, running: false }] // stopped, the preview not written yet
  await a.poll()
  expect(shown).toEqual([])
  chats = [{ ...chats[0]!, preview: 'The build passes again.' }]
  await settle(); await settle()
  expect(shown).toEqual([{ id: 'a', kind: 'answer', title: 'Fix the build', body: 'The build passes again.' }])
})

test('while an agent waits on the person, the ongoing notification says so instead of “working”', async () => {
  let waiting: string[] = []
  const watched: unknown[] = []
  const a = createAttention({
    list: async () => [{ sessionId: 'q', title: 'Plan the trip', updatedAt: 1, running: true }], waiting: () => waiting, requests: () => [], everyMs: 1e9,
    call: async (name, args) => { if (name === 'notify.watch') watched.push(args); return null },
  }, { active: () => false, visible: () => undefined })
  await settle()
  expect(watched.at(-1)).toEqual({ title: 'An agent is working', body: 'Plan the trip' })
  waiting = ['q']; a.look()
  expect(watched.at(-1)).toEqual({ title: 'Agent needs your decision', body: 'Plan the trip' })
})

// A short turn can start and end between two looks at the list (seen on the iOS simulator: a one-word answer in about
// 2 s, the list read every 4 s), so the list shows the chat stopped both times; DSH's own status news says it ran.
test('a turn that starts and ends between two looks still says its answer is ready, as DSH said it started and stopped', async () => {
  const chats: ChatSummary[] = [{ sessionId: 'w', title: 'One word', updatedAt: 1, running: false, preview: 'PEAR' }]
  const shown: unknown[] = []
  const ran = new Map<string, 'running' | 'finished'>()
  const a = createAttention({
    list: async () => chats, requests: () => [], waiting: () => [], ran, everyMs: 1e9, settleMs: 0,
    call: async (name, args) => { if (name === 'notify.show') shown.push(args); return null },
  }, { active: () => false, visible: () => undefined })
  await settle()
  ran.set('w', 'finished'); await a.poll(); await settle(); await settle()
  expect(shown).toEqual([{ id: 'w', kind: 'answer', title: 'One word', body: 'PEAR' }])
  expect(ran.size).toBe(0)
})

// Seen on the iOS simulator: DSH's "started" arrives before the list shows the chat running, and an empty "Answer
// ready" went out while the agent was still working.
test('a chat DSH says started, that the list does not show running yet, is not news', async () => {
  const chats: ChatSummary[] = [{ sessionId: 'w', title: 'Long one', updatedAt: 1, running: false }]
  const shown: unknown[] = []
  const ran = new Map<string, 'running' | 'finished'>()
  const a = createAttention({
    list: async () => chats, requests: () => [], waiting: () => [], ran, everyMs: 1e9, settleMs: 0,
    call: async (name, args) => { if (name === 'notify.show') shown.push(args); return null },
  }, { active: () => false, visible: () => undefined })
  await settle()
  ran.set('w', 'running'); await a.poll(); await settle(); await settle()
  expect(shown).toEqual([])
})

test('the person’s own chat that DSH says started is when the phone asks, even if the list never shows it running', async () => {
  const chats: ChatSummary[] = [{ sessionId: 'w', title: 'One word', updatedAt: 1, running: false }]
  const calls: string[] = []
  const ran = new Map<string, 'running' | 'finished'>()
  const a = createAttention({
    list: async () => chats, requests: () => [], waiting: () => [], ran, everyMs: 1e9, settleMs: 0,
    call: async (name) => { calls.push(name); return null },
  }, { active: () => true, visible: () => 'w' })
  await settle(); await settle()
  ran.set('w', 'running'); await a.poll()
  expect(calls.filter((c) => c === 'notify.request').length).toBe(1)
})

// On the iOS simulator the app once stored that it had asked while no prompt had shown, and never asked again.
test('an ask the phone did not put to the person (it says undecided) is asked again the next time', async () => {
  const chats: ChatSummary[] = [{ sessionId: 'w', title: 'One word', updatedAt: 1, running: false }]
  await Storage.removeItem('notifyAsked') // the tests above asked
  let requests = 0
  const ran = new Map<string, 'running' | 'finished'>()
  const a = createAttention({
    list: async () => chats, requests: () => [], waiting: () => [], ran, everyMs: 1e9, settleMs: 0,
    call: async (name) => { if (name !== 'notify.request') return null; requests++; return requests === 1 ? { granted: false, decided: false } : { granted: true } },
  }, { active: () => true, visible: () => 'w' })
  await settle(); await settle()
  ran.set('w', 'running'); await a.poll(); await settle()
  ran.set('w', 'running'); await a.poll(); await settle()
  ran.set('w', 'running'); await a.poll(); await settle()
  expect(requests).toBe(2)
})
