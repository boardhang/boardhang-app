// Generates the default Open Graph image from the brand mark.
//
// Composes brand/resin-jug-b-open.svg and a "Boardhang" wordmark onto the brand
// dark tile background (#0E1116) at the OG standard 1200×630 and commits the PNG.
//
// Dev-only, run manually after the brand mark changes (sharp is a committed
// devDependency, so a plain `npm install` already provides it):
//   cd site && node scripts/generate-og.mjs
//
// Output (committed): public/og.png

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const dir = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.resolve(dir, '../public')
const markSvg = readFileSync(path.resolve(dir, '../../brand/resin-jug-b-open.svg'))
const markUri = `data:image/svg+xml;base64,${markSvg.toString('base64')}`

const WIDTH = 1200
const HEIGHT = 630
const MARK = 300

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0E1116"/>
  <image x="170" y="${(HEIGHT - MARK) / 2}" width="${MARK}" height="${MARK}" href="${markUri}"/>
  <text x="520" y="${HEIGHT / 2}" dominant-baseline="central"
    font-family="system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    font-size="110" font-weight="700" fill="#E6E9EE">Boardhang</text>
</svg>`

await sharp(Buffer.from(svg), { density: 72 }).png().toFile(path.join(publicDir, 'og.png'))

console.log(`wrote public/og.png (${WIDTH}×${HEIGHT})`)
