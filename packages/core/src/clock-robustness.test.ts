import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { FocusSession } from './session.js'
import { createTimer } from './timer.js'
import { elapsedMs } from './elapsed.js'
import { InMemorySessionRepository } from './testing/InMemorySessionRepository.js'
import { ManualClock } from './testing/ManualClock.js'
import { stubNotifier } from './testing/stubNotifier.js'

const FOCUS_25 = { id: 's1', presetId: 'focus-25' }

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

function makeTimer(startAt = 0) {
  const clock = new ManualClock(startAt)
  const repository = new InMemorySessionRepository()
  const timer = createTimer({ clock, repository, notifier: stubNotifier })
  return { clock, timer, repository }
}

/**
 * What "not corrupted" means, in one place.
 *
 * A clock that jumps, a laptop that sleeps, a tab that is closed for two days
 * — none of them may produce a session the rest of the app cannot reason
 * about. Every number has to stay finite, durations have to stay durations,
 * and a pause may never begin before the work it interrupts.
 */
function expectValidSession(session: FocusSession | null): void {
  if (session === null) return

  expect(Number.isFinite(session.startedAt)).toBe(true)
  expect(Number.isFinite(session.plannedDurationMs)).toBe(true)
  expect(Number.isFinite(session.accumulatedPausedMs)).toBe(true)
  expect(session.accumulatedPausedMs).toBeGreaterThanOrEqual(0)
  expect(session.plannedDurationMs).toBeGreaterThan(0)

  if (session.actualMs !== null) {
    expect(Number.isFinite(session.actualMs)).toBe(true)
    expect(session.actualMs).toBeGreaterThanOrEqual(0)
    // Rule 3: elapsed never exceeds planned.
    expect(session.actualMs).toBeLessThanOrEqual(session.plannedDurationMs)
  }
  if (session.endedAt !== null) {
    expect(Number.isFinite(session.endedAt)).toBe(true)
  }
  if (session.pauseStartedAt !== null) {
    expect(Number.isFinite(session.pauseStartedAt)).toBe(true)
    expect(session.pauseStartedAt).toBeGreaterThanOrEqual(session.startedAt)
  }
}

describe('clock robustness', () => {
  it('survives a forward jump without corrupting the session', async () => {
    const { clock, timer, repository } = makeTimer(10_000_000)
    await timer.start(FOCUS_25)
    clock.advance(10 * MINUTE)

    // The clock is corrected forward by two hours — an NTP correction, a
    // manual change, a device that woke up wrong.
    clock.advance(2 * HOUR)

    const { session } = timer.getState()
    expectValidSession(session)

    // The elapsed crossed the plan, so the session completes — a jump forward
    // is indistinguishable from working for two hours, and the plan's answer
    // to that is the same as the answer to a long overrun.
    const finished = await timer.tick()
    expect(finished?.completed).toBe(true)
    // The record is capped at the plan, whatever the clock said.
    expect(finished?.actualMs).toBe(25 * MINUTE)
    expect(await repository.list()).toHaveLength(1)
  })

  it('survives a backward jump without corrupting the session', async () => {
    const { clock, timer } = makeTimer(10_000_000)
    await timer.start(FOCUS_25)
    clock.advance(10 * MINUTE)

    // The clock is corrected backward by five minutes.
    clock.advance(-5 * MINUTE)

    const { phase, session } = timer.getState()
    expectValidSession(session)
    expect(phase).toBe('running')
    // Rule 1: elapsed is never negative, whatever the clock does.
    expect(elapsedMs(session as FocusSession, clock.now())).toBeGreaterThanOrEqual(0)
  })

  it('survives a backward jump that lands before the session started', async () => {
    const { clock, timer } = makeTimer(10_000_000)
    await timer.start(FOCUS_25)
    clock.advance(10 * MINUTE)

    // Two hours back — before the session even began.
    clock.advance(-2 * HOUR)

    const { phase, session } = timer.getState()
    expectValidSession(session)
    expect(phase).toBe('running')
    expect(elapsedMs(session as FocusSession, clock.now())).toBe(0)
  })

  it('completes a session that outlived an eight-hour sleep', async () => {
    const { clock, timer, repository } = makeTimer(10_000_000)
    await timer.start(FOCUS_25)
    clock.advance(10 * MINUTE)

    // The laptop sleeps. The wall clock does not care.
    clock.advance(8 * HOUR)

    const finished = await timer.tick()

    expect(finished?.completed).toBe(true)
    expect(finished?.actualMs).toBe(25 * MINUTE)
    expect(await repository.list()).toHaveLength(1)
    expect(timer.getState().focusCount).toBe(1)
  })

  it('resumes a session that was paused for two days, without counting the pause', async () => {
    const { clock, timer } = makeTimer(10_000_000)
    await timer.start(FOCUS_25)
    clock.advance(10 * MINUTE)
    await timer.pause()

    // Two days pass. Pauses are patient.
    clock.advance(2 * 24 * HOUR)

    const before = timer.getState()
    expect(before.phase).toBe('paused')
    expectValidSession(before.session)
    // The two days were not work.
    expect(elapsedMs(before.session as FocusSession, clock.now())).toBe(10 * MINUTE)

    await timer.resume()

    const after = timer.getState()
    expect(after.phase).toBe('running')
    expectValidSession(after.session)
    // The pause is recorded honestly — it really did last two days — and it
    // was not counted as work: still ten minutes of work.
    expect(after.session?.accumulatedPausedMs).toBe(2 * 24 * HOUR)
    expect(elapsedMs(after.session as FocusSession, clock.now())).toBe(10 * MINUTE)
  })

  it('never lets a pause begin before the work it interrupts', async () => {
    const { clock, timer } = makeTimer(10_000_000)
    await timer.start(FOCUS_25)
    clock.advance(10 * MINUTE)

    // The clock jumps back past the start, and the user pauses.
    clock.advance(-2 * HOUR)
    await timer.pause()

    const { session } = timer.getState()
    expectValidSession(session)
    expect(session?.pauseStartedAt).toBeGreaterThanOrEqual(session?.startedAt as number)
  })
})

