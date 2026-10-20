import { describe, expect, it } from 'vitest'
import type { Notifier } from './notifier.js'
import { createTimer } from './timer.js'
import type { SegmentSpec } from './timer.js'
import { InMemorySessionRepository } from './testing/InMemorySessionRepository.js'
import { ManualClock } from './testing/ManualClock.js'

const FOCUS_25: SegmentSpec = {
  id: 's1',
  kind: 'focus',
  presetId: 'focus-25',
  plannedDurationMs: 25 * 60 * 1000,
}

/**
 * Day 7 replaces this with the real fake — permission states, queued
 * notifications, the lot. Day 2 reads nothing from a notifier; this exists so
 * the factory's dependency list is satisfied honestly rather than with a cast.
 */
const stubNotifier: Notifier = {
  supported: true,
  permission: 'default',
  requestPermission: async () => 'granted',
  notify: async () => undefined,
}

function makeTimer(startAt = 0) {
  const clock = new ManualClock(startAt)
  const timer = createTimer({
    clock,
    repository: new InMemorySessionRepository(),
    notifier: stubNotifier,
  })
  return { clock, timer }
}

/**
 * All nine cells of the (phase × verb) table are pinned below: three legal
 * moves, six refusals. The refusals matter as much as the transitions — a
 * no-op instead of a throw would let the UI and the state machine disagree
 * without anything failing.
 */
describe('createTimer — the transition table', () => {
  describe('the three legal moves', () => {
    it('idle → running: builds the segment from the clock and the spec', () => {
      const { timer } = makeTimer(1_000)

      expect(timer.getState()).toEqual({ phase: 'idle', session: null })

      timer.start(FOCUS_25)

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

    it('running → paused: stamps the pause with the clock', () => {
      const { clock, timer } = makeTimer(5_000)
      timer.start(FOCUS_25)
      clock.advance(30_000)

      timer.pause()

      const { phase, session } = timer.getState()
      expect(phase).toBe('paused')
      expect(session?.pauseStartedAt).toBe(35_000)
      // A pause still in progress has not been counted — only closed ones are.
      expect(session?.accumulatedPausedMs).toBe(0)
    })

    it('paused → running: folds the pause into accumulatedPausedMs', () => {
      const { clock, timer } = makeTimer(5_000)
      timer.start(FOCUS_25)
      clock.advance(30_000)
      timer.pause() // paused at 35_000
      clock.advance(60_000) // a minute passes

      timer.resume()

      const { phase, session } = timer.getState()
      expect(phase).toBe('running')
      expect(session?.pauseStartedAt).toBeNull()
      expect(session?.accumulatedPausedMs).toBe(60_000)
    })

    it('accumulates every pause across repeated cycles', () => {
      const { clock, timer } = makeTimer(10_000)
      timer.start(FOCUS_25)

      clock.advance(1_000)
      timer.pause()
      clock.advance(2_000)
      timer.resume()

      clock.advance(3_000)
      timer.pause()
      clock.advance(4_000)
      timer.resume()

      expect(timer.getState().session?.accumulatedPausedMs).toBe(6_000)
    })

    it('carries a caller-supplied label instead of inventing one', () => {
      const { timer } = makeTimer()

      timer.start({ ...FOCUS_25, id: 's2', label: 'deep work' })

      expect(timer.getState().session?.label).toBe('deep work')
    })
  })

  describe('the six refused moves', () => {
    it('refuses pause() and resume() while idle', () => {
      const { timer } = makeTimer(1_000)

      expect(() => timer.pause()).toThrow('pause() refused: there is no segment running')
      expect(() => timer.resume()).toThrow('resume() refused: there is no segment paused')

      expect(timer.getState()).toEqual({ phase: 'idle', session: null })
    })

    it('refuses start() and resume() while running, leaving the session in place', () => {
      const { timer } = makeTimer(1_000)
      timer.start(FOCUS_25)

      expect(() => timer.start({ ...FOCUS_25, id: 's2' })).toThrow(
        'start() refused: a segment is already running',
      )
      expect(() => timer.resume()).toThrow('resume() refused: the segment is not paused')

      expect(timer.getState().phase).toBe('running')
      expect(timer.getState().session?.id).toBe('s1')
    })

    it('refuses start() and pause() while paused, leaving the pause untouched', () => {
      const { clock, timer } = makeTimer(1_000)
      timer.start(FOCUS_25)
      clock.advance(5_000)
      timer.pause()

      expect(() => timer.start({ ...FOCUS_25, id: 's2' })).toThrow(
        'start() refused: a segment is already paused',
      )
      expect(() => timer.pause()).toThrow('pause() refused: the segment is already paused')

      const { phase, session } = timer.getState()
      expect(phase).toBe('paused')
      expect(session?.id).toBe('s1')
      expect(session?.pauseStartedAt).toBe(6_000)
    })
  })

  describe('snapshots', () => {
    it('a snapshot keeps describing the past after the next transition', () => {
      const { clock, timer } = makeTimer(1_000)
      timer.start(FOCUS_25)

      const before = timer.getState()

      clock.advance(10_000)
      timer.pause()

      expect(before.phase).toBe('running')
      expect(before.session?.pauseStartedAt).toBeNull()
      expect(timer.getState().session).not.toBe(before.session)
    })

    it('freezes the session so a caller cannot rewrite timer state through it', () => {
      const { timer } = makeTimer(1_000)
      timer.start(FOCUS_25)

      const { session } = timer.getState()
      const asCaller = session as unknown as { label: string | null }

      expect(() => {
        asCaller.label = 'tampered'
      }).toThrow(TypeError)
      expect(timer.getState().session?.label).toBeNull()
    })

    it('keeps phase and session agreeing at every step', () => {
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
      timer.start(FOCUS_25)
      bothAgree()
      clock.advance(1_000)
      timer.pause()
      bothAgree()
      timer.resume()
      bothAgree()
    })
  })

  describe('the clock', () => {
    it('reads time from the injected clock, never the wall', () => {
      const { clock, timer } = makeTimer(1_234_567_890) // 1970-01-15, nowhere near "now"
      timer.start(FOCUS_25)
      clock.advance(60_000)

      timer.pause()

      const { session } = timer.getState()
      expect(session?.startedAt).toBe(1_234_567_890)
      expect(session?.pauseStartedAt).toBe(1_234_627_890)
    })

    it('never lets accumulatedPausedMs go negative when the clock steps backwards', () => {
      const { clock, timer } = makeTimer(100_000)
      timer.start(FOCUS_25)
      clock.advance(10_000)
      timer.pause() // paused at 110_000
      clock.advance(-30_000) // the system clock steps back mid-pause

      timer.resume()

      const { session } = timer.getState()
      expect(session?.accumulatedPausedMs).toBe(0)
      expect(session?.pauseStartedAt).toBeNull()
    })
  })
})
