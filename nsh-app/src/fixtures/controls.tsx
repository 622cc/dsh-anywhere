// The controls sheet on its own, open, with more commands than a phone screen holds (src/commandbar.test.tsx).
import { mount, signal, Text, View } from 'nsh'
import { ControlsSheet } from '../commandbar.tsx'
import type { Command } from '../commands.ts'

const commands: Command[] = Array.from({ length: 30 }, (_, i) => ({ name: `c${i}`, description: `Command ${i}` }) as Command)

function App() {
  const picked = signal('')
  return (
    <View class="flex-1 bg-background">
      <Text testID="picked">{picked()}</Text>
      <ControlsSheet open={() => true} onClose={() => {}} sessionId="s" commands={() => commands} skills={() => []} run={async () => undefined} insert={(t) => picked.set(t)} reload={() => {}} />
    </View>
  )
}
mount(App)
