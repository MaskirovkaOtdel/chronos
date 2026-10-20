import { describe, expect, it } from 'vitest'
import { FOCUS_25, LONG_BREAK, PRESETS, SHORT_BREAK, findPreset } from './presets.js'

/**
 * The catalogue is a tripwire, not a demonstration: these assertions exist so
 * that a preset added carelessly — a zero duration, a cadence of zero, an id
 * that disagrees with its own key — fails here rather than in the middle of
 * somebody's focus session.
 */
describe('PRESETS', () => {
  it('keys every preset by its own id, and gives each id to one preset only', () => {
    const presets = Object.values(PRESETS)
    const ids = presets.map((preset) => preset.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const preset of presets) {
      expect(PRESETS[preset.id]).toBe(preset)
    }
  })

  it('gives every preset a positive, finite duration', () => {
    for (const preset of Object.values(PRESETS)) {
      expect(Number.isFinite(preset.durationMs)).toBe(true)
      expect(preset.durationMs).toBeGreaterThan(0)
    }
  })

  it('gives every focus preset a cadence of at least one whole session', () => {
    for (const preset of Object.values(PRESETS)) {
      if (preset.kind !== 'focus') continue
      expect(Number.isInteger(preset.longBreakAfter)).toBe(true)
      expect(preset.longBreakAfter).toBeGreaterThanOrEqual(1)
    }
  })

  it('offers both kinds of break, and breaks carry no cadence', () => {
    expect(SHORT_BREAK.kind).toBe('short_break')
    expect(LONG_BREAK.kind).toBe('long_break')
    expect('longBreakAfter' in SHORT_BREAK).toBe(false)
    expect('longBreakAfter' in LONG_BREAK).toBe(false)
  })

  it('finds a preset by id, and returns null for one that does not exist', () => {
    expect(findPreset(FOCUS_25.id)).toBe(FOCUS_25)
    expect(findPreset('focus-50')).toBeNull()
  })
})
