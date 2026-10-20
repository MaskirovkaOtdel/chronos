import { describe, expect, it } from 'vitest'
import type { FocusSession } from '../session.js'
import { makeFocusSession } from '../testing/fixtures.js'
import { dayKey, dayLengthMs, hourOfDay } from './dayKeys.js'
import { streaks } from './streaks.js'

/**
 * The zone torture test.
 *
 * The plan's list: *"UTC+13/+14, +05:30/+05:45, DST transitions, streak spanning DST, home
 * zone changed mid-streak."* Five cases, each attacking a different assumption the day
 * arithmetic could be making.
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** An instant expressed as a local time in a fixed-offset zone. */
function localInstant(day: number, hour: number, offsetHours: number): number {
  return Date.parse('2026-10-20T00:00:00Z') + (day - 20) * DAY + (hour - offsetHours) * HOUR
}

function focus(overrides: Partial<FocusSession> = {}): FocusSession {
  return makeFocusSession({
    id: 's1',
    kind: 'focus',
    startedAt: Date.parse('2026-10-20T09:00:00Z'),
    actualMs: 25 * MINUTE,
    completed: true,
    ...overrides,
  })
}

describe('the largest offsets', () => {
  it('buckets a day correctly at UTC+13', () => {
    // 2026-10-20 09:00 in Auckland (UTC+13) is 20:00 UTC on the 19th.
    const instant = localInstant(20, 9, 13)

    expect(dayKey(instant, 'Pacific/Auckland')).toBe('2026-10-20')
    expect(hourOfDay(instant, 'Pacific/Auckland')).toBe(9)
    expect(dayKey(instant, 'UTC')).toBe('2026-10-19')
  })

  it('buckets a day correctly at UTC+14', () => {
    // Kiritimati is the easternmost inhabited zone.
    const instant = localInstant(20, 9, 14)

    expect(dayKey(instant, 'Pacific/Kiritimati')).toBe('2026-10-20')
    expect(hourOfDay(instant, 'Pacific/Kiritimati')).toBe(9)
  })

  it('measures a day correctly at UTC+13', () => {
    expect(dayLengthMs(localInstant(20, 9, 13), 'Pacific/Auckland')).toBe(24 * HOUR)
  })
})

describe('the awkward offsets', () => {
  it('buckets a day correctly at +05:30', () => {
    // 09:00 in Kolkata is 03:30 UTC — and the half hour is in the zone, not
    // the instant.
    const instant = localInstant(20, 9, 5.5)

    expect(dayKey(instant, 'Asia/Kolkata')).toBe('2026-10-20')
    expect(hourOfDay(instant, 'Asia/Kolkata')).toBe(9)
  })

  it('buckets a day correctly at +05:45', () => {
    // Kathmandu's quarter-hour is the most awkward offset in use.
    const instant = localInstant(20, 9, 5.75)

    expect(dayKey(instant, 'Asia/Kathmandu')).toBe('2026-10-20')
    expect(hourOfDay(instant, 'Asia/Kathmandu')).toBe(9)
  })

  it('does not round a half-hour offset to the hour', () => {
    // 03:15 UTC is 08:45 in Kolkata and 09:00 in Kathmandu.
    const instant = Date.parse('2026-10-20T03:15:00Z')

    expect(hourOfDay(instant, 'Asia/Kolkata')).toBe(8)
    expect(hourOfDay(instant, 'Asia/Kathmandu')).toBe(9)
  })
})

