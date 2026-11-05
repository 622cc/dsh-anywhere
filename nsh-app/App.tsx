// DSH on the phone: the same chats as DSH Desktop, read and driven through DSH's own protocol.
import { effect, host, Keyboard, mount, safeAreaInsets, signal, Text, View } from 'nsh'
import { createNavStack, Input, NavPage, NavStack } from 'nsh/base'
import { asks, boot, dsh, linkError, linking, loaded, news, pairWith, pending, scan, settings, started, turnErrors } from './src/state.ts'
import { Attention } from './src/notify.tsx'
import { summaries } from './src/workspaces.ts'
import { SessionsScreen, type Summary } from './src/sessions.tsx'
import { ChatScreen, type ChildOf } from './src/chat.tsx'
import { SchedulesScreen } from './src/schedules.tsx'
import { SettingsPage } from './src/settings.tsx'
import { loadPrefs } from './src/prefs.ts'
import { forkChat, RenameSheet } from './src/manage.tsx'
import { readable, S } from './src/strings.ts'
import { ActionSheetHost, HeaderMenu, IconButton } from './src/ui.tsx'
import { SelectTextHost } from './src/copy.tsx'
import { TrajectoryPage } from './src/trajectory.tsx'
import { DetailsPage } from './src/details.tsx'
import { ActivityButton, createActivity } from './src/activity.tsx'
import { ConnectionDot, ReachSheet } from './src/status.tsx'
import { FilesPage } from './src/files.tsx'
import { TerminalPage, TerminalsPage, type TerminalTarget } from './src/shell.tsx'
import type { FileEntry } from './src/files.ts'
import './assets/fonts/Geist-Regular.ttf'
import './assets/fonts/Geist-Medium.ttf'
import './assets/fonts/Geist-SemiBold.ttf'
import './assets/fonts/GeistMono-Regular.ttf'

type Route = { name: 'sessions' } | { name: 'schedules' } | { name: 'settings' } | { name: 'chat'; session: Summary; child?: ChildOf } | { name: 'trajectory'; session: Summary } | { name: 'details'; session: Summary }
  | { name: 'files'; session: Summary; path: string; file?: FileEntry } // a folder ('' the workspace root) or, with `file`, one file
  | { name: 'terminals'; session: Summary } | { name: 'terminal'; session: Summary; target: TerminalTarget; title?: string }
const HEADER = 'bg-background text-foreground tint-foreground'

/** A pairing link opened while the phone is linked: linking, then why the computer refused it, over every page.
 * The phone stays linked as it was; a tap or six seconds take the notice away. */
function LinkNotice() {
  const insets = safeAreaInsets()
  let timer: ReturnType<typeof setTimeout> | undefined
  effect(() => { clearTimeout(timer); if (linkError()) timer = setTimeout(() => linkError.set(''), 6000) })
  return (
    <If when={linking() || linkError()}>
      <View role="button" testID="link-notice" onPress={() => linkError.set('')} class="absolute left-4 right-4 rounded-[12px] bg-popover border border-border px-3 py-[10px] shadow-md"
        style={{ top: insets().top + 64 }}>
        <Text class={`text-[13px] leading-[18px] ${linkError() ? 'text-destructive' : 'text-foreground'}`}>{linkError() || S.linking}</Text>
      </View>
    </If>
  )
}

/** Link the phone to the computer as messaging and agent apps link a device: scan the code the computer shows, or paste it.
 * A pasted code links with Return or the Link button; the page stays above the keyboard so the button and why a code was
 * refused show while typing (seen on the iOS simulator, 2026-11-02: the keyboard covered both). */
function Connect() {
  const pasting = signal(false)
  const code = signal('')
  const link = () => { const t = code().trim(); if (t && !linking()) { Keyboard.dismiss(); pairWith(t) } }
  return (
    <View class="flex-1 bg-background px-6 pt-[env(safe-area-inset-top)] pb-[env(keyboard-inset-height)] justify-center gap-3">
      <Text class="text-foreground text-[17px] font-semibold tracking-[-0.2px]">{S.linkTitle}</Text>
      <Text class="text-muted-foreground text-[15px] leading-[22px] mb-3">{S.linkHow}</Text>
      <View role="button" testID="scan" onPress={() => { if (!linking()) scan() }} class="rounded-[10px] bg-primary py-3 items-center active:opacity-80">
        <Text class="text-primary-foreground text-[15px] font-medium">{linking() ? S.linking : S.scan}</Text>
      </View>
      <If when={pasting()} else={
        <View role="button" testID="paste" onPress={() => pasting.set(true)} class="py-3 items-center active:opacity-60"><Text class="text-muted-foreground text-[15px]">{S.paste}</Text></View>
      }>
        <View class="gap-3">
        <Input testID="code" placeholder="dshm1:…" value={code()} onChange={(e) => code.set(e.value)} autoCapitalize="none" autoCorrect={false} submitBehavior="submit"
          onSubmit={link}
          class="rounded-[10px] border border-input bg-card px-3 py-3 text-foreground placeholder:text-muted-foreground font-mono text-[13px]" />
        <View role="button" testID="link-code" accessibilityLabel={S.linkCode} onPress={link}
          class={`rounded-[10px] border border-border py-3 items-center ${code().trim() && !linking() ? 'active:bg-secondary' : 'opacity-50'}`}>
          <Text class="text-foreground text-[15px] font-medium">{linking() ? S.linking : S.linkCode}</Text>
        </View>
        </View>
      </If>
      <If when={linkError()}><Text testID="link-error" class="text-destructive text-[15px] leading-[21px]">{linkError()}</Text></If>
    </View>
  )
}

