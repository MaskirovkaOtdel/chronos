import type { Clock } from './clock.js'
import type { Notifier } from './notifier.js'
import type { SessionRepository } from './repository.js'
import type { FocusSession, SegmentKind } from './session.js'

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
 * `kind` is stated rather than derived from `presetId` because preset
 * definitions do not exist until day 3. If presets turn out to own the kind,
 * this field is where that decision lands.
 */
export interface SegmentSpec {
  readonly id: string
  readonly kind: SegmentKind
  readonly presetId: string
  readonly plannedDurationMs: number
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

  /** `idle → running`, building the segment from the clock and the spec. */
  start(spec: SegmentSpec): void

  /** `running → paused`, stamped with the clock's instant. */
  pause(): void

  /** `paused → running`, folding the pause into `accumulatedPausedMs`. */
  resume(): void
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

  function getState(): TimerState {
    return { phase: phaseOf(session), session }
  }

  function start(spec: SegmentSpec): void {
    if (!Number.isFinite(spec.plannedDurationMs) || spec.plannedDurationMs <= 0) {
      throw new Error('start() refused: plannedDurationMs must be a positive, finite number')
    }
    if (session !== null) {
      throw new Error(`start() refused: a segment is already ${phaseOf(session)}`)
    }

    session = Object.freeze({
      id: spec.id,
      kind: spec.kind,
      startedAt: clock.now(),
      pauseStartedAt: null,
      accumulatedPausedMs: 0,
      plannedDurationMs: spec.plannedDurationMs,
      label: spec.label ?? null,
      presetId: spec.presetId,
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

  return { getState, start, pause, resume }
}
