// Copying a message, as ChatGPT's and Claude's phone apps do it: a long press on a message offers Copy (all of it) and
// Select text, which opens the message on its own in the platform's text field, so selection is the system's (a word
// under the finger, handles, the magnifier) away from the list's scrolling and the screen edges' back gesture.
import { Clipboard, safeAreaInsets, signal, Text, View, windowSize } from 'nsh'
import { Input, Sheet, TextView } from 'nsh/base'
import { chooseAction, haptic, IconButton, SCRIM, SHEET } from './ui.tsx'
import { S } from './strings.ts'

export async function copyText(text: string): Promise<boolean> {
  try { await Clipboard.writeText(text); haptic('confirm'); return true } catch { haptic('reject'); return false }
}

const selecting = signal<string | undefined>(undefined)

/** The menu of a message: copy it (an answer as its Markdown, as ChatGPT and Claude copy), or select part of it
 * (an answer as it reads, without the Markdown's marks). */
export async function messageMenu(text: string, markdown = false) {
  haptic('press')
  const action = await chooseAction({ actions: [{ id: 'copy', label: S.copy, icon: 'copy' }, { id: 'select', label: S.selectText, icon: 'textSelect' }] })
  if (action === 'copy') copyText(text)
  if (action === 'select') selecting.set(markdown ? TextView.plainText(TextView.parse(text)) : text)
}

/** Where Select text shows the message: once, at the app's root. */
export function SelectTextHost() {
  const insets = safeAreaInsets()
  const shown = signal(false)
  const text = signal('')
  // The sheet keeps its text while it slides out.
  const open = () => { const t = selecting(); if (t !== undefined) { text.set(t); shown.set(true) } return shown() }
  const close = () => { shown.set(false); selecting.set(undefined) }
  return (
    <Sheet open={open()} onOpenChange={(e) => { if (!e.open) close() }} popupClass={SHEET} backdropStyle={SCRIM}>
      <View testID="select-text" style={{ height: Math.round(windowSize().height * 0.88), paddingBottom: insets().bottom + 8 }} class="pt-2">
        <View class="flex-row items-center pl-6 pr-3 h-[48px]">
          <Text class="flex-1 text-foreground text-[15px] font-medium">{S.selectText}</Text>
          <IconButton name="copy" label={S.copy} testID="select-copy" onPress={() => copyText(text())} />
          <IconButton name="x" label={S.close} testID="select-close" onPress={close} />
        </View>
        <Input readonly multiline value={text()} testID="select-field" accessibilityLabel={S.selectText}
          class="flex-1 bg-transparent px-6 pt-2 pb-4 text-foreground text-[15px] leading-[23px]" />
      </View>
    </Sheet>
  )
}
