// The activity panel's section heading and its Pin row, measured: where each one's text starts goes to Storage for
// src/panelrows.test.tsx, which checks that they line up.
import { mount, Storage, View } from 'nsh'
import { PinRow, Section } from '../activity.tsx'

const keep = (key: string) => (e: { bounds: { origin: { x: number } } }) => Storage.setItem(key, String(e.bounds.origin.x)).catch(() => {})

function App() {
  return (
    <View class="flex-1 bg-background p-4">
      <Section icon="listChecks" title="To-dos" count={1} testID="section" onTitleLayout={keep('section')} />
      <PinRow onPress={() => {}} onLabelLayout={keep('pin')} />
    </View>
  )
}
mount(App)
