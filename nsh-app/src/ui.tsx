// Icons: one-colour SVGs tinted with the theme (`tint-*`), the round icon button used in headers and the composer,
// the action sheet every menu on the phone uses, and the phone's haptics.
import { createMotion, effect, host, Image, Keyboard, keyboardFrame, LayoutAnimation, Overlay, safeAreaInsets, signal, Text, View, type Bounds, type ViewRef, windowSize } from 'nsh'
import { Sheet } from 'nsh/base'
import { glow } from './motion.ts'
import { bySize, SIZES } from './icons.gen.ts'
import archive from '../assets/icons/archive.svg'
import check from '../assets/icons/check.svg'
import copy from '../assets/icons/copy.svg'
import textSelect from '../assets/icons/text-select.svg'
import image from '../assets/icons/image.svg'
import pencil from '../assets/icons/pencil.svg'
import pin from '../assets/icons/pin.svg'
import restore from '../assets/icons/restore.svg'
import unlink from '../assets/icons/unlink.svg'
import arrowUp from '../assets/icons/arrow-up.svg'
import chevronDown from '../assets/icons/chevron-down.svg'
import chevronRight from '../assets/icons/chevron-right.svg'
import disclosureDown from '../assets/icons/disclosure-down.svg'
import disclosureRight from '../assets/icons/disclosure-right.svg'
import compose from '../assets/icons/compose.svg'
import file from '../assets/icons/file.svg'
import folder from '../assets/icons/folder.svg'
import more from '../assets/icons/more.svg'
import plus from '../assets/icons/plus.svg'
import search from '../assets/icons/search.svg'
import x from '../assets/icons/x.svg'
import sliders from '../assets/icons/sliders.svg'
import fork from '../assets/icons/fork.svg'
import terminal from '../assets/icons/terminal.svg'
import listChecks from '../assets/icons/list-checks.svg'
import at from '../assets/icons/at.svg'
import message from '../assets/icons/message.svg'
import bot from '../assets/icons/bot.svg'
import clock from '../assets/icons/clock.svg'
import info from '../assets/icons/info.svg'
import route from '../assets/icons/route.svg'

export const icons = { archive, arrowUp, at, bot, check, chevronDown, chevronRight, clock, compose, copy, file, folder, fork, image, info, listChecks, message, more, pencil, pin, plus, restore, route, search, sliders, terminal, textSelect, unlink, x }
export type IconName = keyof typeof icons

/** The sizes icons come in: each draws a 1.5 pt line (scripts/icon-strokes.mjs). */
export type IconSize = typeof SIZES[number]
export const iconAsset = (name: IconName, size: IconSize) => bySize[size][name]

export function Icon(props: { name: IconName; size?: IconSize; class?: string }) {
  const size = props.size ?? 18
  return <Image src={iconAsset(props.name, size)} style={{ width: size, height: size }} class={props.class ?? 'tint-muted-foreground'} />
}

/** The chevron after a label (a dropdown, a disclosure, a row that opens): drawn edge to edge in its frame, so the gap
 * and padding around it are the space a person sees; 0.6 of the label's font size wide, its stroke about as heavy as
 * the label's stems (1.4 of 10 units at that width), in the label's colour. */
export function Chevron(props: { dir: 'down' | 'right'; font: number; class?: string; onLayout?: (e: { bounds: Bounds }) => void }) {
  const long = Math.round(props.font * 0.6 * 2) / 2, short = Math.round(long * 0.6 * 10) / 10
  const down = props.dir === 'down'
  return (
    <View onLayout={props.onLayout} style={{ width: down ? long : short, height: down ? short : long }}>
      <Image src={down ? disclosureDown : disclosureRight} style={{ width: down ? long : short, height: down ? short : long }} class={props.class ?? 'tint-muted-foreground'} />
    </View>
  )
}

/** A button that opens a list to choose from (the model picker): its label, then a chevron 5 pt after it, and the
 * same 10 pt of space on both sides. */
