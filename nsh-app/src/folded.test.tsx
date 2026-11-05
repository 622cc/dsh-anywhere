import { expect, open, test } from 'nsh/test'

type Box = { x: number; y: number; w: number; h: number }
const box = (app: { storage(): Record<string, string> }, key: string): Box => JSON.parse(app.storage()[key]!)

// Seen in the launch video (2026-10-31): "1 completed ⌄" had its chevron at the far right edge of the panel, away
// from the words it opens. It follows the label as the dropdown button's does (src/dropdown.test.tsx).
test('the folded row’s chevron sits 5 pt after its label, centred on it, not at the row’s edge', async () => {
  const app = await open('./fixtures/folded.tsx')
  await app.waitUntil(() => ['row', 'label', 'chevron'].every((k) => app.storage()[k]))
  const row = box(app, 'row'), label = box(app, 'label'), chevron = box(app, 'chevron')
  const gap = chevron.x - (label.x + label.w)
  expect(gap >= 4 && gap <= 6).toBe(true)
  expect(Math.abs((chevron.y + chevron.h / 2) - (label.y + label.h / 2)) <= 1).toBe(true)
  expect(row.w - (chevron.x + chevron.w) > 100).toBe(true)
})
