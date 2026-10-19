#!/usr/bin/env node
/**
 * Derive each palette's DARK block from its LIGHT block (§8).
 *
 * Rule: hold hue and chroma, shift lightness to a per-role target. One target
 * table serves all four palettes, so dark mode is arithmetic — not eight
 * hand-tuned files.
 *
 * Run: pnpm themes:derive
 *
 * The result is committed. `contrast.test.ts` gates the output, so a bad
 * derivation fails CI rather than shipping.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CSS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../apps/web/src/theme/themes.css',
)

/**
 * The default palette. Its dark block is also bound to `:root[data-mode='dark']`
 * so dark mode works before anything sets `data-palette`.
 */
const DEFAULT_PALETTE = 'warm'

/**
 * Target OKLCH lightness per token for dark mode. Hue and chroma come from the
 * light block unchanged.
 *
 * Calibrated against Warm Charcoal — the hand-tuned dark that already shipped
 * and was reviewed on day 5 — so derivation reproduces an accepted result
 * rather than inventing a darker one.
 */
const DARK_TARGET_L = {
  background: 0.2,
  surface: 0.23,
  'surface-alt': 0.27,
  foreground: 0.95,
  muted: 0.72,
  focus: 0.73,
  'short-break': 0.73,
  'long-break': 0.76,
  success: 0.74,
}

// --- colour maths -----------------------------------------------------------

/** sRGB channel (0-255) -> linear light. */
function toLinear(c) {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function fromLinear(c) {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, s)) * 255)
}

function hexToOklch(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = toLinear((n >> 16) & 255)
  const g = toLinear((n >> 8) & 255)
  const b = toLinear(n & 255)

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  return { L, C: Math.hypot(A, B), H: Math.atan2(B, A) }
}

/** OKLCH -> unclamped linear-ish sRGB floats. */
function oklchToRgb(L, C, H) {
  const A = C * Math.cos(H)
  const B = C * Math.sin(H)

  const l_ = L + 0.3963377774 * A + 0.2158037573 * B
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B
  const s_ = L - 0.0894841775 * A - 1.291485548 * B

  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function rgbToHex(rgb) {
  return `#${rgb.map((c) => fromLinear(c).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Shift lightness, holding hue and chroma.
 *
 * A saturated light hue pushed to a dark lightness can leave the sRGB gamut.
 * Clipping it would quietly shift the hue, so chroma is backed off instead —
 * the darks stay recognisably the same colour family.
 */
function shiftLightness(hex, targetL) {
  const { C, H } = hexToOklch(hex)

  for (let scale = 1; scale >= 0; scale -= 0.05) {
    const rgb = oklchToRgb(targetL, C * scale, H)
    if (rgb.every((c) => c >= 0 && c <= 1)) return rgbToHex(rgb)
  }
  return rgbToHex(oklchToRgb(targetL, 0, H))
}

// --- css parsing ------------------------------------------------------------

const TOKEN_RE = /--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g
const LIGHT_RE = /\[data-palette='(\w+)'\]\[data-mode='light'\]\s*\{([^}]*)\}/g

function parseTokens(body) {
  const out = {}
  for (const m of body.matchAll(TOKEN_RE)) out[m[1]] = m[2]
  return out
}

// --- main -------------------------------------------------------------------

const css = readFileSync(CSS_PATH, 'utf8')

/**
 * Drop every existing dark block first, so re-running is idempotent. The
 * optional `:root[data-mode='dark']` prefix belongs to the default palette and
 * is regenerated, so it has to go with the block.
 */
const DARK_BLOCK_RE =
  /(?::root\[data-mode='\w+'\],\s*)?\[data-palette='\w+'\]\[data-mode='dark'\]\s*\{[^}]*\}\n*/g

let out = css.replace(DARK_BLOCK_RE, '')

for (const [, palette, body] of out.matchAll(LIGHT_RE)) {
  const tokens = parseTokens(body)
  const missing = Object.keys(DARK_TARGET_L).filter((k) => !(k in tokens))
  if (missing.length) {
    throw new Error(`palette '${palette}' is missing tokens: ${missing.join(', ')}`)
  }

  const derived = Object.entries(DARK_TARGET_L).map(
    ([token, l]) => `  --${token}: ${shiftLightness(tokens[token], l)};`,
  )

  const selector =
    palette === DEFAULT_PALETTE
      ? `:root[data-mode='dark'],\n[data-palette='${palette}'][data-mode='dark']`
      : `[data-palette='${palette}'][data-mode='dark']`

  const block = `\n${selector} {\n  /* derived from '${palette}' light via OKLCH — h/c held, l shifted */\n${derived.join('\n')}\n}\n`

  // insert immediately after this palette's light block
  const lightMatch = `[data-palette='${palette}'][data-mode='light']`
  const at = out.indexOf(lightMatch)
  const close = out.indexOf('}\n', at) + 2
  out = out.slice(0, close) + block + out.slice(close)
}

// Prettier strips a trailing blank line; emitting one here would put `format`
// and `themes:derive` in an infinite loop with each other.
out = out.replace(/\n+$/, '\n')

writeFileSync(CSS_PATH, out, 'utf8')
console.log(`derived dark blocks -> ${CSS_PATH}`)