function App() {
  loadPrefs()
  boot()
  const nav = createNavStack<Route>([{ name: 'sessions' }])
  const titles = signal<Record<string, string>>({})
  const newChat = signal(false)
  const menu = signal(false)
  const chatMenu = signal(false)
  const renaming = signal<Summary | undefined>(undefined)
  const notice = signal('')
  let menuClosed = 0 // a press on ⋯ while the menu is open closes it as a press outside; it must not reopen it
  effect(() => { nav.routes(); setTimeout(() => Keyboard.dismiss(), 0) }) // the keyboard belongs to the page that asked for it
  const terminalMenu = signal(false)
  const page = (route: Route) => route.name === 'terminals'
    ? <NavPage title={S.terminals} headerClass={HEADER} class="bg-background">
        <TerminalsPage sessionId={route.session.sessionId} onOpen={(target, title) => nav.push({ name: 'terminal', session: route.session, target, title })} />
      </NavPage>
    : route.name === 'terminal'
    ? <NavPage title={route.title ?? S.terminal} headerClass={HEADER} class="bg-background"
        headerRight={<IconButton name="x" label={S.closeTerminal} testID="terminal-more" onPress={() => { if (Date.now() - menuClosed > 300) terminalMenu.set(true) }} />}>
        <TerminalPage sessionId={route.session.sessionId} target={route.target} menu={terminalMenu} onMenuClosed={() => { menuClosed = Date.now(); terminalMenu.set(false) }} onClosed={() => nav.pop()} />
      </NavPage>
    : route.name === 'files'
    ? <FilesPage sessionId={route.session.sessionId} path={route.path} file={route.file} headerClass={HEADER}
        onOpen={(path, entry) => nav.push({ name: 'files', session: route.session, path, file: entry.type === 'directory' ? undefined : entry })}
        onMentioned={() => { const rs = nav.routes(); let i = rs.length - 1; while (i > 0 && rs[i]!.name === 'files') i--; nav.pop(rs.length - 1 - i) }} />
    : route.name === 'schedules'
    ? <NavPage title={S.schedules} headerClass={HEADER} class="bg-background"><SchedulesScreen /></NavPage>
    : route.name === 'settings'
    ? <NavPage title={S.settings} headerClass={HEADER} class="bg-background"><SettingsPage /></NavPage>
    : route.name === 'sessions'
    ? <NavPage title={S.chats} headerClass={HEADER} class="bg-background"
        headerRight={<View class="flex-row items-center">
          <IconButton name="compose" label={S.newChat} testID="new-chat" onPress={() => newChat.set(true)} />
          <IconButton name="more" label={S.more} testID="more" onPress={() => { if (Date.now() - menuClosed > 300) menu.set(true) }} />
        </View>}>
        <View class="flex-1">
          <SessionsScreen onOpen={(session) => nav.push({ name: 'chat', session })} newChat={newChat} onNewChatClosed={() => newChat.set(false)} />
          <HeaderMenu open={menu} onClose={() => { menuClosed = Date.now(); menu.set(false) }} actions={[{ id: 'schedules', label: S.schedules, icon: 'clock' }, { id: 'settings', label: S.settings, icon: 'sliders' }]}
            onChoose={(id) => { if (id === 'schedules') nav.push({ name: 'schedules' }); else if (id === 'settings') nav.push({ name: 'settings' }) }} />
        </View>
      </NavPage>
    : route.name === 'trajectory' ? <NavPage title={S.trajectory} headerClass={HEADER} class="bg-background"><TrajectoryPage sessionId={route.session.sessionId} /></NavPage>
    : route.name === 'details' ? <NavPage title={S.details} headerClass={HEADER} class="bg-background"><DetailsPage sessionId={route.session.sessionId} /></NavPage>
    : chatPage(route)
  const chatPage = (route: Route & { name: 'chat' }) => {
    const activity = route.child ? undefined : createActivity()
    return <NavPage title={titles()[route.session.sessionId] ?? route.session.title} headerClass={HEADER} class="bg-background"
        headerRight={route.child ? <ConnectionDot /> : <View class="flex-row items-center">
          <ConnectionDot />
          <ActivityButton activity={activity!} />
          <IconButton name="more" label={S.more} testID="chat-more" onPress={() => { if (Date.now() - menuClosed > 300) chatMenu.set(true) }} />
        </View>}>
        <View class="flex-1">
          <ChatScreen sessionId={route.session.sessionId} child={route.child} activity={activity} where={route.session.project && route.session.cwd ? { title: route.session.project, path: route.session.cwd } : undefined} onTitle={(t) => { if (!route.child && titles()[route.session.sessionId] !== t) titles.update((m) => ({ ...m, [route.session.sessionId]: t })) }}
            onOpenChild={(c) => nav.push({ name: 'chat', session: { ...route.session, sessionId: c.id, title: c.name, running: c.running }, child: { parentSessionId: route.session.sessionId, subagent: c } })} />
          <If when={notice()}><Text testID="chat-notice" class="absolute top-2 left-4 right-4 rounded-[10px] bg-popover border border-border px-3 py-2 text-foreground text-[13px] shadow-md">{notice()}</Text></If>
          <HeaderMenu open={chatMenu} onClose={() => { menuClosed = Date.now(); chatMenu.set(false) }}
            actions={[{ id: 'rename', label: S.rename, icon: 'pencil' }, { id: 'fork', label: S.fork, icon: 'fork' }, { id: 'files', label: S.files, icon: 'folder' }, { id: 'terminal', label: S.terminal, icon: 'terminal' }, { id: 'trajectory', label: S.trajectory, icon: 'route' }, { id: 'details', label: S.details, icon: 'info' }]}
            onChoose={(id) => {
              if (id === 'files') return nav.push({ name: 'files', session: route.session, path: '' })
              if (id === 'terminal') return nav.push({ name: 'terminals', session: route.session })
              const chat = { ...route.session, title: titles()[route.session.sessionId] ?? route.session.title }
              if (id === 'trajectory' || id === 'details') nav.push(id === 'trajectory' ? { name: 'trajectory', session: chat } : { name: 'details', session: chat })
              else if (id === 'rename') renaming.set(chat)
              else forkChat(chat).then((forked) => nav.push({ name: 'chat', session: forked }), (e) => { notice.set(readable(e)); setTimeout(() => notice.set(''), 4000) })
            }} />
          <RenameSheet chat={renaming} onClose={() => renaming.set(undefined)} onRenamed={(id, t) => titles.update((m) => ({ ...m, [id]: t }))} />
        </View>
      </NavPage>
  }
  /** The chat on screen (none on the list or a chat's other pages). */
  const visible = () => { const r = nav.routes().at(-1); return r?.name === 'chat' ? r.session.sessionId : undefined }
  /** A notification or banner tapped: that chat, over the list, whatever page was open. A notification that started
   * the app does not know the chat's title yet: the header stays empty until the chat says it, instead of "New chat". */
  const openChat = (sessionId: string, title: string) => {
    if (visible() === sessionId) return
    nav.popToRoot()
    nav.push({ name: 'chat', session: { sessionId, title: titles()[sessionId] ?? title, updatedAt: 0, running: false } })
  }
  // A new link may be another computer: back to its chats.
  let lastLink: string | undefined
  effect(() => { const key = settings()?.key; if (lastLink && key && key !== lastLink) nav.popToRoot(); lastLink = key })
  return (
    <If when={loaded()}>
      <If when={settings()} else={<Connect />}>
        {/* One for each link: a new one replaces the connection, and every stream a screen holds closes with the old. */}
        <Each of={settings() ? [settings()!.key] : []}>{() => (
          <>
            <NavStack state={nav} class="flex-1">{(route) => page(route)}</NavStack>
            <Attention visible={visible} open={openChat} asks={asks} news={news}
              io={{ list: () => dsh().rpc('session/list', { _request: {} }).then(summaries), requests: (id) => pending.forSession(id), waiting: () => pending.sessionsWaiting(), errors: turnErrors, ran: started, call: (name, args) => host.call(name, args) }} />
            <LinkNotice />
            <ReachSheet />
            <ActionSheetHost />
            <SelectTextHost />
          </>
        )}</Each>
      </If>
    </If>
  )
}

mount(App)
