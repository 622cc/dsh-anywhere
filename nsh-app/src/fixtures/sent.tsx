// Sent messages in each state, and the row of an agent that has started (src/sent.test.tsx).
import { mount, View } from 'nsh'
import { OutgoingView, WorkingRow } from '../sent.tsx'
import { liveText } from '../fold.ts'
import { S } from '../strings.ts'
import type { Outgoing } from '../outbox.ts'

const now = Date.now()
const o = (id: string, change: Partial<Outgoing>): Outgoing => ({ id, text: `message ${id}`, drafts: [], state: 'sending', ahead: 0, sentAt: now, ...change })

function App() {
  return (
    <View class="flex-1 bg-background p-4 gap-4">
      <OutgoingView message={() => o('1', {})} busy={() => false} retry={() => {}} />
      <OutgoingView message={() => o('2', { state: 'queued', acceptedAt: now })} busy={() => false} retry={() => {}} />
      <OutgoingView message={() => o('3', { state: 'failed', error: S.errors.network })} busy={() => false} retry={() => {}} />
      <WorkingRow title={() => liveText({ detail: 'This gives the room id' }, 'analyzing')} />
    </View>
  )
}
mount(App)
