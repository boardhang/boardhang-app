// The one rasterizer: satori lays the card element out to SVG and native resvg turns
// it into a PNG. Kept in its own module so the image handler can be unit-tested with
// a stub and only the integration test (renderCard.test.ts) pays for the real render.
//
// Why not @vercel/og: its Node build (1.0.2) evaluates an emscripten `require("fs")`
// shim at import time, which throws under native Node ESM — and Vercel's function
// builder does not bundle, so the deployed function would fail the same way. satori +
// @resvg/resvg-js run unmodified in Node and skip the WASM cold start.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { ReactElement } from 'react'
import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'
import { CARD_HEIGHT, CARD_WIDTH } from './boardCard.js'

export interface RenderOptions {
  width?: number
  height?: number
  headers: Record<string, string>
}

export type CardRenderer = (element: ReactElement, opts: RenderOptions) => Promise<Response>

// Literal `new URL(..., import.meta.url)` so nft ships the font with the function.
const FONT_URL = new URL('../_assets/Geist-Regular.ttf', import.meta.url)
let fontData: Promise<Buffer> | undefined

function loadFont(): Promise<Buffer> {
  fontData ??= readFile(fileURLToPath(FONT_URL))
  return fontData
}

export const renderCard: CardRenderer = async (element, opts) => {
  const width = opts.width ?? CARD_WIDTH
  const height = opts.height ?? CARD_HEIGHT
  const svg = await satori(element, {
    width,
    height,
    fonts: [{ name: 'Geist', data: await loadFont(), weight: 400, style: 'normal' }],
  })
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng()
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: { 'content-type': 'image/png', ...opts.headers },
  })
}
