import { describe, expect, it } from 'vitest'
import type { FocusSession } from '../session.js'
import { makeFocusSession } from '../testing/fixtures.js'
import { dayKey } from './dayKeys.js'
import { ribbonForDay } from './ribbon.js'
import { streaks } from './streaks.js'
import { summary } from './summaries.js'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 2026-10-20T09:00:00Z, and the same instant in a few zones. */
const NINE_UTC = Date.parse('2026-10-20T09:00:00Z')

function focus(overrides: Partial<FocusSession> & { startedAt?: number } = {}): FocusSession {
  return makeFocusSession({
    id: 's1',
    kind: 'focus',
    startedAt: NINE_UTC,
    actualMs: 25 * MINUTE,
    completed: true,
    ...overrides,
  })
}

describe('the stats band', () => {
  it('sums the focus time and counts the completions', () => {
    const sessions = [
      focus({ id: 'a', actualMs: 25 * MINUTE }),
      focus({ id: 'b', actualMs: 50 * MINUTE, completed: false }),
    ]

    const stats = summary(sessions, 'UTC')

    expect(stats.totalFocusMs).toBe(75 * MINUTE)
    expect(stats.totalSessions).toBe(2)
    expect(stats.completedSessions).toBe(1)
    expect(stats.completionRate).toBe(0.5)
  })

  it('has no completion rate at all when nothing has run', () => {
    const stats = summary([], 'UTC')

    // "No sessions" and "zero percent completed" are different facts.
    expect(stats.completionRate).toBeNull()
    expect(stats.totalFocusMs).toBe(0)
    expect(stats.dailyAverageMs).toBe(0)
  })

  it('ignores breaks — this is a focus timer', () => {
    const sessions = [
      focus({ id: 'a', actualMs: 25 * MINUTE }),
      focus({ id: 'b', kind: 'short_break', actualMs: 5 * MINUTE }),
    ]

    const stats = summary(sessions, 'UTC')

    expect(stats.totalFocusMs).toBe(25 * MINUTE)
    expect(stats.totalSessions).toBe(1)
  })

  it('distributes the focus time across the local hours', () => {
    const sessions = [
      focus({ id: 'a', startedAt: Date.parse('2026-10-20T09:00:00Z'), actualMs: 60 * MINUTE }),
      focus({ id: 'b', startedAt: Date.parse('2026-10-20T10:30:00Z'), actualMs: 30 * MINUTE }),
    ]

    const stats = summary(sessions, 'UTC')

    expect(stats.hourlyFocusMs).toHaveLength(24)
    expect(stats.hourlyFocusMs[9]).toBe(60 * MINUTE)
    expect(stats.hourlyFocusMs[10]).toBe(30 * MINUTE)
    expect(stats.hourlyFocusMs[11]).toBe(0)
  })

  it('averages over the days that had any focus', () => {
    const sessions = [
      focus({ id: 'a', startedAt: NINE_UTC, actualMs: 25 * MINUTE }),
      focus({
        id: 'b',
        startedAt: Date.parse('2026-10-21T09:00:00Z'),
        actualMs: 25 * MINUTE,
      }),
    ]

    expect(summary(sessions, 'UTC').dailyAverageMs).toBe(25 * MINUTE)
  })
})

