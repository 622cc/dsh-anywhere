// Icons draw the same 1.5 pt line at every size (scripts/icon-strokes.mjs writes one file per size; its `--check`
// keeps them current). Before, one 24-unit file with a 1.75 stroke drew 1 pt at 14 pt and 1.46 pt at 20 pt.
import { expect, test } from 'nsh/test'
import { SIZES } from './icons.gen.ts'
import { iconAsset, icons, type IconName } from './ui.tsx'

test('every icon at every size the app draws comes from that size’s file', () => {
  for (const size of SIZES) for (const name of Object.keys(icons) as IconName[]) {
    const url = (iconAsset(name, size) as { url: string }).url
    expect(url.includes(`/icons/${size}/`)).toBe(true)
  }
})