export function DropdownButton(props: { label: string; onPress: () => void; testID?: string; accessibilityLabel?: string; maxLabelWidth?: number
  onButtonLayout?: (e: { bounds: Bounds }) => void; onLabelLayout?: (e: { bounds: Bounds }) => void; onChevronLayout?: (e: { bounds: Bounds }) => void }) {
  return (
    <View role="button" testID={props.testID} accessibilityLabel={props.accessibilityLabel} onPress={props.onPress} hitSlop={4} onLayout={props.onButtonLayout}
      class="flex-row items-center gap-[5px] h-[32px] px-[10px] rounded-full active:bg-secondary">
      <Text onLayout={props.onLabelLayout} class="shrink text-muted-foreground text-[13px] line-clamp-1" style={{ maxWidth: props.maxLabelWidth ?? 200 }}>{props.label}</Text>
      <Chevron dir="down" font={13} onLayout={props.onChevronLayout} />
    </View>
  )
}

/** A 36 pt target around an icon (Android's minimum is 48 dp of touch area; the hit slop makes up the rest). */
export function IconButton(props: { name: IconName; label: string; onPress: () => void; testID?: string; size?: IconSize; class?: string; iconClass?: string }) {
  return (
    <View role="button" accessibilityLabel={props.label} testID={props.testID} onPress={props.onPress} hitSlop={6}
      class={`w-[36px] h-[36px] rounded-full items-center justify-center active:bg-secondary ${props.class ?? ''}`}>
      <Icon name={props.name} size={props.size ?? 20} class={props.iconClass ?? 'tint-foreground'} />
    </View>
  )
}


/** The next update's size changes animate, as a panel opening does elsewhere in the app. */
export const glide = () => LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'))

const insets = safeAreaInsets()
/** Bottom padding of a sheet: above the keyboard while it is up, else above the system bar. */
export const sheetBottom = () => Math.max(keyboardFrame().height, insets().bottom) + 8
/** Height limit of a sheet whose content stops at `cap`: the bottom padding (`sheetBottom`, the keyboard while it is
 * up) comes on top of the cap, and the sheet stays 8 pt below the status bar. */
export function sheetMaxHeight(cap: number, at: { window: number; top: number; bottom: number }) {
  return Math.min(cap + at.bottom, at.window - at.top - 8)
}
/** `sheetMaxHeight` on this screen, now. */
export const sheetMax = (cap: number) => sheetMaxHeight(cap, { window: windowSize().height, top: insets().top, bottom: sheetBottom() })

/** Material 3's bottom sheet: 28 pt top corners over a 32% scrim; every sheet of the app wears it. */
/** Something running: a dot in the text colour that breathes (see `glow`). */
export function LiveDot(props: { size?: number; class?: string }) {
  const m = createMotion()
  m.play(glow)
  return <View testID="live-dot" class={`rounded-full bg-live ${props.class ?? ''}`} style={{ width: props.size ?? 6, height: props.size ?? 6, ...m.style }} />
}

export const SHEET = 'bg-background rounded-t-[28px]'
export const SCRIM = { backgroundColor: 'rgba(0, 0, 0, 0.32)' }
/** The sheet's drag handle, 32 × 4 pt. */
export function Grabber() { return <View class="self-center w-8 h-1 rounded-full bg-input mb-2" /> }

/** The phone's own feedback for a moment (the app's `haptic`: Android's HapticFeedbackConstants). */
export type Haptic = 'tick' | 'press' | 'confirm' | 'reject' | 'threshold' | 'unthreshold'
export const haptic = (kind: Haptic) => { host.call('haptic', { kind }).catch(() => {}) }

export interface SheetAction { id: string; label: string; icon?: IconName; destructive?: boolean; /** A setting that is on: a check after it. */ checked?: boolean }
interface Asked { title?: string; actions: SheetAction[]; resolve: (id: string | undefined) => void }
const asked = signal<Asked | undefined>(undefined)
const shown = signal(false)

/** Asks which of `actions` to take in a sheet at the bottom; undefined when the person closes it. The keyboard goes
 * away first: the sheet would open behind it. */
export function chooseAction(options: { title?: string; actions: SheetAction[] }): Promise<string | undefined> {
  Keyboard.dismiss()
  asked()?.resolve(undefined)
  return new Promise((resolve) => { asked.set({ ...options, resolve }); shown.set(true) })
}

