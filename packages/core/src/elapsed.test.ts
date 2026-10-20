import { describe, expect, it } from 'vitest'
import { ManualClock } from './testing/ManualClock.js'
import { makeFocusSession } from './testing/fixtures.js'
import { elapsedMs } from './elapsed.js'

/**
 * Time is never slept through — a `ManualClock` is stepped by the test, so
 * "paused for a week" costs one `advance()` call instead of a week.
 */
describe('elapsedMs', () => {
  it('accumulates while running', () => {
    const clock = new ManualClock()
    const session = makeFocusSession({ startedAt: clock.now() })

    clock.advance(1000)
    expect(elapsedMs(session, clock.now())).toBe(1000)

    clock.advance(1000)
    expect(elapsedMs(session, clock.now())).toBe(2000)
  })

  it('stops accumulating during a pause and resumes where it left off', () => {
    const clock = new ManualClock()
    let session = makeFocusSession({ startedAt: clock.now() })

    // 10s of work, then pause.
    clock.advance(10_000)
    session = { ...session, pauseStartedAt: clock.now() }
    expect(elapsedMs(session, clock.now())).toBe(10_000)

    // A week passes paused — elapsed must not move.
    clock.advance(7 * 24 * 60 * 60 * 1000)
    expect(elapsedMs(session, clock.now())).toBe(10_000)

    // Resume, then work 5s more.
    session = {
      ...session,
      pauseStartedAt: null,
      accumulatedPausedMs: session.accumulatedPausedMs + (clock.now() - 0 - 10_000),
    }
    clock.advance(5000)
    expect(elapsedMs(session, clock.now())).toBe(15_000)
  })

  it('accumulates multiple separate pauses', () => {
    const clock = new ManualClock()
    let session = makeFocusSession({ startedAt: clock.now() })

    clock.advance(1000)
    session = { ...session, pauseStartedAt: clock.now() }
    clock.advance(4000)
    session = {
      ...session,
      pauseStartedAt: null,
      accumulatedPausedMs: session.accumulatedPausedMs + 4000,
    }

    clock.advance(2000)

    session = { ...session, pauseStartedAt: clock.now() }
    clock.advance(9000)
    session = {
      ...session,
      pauseStartedAt: null,
      accumulatedPausedMs: session.accumulatedPausedMs + 9000,
    }

    clock.advance(1000)

    // 1000 + 2000 + 1000 of real work; the 4000 and 9000 pauses contributed nothing.
    expect(elapsedMs(session, clock.now())).toBe(4000)
  })

  it('clamps to zero rather than going negative when the clock runs backwards', () => {
    const clock = new ManualClock(50_000)
    const session = makeFocusSession({ startedAt: clock.now() })

    clock.advance(-30_000)
    expect(elapsedMs(session, clock.now())).toBe(0)
  })

  it('clamps to zero for an instant before the session started', () => {
    const clock = new ManualClock(100_000)
    const session = makeFocusSession({ startedAt: clock.now() })

    expect(elapsedMs(session, 50_000)).toBe(0)
  })
})
