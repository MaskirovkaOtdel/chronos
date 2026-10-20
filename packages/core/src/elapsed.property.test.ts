import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { FocusSession } from './session.js'
import { elapsedMs } from './elapsed.js'
import { makeFocusSession } from './testing/fixtures.js'

/**
 * Property-based tests for `elapsedMs`.
 *
 * The example suite in `elapsed.test.ts` proves the five situations the plan
 * names — running, one pause, several pauses, a week paused, `now` before
 * `startedAt`. Those cases were hand-picked, and hand-picked cases cannot state
 * "for every session, at every instant", which is the claim a formula makes.
 *
 * fast-check supplies the missing quantifier: random inputs that are *shrunk*,
 * so a failure reports the smallest counterexample together with the seed that
 * produced it. Random is safe here precisely because the properties are
 * universal — a real counterexample fails under nearly every seed rather than
 * under one unlucky one.
 *
 * What is deliberately absent: no property restates the implementation as
 * `now − startedAt − accumulatedPausedMs − tail` and then asserts itself. Each
 * property below is a claim that something else — the countdown, the
 * completion detector, persistence — depends on independently.
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Instants from 1970 to ~2096 — wide enough to make carries non-trivial. */
const instant = fc.integer({ min: 0, max: 4_000_000_000_000 })

/** Durations up to 30 days. */
const duration = fc.integer({ min: 0, max: 30 * DAY })

/** `now` measured from `startedAt`: an hour before the start through 60 days on. */
const offset = fc.integer({ min: -DAY, max: 60 * DAY })

/** The time fields of a session, isolated so variants can be derived from one source. */
type SessionCore = {
  startedAt: number
  accumulatedPausedMs: number
  pauseAfterStart: number | null
  plannedDurationMs: number
}

const sessionCoreArb: fc.Arbitrary<SessionCore> = fc.record({
  startedAt: instant,
  accumulatedPausedMs: duration,
  pauseAfterStart: fc.option(duration, { nil: null }),
  plannedDurationMs: fc.integer({ min: 1, max: 4 * HOUR }),
})

/** A paused session whose `pauseStartedAt` is known to be a real instant. */
type PausedSession = FocusSession & { readonly pauseStartedAt: number }

/** Any session the engine could have produced: paused, running, or never started. */
const sessionArb = sessionCoreArb.map((c) =>
  makeFocusSession({
    startedAt: c.startedAt,
    accumulatedPausedMs: c.accumulatedPausedMs,
    plannedDurationMs: c.plannedDurationMs,
    pauseStartedAt: c.pauseAfterStart === null ? null : c.startedAt + c.pauseAfterStart,
  }),
)

/** Guaranteed paused — `pausedArb`'s variants all carry a non-null instant. */
const pausedArb: fc.Arbitrary<PausedSession> = sessionCoreArb.map((c) => {
  const pauseStartedAt = c.startedAt + (c.pauseAfterStart ?? 0)
  return {
    ...makeFocusSession({
      startedAt: c.startedAt,
      accumulatedPausedMs: c.accumulatedPausedMs,
      plannedDurationMs: c.plannedDurationMs,
      pauseStartedAt,
    }),
    pauseStartedAt,
  }
})

/** Nothing paused, ever: no tail and nothing accumulated. */
const neverPausedArb = sessionCoreArb.map((c) =>
  makeFocusSession({
    startedAt: c.startedAt,
    plannedDurationMs: c.plannedDurationMs,
    accumulatedPausedMs: 0,
    pauseStartedAt: null,
  }),
)

describe('elapsedMs — properties', () => {
  it('is never negative, for any session at any instant', () => {
    fc.assert(
      fc.property(sessionArb, offset, (session, delta) => {
        expect(elapsedMs(session, session.startedAt + delta)).toBeGreaterThanOrEqual(0)
      }),
    )
  })

  it('never runs backwards when the clock advances', () => {
    fc.assert(
      fc.property(sessionArb, offset, duration, (session, delta, advance) => {
        const earlier = session.startedAt + delta
        const later = earlier + advance
        expect(elapsedMs(session, later)).toBeGreaterThanOrEqual(elapsedMs(session, earlier))
      }),
    )
  })

  it('does not tick while paused, whatever the clock does afterwards', () => {
    fc.assert(
      fc.property(pausedArb, offset, offset, (session, first, second) => {
        const atFirst = elapsedMs(session, session.startedAt + first)
        const atSecond = elapsedMs(session, session.startedAt + second)
        expect(atSecond).toBe(atFirst)
      }),
    )
  })

  it('treats closing the pause now as having accumulated it all along', () => {
    // This is the invariant the timer engine leans on when it resumes: reading
    // the state and folding the current pause into `accumulatedPausedMs` must
    // not move the elapsed value by a millisecond at the instant of resuming.
    fc.assert(
      fc.property(pausedArb, duration, (session, after) => {
        const now = session.pauseStartedAt + after
        const resumed: FocusSession = {
          ...session,
          pauseStartedAt: null,
          accumulatedPausedMs: session.accumulatedPausedMs + after,
        }
        expect(elapsedMs(resumed, now)).toBe(elapsedMs(session, now))
      }),
    )
  })

  it('subtracts paused time exactly once — not twice, not at all', () => {
    // `elapsed.ts` warns that time paused is subtracted "twice over" if only one
    // of the two terms is carried. Here both terms are zero on one side and a
    // single `pausedFor` on the other, so the difference is the whole pause.
    fc.assert(
      fc.property(sessionCoreArb, duration, duration, (core, pausedFor, after) => {
        const now = core.startedAt + pausedFor + after
        const worked = makeFocusSession({
          startedAt: core.startedAt,
          plannedDurationMs: core.plannedDurationMs,
        })
        const workedThenPaused: FocusSession = { ...worked, accumulatedPausedMs: pausedFor }

        expect(elapsedMs(worked, now) - elapsedMs(workedThenPaused, now)).toBe(pausedFor)
      }),
    )
  })

  it('counts wall time exactly and never clamps at the planned duration', () => {
    // Overrun is a *signal* — the engine detects elapsed crossing the plan to
    // auto-complete the segment. A clamp here would silently swallow it.
    fc.assert(
      fc.property(neverPausedArb, duration, (session, beyond) => {
        const over = session.plannedDurationMs + beyond
        const elapsed = elapsedMs(session, session.startedAt + over)

        expect(elapsed).toBe(over)
        expect(elapsed).toBeGreaterThanOrEqual(session.plannedDurationMs)
      }),
    )
  })

  it('reads only the clock fields — completion bookkeeping cannot leak in', () => {
    fc.assert(
      fc.property(sessionArb, offset, (session, delta) => {
        const now = session.startedAt + delta
        const tampered: FocusSession = {
          ...session,
          kind: 'long_break',
          label: 'tampered',
          presetId: 'focus-50',
          endedAt: now,
          actualMs: 1,
          completed: true,
          plannedDurationMs: 1,
        }

        expect(elapsedMs(tampered, now)).toBe(elapsedMs(session, now))
      }),
    )
  })
})
