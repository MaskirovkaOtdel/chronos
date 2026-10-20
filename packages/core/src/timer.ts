import type { Clock } from './clock.js'
import type { Notifier } from './notifier.js'
import type { SessionRepository } from './repository.js'
import type { FocusSession } from './session.js'
import { elapsedMs } from './elapsed.js'
import { nextSegmentAfterCompletion } from './cycle.js'
import { FOCUS_25, findPreset } from './presets.js'
import type { FocusPreset } from './presets.js'

/**
 * Phase 2, day 2: the transition table — three phases, three verbs.
 *
 * `start`, `pause` and `resume` are the whole surface. Completion detection
 * (day 3), the remaining exit paths (day 4), persistence (day 5), clock
 * robustness (day 6) and notification policy (day 7) each extend this; none of
 * them is approximated here, which is why there is no `tick()` and no
 * auto-complete yet.
 *
 * Illegal moves **throw** rather than no-op. The buttons that will drive this
 * live in the UI and are expected to be disabled by state; a call that reaches
 * here anyway means the state machine and its caller disagree, and silently
 * absorbing that would let the two drift apart for weeks without a symptom.
 */
export type TimerPhase = 'idle' | 'running' | 'paused'

/**
 * What `getState()` reports: the session, and the phase read off it.
 *
 * `phase` is computed at read time from the session rather than stored beside
 * it. `session === null` already means idle, and `pauseStartedAt !== null`
 * already means paused — a stored `phase` would be a second opinion about a
 * fact the session holds, which is the standard way a timer ends up both
 * running and paused after a reload. Same reasoning as `pauseStartedAt`
 * replacing an `isPaused` flag in `FocusSession`.
 */
export interface TimerState {
  readonly phase: TimerPhase
  /**
   * `null` while idle. The session is frozen and this snapshot is a fresh
   * copy, so nothing a caller does to what it is handed can reach the timer.
   */
  readonly session: FocusSession | null
  /**
   * Focus sessions completed so far — the cycle position.
   *
   * This is the reason the state has to persist at all: without it the
   * long-break cadence restarts every time the tab closes. Breaks do not
   * advance it.
   */
  readonly completedFocusCount: number
  /**
   * The preset in force.
   *
   * While a segment runs, this is that segment's preset. While the timer is
   * idle it is the segment to run **next** — the break the cycle chose, or the
   * focus to offer — and it is a *suggestion* rather than a decision: the app
   * supplies the preset when it starts something, and that wins. It is the
   * field that tells a reloaded app what to offer.
   */
  readonly currentPresetId: string
}

/**
 * The part of a segment the **caller** decides.
 *
 * Everything time decides is absent by design — `startedAt`, both pause
 * fields, `endedAt`, `actualMs`, `completed` are stamped by the clock or by a
 * later transition. Accepting them here would make "started ten minutes ago
 * and already completed" a representable state, and the formula's guarantees
 * would only hold for callers who happened to pass honest values.
 *
 * `id` is caller-supplied deliberately. Core cannot mint one: `crypto.randomUUID`
 * lives in `lib.dom`/`@types/node`, and core compiles with `lib: ["ES2023"]`
 * and `types: []` — reaching for it would be the same mistake as importing
 * `node:fs` into a package whose whole claim is zero I/O. It also keeps tests
 * deterministic: a random id would turn every assertion about history order
 * into a lottery.
 *
 * The preset supplies the kind and the duration. Both used to be stated here
 * as well, which meant a caller could start a "25 minute" segment under the id
 * of a 5 minute preset and have the two disagree — the session's own duration
 * and the preset it claims to belong to. One source, no disagreement.
 */
export interface SegmentSpec {
  readonly id: string
  /** The preset that defines this segment's kind and duration. */
  readonly presetId: string
  /** `null` when started bare. Optional so a bare start costs one line. */
  readonly label?: string | null
}

/**
 * Everything the timer asks of the outside world.
 *
 * Only `clock` is read on day 2. `repository` and `notifier` are accepted now
 * because the plan fixes this signature and days 5 and 7 activate them — the
 * public shape stays put while the behaviour underneath grows into it, instead
 * of being widened under callers three times.
 */
export interface TimerDeps {
  readonly clock: Clock
  readonly repository: SessionRepository
  readonly notifier: Notifier
}

export interface Timer {
  /** The current phase and the session behind it. Safe to call at any time. */
  getState(): TimerState

  /** `idle → running`, building the segment from the clock and its preset. */
  start(spec: SegmentSpec): void

  /** `running → paused`, stamped with the clock's instant. */
  pause(): void

  /** `paused → running`, folding the pause into `accumulatedPausedMs`. */
  resume(): void

  /**
   * Checks the clock, and completes the segment if it has reached its planned
   * duration.
   *
   * The timer schedules nothing: core cannot — there is no `setTimeout` in
   * `lib: ["ES2023"]` — and the app is already reading the clock to draw the
   * countdown. So completion is detected when the app asks, which keeps the
   * whole thing a pure function of the clock.
   *
   * Returns the session that completed, so the caller can put it in history.
   * `null` when nothing completed.
   */
  tick(): FocusSession | null
}

