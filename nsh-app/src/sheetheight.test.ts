// How tall a sheet may grow (src/ui.tsx sheetMaxHeight). The keyboard's height is padding inside the sheet, so a fixed
// cap left little for the content while typing.
// Seen on the iOS simulator (2026-10-31, iPhone 17 Pro Max, 956 pt tall, keyboard 346 pt): searching in Add workspace,
// the folder list was 12 pt tall and the matches could not be seen.
import { expect, test } from 'nsh/test'
import { sheetMaxHeight } from './ui.tsx'

test('without the keyboard a sheet stops at its own cap', () => {
  expect(sheetMaxHeight(600, { window: 956, top: 62, bottom: 42 })).toBe(600 + 42)
})

test('while typing, the content keeps its cap above the keyboard, as far as the screen allows', () => {
  const window = 956, top = 62, bottom = 346 + 8
  const total = sheetMaxHeight(600, { window, top, bottom })
  expect(total).toBeLessThanOrEqual(window - top)
  expect(total - bottom).toBeGreaterThanOrEqual(400)
})

test('on a short screen the sheet stays below the status bar', () => {
  expect(sheetMaxHeight(600, { window: 640, top: 24, bottom: 300 })).toBe(640 - 24 - 8)
})
