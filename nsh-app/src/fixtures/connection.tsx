// The connection's state on its own, over a connection the test sets with buttons (src/status.test.tsx): the bar under
// a chat's header, the one on the chats page, the dot in a chat's header, and the sheet they open.
import { mount, signal, Text, View } from 'nsh'
import type { ConnectionState } from '../dsh.ts'
import type { Check } from '../reach.ts'
import { ConnectionBar, ConnectionDot, ReachSheet, type Reach } from '../status.tsx'

const connection = signal<ConnectionState>('online'), network = signal(true), active = signal(true)
const check = signal<Check | undefined>(undefined), retryAt = signal<number | undefined>(undefined), route = signal('')
const open = signal(false), onChats = signal(false), retried = signal(0), relinked = signal(0)
const reach: Reach = { connection, network, active, check, retryAt, routeText: route, open, retry: () => retried.update((n) => n + 1), relink: () => relinked.update((n) => n + 1) }
const set = (label: string, f: () => void) => <View role="button" testID={label} onPress={f}><Text>{label}</Text></View>
const failing = (c: Check) => { connection.set('offline'); check.set(c) }

function App() {
  return (
    <View class="flex-1 bg-background pt-[60px]">
      <ConnectionDot reach={reach} />
      <If when={onChats()} else={<ConnectionBar reach={reach} />}><ConnectionBar reach={reach} always /></If>
      <View class="flex-row flex-wrap gap-2">
        {set('online', () => { connection.set('online'); check.set(undefined) })}
        {set('connecting', () => connection.set('connecting'))}
        {set('offline', () => connection.set('offline'))}
        {set('away', () => active.set(false))}
        {set('back', () => active.set(true))}
        {set('no-network', () => { network.set(false); connection.set('offline') })}
        {set('blocked', () => failing({ relay: 'unreachable', computer: 'unreachable' }))}
        {set('computer', () => failing({ relay: 'reachable', computer: 'unreachable' }))}
        {set('companion', () => failing({ relay: 'reachable', computer: 'reachable', access: 'failed' }))}
        {set('refused', () => { failing({ relay: 'reachable', computer: 'reachable', access: 'refused' }); retryAt.set(undefined) })}
        {set('slow', () => { connection.set('online'); check.set({ access: 'ok', latencyMs: 2400 }) })}
        {set('next-try', () => retryAt.set(Date.now() + 8_000))}
        {set('direct', () => route.set('Direct to your computer'))}
        {set('chats', () => onChats.set(true))}
      </View>
      <Text>{`retried:${retried()} relinked:${relinked()}`}</Text>
      <ReachSheet reach={reach} />
    </View>
  )
}

mount(App)
