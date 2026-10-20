import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { nextSegmentAfterCompletion } from './cycle.js'
import { FOCUS_25 } from './presets.js'

describe('nextSegmentAfterCompletion', () => {
  it('gives a short break after an ordinary focus', () => {
    const next = nextSegmentAfterCompletion('focus', 1, FOCUS_25)

    expect(next.kind).toBe('short_break')
    expect(next.presetId).toBe('short-break-5')
    expect(next.durationMs).toBe(5 * 60 * 1000)
  })

  it('gives the long break on the focus that completes the cadence', () => {
    // The count is *after* the increment: this is "we just finished focus #4
    // of 4", and 4 is the multiple.
    const next = nextSegmentAfterCompletion('focus', 4, FOCUS_25)

    expect(next.kind).toBe('long_break')
    expect(next.presetId).toBe('long-break-15')
    expect(next.durationMs).toBe(15 * 60 * 1000)
  })

  it('gives a focus after a break', () => {
    const next = nextSegmentAfterCompletion('short_break', 3, FOCUS_25)

    expect(next.kind).toBe('focus')
    expect(next.presetId).toBe('focus-25')
    expect(next.durationMs).toBe(25 * 60 * 1000)
  })

  it('follows the cadence exactly over twelve focuses', () => {
    const kinds = Array.from(
      { length: 12 },
      (_, i) => nextSegmentAfterCompletion('focus', i + 1, FOCUS_25).kind,
    )

    expect(kinds).toEqual([
      'short_break',
      'short_break',
      'short_break',
      'long_break',
      'short_break',
      'short_break',
      'short_break',
      'long_break',
      'short_break',
      'short_break',
      'short_break',
      'long_break',
    ])
  })

  it('gives exactly one long break in any run of consecutive focus completions', () => {
    // The rhythm a user feels: however the run starts, every window of one
    // cadence contains one long break — never two, never none.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), (start) => {
        const window = FOCUS_25.longBreakAfter
        const kinds = Array.from(
          { length: window },
          (_, i) => nextSegmentAfterCompletion('focus', start + i, FOCUS_25).kind,
        )

        expect(kinds.filter((kind) => kind === 'long_break')).toHaveLength(1)
      }),
    )
  })

  it('spaces the long breaks exactly one cadence apart', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), (start) => {
        let previous: number | null = null

        for (let i = 0; i < 40; i += 1) {
          const count = start + i
          if (nextSegmentAfterCompletion('focus', count, FOCUS_25).kind !== 'long_break') {
            continue
          }
          if (previous !== null) {
            expect(count - previous).toBe(FOCUS_25.longBreakAfter)
          }
          previous = count
        }
      }),
    )
  })
})
