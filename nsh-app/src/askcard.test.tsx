import { expect, open, test } from 'nsh/test'
import { CARD, CONTROL_RADIUS } from './asks.tsx'

type Box = { x: number; y: number; w: number; h: number }
const box = (app: { storage(): Record<string, string> }, key: string): Box => JSON.parse(app.storage()[key]!)

// The card's 14 pt corners held 10 pt buttons 14 pt in from the side and
// 12 pt from the bottom, so the two curves did not follow each other.
test('a button in the approval card’s corner is as far from both edges, and its corner follows the card’s', async () => {
  const app = await open('./fixtures/askcard.tsx')
  await app.waitUntil(() => ['card', 'row', 'button'].every((k) => app.storage()[k]))
  const card = box(app, 'card'), row = box(app, 'row'), button = box(app, 'button')
  const left = row.x + button.x, bottom = card.h - (row.y + button.y + button.h)
  expect(left).toBe(bottom)
  expect(CONTROL_RADIUS).toBe(CARD.radius - left)
})
