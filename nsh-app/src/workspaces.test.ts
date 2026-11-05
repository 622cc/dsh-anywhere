// The chat list as DSH Desktop's sidebar shows it: workspaces from workspace/follow, each with its chats in its own
// order, pinned chats first, archived chats hidden, and chats no workspace claims under "Other".
import { expect, test } from 'nsh/test'
import { Workspaces, archivedChats, groupChats, searchChats, summaries } from './workspaces.ts'
import { language, S, type Language } from './strings.ts'

const W = (id: string, title: string, sessionIds: string[]) => ({ workspaceId: id, path: `/w/${id}`, title, sessionIds, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' })
const chat = (id: string, updatedAt: number) => ({ sessionId: id, title: id, updatedAt, running: false })

test('frames build the workspace list: baseline, upsert, remove, order, archived, pinned', () => {
  const w = new Workspaces()
  w.apply({ type: 'baseline', value: { items: [W('a', 'Alpha', ['s1']), W('b', 'Beta', [])], archivedSessionIds: ['s9'], pinnedSessionIds: [] } })
  w.apply({ type: 'upsert', workspace: W('c', 'Gamma', ['s3']) })
  w.apply({ type: 'remove', workspaceId: 'b' })
  w.apply({ type: 'order', workspaceIds: ['c', 'a'] })
  w.apply({ type: 'pinned', pinnedSessionIds: ['s2'] })
  expect(w.list().map((x) => x.title)).toEqual(['Gamma', 'Alpha'])
  expect([...w.archived]).toEqual(['s9'])
  expect(w.pinned).toEqual(['s2'])
})

test('the group of chats in no workspace is named in the app\'s language', () => {
  const names: Record<string, string> = { zh: '其他', 'zh-Hant': '其他', en: 'Other', es: 'Otros', ko: '기타', ja: 'その他', ru: 'Другие' }
  for (const [id, name] of Object.entries(names)) {
    language.set(id as Language)
    expect([id, groupChats(new Workspaces(), [chat('s1', 1)])[0]!.title]).toEqual([id, name])
  }
  language.set('system')
})

test('chats grouped under their workspaces, newest first, pinned first, archived hidden', () => {
  const w = new Workspaces()
  w.apply({ type: 'baseline', value: { items: [W('a', 'Alpha', ['s1', 's2', 's9']), W('b', 'Beta', ['s3'])], archivedSessionIds: ['s9'], pinnedSessionIds: ['s1'] } })
  const groups = groupChats(w, [chat('s1', 1), chat('s2', 5), chat('s3', 3), chat('s4', 9), chat('s9', 10)])
  expect(groups.map((g) => [g.title, g.chats.map((c) => c.sessionId)])).toEqual([['Alpha', ['s1', 's2']], ['Beta', ['s3']], ['Other', ['s4']]])
})

test('archived chats stay out of the workspaces and come on their own, newest first, to be brought back', () => {
  const w = new Workspaces()
  w.apply({ type: 'baseline', value: { items: [W('a', 'Alpha', ['s1', 's8', 's9'])], archivedSessionIds: ['s8', 's9'], pinnedSessionIds: [] } })
  const chats = [chat('s1', 1), chat('s8', 4), chat('s9', 7)]
  expect(groupChats(w, chats).map((g) => [g.id, g.chats.map((c) => c.sessionId)])).toEqual([['a', ['s1']]])
  expect(archivedChats(w, chats).map((c) => c.sessionId)).toEqual(['s9', 's8'])
})

test('search: titles match on the phone at once (any word, any case); DSH\'s full-text hits follow, without repeats', () => {
  const chats = [{ ...chat('s1', 1), title: 'Fix the login bug' }, { ...chat('s2', 9), title: 'Release notes' }, { ...chat('s3', 5), title: 'Login page copy' }]
  expect(searchChats(chats, '  LOGIN ').map((r) => r.sessionId)).toEqual(['s3', 's1'])
  expect(searchChats(chats, 'login', [{ sessionId: 's1', snippet: '…the login token…' }, { sessionId: 's2', snippet: 'login is mentioned' }])
    .map((r) => [r.sessionId, r.snippet ?? ''])).toEqual([['s3', ''], ['s1', '…the login token…'], ['s2', 'login is mentioned']])
  expect(searchChats(chats, '')).toEqual([])
})

test('the chat list has the person\'s chats and their forks, as Desktop\'s sidebar: no subagents, no blank chats', () => {
  const list = summaries({ items: [
    { sessionId: 'a', updatedAt: 2, projections: { values: { title: 'Mine' } } },
    { sessionId: 'f', updatedAt: 3, parentSessionId: 'a', projections: { values: { title: 'Mine' } } },
    { sessionId: 's', updatedAt: 4, parentSessionId: 'a', origin: 'subagent' },
    { sessionId: 'b', updatedAt: 5, blank: true },
  ] })
  expect(list.map((c) => c.sessionId)).toEqual(['f', 'a'])
})

// The wire value is the bare array of turns (dsh-session-turn-outline 0.2.1-rc.3, projection.js: `view: state => state.turns`).
test('a chat carries the preview of its last answer, as DSH’s turn outline keeps it (up to 120 characters)', () => {
  const [c] = summaries({ items: [{ sessionId: 'a', updatedAt: 1, projections: { values: { title: 'Mine', turnOutline: [
    { turn: 1, seq: 3, prompt: 'Hi', response: 'Hello' }, { turn: 2, seq: 9, prompt: 'Run the tests', response: 'All 173 tests pass.' },
  ] } } }] })
  expect(c!.preview).toBe('All 173 tests pass.')
  expect(summaries({ items: [{ sessionId: 'b', updatedAt: 1, projections: { values: { turnOutline: [{ turn: 1, seq: 1, prompt: 'x' }] } } }] })[0]!.preview).toBe(undefined)
})

// DSH Desktop shows its Default workspace (title "default-workspace") as "Default workspace" (dsh-client-ui-workspace 0.2.1-rc.3).
test('DSH\'s Default workspace is named as Desktop names it', () => {
  const w = new Workspaces()
  w.apply({ type: 'baseline', value: { items: [{ workspaceId: 'd', path: '/home/me/Documents/deepseek-harness/default-workspace', title: 'default-workspace', sessionIds: ['s1'] }, W('a', 'default-workspace', [])], archivedSessionIds: [], pinnedSessionIds: [] } })
  expect(w.list().map((x) => x.title)).toEqual([S.defaultWorkspace, 'default-workspace'])
})