/** Where `chooseAction` shows its sheet: once, at the app's root. */
export function ActionSheetHost() {
  const answer = (id: string | undefined) => { asked()?.resolve(id); asked.set({ ...asked()!, resolve: () => {} }); shown.set(false) }
  return (
    <Sheet open={shown()} onOpenChange={(e) => { if (!e.open) answer(undefined) }} onClose={() => asked.set(undefined)} closeOnSwipe
      popupClass={SHEET} backdropStyle={SCRIM}>
      <View class="pt-[10px]" style={{ paddingBottom: insets().bottom + 8 }} testID="action-sheet">
        <Grabber />
        <If when={asked()?.title}><Text class="px-5 pt-1 pb-2 text-muted-foreground text-[13px] line-clamp-1">{asked()?.title}</Text></If>
        {(asked()?.actions ?? []).map((a) => (
          <View role="button" testID={`action-${a.id}`} onPress={() => { haptic('tick'); answer(a.id) }}
            class="flex-row items-center gap-[14px] mx-2 px-3 h-[52px] rounded-[12px] active:bg-secondary transition-colors duration-150">
            {a.icon ? <Icon name={a.icon} size={20} class={a.destructive ? 'tint-destructive' : 'tint-foreground'} /> : null}
            <Text class={`flex-1 text-[15px] ${a.destructive ? 'text-destructive' : 'text-foreground'}`}>{a.label}</Text>
            {a.checked ? <View testID={`action-${a.id}-on`}><Icon name="check" size={18} /></View> : null}
          </View>
        ))}
      </View>
    </Sheet>
  )
}

/** A header's "⋯" menu, dropped under the button as Claude's app does: it grows from the corner (scale 0.8 → 1 with a
 * fade, Material 3's menu) in 150 ms and leaves faster. It hangs from the top right of the page's content, right under
 * the header: NSH lays out header buttons in the platform's toolbar, so a popup anchored to the button itself lands
 * elsewhere. The header button only toggles `open`. */
export function HeaderMenu(props: { open: () => boolean; onClose: () => void; actions: SheetAction[]; onChoose: (id: string) => void }) {
  let anchor: ViewRef | undefined
  const shown = signal(false)
  const m = createMotion({ initial: { opacity: 0, scale: 0.8 } })
  effect(() => {
    if (props.open()) { shown.set(true); m.play({ duration: 150, keyframes: [{ opacity: 0, scale: 0.8, easing: [0.05, 0.7, 0.1, 1] }, { opacity: 1, scale: 1 }] }) }
    else if (shown()) m.play({ duration: 100, keyframes: [{ opacity: 1, scale: 1, easing: [0.3, 0, 0.8, 0.15] }, { opacity: 0, scale: 0.9 }] }).then(() => { if (!props.open()) shown.set(false) })
  })
  const choose = (id: string) => { haptic('tick'); props.onClose(); props.onChoose(id) }
  return (
    <>
      <View ref={anchor} class="absolute top-0 right-[10px] w-[1px] h-[1px]" style={{ pointerEvents: 'none' }} />
      <If when={shown()}>
        <Overlay anchor={anchor} placement="bottom" align="end" offset={0} margin={8} onPressOutside={props.onClose} onCancel={props.onClose}
          style={{ ...m.style, transformOrigin: 'top right' }} class="min-w-[200px] py-[6px] rounded-[14px] border border-border bg-popover shadow-lg" testID="header-menu">
          {props.actions.map((a) => (
            <View role="menuitem" testID={`menu-${a.id}`} onPress={() => choose(a.id)} class="flex-row items-center gap-3 px-[14px] h-[44px] active:bg-secondary transition-colors duration-150">
              {a.icon ? <Icon name={a.icon} size={18} class={a.destructive ? 'tint-destructive' : 'tint-foreground'} /> : null}
              <Text class={`text-[15px] ${a.destructive ? 'text-destructive' : 'text-foreground'}`}>{a.label}</Text>
            </View>
          ))}
        </Overlay>
      </If>
    </>
  )
}
