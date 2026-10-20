import { describe, expect, it } from 'vitest'
import { dayFraction, dayKey, dayLengthMs, hourOfDay } from './dayKeys.js'

/**
 * Local-day bucketing.
 *
 * The rules being defended: a day is the user's day ✓, not UTC's ✓; the key
 * is comparable ✓, whatever the user's locale ✓; and a day is 23 or 25 hours
 * long twice a year ✓, which anything that positions things by time of day
 * has to know ✓.
 */
describe('day keys', () => {
  it('gives the UTC day for an instant', () => {
    expect(dayKey(Date.parse('2026-10-20T12:00:00Z'), 'UTC')).toBe('2026-10-20')
  })

  it('gives the local day, not the UTC one, when the zone differs', () => {
    // 23:30 UTC is already the next day in Tokyo.
    const instant = Date.parse('2026-10-20T23:30:00Z')

    expect(dayKey(instant, 'UTC')).toBe('2026-10-20')
    expect(dayKey(instant, 'Asia/Tokyo')).toBe('2026-10-21')
  })

  it('gives the hour of the local day', () => {
    const instant = Date.parse('2026-10-20T12:00:00Z')

    expect(hourOfDay(instant, 'UTC')).toBe(12)
    expect(hourOfDay(instant, 'Asia/Tokyo')).toBe(21)
  })

  it('places an instant in its day, as a fraction', () => {
    const instant = Date.parse('2026-10-20T12:00:00Z')

    expect(dayFraction(instant, 'UTC')).toBeCloseTo(0.5, 10)
    expect(dayFraction(instant, 'Asia/Tokyo')).toBeCloseTo(21 / 24, 10)
  })

  it('measures an ordinary day as 24 hours', () => {
    const instant = Date.parse('2026-10-20T12:00:00Z')

    expect(dayLengthMs(instant, 'UTC')).toBe(24 * 60 * 60 * 1000)
    expect(dayLengthMs(instant, 'Europe/Athens')).toBe(24 * 60 * 60 * 1000)
  })

  it('measures the day a zone springs forward as 23 hours', () => {
    // Athens springs forward on 2026-03-29: the clock goes 03:00 → 04:00 and
    // the day loses an hour.
    const instant = Date.parse('2026-03-29T12:00:00Z')

    expect(dayLengthMs(instant, 'Europe/Athens')).toBe(23 * 60 * 60 * 1000)
    // The same day elsewhere is still 24 hours.
    expect(dayLengthMs(instant, 'UTC')).toBe(24 * 60 * 60 * 1000)
  })

  it('measures the day a zone falls back as 25 hours', () => {
    // Athens falls back on 2026-10-25: the clock goes 04:00 → 03:00 and the
    // day gains an hour.
    const instant = Date.parse('2026-10-25T12:00:00Z')

    expect(dayLengthMs(instant, 'Europe/Athens')).toBe(25 * 60 * 60 * 1000)
  })

  it('places a session on a short day by the day it really is', () => {
    // 2026-03-29 02:00 in Athens is 00:00 UTC — the day has already begun.
    const instant = Date.parse('2026-03-29T00:00:00Z')

    expect(dayKey(instant, 'Europe/Athens')).toBe('2026-03-29')
    expect(dayKey(instant, 'UTC')).toBe('2026-03-29')
    expect(hourOfDay(instant, 'Europe/Athens')).toBe(2)
  })
})
