// The phone's Settings page (src/settings.tsx): which computer it is linked to and how, the
// appearance, the language and the notifications, and Unlink. Headless: the test plays the shell and the computer.
import { expect, open, test } from 'nsh/test'

const ORIGIN = 'http://127.0.0.1:40001/dsh'
const paired = { paired: true, origin: ORIGIN, token: 'synthetic-device-token' }
const ok = (value: unknown) => ({ body: { type: 'server-response', rpcId: 'x', result: { ok: true, value } } })

async function settings(granted: boolean) {
  const app = await open('../App.tsx', {
    locale: 'en-US',
    host: { handlers: {
      'link.state': paired, 'app.state': { active: true }, 'notify.watch': null, 'notify.clear': null, 'notify.permission': { granted },
      'notify.request': { granted: true, decided: true }, 'notify.settings': null, 'link.forget': null, 'link.path': { route: 'relay', relay: 'tok' },
    } },
    network: {
      [`POST ${ORIGIN}/api/session/list`]: () => ok({ items: [] }),
      [`GET http://127.0.0.1:40001/v1/capabilities`]: () => ({ body: { hostName: 'DSH Anywhere companion', computerName: 'Studio', hostVersion: '0.7.13', upstreamVersion: '0.2.1-rc.3' } }),
    },
  })
  await app.waitFor('id:more')
  await app.press('id:more')
  await app.press('text:Settings')
  await app.waitFor('text:Studio')
  return app
}

test('Settings says which computer the phone is linked to, how, and the versions on it', async () => {
  const app = await settings(true)
  const t = app.texts()
  for (const s of ['Computer', 'Studio', 'End-to-end encrypted tunnel', 'Through a relay (TOK)', '0.2.1-rc.3', '0.7.13', 'Unlink', 'Appearance', 'Language', 'Notifications']) expect([s, t.includes(s)]).toEqual([s, true])
})

test('a language picked in Settings changes the app\'s words at once', async () => {
  const app = await settings(true)
  await app.press('id:language-ru')
  await app.waitFor('text:Компьютер')
  await app.press('id:language-system')
  await app.waitFor('text:Computer')
})

test('with notifications off for the app, Settings says so and opens the phone\'s settings', async () => {
  const app = await settings(false)
  await app.waitFor('text:Notifications for DSH are off in the phone’s settings.')
  await app.press('id:notify-open-settings')
  expect(app.host.calls().some((c) => c.name === 'notify.settings')).toBe(true)
})

test('Unlink in Settings forgets the computer', async () => {
  const app = await settings(true)
  await app.press('id:settings-unlink')
  await app.waitFor('text:Link your computer')
  expect(app.host.calls().some((c) => c.name === 'link.forget')).toBe(true)
})