describe('DST transitions', () => {
  // Athens springs forward on 2026-03-29 and falls back on 2026-10-25.
  const SPRING = Date.parse('2026-03-29T01:00:00Z')
  const AUTUMN = Date.parse('2026-10-25T01:00:00Z')

  it('handles the instant a zone springs forward', () => {
    // 01:00 UTC is 03:00 local, and the next moment is 04:00 local — the
    // hour from 03:00 to 03:59 simply does not happen.
    expect(hourOfDay(SPRING - 1, 'Europe/Athens')).toBe(2)
    expect(hourOfDay(SPRING, 'Europe/Athens')).toBe(4)
  })

  it('handles the instant a zone falls back', () => {
    // 01:00 UTC is 04:00 local, and the next moment is 03:00 local again —
    // the hour from 03:00 to 03:59 happens twice.
    expect(hourOfDay(AUTUMN - 1, 'Europe/Athens')).toBe(3)
    expect(hourOfDay(AUTUMN, 'Europe/Athens')).toBe(3)
  })

  it('measures the short day and the long day', () => {
    expect(dayLengthMs(Date.parse('2026-03-29T12:00:00Z'), 'Europe/Athens')).toBe(23 * HOUR)
    expect(dayLengthMs(Date.parse('2026-10-25T12:00:00Z'), 'Europe/Athens')).toBe(25 * HOUR)
  })

  it('keeps a streak spanning a transition intact', () => {
    // The instants are unevenly spaced — one day is 23 hours and the next is
    // 24 — but the *days* are still consecutive, and a streak must not be
    // computed by dividing an elapsed time by 24 hours.
    const sessions = [
      focus({ id: 'a', startedAt: Date.parse('2026-03-28T09:00:00Z') }),
      focus({ id: 'b', startedAt: Date.parse('2026-03-29T09:00:00Z') }),
      focus({ id: 'c', startedAt: Date.parse('2026-03-30T09:00:00Z') }),
    ]

    expect(streaks(sessions, 'Europe/Athens', Date.parse('2026-03-30T12:00:00Z')).current).toBe(3)
  })
})

describe('the home zone changed mid-streak', () => {
  /**
   * The answer, measured rather than assumed: **recomputing usually does not
   * break a streak.** A zone change shifts every session's day key by the same
   * amount when the sessions sit in a normal band of hours, so the run of days
   * stays consecutive and the streak survives with the same length.
   *
   * It breaks in one shape: a day whose sessions *all* cross midnight in the
   * new zone. That day vanishes, a gap opens where it was, and the streak
   * splits.
   */
  const uniform = [10, 11, 12, 13, 14].map((day) =>
    focus({ id: `s${day}`, startedAt: localInstant(day, 9, 9) }),
  )

  it('keeps the streak when the sessions sit in a normal band of hours', () => {
    const tokyo = streaks(uniform, 'Asia/Tokyo', localInstant(14, 12, 9))
    const auckland = streaks(uniform, 'Pacific/Auckland', localInstant(14, 12, 9))
    const london = streaks(uniform, 'Europe/London', localInstant(14, 12, 9))

    expect(tokyo.current).toBe(5)
    expect(auckland.current).toBe(5)
    expect(london.current).toBe(5)
  })

  it('splits the streak when a whole day crosses midnight in the new zone', () => {
    // One day is a 23:00 session and nothing else, so moving east by four
    // hours carries it over into the next day and leaves the day it was on
    // empty.
    const sessions = [
      focus({ id: 'a', startedAt: localInstant(10, 9, 9) }),
      focus({ id: 'b', startedAt: localInstant(11, 9, 9) }),
      focus({ id: 'c', startedAt: localInstant(12, 9, 9) }),
      focus({ id: 'd', startedAt: localInstant(13, 23, 9) }),
      focus({ id: 'e', startedAt: localInstant(14, 9, 9) }),
      focus({ id: 'f', startedAt: localInstant(15, 9, 9) }),
    ]

    // In Tokyo the six days are consecutive.
    expect(streaks(sessions, 'Asia/Tokyo', localInstant(15, 12, 9)).current).toBe(6)
    // In Auckland the late-only day is carried over and its day empties, so
    // the streak splits in two: three days before the gap, two after it.
    const auckland = streaks(sessions, 'Pacific/Auckland', localInstant(15, 12, 9))
    expect(auckland.current).toBe(2)
    expect(auckland.longest).toBe(3)
    // Moving *west* merges days instead, and cannot open a gap.
    expect(streaks(sessions, 'Europe/London', localInstant(15, 12, 9)).current).toBe(6)
  })

  it('re-buckets the same history rather than keeping the old answer', () => {
    // The recomputation is a *re-bucketing*: the same sessions, read under a
    // different zone. Nothing is stored, so nothing can disagree.
    const sessions = [focus({ id: 'a', startedAt: localInstant(20, 23, 9) })]

    expect(streaks(sessions, 'Asia/Tokyo', localInstant(21, 12, 9)).current).toBe(1)
    // The same session, read in a zone where it belongs to the previous day,
    // still counts — it moved, it did not disappear.
    expect(streaks(sessions, 'Europe/London', localInstant(21, 12, 9)).current).toBe(1)
  })
})
