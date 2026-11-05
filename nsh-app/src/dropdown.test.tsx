import { expect, open, test } from 'nsh/test'

type Box = { x: number; y: number; w: number; h: number }
const box = (app: { storage(): Record<string, string> }, key: string): Box => JSON.parse(app.storage()[key]!)

// The chevron's frame is its ink (no blank margin inside the image), so these are the spaces a person sees.
test('a dropdown button keeps the same space on both sides, and its chevron sits next to the label, centred on it', async () => {
  const app = await open('./fixtures/dropdown.tsx')
  await app.waitUntil(() => ['button', 'label', 'chevron'].every((k) => app.storage()[k]))
  const button = box(app, 'button'), label = box(app, 'label'), chevron = box(app, 'chevron')
  const left = label.x, right = button.w - (chevron.x + chevron.w)
  expect(Math.abs(left - right) <= 0.5).toBe(true)
  const gap = chevron.x - (label.x + label.w)
  expect(gap >= 4 && gap <= 6).toBe(true)
  expect(Math.abs((chevron.y + chevron.h / 2) - (label.y + label.h / 2)) <= 1).toBe(true)
})

test('the chevron is drawn to the label’s size: about 0.6 of the font size wide, a little over half as tall', async () => {
  const app = await open('./fixtures/dropdown.tsx')
  await app.waitUntil(() => !!app.storage().chevron)
  const chevron = box(app, 'chevron')
  expect(chevron.w).toBe(8) // 13 pt label
  expect(Math.abs(chevron.h - 4.8) <= 1).toBe(true) // the headless layout rounds to whole points
})
