// The phone's Settings page: the computer it is linked to (its name and versions, from the companion's
// /v1/capabilities; whether it is reached now; how: Tailcat's end-to-end encrypted tunnel, direct or through a relay),
// Unlink, and the phone's own settings (prefs.ts): appearance, language, notifications. DSH's own settings stay on
// the computer.
import { cleanup, effect, host, platform, Scroll, signal, Text, View, type JSX } from 'nsh'
import { Switch } from 'nsh/base'
import { appActive, connection, dsh, unlink } from './state.ts'
import { language, S, type Language } from './strings.ts'
import { notifyPrefs, setLanguage, setNotify, setTheme, theme, type NotifyPrefs, type Theme } from './prefs.ts'
import { Icon } from './ui.tsx'

function Group(props: { children?: JSX.Element | JSX.Element[] }) { return <View class="rounded-[14px] bg-card border border-border overflow-hidden">{props.children}</View> }
function Label(props: { text: string }) { return <Text class="px-2 pt-5 pb-[6px] text-muted-foreground text-[13px] font-medium">{props.text}</Text> }
function Info(props: { label: string; value: string; first?: boolean; children?: JSX.Element }) {
  return (
    <View class={`flex-row items-center gap-3 px-[14px] py-[11px] ${props.first ? '' : 'border-t border-border'}`}>
      <Text class="text-foreground text-[15px]">{props.label}</Text>
      <View class="flex-1 flex-row items-center justify-end gap-2">{props.children}<Text class="text-muted-foreground text-[15px] text-right line-clamp-2 shrink">{props.value}</Text></View>
    </View>
  )
}

/** Language names in their own language, as pickers show them; "System" in the app's. */
const LANGUAGES: { id: Language; name: () => string }[] = [
  { id: 'system', name: () => S.languageSystem }, { id: 'zh', name: () => '简体中文' }, { id: 'zh-Hant', name: () => '繁體中文' }, { id: 'en', name: () => 'English' }, { id: 'es', name: () => 'Español' }, { id: 'fr', name: () => 'Français' }, { id: 'ko', name: () => '한국어' }, { id: 'ja', name: () => '日本語' }, { id: 'ru', name: () => 'Русский' },
]
const THEMES: { id: Theme; name: () => string }[] = [{ id: 'system', name: () => S.themeSystem }, { id: 'light', name: () => S.themeLight }, { id: 'dark', name: () => S.themeDark }]

