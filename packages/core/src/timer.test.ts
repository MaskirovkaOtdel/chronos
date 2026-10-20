import { describe, expect, it } from 'vitest'
import type { FocusSession, PersistedTimerState } from './session.js'
import { createTimer, RESUME_GRACE_MS } from './timer.js'
import type { SegmentSpec, Timer } from './timer.js'
import { elapsedMs } from './elapsed.js'
import { InMemorySessionRepository } from './testing/InMemorySessionRepository.js'
import { ManualClock } from './testing/ManualClock.js'
import type { Mutable } from './testing/fixtures.js'
import { makeFocusSession, makePersistedTimerState } from './testing/fixtures.js'
import { FakeNotifier } from './testing/FakeNotifier.js'

const FOCUS_25: SegmentSpec = {
  id: 's1',
  presetId: 'focus-25',
}

/** The state of a timer that has never run anything. */
const IDLE = {
  phase: 'idle',
  session: null,
  focusCount: 0,
  currentPresetId: 'focus-25',
}

/**
 * The repository with a write counter, so "did this transition persist?" is a
 * question a test can actually ask.
 */
class CountingRepository extends InMemorySessionRepository {
  saves = 0

  override async saveState(state: PersistedTimerState): Promise<void> {
    this.saves += 1
    await super.saveState(state)
  }
}

function makeTimer(startAt = 0) {
  const clock = new ManualClock(startAt)
  const repository = new CountingRepository()
  const timer = createTimer({
    clock,
    repository,
    notifier: new FakeNotifier(),
  })
  return { clock, timer, repository }
}

/** The timer's live session, for tests that know one is running. */
function activeSession(timer: Timer): FocusSession {
  const { session } = timer.getState()
  if (session === null) throw new Error('expected an active session')
  return session
}

/** The instant the current pause began. */
function pausedAt(timer: Timer): number {
  const { session } = timer.getState()
  if (session === null || session.pauseStartedAt === null) {
    throw new Error('expected a paused session')
  }
  return session.pauseStartedAt
}

/**
 * All nine cells of the (phase × verb) table are pinned below: three legal
 * moves, six refusals. The refusals matter as much as the transitions — a
 * no-op instead of a throw would let the UI and the state machine disagree
 * without anything failing.
 */
