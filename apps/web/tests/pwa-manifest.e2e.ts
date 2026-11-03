import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { chromium, type Page } from 'playwright'
import {
  APP_ICON_VARIANTS, ICON_OUTPUT_DIRECTORY, MASKABLE_ARTWORK_SCALE, MASKABLE_SAFE_RADIUS_RATIO,
  TILE_SOURCE, renderAppIcons, tileDocument,
} from '../scripts/render-app-icons.ts'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))
const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
const browserOptions = executablePath === undefined ? {} : { executablePath }

async function pixels(page: Page, url: string, size: number) {
  return page.evaluate(async ({ url, size, safeRadius }) => {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0, size, size)
    const { data } = context.getImageData(0, 0, size, size)
    let radius = 0
    let starRadius = 0
    let ink = 0
    let opaqueSafeDisc = true
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const at = (y * size + x) * 4
        const alpha = data[at + 3]!
        const distance = Math.hypot(x - (size - 1) / 2, y - (size - 1) / 2)
        if (distance <= safeRadius && alpha !== 255) opaqueSafeDisc = false
        // Half alpha ignores the rasterizer's near-transparent border fringe,
        // whose RGB carries no artwork.
        if (alpha < 128) continue
        const brightness = (data[at]! + data[at + 1]! + data[at + 2]!) / 3
        if (brightness >= 200) {
          starRadius = Math.max(starRadius, distance)
          continue
        }
        if (brightness >= 128) continue
        ink += 1
        radius = Math.max(radius, distance)
      }
    }
    return {
      width: image.naturalWidth, height: image.naturalHeight, radius, ink, starRadius, opaqueSafeDisc,
      corners: [0, size - 1, (size - 1) * size, size * size - 1].map(index => data[index * 4 + 3]),
    }
  }, { url, size, safeRadius: MASKABLE_SAFE_RADIUS_RATIO * size })
}

function pngUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`
}

function svgUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}


it('decodes every generated and shipped icon with its full artwork and clear corners', async () => {
  const browser = await chromium.launch({ headless: true, ...browserOptions })
  try {
    const page = await browser.newPage()
    const source = await readFile(TILE_SOURCE, 'utf8')
    const generated = await renderAppIcons(source)
    for (const { variant, png } of generated) {
      const reference = await pixels(page, svgUrl(tileDocument(source)), variant.size)
      expect(reference.ink).toBeGreaterThan(0)
      for (const bytes of [png, await readFile(join(DIST_ROOT, variant.file))]) {
        const image = await pixels(page, pngUrl(bytes), variant.size)
        expect([image.width, image.height], variant.file).toEqual([variant.size, variant.size])
        // The tile's rounded corners stay transparent; launchers mask the rest.
        expect(image.corners, variant.file).toEqual([0, 0, 0, 0])
        expect(image.ink, variant.file).toBeGreaterThan(0)
        // Two pixels allow rasterizer and downsampling differences without
        // accepting missing or undersized artwork in the published PNG. The
        // tile gradient is unscaled in every variant, maskable included.
        expect(Math.abs(image.radius - reference.radius), variant.file).toBeLessThan(2)
      }
    }
  } finally { await browser.close() }
})


it('preserves fractional coverage along the Apple icon curves', async () => {
  const browser = await chromium.launch({ headless: true, ...browserOptions })
  try {
    const page = await browser.newPage()
    const png = await readFile(join(ICON_OUTPUT_DIRECTORY, 'apple-touch-icon.png'))
    const partial = await page.evaluate(async (url) => {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 180
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0, 180, 180)
      const { data } = context.getImageData(0, 0, 180, 180)
      const alpha = (x: number, y: number): number => data[(y * 180 + x) * 4 + 3]!
      let partial = 0
      for (let y = 1; y < 179; y += 1) {
        for (let x = 1; x < 179; x += 1) {
          const value = alpha(x, y)
          if (value === 0 || value === 255) continue
          // Neighboring transparent and opaque pixels distinguish the tile's
          // anti-aliased border from interior artwork, which is fully opaque.
          const neighbors: number[] = []
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) neighbors.push(alpha(x + dx, y + dy))
          }
          if (Math.min(...neighbors) === 0 && Math.max(...neighbors) === 255) partial += 1
        }
      }
      return partial
    }, `data:image/png;base64,${png.toString('base64')}`)
    expect(partial).toBeGreaterThan(0)
  } finally { await browser.close() }
})

it('keeps the shipped maskable star inside its opaque platform safe zone', async () => {
  const browser = await chromium.launch({ headless: true, ...browserOptions })
  try {
    const page = await browser.newPage()
    const maskable = await readFile(join(DIST_ROOT, 'icon-maskable-512.png'))
    const tile = tileDocument(await readFile(TILE_SOURCE, 'utf8'))
    const size = APP_ICON_VARIANTS.find(variant => variant.kind === 'maskable')!.size
    const safeRadius = MASKABLE_SAFE_RADIUS_RATIO * size
    const scaled = await pixels(page, pngUrl(maskable), size)
    const unscaled = await pixels(page, svgUrl(tile), size)
    expect(scaled.opaqueSafeDisc).toBe(true)
    expect(scaled.starRadius).toBeLessThanOrEqual(safeRadius)
    expect(scaled.starRadius).toBeGreaterThan(unscaled.starRadius * MASKABLE_ARTWORK_SCALE - 2)
    // The unscaled tips exceed the guaranteed circle, so the maskable scale is
    // doing real work; two pixels absorb rasterizer differences at the tip.
    expect(unscaled.starRadius).toBeGreaterThan(safeRadius - 2)
  } finally {
    await browser.close()
  }
})
