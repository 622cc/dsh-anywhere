// The theme's secondary text (`muted-foreground`, nsh.json) is read on every surface the app draws: WCAG's 4.5:1 for
// body text on each, in both themes. The light theme's #85847E measured 3.2–3.65:1.
import { expect, test } from 'nsh/test'
import app from '../nsh.json'

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }

for (const scheme of ['light', 'dark'] as const) {
  test(`secondary text reads at 4.5:1 or more on every ${scheme} surface`, () => {
    const t = app.theme.cssVars[scheme] as Record<string, string>
    for (const surface of ['background', 'card', 'popover', 'secondary', 'muted']) {
      expect(`${surface} ${contrast(t['muted-foreground']!, t[surface]!) >= 4.5}`).toBe(`${surface} true`)
    }
  })
}