describe('createTimer — the transition table', () => {
  describe('the three legal moves', () => {
    it('idle → running: builds the segment from the clock and the spec', async () => {
      const { timer } = makeTimer(1_000)

      expect(timer.getState()).toEqual(IDLE)

      await timer.start(FOCUS_25)

      const { phase, session } = timer.getState()
      expect(phase).toBe('running')
      // A segment that has just started: no pause, no outcome, not completed.
      expect(session).toEqual({
        id: 's1',
        kind: 'focus',
        startedAt: 1_000,
        pauseStartedAt: null,
        accumulatedPausedMs: 0,
        plannedDurationMs: 1_500_000,
        label: null,
        presetId: 'focus-25',
        endedAt: null,
        actualMs: null,
        completed: false,
      })
    })

    it('running → paused: stamps the pause with the clock', async () => {
      const { clock, timer } = makeTimer(5_000)
      await timer.start(FOCUS_25)
      clock.advance(30_000)

      await timer.pause()

      const { phase, session } = timer.getState()
      expect(phase).toBe('paused')
      expect(session?.pauseStartedAt).toBe(35_000)
      // A pause still in progress has not been counted — only closed ones are.
      expect(session?.accumulatedPausedMs).toBe(0)
    })

    it('paused → running: folds the pause into accumulatedPausedMs', async () => {
      const { clock, timer } = makeTimer(5_000)
      await timer.start(FOCUS_25)
      clock.advance(30_000)
      await timer.pause() // paused at 35_000
      clock.advance(60_000) // a minute passes

      await timer.resume()

      const { phase, session } = timer.getState()
      expect(phase).toBe('running')
      expect(session?.pauseStartedAt).toBeNull()
      expect(session?.accumulatedPausedMs).toBe(60_000)
    })

    it('accumulates every pause across repeated cycles', async () => {
      const { clock, timer } = makeTimer(10_000)
      await timer.start(FOCUS_25)

      clock.advance(1_000)
      await timer.pause()
      clock.advance(2_000)
      await timer.resume()

      clock.advance(3_000)
      await timer.pause()
      clock.advance(4_000)
      await timer.resume()

      expect(timer.getState().session?.accumulatedPausedMs).toBe(6_000)
    })

    it('carries a caller-supplied label instead of inventing one', async () => {
      const { timer } = makeTimer()

      await timer.start({ ...FOCUS_25, id: 's2', label: 'deep work' })

      expect(timer.getState().session?.label).toBe('deep work')
    })
  })

  describe('the six refused moves', () => {
    it('refuses pause() and resume() while idle', async () => {
      const { timer } = makeTimer(1_000)

      await expect(timer.pause()).rejects.toThrow('pause() refused: there is no segment running')
      await expect(timer.resume()).rejects.toThrow('resume() refused: there is no segment paused')

      expect(timer.getState()).toEqual(IDLE)
    })

    it('refuses start() and resume() while running, leaving the session in place', async () => {
      const { timer } = makeTimer(1_000)
      await timer.start(FOCUS_25)

      await expect(timer.start({ ...FOCUS_25, id: 's2' })).rejects.toThrow(
        'start() refused: a segment is already running',
      )
      await expect(timer.resume()).rejects.toThrow('resume() refused: the segment is not paused')

      expect(timer.getState().phase).toBe('running')
      expect(timer.getState().session?.id).toBe('s1')
    })

    it('refuses start() and pause() while paused, leaving the pause untouched', async () => {
      const { clock, timer } = makeTimer(1_000)
      await timer.start(FOCUS_25)
      clock.advance(5_000)
      await timer.pause()

      await expect(timer.start({ ...FOCUS_25, id: 's2' })).rejects.toThrow(
        'start() refused: a segment is already paused',
      )
      await expect(timer.pause()).rejects.toThrow('pause() refused: the segment is already paused')

      const { phase, session } = timer.getState()
      expect(phase).toBe('paused')
      expect(session?.id).toBe('s1')
      expect(session?.pauseStartedAt).toBe(6_000)
    })
  })

  describe('a spec the domain does not admit', () => {
    it('refuses a preset that does not exist', async () => {
      const { timer } = makeTimer(1_000)

      await expect(timer.start({ ...FOCUS_25, presetId: 'focus-50' })).rejects.toThrow(
        'start() refused: no preset named "focus-50"',
      )

      expect(timer.getState()).toEqual(IDLE)
    })
  })

  describe('completion', () => {
    it('completes a session that has reached its planned duration', async () => {
      const { clock, timer } = makeTimer(1_000)
      await timer.start(FOCUS_25)
      clock.advance(25 * 60 * 1000)

      const finished = await timer.tick()

      expect(finished?.endedAt).toBe(1_000 + 25 * 60 * 1000)
      expect(finished?.actualMs).toBe(25 * 60 * 1000)
      expect(finished?.completed).toBe(true)
      expect(finished?.kind).toBe('focus')
    })

    it('does not complete before the planned duration', async () => {
      const { clock, timer } = makeTimer(1_000)
      await timer.start(FOCUS_25)
      clock.advance(25 * 60 * 1000 - 1)

      expect(await timer.tick()).toBeNull()
      expect(timer.getState().phase).toBe('running')
    })

    it('does not complete a paused session that is still short of the plan', async () => {
      const { clock, timer } = makeTimer(1_000)
      await timer.start(FOCUS_25)
      clock.advance(60_000)
      await timer.pause()
      clock.advance(8 * 60 * 60 * 1000) // a night passes, paused

      expect(await timer.tick()).toBeNull()
      expect(timer.getState().phase).toBe('paused')
    })

    it('returns to idle and records what comes next', async () => {
      const { clock, timer } = makeTimer(1_000)
      await timer.start(FOCUS_25)
      clock.advance(25 * 60 * 1000)
      await timer.tick()

      const state = timer.getState()
      expect(state.phase).toBe('idle')
      expect(state.session).toBeNull()
      expect(state.focusCount).toBe(1)
      expect(state.currentPresetId).toBe('short-break-5')
    })

    it('earns the long break on the focus that completes the cadence', async () => {
      const { clock, timer } = makeTimer(1_000)
      const breaks: string[] = []

      for (let i = 0; i < 4; i += 1) {
        await timer.start({ ...FOCUS_25, id: `s${i}` })
        clock.advance(25 * 60 * 1000)
        await timer.tick()
        breaks.push(timer.getState().currentPresetId)
      }

      expect(breaks).toEqual(['short-break-5', 'short-break-5', 'short-break-5', 'long-break-15'])
      expect(timer.getState().focusCount).toBe(4)
    })

    it('counts breaks not at all, and follows a break with a focus', async () => {
      const { clock, timer } = makeTimer(1_000)
      await timer.start({ id: 'b1', presetId: 'short-break-5' })
      clock.advance(5 * 60 * 1000)
      await timer.tick()

      expect(timer.getState().focusCount).toBe(0)
      expect(timer.getState().currentPresetId).toBe('focus-25')
    })

    it('completes nothing when there is nothing running', async () => {
      const { timer } = makeTimer(1_000)

      expect(await timer.tick()).toBeNull()
    })
  })

  describe('the exit paths', () => {
    it('ends a segment early as a partial, consuming its cycle slot', async () => {
      const { clock, timer } = makeTimer(1_000)
      await timer.start(FOCUS_25)
      clock.advance(10 * 60 * 1000)

      const finished = await timer.endEarly()

      expect(finished?.endedAt).toBe(1_000 + 10 * 60 * 1000)
      expect(finished?.actualMs).toBe(10 * 60 * 1000)
      expect(finished?.completed).toBe(false)

      const state = timer.getState()
      expect(state.phase).toBe('idle')
      expect(state.session).toBeNull()
      // The focus ran, so it consumed a slot — but what comes next is still
      // the caller's call, so the cycle did not name a segment.
      expect(state.focusCount).toBe(1)
      expect(state.currentPresetId).toBe('focus-25')
    })

    it('refuses to end or skip a segment when there is none running', async () => {
      const { timer } = makeTimer(1_000)

      await expect(timer.endEarly()).rejects.toThrow(
        'endEarly() refused: there is no segment running',
      )
      await expect(timer.skip()).rejects.toThrow('skip() refused: there is no segment running')
    })

    it('skips to the next segment, and records it', async () => {
      const { clock, timer } = makeTimer(1_000)
      await timer.start(FOCUS_25)
      clock.advance(10 * 60 * 1000)

      const finished = await timer.skip()

      expect(finished?.completed).toBe(false)
      expect(timer.getState().currentPresetId).toBe('short-break-5')
      expect(timer.getState().focusCount).toBe(1)
    })

    it('skips a break to the next focus', async () => {
      const { clock, timer } = makeTimer(1_000)
      await timer.start({ id: 'b1', presetId: 'short-break-5' })
      clock.advance(60_000)

      await timer.skip()

      expect(timer.getState().currentPresetId).toBe('focus-25')
    })

    it('caps a completion at the planned duration, while the clock still shows the overrun', async () => {
      const { clock, timer } = makeTimer(1_000)
      await timer.start(FOCUS_25)
      clock.advance(25 * 60 * 1000 + 1)

      // The live elapsed time is not capped — that is how the overrun is
      // detected at all.
      expect(elapsedMs(activeSession(timer), 1_000 + 25 * 60 * 1000 + 1)).toBe(25 * 60 * 1000 + 1)

      const finished = await timer.tick()

      // The record, on the other hand, says what the segment was worth.
      expect(finished?.actualMs).toBe(25 * 60 * 1000)
    })

    it('records a partial honestly, and still consumes its cycle slot', async () => {
      // Two different questions, two different places. The cycle asks "where
      // in the rhythm am I" — a focus that ran answers that, whether it
      // reached its plan or not. The record asks "did it reach its plan" —
      // and the session's own `completed` flag answers that, which is where
      // the statistics read it from.
      const { clock, timer } = makeTimer(1_000)
      await timer.start(FOCUS_25)
      clock.advance(10 * 60 * 1000)

      const finished = await timer.endEarly()

      expect(finished?.completed).toBe(false)
      expect(finished?.actualMs).toBe(10 * 60 * 1000)
      expect(timer.getState().focusCount).toBe(1)
    })

    it('earns the long break after four focuses run, completed or not', async () => {
      const { clock, timer } = makeTimer(1_000)

      // A partial, then three completed focuses: four slots either way.
      await timer.start({ ...FOCUS_25, id: 'p0' })
      clock.advance(60_000)
      await timer.endEarly()

      for (let i = 0; i < 3; i += 1) {
        await timer.start({ ...FOCUS_25, id: `s${i}` })
        clock.advance(25 * 60 * 1000)
        await timer.tick()
      }

      expect(timer.getState().focusCount).toBe(4)
      expect(timer.getState().currentPresetId).toBe('long-break-15')
    })

    it('does not hand out a second long break in a row', async () => {
      // The rhythm is exact: every fourth focus earns the long break, and the
      // fifth does not — whether the fourth was completed or skipped.
      const { clock, timer } = makeTimer(1_000)

      for (let i = 0; i < 4; i += 1) {
        await timer.start({ ...FOCUS_25, id: `s${i}` })
        clock.advance(25 * 60 * 1000)
        await timer.tick()
      }

      expect(timer.getState().currentPresetId).toBe('long-break-15')

      await timer.start({ ...FOCUS_25, id: 's4' })
      clock.advance(10 * 60 * 1000)
      await timer.skip()

      expect(timer.getState().focusCount).toBe(5)
      expect(timer.getState().currentPresetId).toBe('short-break-5')
    })
  })

  describe('persistence', () => {
    it('writes the whole state document on every transition', async () => {
      const { clock, timer, repository } = makeTimer(1_000)

      await timer.start(FOCUS_25)
      expect((await repository.loadState())?.activeSession?.id).toBe('s1')
      expect((await repository.loadState())?.focusCount).toBe(0)

      clock.advance(60_000)
      await timer.pause()
      expect((await repository.loadState())?.activeSession?.pauseStartedAt).toBe(61_000)

      await timer.resume()
      expect((await repository.loadState())?.activeSession?.pauseStartedAt).toBeNull()
    })

    it('writes exactly one document per transition', async () => {
      const { clock, timer, repository } = makeTimer(1_000)

      await timer.start(FOCUS_25)
      expect(repository.saves).toBe(1)

      clock.advance(1_000)
      await timer.pause()
      expect(repository.saves).toBe(2)

      await timer.resume()
      expect(repository.saves).toBe(3)
    })

    it('writes nothing when a tick changes nothing', async () => {
      const { clock, timer, repository } = makeTimer(1_000)
      await timer.start(FOCUS_25)
      clock.advance(1_000)

      expect(await timer.tick()).toBeNull()
      expect(repository.saves).toBe(1)
    })

    it('files a finished session in the history, and advances the cycle in the state', async () => {
      const { clock, timer, repository } = makeTimer(1_000)
      await timer.start(FOCUS_25)
      clock.advance(25 * 60 * 1000)

      await timer.tick()

      const history = await repository.list()
      expect(history).toHaveLength(1)
      expect(history[0]?.id).toBe('s1')
      expect(history[0]?.completed).toBe(true)

      const state = await repository.loadState()
      expect(state?.activeSession).toBeNull()
      expect(state?.focusCount).toBe(1)
      expect(state?.currentPresetId).toBe('short-break-5')
    })
  })

  describe('startup reconciliation', () => {
    it('starts idle when nothing was persisted', async () => {
      const { timer } = makeTimer(1_000)

      const outcome = await timer.restore(null)

      expect(outcome.resumed).toBeNull()
      expect(outcome.completedWhileAway).toBeNull()
      expect(timer.getState().phase).toBe('idle')
    })

    it('restores a paused session as paused, however long ago it was paused', async () => {
      // Pauses are patient: a week-old pause is still a pause.
      const { clock, timer, repository } = makeTimer(1_000)
      const paused = makeFocusSession({ id: 's1', startedAt: 1_000, pauseStartedAt: 31_000 })
      await repository.saveState(makePersistedTimerState({ activeSession: paused }))

      clock.advance(7 * 24 * 60 * 60 * 1000) // a week later
      const outcome = await timer.restore(await repository.loadState())

      expect(outcome.resumed?.id).toBe('s1')
      expect(outcome.completedWhileAway).toBeNull()
      expect(timer.getState().phase).toBe('paused')
    })

    it('resumes a running session silently inside the grace period', async () => {
      const { clock, timer, repository } = makeTimer(1_000)
      const running = makeFocusSession({ id: 's1', startedAt: 1_000 })
      await repository.saveState(makePersistedTimerState({ activeSession: running }))

      // Twenty seconds past the end: still inside `planned + 30s`.
      clock.advance(25 * 60 * 1000 + 20_000)
      const outcome = await timer.restore(await repository.loadState())

      expect(outcome.resumed?.id).toBe('s1')
      expect(outcome.completedWhileAway).toBeNull()
      expect(timer.getState().phase).toBe('running')
    })

    it('completes a session that finished while the app was away', async () => {
      const { clock, timer, repository } = makeTimer(1_000)
      const running = makeFocusSession({ id: 's1', startedAt: 1_000 })
      await repository.saveState(makePersistedTimerState({ activeSession: running }))

      clock.advance(25 * 60 * 1000 + RESUME_GRACE_MS + 30_000)
      const outcome = await timer.restore(await repository.loadState())

      expect(outcome.resumed).toBeNull()
      expect(outcome.completedWhileAway?.id).toBe('s1')
      expect(outcome.completedWhileAway?.completed).toBe(true)
      expect(outcome.completedWhileAway?.actualMs).toBe(25 * 60 * 1000)

      // Recorded, not discarded.
      expect(await repository.list()).toHaveLength(1)

      // And the cycle has moved on, leaving the timer idle.
      const state = await repository.loadState()
      expect(state?.activeSession).toBeNull()
      expect(state?.focusCount).toBe(1)
      expect(state?.currentPresetId).toBe('short-break-5')
      expect(timer.getState().phase).toBe('idle')
    })

    it('ignores a persisted session whose numbers are not finite', async () => {
      const { timer, repository } = makeTimer(1_000)
      const corrupt = makeFocusSession({ id: 's1', startedAt: Number.NaN })
      await repository.saveState(makePersistedTimerState({ activeSession: corrupt }))

      const outcome = await timer.restore(await repository.loadState())

      expect(outcome.resumed).toBeNull()
      expect(timer.getState().phase).toBe('idle')
    })
  })

  describe('snapshots', () => {
    it('a snapshot keeps describing the past after the next transition', async () => {
      const { clock, timer } = makeTimer(1_000)
      await timer.start(FOCUS_25)

      const before = timer.getState()

      clock.advance(10_000)
      await timer.pause()

      expect(before.phase).toBe('running')
      expect(before.session?.pauseStartedAt).toBeNull()
      expect(timer.getState().session).not.toBe(before.session)
    })

    it('freezes the session so a caller cannot rewrite timer state through it', async () => {
      const { timer } = makeTimer(1_000)
      await timer.start(FOCUS_25)

      const { session } = timer.getState()
      const asCaller = session as Mutable<FocusSession>

      expect(() => {
        asCaller.label = 'tampered'
      }).toThrow(TypeError)
      expect(timer.getState().session?.label).toBeNull()
    })

    it('keeps phase and session agreeing at every step', async () => {
      // Phase is derived, not stored — this walk fails the moment a stored
      // `phase` is added and allowed to drift from the session behind it.
      const { clock, timer } = makeTimer(1_000)
      const bothAgree = () => {
        const { phase, session } = timer.getState()
        const expected =
          session === null ? 'idle' : session.pauseStartedAt === null ? 'running' : 'paused'
        expect(phase).toBe(expected)
      }

      bothAgree()
      await timer.start(FOCUS_25)
      bothAgree()
      clock.advance(1_000)
      await timer.pause()
      bothAgree()
      await timer.resume()
      bothAgree()
    })
  })

  describe('the clock', () => {
    it('reads time from the injected clock, never the wall', async () => {
      const { clock, timer } = makeTimer(1_234_567_890) // 1970-01-15, nowhere near "now"
      await timer.start(FOCUS_25)
      clock.advance(60_000)

      await timer.pause()

      const { session } = timer.getState()
      expect(session?.startedAt).toBe(1_234_567_890)
      expect(session?.pauseStartedAt).toBe(1_234_627_890)
    })

    it('never lets accumulatedPausedMs go negative when the clock steps backwards', async () => {
      const { clock, timer } = makeTimer(100_000)
      await timer.start(FOCUS_25)
      clock.advance(10_000)
      await timer.pause() // paused at 110_000
      clock.advance(-30_000) // the system clock steps back mid-pause

      await timer.resume()

      const { session } = timer.getState()
      expect(session?.accumulatedPausedMs).toBe(0)
      expect(session?.pauseStartedAt).toBeNull()
    })

    it('never moves the elapsed time across a pause and a resume', async () => {
      const { clock, timer } = makeTimer(0)
      await timer.start(FOCUS_25)
      clock.advance(10_000)

      expect(elapsedMs(activeSession(timer), 10_000)).toBe(10_000)

      await timer.pause()
      clock.advance(60_000)
      await timer.resume()

      // The minute spent paused is not work: the counter resumes where it was.
      expect(elapsedMs(activeSession(timer), 70_000)).toBe(10_000)
    })

    it('records a pause that cannot have begun before the session did', async () => {
      // The clock stepping back past the start must not manufacture a pause
      // that started before the work it interrupts: the pause tail would then
      // swallow the whole session and the work would be unrecoverable.
      const { clock, timer } = makeTimer(1_000_000)
      await timer.start(FOCUS_25)
      clock.advance(600_000) // ten minutes of real work
      clock.advance(-1_200_000) // the clock steps back past the start

      await timer.pause()

      const session = activeSession(timer)
      expect(pausedAt(timer)).toBeGreaterThanOrEqual(session.startedAt)
      expect(pausedAt(timer)).toBeGreaterThanOrEqual(
        session.startedAt + session.accumulatedPausedMs,
      )

      // And the work before the jump is not charged to the pause either.
      clock.advance(200_000)
      await timer.resume()
      expect(activeSession(timer).accumulatedPausedMs).toBe(0)
    })
  })
})
