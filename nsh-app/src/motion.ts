// The app's motion, from Material 3's tokens (docs/research/mobile-ux-feel.md): entrances decelerate in 180–220 ms,
// exits are shorter, and only what just arrived moves (t3code animates rows created in the last 3 s, so rows a list
// recycles never play again). Motions land at once when the system asks for less motion.
import type { MotionSpec } from 'nsh'

export const DECELERATE: [number, number, number, number] = [0.05, 0.7, 0.1, 1] // M3 emphasized decelerate: entering
export const STANDARD = 'cubic-bezier(0.2, 0, 0, 1)' // M3 standard: changes on the screen
export const FRESH_MS = 3000

/** A sent message rises into place. */
export const rise: MotionSpec = { duration: 220, keyframes: [{ opacity: 0, translateY: 10, easing: DECELERATE }, { opacity: 1, translateY: 0 }] }
/** A new answer fades in. */
export const appear: MotionSpec = { duration: 220, keyframes: [{ opacity: 0, easing: DECELERATE }, { opacity: 1 }] }
/** What runs breathes: a neutral dot fading in and out says so without a colour that reads as an alert. */
export const glow: MotionSpec = { duration: 2000, iterations: 'infinite', keyframes: [{ opacity: 1, easing: 'easeInOut' }, { opacity: 0.25, easing: 'easeInOut' }, { opacity: 1 }] }
