// A chat row swiped left, with t3code's thresholds (docs/research/mobile-ux-feel.md): its actions show past 42% of
// their width, and a swipe past max(actions + 44, 58% of the row) acts on release.
import { expect, test } from 'nsh/test'
import { dragTo, release, swipeThresholds } from './swipe.ts'

const t = swipeThresholds(390, 116)

test('the row follows the finger leftwards only, never past its own width', () => {
  expect(dragTo(0, -30, 390)).toBe(-30)
  expect(dragTo(0, 40, 390)).toBe(0)
  expect(dragTo(-116, -400, 390)).toBe(-390)
})

test('thresholds: actions show past 42% of their width; a full swipe is past max(actions + 44, 58% of the row)', () => {
  expect(Math.round(t.reveal * 100)).toBe(4872)
  expect(Math.round(t.full * 10)).toBe(2262)
  expect(Math.round(swipeThresholds(320, 116).full * 10)).toBe(1856)
  expect(swipeThresholds(200, 116).full).toBe(160)
})

test('on release: past the full threshold it acts, past the reveal it stays open, else it closes; a fling counts', () => {
  expect(release(-240, 0, t)).toBe('act')
  expect(release(-60, 0, t)).toBe('open')
  expect(release(-30, 0, t)).toBe('closed')
  expect(release(-30, -900, t)).toBe('open') // a quick flick opens it
  expect(release(-90, 900, t)).toBe('closed') // flung back
})
