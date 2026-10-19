import { describe, expect, it } from 'vitest'
import css from './themes.css?raw'

/**
 * WCAG contrast gate for every theme (§8).
 *
 * The plan's alternative was ~120 hand comparisons across eight themes. This
 * turns them into a permanent CI gate instead: it parses the stylesheet that
 * actually ships, so a token that regresses can never make it into a release
 * unmeasured.
 *
 * Thresholds are the plan's, not WCAG's generic ones:
 *   4.5:1  body text  (WCAG AA, 1.4.3)
 *   3.0:1  non-text   (WCAG AA, 1.4.11) — the timer arc is meaningful graphics,
 *          so its colour must clear this against whatever it sits on.
 */

const SURFACES = ['background', 'surface', 'surface-alt'] as const
const TEXT_TOKENS = ['foreground', 'muted'] as const
/** Role colours drawn as graphics: the arc, the ticks, the status dot. */
const GRAPHIC_TOKENS = ['focus', 'short-break', 'long-break', 'success'] as const
const ALL_TOKENS = [...SURFACES, ...TEXT_TOKENS, ...GRAPHIC_TOKENS] as const

const BODY_TEXT_MIN = 4.5
const NON_TEXT_MIN = 3.0

const BLOCK_RE = /\[data-palette='(\w+)'\]\[data-mode='(\w+)'\]\s*\{([^}]*)\}/g
const TOKEN_RE = /--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g

type Theme = { id: string; palette: string; mode: string; tokens: Record<string, string> }

function parseThemes(source: string): Theme[] {
  const out: Theme[] = []
  for (const block of source.matchAll(BLOCK_RE)) {
    const palette = block[1]
    const mode = block[2]
    const body = block[3]
    if (palette === undefined || mode === undefined || body === undefined) continue

    const tokens: Record<string, string> = {}
    for (const token of body.matchAll(TOKEN_RE)) {
      const name = token[1]
      const hex = token[2]
      if (name !== undefined && hex !== undefined) tokens[name] = hex
    }
    out.push({ id: `${palette}/${mode}`, palette, mode, tokens })
  }
  return out
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const r = toLinear((n >> 16) & 255)
  const g = toLinear((n >> 8) & 255)
  const b = toLinear(n & 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function toLinear(channel: number): number {
  const s = channel / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const themes = parseThemes(css)

function failingPairs(min: number, fgTokens: readonly string[]): string[] {
  const failures: string[] = []
  for (const theme of themes) {
    for (const fg of fgTokens) {
      for (const bg of SURFACES) {
        const fgHex = theme.tokens[fg]
        const bgHex = theme.tokens[bg]
        if (fgHex === undefined || bgHex === undefined) continue

        const ratio = contrastRatio(fgHex, bgHex)
        if (ratio < min) {
          failures.push(
            `${theme.id}: ${fg} ${fgHex} on ${bg} ${bgHex} = ${ratio.toFixed(2)}:1 (needs ${min})`,
          )
        }
      }
    }
  }
  return failures
}

describe('theme contrast gate', () => {
  it('defines 8 themes — 4 palettes × 2 modes', () => {
    const ids = themes.map((t) => t.id).sort()
    expect(ids).toEqual([
      'dusk/dark',
      'dusk/light',
      'meadow/dark',
      'meadow/light',
      'sunrise/dark',
      'sunrise/light',
      'warm/dark',
      'warm/light',
    ])
  })

  it('every theme defines every token', () => {
    const incomplete = themes
      .map(
        (t) =>
          `${t.id} is missing ${ALL_TOKENS.filter((token) => !(token in t.tokens)).join(', ')}`,
      )
      .filter((message) => !message.endsWith('is missing '))
    expect(incomplete).toEqual([])
  })

  it('dark blocks are derived, never hand-written', () => {
    const darkBlocks = [
      ...css.matchAll(/\[data-palette='\w+'\]\[data-mode='dark'\]\s*\{[^}]*\}/g),
    ].map((m) => m[0] ?? '')
    expect(darkBlocks).toHaveLength(4)
    // A hand-edited dark block loses the marker the derive script stamps in.
    expect(darkBlocks.filter((block) => !block.includes('derived from'))).toEqual([])
  })

  it.each([
    ['body text (foreground, muted) meets 4.5:1', BODY_TEXT_MIN, TEXT_TOKENS],
    ['graphics (focus, breaks, success) meet 3:1', NON_TEXT_MIN, GRAPHIC_TOKENS],
  ])('%s', (_name, min, tokens) => {
    const failures = failingPairs(min, tokens)
    expect(failures, failures.join('\n')).toEqual([])
  })
})
