import { describe, expect, it } from 'vitest'
import type { PersistedTimerState } from './session.js'
import { createTimer } from './timer.js'
import { elapsedMs } from './elapsed.js'
import { streaks, summary } from './stats/index.js'
import { InMemorySessionRepository } from './testing/InMemorySessionRepository.js'
import { ManualClock } from './testing/ManualClock.js'
import { FakeNotifier } from './testing/FakeNotifier.js'
import { makePersistedTimerState } from './testing/fixtures.js'

const MINUTE = 60 * 1000

/**
 * Integration, and the phase's last invariant: **reload restores exact
 * state**.
 *
 * Every other day tested the timer against a double and checked one thing at
 * a time. This one runs the whole life of a session — start, work, pause,
 * resume, finish — through the repository, and then builds a **fresh timer
 * from what was written**. The week-3 contract says a transition is one
 * atomic write of the whole document; that promise is only worth something if
 * what comes back out of storage is what went in.
 */
describe('a session, end to end, through the repository', () => {
  it('carries the work from one timer to the next', async () => {
    const clock = new ManualClock(1_000)
    const repository = new InMemorySessionRepository()
    const notifier = new FakeNotifier()
    notifier.permission = 'granted'

    // Twenty-five minutes of focus, with a five-minute pause in the middle.
    const first = createTimer({ clock, repository, notifier })
    await first.start({ id: 's1', presetId: 'focus-25' })
    clock.advance(10 * MINUTE)
    await first.pause()
    clock.advance(5 * MINUTE)
    await first.resume()
    clock.advance(15 * MINUTE)

    const finished = await first.tick()
    expect(finished?.completed).toBe(true)
    // The pause was not work, so the session is worth twenty-five minutes and
    // not thirty.
    expect(finished?.actualMs).toBe(25 * MINUTE)

    // The repository holds both halves: the finished session in the history,
    // and the cycle position in the state.
    const history = await repository.list()
    expect(history).toHaveLength(1)

    const state = await repository.loadState()
    expect(state?.activeSession).toBeNull()
    expect(state?.focusCount).toBe(1)
    expect(state?.currentPresetId).toBe('short-break-5')

    // A **fresh** timer, built from what was written.
    const second = createTimer({ clock, repository, notifier })
    const outcome = await second.restore(await repository.loadState())

    expect(outcome.resumed).toBeNull()
    expect(outcome.completedWhileAway).toBeNull()
    expect(second.getState().phase).toBe('idle')
    expect(second.getState().focusCount).toBe(1)
    expect(second.getState().currentPresetId).toBe('short-break-5')

    // And the history is still the history, and the statistics still read it.
    const stats = summary(history, 'UTC')
    expect(stats.totalFocusMs).toBe(25 * MINUTE)
    expect(stats.completionRate).toBe(1)
    expect(streaks(history, 'UTC', clock.now()).current).toBe(1)
  })

  it('restores a running session exactly as it was', async () => {
    const clock = new ManualClock(1_000)
    const repository = new InMemorySessionRepository()
    const notifier = new FakeNotifier()

    const first = createTimer({ clock, repository, notifier })
    await first.start({ id: 's1', presetId: 'focus-25' })
    clock.advance(7 * MINUTE)
    await first.pause()

    // The tab was closed. Reopen it a minute later.
    clock.set(1_000 + 8 * MINUTE)

    const second = createTimer({ clock, repository, notifier })
    const outcome = await second.restore(await repository.loadState())

    expect(outcome.resumed?.id).toBe('s1')
    expect(second.getState().phase).toBe('paused')
    expect(second.getState().session?.pauseStartedAt).toBe(first.getState().session?.pauseStartedAt)
    expect(second.getState().session?.accumulatedPausedMs).toBe(0)
    // The work done before the pause is still the work done.
    expect(elapsedMs(second.getState().session!, clock.now())).toBe(7 * MINUTE)
  })

  it('completes a session exactly once, even across a reload', async () => {
    const clock = new ManualClock(1_000)
    const repository = new InMemorySessionRepository()
    const notifier = new FakeNotifier()
    notifier.permission = 'granted'

    const first = createTimer({ clock, repository, notifier })
    await first.start({ id: 's1', presetId: 'focus-25' })

    // The app was closed while the focus was running, and the session ran out
    // in the meantime.
    clock.set(1_000 + 26 * MINUTE)

    const second = createTimer({ clock, repository, notifier })
    const outcome = await second.restore(await repository.loadState())

    expect(outcome.completedWhileAway?.id).toBe('s1')
    expect(outcome.completedWhileAway?.completed).toBe(true)
    expect(second.getState().focusCount).toBe(1)

    // A third timer, reading the same storage, finds the session already
    // settled — it is not completed a second time.
    const third = createTimer({ clock, repository, notifier })
    const again = await third.restore(await repository.loadState())

    expect(again.completedWhileAway).toBeNull()
    expect(again.resumed).toBeNull()
    expect(third.getState().focusCount).toBe(1)
    expect(await repository.list()).toHaveLength(1)
  })

  it('restores an idle state — a document with no active session', async () => {
    const clock = new ManualClock(1_000)
    const repository = new InMemorySessionRepository()
    const notifier = new FakeNotifier()

    await repository.saveState(
      makePersistedTimerState({ focusCount: 3, currentPresetId: 'short-break-5' }),
    )

    const timer = createTimer({ clock, repository, notifier })
    const outcome = await timer.restore(await repository.loadState())

    expect(outcome.resumed).toBeNull()
    expect(outcome.completedWhileAway).toBeNull()
    expect(timer.getState().phase).toBe('idle')
    expect(timer.getState().focusCount).toBe(3)
    expect(timer.getState().currentPresetId).toBe('short-break-5')
  })
})

describe('serialize round-trip', () => {
  it('changes nothing when the state goes through JSON', async () => {
    const clock = new ManualClock(1_000)
    const repository = new InMemorySessionRepository()
    const notifier = new FakeNotifier()

    const timer = createTimer({ clock, repository, notifier })
    await timer.start({ id: 's1', presetId: 'focus-25' })
    clock.advance(3 * MINUTE)
    await timer.pause()

    const state = await repository.loadState()
    expect(state).not.toBeNull()

    // `JSON.parse` is `any` by definition — the assertion is what makes the
    // round trip checkable rather than merely permitted.
    const round = JSON.parse(JSON.stringify(state)) as PersistedTimerState
    expect(round).toEqual(state)

    await repository.saveState(round)
    expect(await repository.loadState()).toEqual(state)
  })

  it('changes nothing when a session goes through JSON', () => {
    const session = makePersistedTimerState({
      activeSession: {
        id: 's1',
        kind: 'focus',
        startedAt: 1_000,
        pauseStartedAt: 2_000,
        accumulatedPausedMs: 0,
        plannedDurationMs: 25 * MINUTE,
        label: 'deep work',
        presetId: 'focus-25',
        endedAt: null,
        actualMs: null,
        completed: false,
      },
    })

    expect(JSON.parse(JSON.stringify(session))).toEqual(session)
  })
})