/** Reads the phase off a session; `null` (no session) is `idle`. */
function phaseOf(session: FocusSession | null): TimerPhase {
  if (session === null) return 'idle'
  return session.pauseStartedAt === null ? 'running' : 'paused'
}

/**
 * Builds a timer over `deps`.
 *
 * The single piece of mutable state is a closure variable, and **no transition
 * mutates a session** — each one replaces it with a fresh frozen copy. That is
 * what lets `getState()` hand out an object and still mean it: a snapshot
 * taken before `pause()` goes on describing the world as it was, rather than
 * changing underneath its reader.
 */
export function createTimer(deps: TimerDeps): Timer {
  const { clock } = deps

  let session: FocusSession | null = null
  let completedFocusCount = 0

  /**
   * The preset of the segment to run next.
   *
   * The cycle overwrites this with a break preset once a focus completes, so
   * it is *not* the user's focus selection — it is what the app should offer
   * next. That is exactly what has to survive a reload, and why it is the
   * field the persisted state carries.
   */
  let currentPresetId = FOCUS_25.id

  /**
   * The user's focus selection, kept apart from `currentPresetId` because the
   * cycle replaces the latter with a break. After a break completes, the next
   * focus comes from here.
   *
   * It lives in memory only: the persisted state's `currentPresetId` holds
   * whichever segment comes next, and a *chosen* focus length is a settings
   * fact — it belongs to the settings store, and the app restores it when it
   * starts the next focus.
   */
  let focusPreset: FocusPreset = FOCUS_25

  function getState(): TimerState {
    return {
      phase: phaseOf(session),
      session,
      completedFocusCount,
      currentPresetId,
    }
  }

  function start(spec: SegmentSpec): void {
    const preset = findPreset(spec.presetId)
    if (preset === null) {
      throw new Error(`start() refused: no preset named "${spec.presetId}"`)
    }
    if (session !== null) {
      throw new Error(`start() refused: a segment is already ${phaseOf(session)}`)
    }

    currentPresetId = preset.id
    if (preset.kind === 'focus') {
      focusPreset = preset
    }

    session = Object.freeze({
      id: spec.id,
      kind: preset.kind,
      startedAt: clock.now(),
      pauseStartedAt: null,
      accumulatedPausedMs: 0,
      plannedDurationMs: preset.durationMs,
      label: spec.label ?? null,
      presetId: preset.id,
      endedAt: null,
      actualMs: null,
      completed: false,
    })
  }

  function pause(): void {
    if (session === null) {
      throw new Error('pause() refused: there is no segment running')
    }
    if (session.pauseStartedAt !== null) {
      throw new Error('pause() refused: the segment is already paused')
    }

    // A pause cannot begin before the session did, and cannot begin before the
    // pauses already closed have been accounted for: every closed pause lies
    // inside the span between `startedAt` and now, so their total is at most
    // `now - startedAt`, which puts the current pause at or after
    // `startedAt + accumulatedPausedMs`.
    //
    // The clock can step backwards, and without this bound the timer would
    // record a pause that started before the work it interrupts — a state the
    // domain does not admit and `elapsedMs` cannot represent. The pause tail
    // would swallow the whole session, the floor would report zero for work
    // that was genuinely done, and the loss would only surface minutes later
    // as a countdown that refuses to move.
    const earliestPauseStart = session.startedAt + session.accumulatedPausedMs
    session = Object.freeze({
      ...session,
      pauseStartedAt: Math.max(clock.now(), earliestPauseStart),
    })
  }

  function resume(): void {
    if (session === null) {
      throw new Error('resume() refused: there is no segment paused')
    }
    if (session.pauseStartedAt === null) {
      throw new Error('resume() refused: the segment is not paused')
    }

    // `Math.max(0, …)` because a pause is a *duration*, and the clock can step
    // backwards during one — a timezone correction mid-pause would otherwise
    // push accumulatedPausedMs below zero and break the invariant every
    // elapsed-time property assumes. The pause simply counts as nothing.
    const pausedFor = Math.max(0, clock.now() - session.pauseStartedAt)

    session = Object.freeze({
      ...session,
      pauseStartedAt: null,
      accumulatedPausedMs: session.accumulatedPausedMs + pausedFor,
    })
  }

  /**
   * Ends the session as completed and hands back the finished record.
   *
   * `actualMs` is the elapsed time at the instant of completion, *not* the
   * planned duration: a segment that overran really did run longer, and day 4
   * decides what a completion is allowed to record about that.
   */
  function complete(): FocusSession {
    if (session === null) {
      throw new Error('complete() refused: there is no segment running')
    }

    const now = clock.now()
    const finished = Object.freeze({
      ...session,
      endedAt: now,
      actualMs: elapsedMs(session, now),
      completed: true,
    })

    if (finished.kind === 'focus') {
      completedFocusCount += 1
    }

    // The cycle decides what comes next, and the state records it — so a
    // reloaded app knows to offer the break rather than another focus.
    const next = nextSegmentAfterCompletion(finished.kind, completedFocusCount, focusPreset)
    currentPresetId = next.presetId

    session = null
    return finished
  }

  function tick(): FocusSession | null {
    if (session === null) return null
    if (elapsedMs(session, clock.now()) < session.plannedDurationMs) return null
    return complete()
  }

  return { getState, start, pause, resume, tick }
}
