/**
 * Draws the flashgent app icon: a rounded orange square with a lowercase "f",
 * matching the brand colour used in the interface (--color-brand, #d97757).
 *
 * The glyph is built from primitives rather than a font so the result is
 * identical on every machine and needs no toolchain beyond node.
 *
 *   node scripts/make-icon.mjs
 *
 * Writes resources/icon.png at 1024x1024; electron-builder derives the Windows
 * .ico and the Linux sizes from it.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 1024
const SUB = 4 // supersamples per axis; 16 per pixel is plenty for these edges

// --- Geometry, in a 0..1 square with y pointing down ------------------------

const CORNER = 0.225 // rounded-square radius

const STROKE = 0.105 // stem and hook thickness
const STEM_X = 0.462 // centre line of the stem
const HOOK_R = 0.132 // radius of the arc at the top
const HOOK_CY = 0.338 // where the arc's centre sits
const STEM_BOTTOM = 0.796
const BAR_Y = 0.523
const BAR_T = 0.098
const BAR_LEFT = 0.276
const BAR_RIGHT = 0.650
const HOOK_END = (80 * Math.PI) / 180 // the arc stops just short of vertical

const hookCx = STEM_X + HOOK_R

/** Signed distance to a capsule: the segment a-b grown by `r`. */
function capsule(x, y, ax, ay, bx, by, r) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2))
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) - r
}

/** Signed distance to a rounded square centred on the canvas. */
function roundedSquare(x, y) {
  const qx = Math.abs(x - 0.5) - (0.5 - CORNER)
  const qy = Math.abs(y - 0.5) - (0.5 - CORNER)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - CORNER
}

/** Signed distance to the "f". */
function glyph(x, y) {
  // Stem, from the arc's centre down to the baseline.
  let d = capsule(x, y, STEM_X, HOOK_CY, STEM_X, STEM_BOTTOM, STROKE / 2)

  // Crossbar.
  d = Math.min(d, capsule(x, y, BAR_LEFT, BAR_Y, BAR_RIGHT, BAR_Y, BAR_T / 2))

  // The hook: an arc swept from the top of the stem (180°) round to the
  // terminal, so the stem rises and turns right. Points below the arc's centre
  // give a negative angle and fall outside the range.
  const angle = Math.atan2(HOOK_CY - y, x - hookCx) // 0 at 3 o'clock, up is +
  if (angle >= HOOK_END && angle <= Math.PI) {
    d = Math.min(d, Math.abs(Math.hypot(x - hookCx, y - HOOK_CY) - HOOK_R) - STROKE / 2)
  }
  const capX = hookCx + HOOK_R * Math.cos(HOOK_END)
  const capY = HOOK_CY - HOOK_R * Math.sin(HOOK_END)
  d = Math.min(d, capsule(x, y, capX, capY, capX, capY, STROKE / 2))

  return d
}

// --- Colour -----------------------------------------------------------------

const TOP = [0xe4, 0x8a, 0x68]
const BOTTOM = [0xcf, 0x66, 0x46]
const INK = [0xff, 0xf7, 0xf3]

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ]
}

// --- Raster -----------------------------------------------------------------

const pixels = Buffer.alloc(SIZE * SIZE * 4)

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let inSquare = 0
    let inGlyph = 0

    for (let sy = 0; sy < SUB; sy++) {
      for (let sx = 0; sx < SUB; sx++) {
        const x = (px + (sx + 0.5) / SUB) / SIZE
        const y = (py + (sy + 0.5) / SUB) / SIZE
        if (roundedSquare(x, y) <= 0) inSquare++
        if (glyph(x, y) <= 0) inGlyph++
      }
    }

    const samples = SUB * SUB
    const alpha = inSquare / samples
    const ink = Math.min(1, inGlyph / samples / Math.max(alpha, 1e-6))

    const base = mix(TOP, BOTTOM, py / (SIZE - 1))
    const rgb = mix(base, INK, ink)

    const at = (py * SIZE + px) * 4
    pixels[at] = rgb[0]
    pixels[at + 1] = rgb[1]
    pixels[at + 2] = rgb[2]
    pixels[at + 3] = Math.round(alpha * 255)
  }
}

// --- PNG --------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
// 10..12 stay zero: deflate, adaptive filtering, no interlace.

// One filter byte per scanline; filter 0 (none) compresses fine for flat art.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icon.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`wrote ${out} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} kB)`)
