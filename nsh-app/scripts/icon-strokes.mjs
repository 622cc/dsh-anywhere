#!/usr/bin/env node
// The icons in assets/icons are drawn on a 24-unit grid with a 1.75-unit stroke, so a 14 pt icon drew a 1 pt line and a
// 20 pt one a 1.46 pt line. This writes each icon once per size the app draws it at (assets/icons/<size>/), its stroke
// set so every icon draws a 1.5 pt line, and src/icons.gen.ts, which imports them for `Icon` (src/ui.tsx).
//   node scripts/icon-strokes.mjs           write them
//   node scripts/icon-strokes.mjs --check   exit 1 if what is checked in differs from what this writes
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SIZES = [14, 15, 16, 18, 20, 32]
export const LINE = 1.5
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = path.join(app, 'assets', 'icons')
// The disclosure chevrons have their own grid and stroke (`Chevron`, src/ui.tsx).
const names = readdirSync(base).filter((f) => f.endsWith('.svg') && !f.startsWith('disclosure-')).map((f) => f.slice(0, -4)).sort()
const camel = (name) => name.replace(/-(\w)/g, (_, c) => c.toUpperCase())

const files = new Map()
for (const size of SIZES) for (const name of names) {
  const svg = readFileSync(path.join(base, `${name}.svg`), 'utf8')
  if (!/ stroke-width="1\.75"/.test(svg) || !/viewBox="0 0 24 24"/.test(svg)) throw new Error(`${name}.svg: expected a 24-unit grid and a 1.75 stroke`)
  const stroke = Math.round((LINE * 24 / size) * 1000) / 1000
  files.set(path.join(base, String(size), `${name}.svg`), svg.replace(/ stroke-width="1\.75"/, ` stroke-width="${stroke}"`).replace(/ width="24" height="24"/, ` width="${size}" height="${size}"`))
}
const imports = SIZES.flatMap((size) => names.map((n) => `import ${camel(n)}${size} from '../assets/icons/${size}/${n}.svg'`))
const map = SIZES.map((size) => `  ${size}: { ${names.map((n) => `${camel(n)}: ${camel(n)}${size}`).join(', ')} },`)
files.set(path.join(app, 'src', 'icons.gen.ts'), `// Written by scripts/icon-strokes.mjs: each icon at each size the app draws it at, all with a ${LINE} pt line.\n${imports.join('\n')}\n\nexport const SIZES = [${SIZES.join(', ')}] as const\nexport const bySize = {\n${map.join('\n')}\n}\n`)

const check = process.argv.includes('--check')
let stale = 0
for (const [file, text] of files) {
  if (check) { if (!existsSync(file) || readFileSync(file, 'utf8') !== text) { console.error(`stale: ${path.relative(app, file)}`); stale++ } continue }
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text)
}
if (check && stale) { console.error('Run node scripts/icon-strokes.mjs'); process.exit(1) }
console.log(`${check ? 'checked' : 'wrote'} ${files.size} files`)