export function SettingsPage() {
  const computer = signal<{ name: string; companionVersion: string; dshVersion: string } | undefined>(undefined)
  const granted = signal<boolean | undefined>(undefined)
  const load = () => dsh().computer().then((c) => computer.set(c), () => {})
  // Direct or through a relay: the tunnel asks the computer (link.path; a direct path can come a little later).
  const route = signal<{ route: string; relay?: string } | undefined>(undefined)
  const findRoute = () => host.call<{ route?: string; relay?: string }>('link.path').then((v) => route.set(v?.route ? { route: v.route, ...(v.relay ? { relay: v.relay } : {}) } : undefined), () => {})
  const routeText = () => { const r = route(); return r?.route === 'direct' ? S.pathDirect : r?.route === 'relay' ? S.pathRelay((r.relay ?? '').toUpperCase() || '—') : '' }
  const permission = () => host.call<{ granted?: boolean }>('notify.permission').then((v) => granted.set(v?.granted === true), () => {})
  load(); permission(); findRoute()
  const again = setInterval(() => { if (connection() === 'online') findRoute() }, 10_000)
  cleanup(() => clearInterval(again))
  // Back from the phone's settings, or reconnected: read again what may have changed there.
  effect(() => { if (appActive()) permission() })
  effect(() => { if (connection() === 'online' && !computer()) load() })
  const allow = () => host.call<{ granted?: boolean }>('notify.request').then((v) => { granted.set(v?.granted === true); if (!v?.granted) host.call('notify.settings').catch(() => {}) }, () => {})
  const state = () => connection()
  const toggle = (key: keyof NotifyPrefs, label: string, hint?: string, first?: boolean) => (
    <View class={`flex-row items-center gap-3 px-[14px] py-3 ${first ? '' : 'border-t border-border'}`}>
      <View class="flex-1 gap-[2px]">
        <Text class="text-foreground text-[15px]">{label}</Text>
        <If when={hint}><Text class="text-muted-foreground text-[13px] leading-[18px]">{hint}</Text></If>
      </View>
      <Switch testID={`notify-${key}`} accessibilityLabel={label} checked={notifyPrefs()[key]} onChange={(e) => setNotify({ [key]: e.checked })}
        class="w-[46px] h-[28px]" trackClass="w-full h-full rounded-full bg-input checked:bg-primary justify-center px-[3px] transition-colors duration-150"
        thumbClass="w-[22px] h-[22px] rounded-full bg-background shadow-sm checked:translate-x-[18px] transition-transform duration-150" />
    </View>
  )
  return (
    <Scroll class="flex-1 bg-background" contentClass="px-4 pb-10" testID="settings">
      <Label text={S.computer} />
      <Group>
        <Info first label={S.computerName} value={computer()?.name ?? '…'} />
        <Info label={S.connectionStatus} value={S.connectionState[state()]}>
          <View class={`w-[8px] h-[8px] rounded-full ${state() === 'online' ? 'bg-emerald-500' : state() === 'offline' ? 'bg-destructive' : 'bg-amber-500'}`} />
        </Info>
        <View class="flex-row items-start gap-3 px-[14px] py-[11px] border-t border-border">
          <Text class="text-foreground text-[15px]">{S.connection}</Text>
          <View class="flex-1 items-end gap-[2px]">
            <Text class="text-muted-foreground text-[15px] text-right">{S.viaTailcat}</Text>
            <If when={routeText()}><Text testID="route" class="text-muted-foreground text-[13px] text-right">{routeText()}</Text></If>
          </View>
        </View>
        <If when={computer()?.dshVersion}><Info label={S.dshVersion} value={computer()?.dshVersion ?? ''} /></If>
        <If when={computer()?.companionVersion}><Info label={S.companionVersion} value={computer()?.companionVersion ?? ''} /></If>
      </Group>
      <View role="button" testID="settings-unlink" onPress={() => unlink()} class="mt-3 rounded-[14px] bg-card border border-border px-[14px] py-[11px] items-center active:bg-secondary">
        <Text class="text-destructive text-[15px] font-medium">{S.unlink}</Text>
      </View>
      <Text class="px-2 pt-[6px] text-muted-foreground text-[13px] leading-[18px]">{S.unlinkHint}</Text>

      <Label text={S.appearance} />
      <View class="flex-row rounded-[12px] bg-secondary p-[3px]">
        {THEMES.map((t) => (
          <View role="radio" testID={`theme-${t.id}`} accessibilityLabel={t.name()} onPress={() => setTheme(t.id)}
            class={`flex-1 h-[34px] rounded-[9px] items-center justify-center ${theme() === t.id ? 'bg-background shadow-sm' : 'active:opacity-70'}`}>
            <Text class={`text-[14px] ${theme() === t.id ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{t.name()}</Text>
          </View>
        ))}
      </View>

      <Label text={S.language} />
      <Group>
        {LANGUAGES.map((l, i) => (
          <View role="radio" testID={`language-${l.id}`} accessibilityLabel={l.name()} onPress={() => setLanguage(l.id)}
            class={`flex-row items-center gap-3 px-[14px] py-[11px] active:bg-secondary ${i ? 'border-t border-border' : ''}`}>
            <Text class="flex-1 text-foreground text-[15px]">{l.name()}</Text>
            <If when={language() === l.id}><Icon name="check" size={18} class="tint-foreground" /></If>
          </View>
        ))}
      </Group>

      <Label text={S.notifications} />
      <If when={granted() === false}>
        <View class="mb-3 rounded-[14px] bg-card border border-border px-[14px] py-3 gap-2">
          <Text class="text-foreground text-[14px] leading-5">{S.notifyDenied}</Text>
          <View class="flex-row gap-4">
            <View role="button" testID="notify-allow" onPress={allow} hitSlop={6} class="active:opacity-60"><Text class="text-primary text-[14px] font-medium">{S.notifyAllow}</Text></View>
            <View role="button" testID="notify-open-settings" onPress={() => host.call('notify.settings').catch(() => {})} hitSlop={6} class="active:opacity-60"><Text class="text-primary text-[14px] font-medium">{S.openSystemSettings}</Text></View>
          </View>
        </View>
      </If>
      <Group>
        {toggle('answers', S.notifyAnswers, undefined, true)}
        {toggle('decisions', S.notifyDecisions)}
        {toggle('banners', S.notifyBanners)}
        {toggle('background', S.notifyBackground, platform.os === 'android' ? S.notifyBackgroundHint : undefined)}
      </Group>
    </Scroll>
  )
}