/**
 * The state machine, fuzzed.
 *
 * The plan asks for this by name — *"fuzz the state machine with thousands of
 * random action sequences"* — and for the invariant *"clock changes can't
 * corrupt"*. A random sequence of actions, including ones the state machine
 * refuses, crossed with a clock that jumps forwards and backwards by hours,
 * with the invariants checked after every single step.
 */
describe('the state machine under a hostile clock', () => {
  const actionArb = fc.constantFrom(
    'start',
    'pause',
    'resume',
    'tick',
    'endEarly',
    'skip',
    'jumpForward',
    'jumpBackward',
  )

  const stepArb = fc.record({
    action: actionArb,
    amount: fc.integer({ min: -8 * HOUR, max: 8 * HOUR }),
  })

  it('keeps every invariant through thousands of random action sequences', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 40 }), async (steps) => {
        const { clock, timer, repository } = makeTimer(10_000_000)
        let nextId = 0

        for (const step of steps) {
          switch (step.action) {
            case 'start':
              // The state machine refuses illegal moves; the fuzzer does not
              // care which, it only cares that a refusal changes nothing.
              await timer.start({ id: `s${nextId++}`, presetId: 'focus-25' }).catch(() => undefined)
              break
            case 'pause':
              await timer.pause().catch(() => undefined)
              break
            case 'resume':
              await timer.resume().catch(() => undefined)
              break
            case 'tick':
              await timer.tick().catch(() => undefined)
              break
            case 'endEarly':
              await timer.endEarly().catch(() => undefined)
              break
            case 'skip':
              await timer.skip().catch(() => undefined)
              break
            case 'jumpForward':
              clock.advance(Math.abs(step.amount))
              break
            case 'jumpBackward':
              clock.advance(-Math.abs(step.amount))
              break
          }

          const { session, focusCount } = timer.getState()

          // 1, 2, 3, 5: the session is never corrupted, and the elapsed is
          // never negative and never exceeds the plan.
          expectValidSession(session)
          if (session !== null) {
            expect(elapsedMs(session, clock.now())).toBeGreaterThanOrEqual(0)
          }

          // 6: the session completes exactly once, and the count of focuses
          // that concluded matches the history exactly — a double-count would
          // break the equality, and so would a completion that was never
          // filed.
          const history = await repository.list()
          expect(focusCount).toBe(history.length)

          // 9: the state round-trips through JSON without losing anything.
          const state = await repository.loadState()
          if (state !== null) {
            expect(JSON.parse(JSON.stringify(state))).toEqual(state)
          }
        }
      }),
      { numRuns: 1_000 },
    )
  })
})