describe('streaks', () => {
  const day = (index: number): number => Date.parse('2026-10-20T12:00:00Z') + index * DAY

  it('counts consecutive days with a completed focus', () => {
    const sessions = [
      focus({ id: 'a', startedAt: day(0) }),
      focus({ id: 'b', startedAt: day(1) }),
      focus({ id: 'c', startedAt: day(2) }),
    ]

    const result = streaks(sessions, 'UTC', day(2))

    expect(result.current).toBe(3)
    expect(result.longest).toBe(3)
  })

  it('excludes partials — an abandoned focus is not a day you showed up', () => {
    const sessions = [
      focus({ id: 'a', startedAt: day(0) }),
      focus({ id: 'b', startedAt: day(1), completed: false, actualMs: 5 * MINUTE }),
    ]

    const result = streaks(sessions, 'UTC', day(1))

    expect(result.current).toBe(1)
  })

  it('excludes breaks', () => {
    const sessions = [focus({ id: 'b', kind: 'short_break', startedAt: day(0) })]

    expect(streaks(sessions, 'UTC', day(0)).current).toBe(0)
  })

  it('is broken by a missed day', () => {
    const sessions = [focus({ id: 'a', startedAt: day(0) }), focus({ id: 'b', startedAt: day(2) })]

    const result = streaks(sessions, 'UTC', day(2))

    expect(result.current).toBe(1)
    expect(result.longest).toBe(1)
  })

  it('survives a today that has not happened yet', () => {
    // The day is not over, so it cannot have been missed.
    const sessions = [focus({ id: 'a', startedAt: day(0) })]

    const result = streaks(sessions, 'UTC', day(1))

    expect(result.current).toBe(1)
  })

  it('remembers the longest streak even when the current one is shorter', () => {
    const sessions = [
      focus({ id: 'a', startedAt: day(0) }),
      focus({ id: 'b', startedAt: day(1) }),
      focus({ id: 'c', startedAt: day(2) }),
      focus({ id: 'd', startedAt: day(10) }),
    ]

    const result = streaks(sessions, 'UTC', day(10))

    expect(result.current).toBe(1)
    expect(result.longest).toBe(3)
  })

  it('buckets by the local day, so a late session is not lost to UTC', () => {
    // 23:30 UTC on the 20th is already the 21st in Tokyo.
    const late = Date.parse('2026-10-20T23:30:00Z')
    const sessions = [
      focus({ id: 'a', startedAt: Date.parse('2026-10-20T12:00:00Z') }),
      focus({ id: 'b', startedAt: late }),
    ]

    // In UTC the two sessions are on different days — a broken streak.
    expect(streaks(sessions, 'UTC', late).current).toBe(1)
    // In Tokyo they are the same day.
    expect(streaks(sessions, 'Asia/Tokyo', late).current).toBe(2)
  })
})

describe('the day ribbon', () => {
  it('places a session at its true clock position', () => {
    const sessions = [focus({ id: 'a', startedAt: NINE_UTC, actualMs: 25 * MINUTE })]

    const segments = ribbonForDay(sessions, 'UTC', '2026-10-20')

    expect(segments).toHaveLength(1)
    expect(segments[0]?.start).toBeCloseTo(9 / 24, 10)
    // 25 minutes past nine.
    expect(segments[0]?.end).toBeCloseTo((9 * 60 + 25) / (24 * 60), 10)
  })

  it('lists the segments in the order they happened', () => {
    const sessions = [
      focus({ id: 'late', startedAt: Date.parse('2026-10-20T14:00:00Z') }),
      focus({ id: 'early', startedAt: Date.parse('2026-10-20T08:00:00Z') }),
    ]

    const segments = ribbonForDay(sessions, 'UTC', '2026-10-20')

    expect(segments.map((segment) => segment.id)).toEqual(['early', 'late'])
  })

  it('shows only the day asked for', () => {
    const sessions = [
      focus({ id: 'a', startedAt: NINE_UTC }),
      focus({ id: 'b', startedAt: Date.parse('2026-10-21T09:00:00Z') }),
    ]

    const segments = ribbonForDay(sessions, 'UTC', '2026-10-20')

    expect(segments.map((segment) => segment.id)).toEqual(['a'])
  })

  it('carries the breaks too — they are the thin ticks on the band', () => {
    const sessions = [
      focus({ id: 'a', startedAt: NINE_UTC }),
      focus({
        id: 'b',
        kind: 'short_break',
        startedAt: Date.parse('2026-10-20T10:00:00Z'),
        actualMs: 5 * MINUTE,
      }),
    ]

    const segments = ribbonForDay(sessions, 'UTC', '2026-10-20')

    expect(segments.map((segment) => segment.kind)).toEqual(['focus', 'short_break'])
  })

  it('clips a session that runs past the end of the day', () => {
    const sessions = [
      focus({ id: 'a', startedAt: Date.parse('2026-10-20T23:30:00Z'), actualMs: 60 * MINUTE }),
    ]

    const segments = ribbonForDay(sessions, 'UTC', '2026-10-20')

    expect(segments[0]?.start).toBeLessThan(1)
    expect(segments[0]?.end).toBe(1)
  })

  it('has nothing to show for a day with no sessions', () => {
    expect(ribbonForDay([focus({ id: 'a' })], 'UTC', '2026-10-21')).toEqual([])
  })

  it('buckets the ribbon by the same day key the rest of the stats use', () => {
    const late = Date.parse('2026-10-20T23:30:00Z')

    expect(dayKey(late, 'Asia/Tokyo')).toBe('2026-10-21')
    expect(
      ribbonForDay([focus({ id: 'a', startedAt: late })], 'Asia/Tokyo', '2026-10-21'),
    ).toHaveLength(1)
  })
})
