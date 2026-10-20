import type { Clock } from './clock.js'
import type { Notifier } from './notifier.js'
import type { SessionRepository } from './repository.js'
import type { FocusSession, PersistedTimerState, SegmentKind } from './session.js'
import { elapsedMs } from './elapsed.js'
import { notificationFor } from './notifications.js'
import { nextSegmentAfterFinish } from './cycle.js'
import { FOCUS_25, findPreset } from './presets.js'
import type { FocusPreset } from './presets.js'

/**
 * How long past a session's planned duration the app will still resume it
 * silently.
 *
 * The plan's rule, verbatim: *"Reopen within `planned + 30s` → silently
 * resume. Beyond → mark completed, notify, land on idle with 'Completed while
 * you were away.' Never scolding."*
 *
 * The grace period is what makes a brief absence — a reload, a crashed tab, a
 * switched app — invisible, while a genuine absence is *settled* rather than
 * left hanging. It is a grace period, not a tolerance for imprecision: a
 * session that finished while the app was closed is completed and recorded
 * either way.
 */
export const RESUME_GRACE_MS = 30_000

/**
 * The timer: phases, transitions, and the persistence behind them.
 *
 * `idle`, `running` and `paused`; three verbs, two exit paths, and a
 * completion detected on the clock. Every transition writes the whole state
 * document before it resolves, and the startup reconciliation follows the
 * plan's rules exactly. Clock robustness (day 6) and notification policy
 * (day 7) still extend this.
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
   * Focus sessions that have run to a conclusion — the cycle position.
   *
   * A focus consumes a slot whether it was completed or ended early, because
   * the cycle is a rhythm of focuses *run*. Whether a focus reached its plan
   * is answered per session by `FocusSession.completed`, and the statistics
   * read the history for that. This count answers only "where in the cycle
   * are we" — and it has to persist, or the long-break cadence resets every
   * time the tab closes.
   */
  readonly focusCount: number
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
 * All three are read. The notifier carries the finished segment's message —
 * the *policy* for what to say is pure and lives in `notifications.ts`; this
 * only delivers it.
 */
export interface TimerDeps {
  readonly clock: Clock
  readonly repository: SessionRepository
  readonly notifier: Notifier
}

export interface Timer {
  /** The current phase and the session behind it. Safe to call at any time. */
  getState(): TimerState

  /**
   * `idle → running`, building the segment from the clock and its preset.
   *
   * Every transition is **persisted before it resolves**: the whole state
   * document is written in one call, so a transition is one atomic write.
   */
  start(spec: SegmentSpec): Promise<void>

  /** `running → paused`, stamped with the clock's instant. */
  pause(): Promise<void>

  /** `paused → running`, folding the pause into `accumulatedPausedMs`. */
  resume(): Promise<void>

  /**
   * Checks the clock, and completes the segment if it has reached its planned
   * duration.
   *
   * The timer schedules nothing: core cannot — there is no `setTimeout` in
   * `lib: ["ES2023"]` — and the app is already reading the clock to draw the
   * countdown. So completion is detected when the app asks, which keeps the
   * whole thing a pure function of the clock.
   *
   * Returns the session that completed. `null` when nothing completed — and
   * nothing is written either, because nothing changed.
   */
  tick(): Promise<FocusSession | null>

  /**
   * Ends the running segment now, as a **partial**, and hands it back.
   *
   * The record is honest: it says the segment ran for however long it ran and
   * that it did not reach its plan. The focus still consumes its cycle slot
   * — it ran — but *what comes next* is the caller's choice here, so the
   * cycle is not consulted.
   */
  endEarly(): Promise<FocusSession>

  /**
   * Ends the running segment as a partial **and moves the cycle on**, so the
   * state names the segment to run next.
   *
   * The caller starts it — with an id of its own, since core cannot mint one.
   */
  skip(): Promise<FocusSession>

  /**
   * Extends a finished segment and resumes it — the notification's *"Extend
   * 5m"* action.
   *
   * The plan: *"Extend 5m (adds to `plannedDurationMs`, resumes)"*. The work
   * already done is untouched; only the target grows, and the segment becomes
   * live again.
   */
  extend(finished: FocusSession, extraMs: number): Promise<void>

  /**
   * Reconciles a persisted state into this timer, as the app starts up.
   *
   * The reconciliation follows the plan's rules exactly:
   *
   * ```
   * read activeSession
   *   ├─ none      → idle
   *   ├─ paused    → still paused (pauses are patient — a week-old pause is fine)
   *   └─ running
   *        ├─ elapsed < planned + 30s  → auto-resume silently
   *        └─ otherwise                → completed with actualMs, notify, idle
   * ```
   *
   * The "completed while you were away" case is *completed and recorded*, not
   * discarded: the session goes to history, the cycle advances, and the timer
   * lands on idle. The notification itself is day 7's work — the outcome is
   * returned here so the app can decide what to say.
   */
  restore(state: PersistedTimerState | null): Promise<RestoreOutcome>
}

/**
 * What the startup reconciliation found.
 *
 * Both fields are `null` in the ordinary case — nothing was running, so
 * nothing was resumed and nothing finished while the app was away.
 */
export interface RestoreOutcome {
  /** The session that was running or paused and has been resumed. */
  readonly resumed: FocusSession | null
  /** A session that finished while the app was away — completed and recorded. */
  readonly completedWhileAway: FocusSession | null
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
 *
 * **Every transition persists the whole state document before it resolves.**
 * The document is the unit of write (week 3), so a transition is one atomic
 * write — never two, never a half-written pair. That is why the verbs are
 * asynchronous: the port is asynchronous, and a transition that returned
 * before its write landed would be a transition that had not happened yet.
 */
export function createTimer(deps: TimerDeps): Timer {
  const { clock, repository, notifier } = deps

  let session: FocusSession | null = null
  let focusCount = 0

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
      focusCount,
      currentPresetId,
    }
  }

  /**
   * Writes the whole state document.
   *
   * One call, one document: the active session and the cycle position move
   * together or not at all.
   */
  async function persist(): Promise<void> {
    await repository.saveState({ activeSession: session, focusCount, currentPresetId })
  }

  /**
   * Files a finished session in the history.
   *
   * History is **upserted by id**, so filing the same session twice is a
   * no-op rather than a duplicate — which is what makes the retry safe when a
   * write fails half way: the session is filed *before* the state is written,
   * so a crash in between leaves the history one step ahead of the state, and
   * the next attempt files the same id again.
   */
  async function file(finished: FocusSession): Promise<void> {
    await repository.put(finished)
  }

  async function start(spec: SegmentSpec): Promise<void> {
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

    await persist()
  }

  async function pause(): Promise<void> {
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

    await persist()
  }

  async function resume(): Promise<void> {
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

    await persist()
  }

  /**
   * Announces a finished segment, if the platform should hear about it.
   *
   * The *policy* — what to say, and whether to say it — is pure and lives in
   * `notifications.ts`; this is only the delivery. A refused permission or a
   * platform with no notification API produces nothing, and that is an
   * ordinary outcome rather than a failure: the redundancy ladder's other
   * channels still reach the user.
   */
  async function announce(finished: FocusSession, whileAway: boolean): Promise<void> {
    const notification = notificationFor(finished, {
      supported: notifier.supported,
      permission: notifier.permission,
      whileAway,
    })

    if (notification === null) return
    await notifier.notify(notification)
  }

  /**
   * Ends the session and hands back the finished record.
   *
   * `actualMs` is the elapsed time at the instant it ended, **capped at the
   * planned duration**. The cap is a rule, not a rounding: a segment is 25
   * minutes long, and running two minutes over is a grace period rather than
   * two minutes of credit. The live elapsed time is *not* capped — that is how
   * the overrun is detected at all — so the overrun is still visible on the
   * countdown while the record says what the segment was worth.
   */
  async function finish(completed: boolean, action: string): Promise<FocusSession> {
    if (session === null) {
      throw new Error(`${action}() refused: there is no segment running`)
    }

    const now = clock.now()
    const finished = Object.freeze({
      ...session,
      endedAt: now,
      actualMs: Math.min(elapsedMs(session, now), session.plannedDurationMs),
      completed,
    })

    session = null
    return finished
  }

  /**
   * Consumes a cycle slot for a focus that has reached a conclusion.
   *
   * The slot is used whether the focus was completed or ended early: the
   * cycle is a rhythm of focuses *run*, and the long break follows every
   * fourth one. Whether the focus actually reached its plan is a different
   * question, and the session's own `completed` flag answers it.
   */
  function consumeFocusSlot(finishedKind: SegmentKind): void {
    if (finishedKind === 'focus') {
      focusCount += 1
    }
  }

  /** Consumes the slot and records the segment the cycle calls for next. */
  function advanceCycle(finishedKind: SegmentKind): void {
    consumeFocusSlot(finishedKind)

    const next = nextSegmentAfterFinish(finishedKind, focusCount, focusPreset)
    currentPresetId = next.presetId
  }

  /**
   * Ends the session as completed, and moves the cycle on.
   *
   * A completed focus consumes a cycle slot; a completed break does not. The
   * next segment is recorded in the state, so a reloaded app knows to offer
   * the break rather than another focus.
   */
  async function complete(): Promise<FocusSession> {
    const finished = await finish(true, 'complete')
    await file(finished)
    advanceCycle(finished.kind)
    await persist()
    await announce(finished, false)
    return finished
  }

  /**
   * Extends a finished segment and resumes it — the notification's *"Extend
   * 5m"* action.
   *
   * The plan: *"Extend 5m (adds to `plannedDurationMs`, resumes)"*. The work
   * already done is untouched: the segment started when it started and the
   * pauses it took are still the pauses it took. Only the target grows, and
   * the segment becomes live again.
   *
   * Two things are undone, because the segment has **not** concluded after
   * all: the completion's cycle advance (it must not have consumed a slot)
   * and its place in the history (a running segment is not a finished one).
   */
  async function extend(finished: FocusSession, extraMs: number): Promise<void> {
    if (session !== null) {
      throw new Error('extend() refused: a segment is already running')
    }
    if (!Number.isFinite(extraMs) || extraMs <= 0) {
      throw new Error('extend() refused: the extension must be a positive number of milliseconds')
    }

    if (finished.kind === 'focus' && focusCount > 0) {
      focusCount -= 1
    }
    currentPresetId = finished.presetId
    await repository.delete(finished.id)

    session = Object.freeze({
      ...finished,
      plannedDurationMs: finished.plannedDurationMs + extraMs,
      endedAt: null,
      actualMs: null,
      completed: false,
    })

    await persist()
  }

  /**
   * Ends the running segment now, as a **partial**.
   *
   * The session is finished and returned, with `completed: false` — the
   * record says exactly how long it ran and that it did not reach its plan.
   *
   * The focus still consumes its cycle slot: it ran, and the cadence is a
   * rhythm rather than a reward. But *what comes next* is the caller's call
   * here — the cycle is not consulted, so the caller may start another focus
   * instead of taking the break. Use {@link skip} to be handed the cycle's
   * next segment.
   */
  async function endEarly(): Promise<FocusSession> {
    const finished = await finish(false, 'endEarly')
    await file(finished)
    consumeFocusSlot(finished.kind)
    await persist()
    return finished
  }

  /**
   * Ends the running segment as a partial **and moves the cycle on**.
   *
   * The difference from {@link endEarly} is the cycle: skipping asks what
   * comes next, and the state records it — the break the cadence calls for
   * after a focus, the focus after a break. The caller starts it, with an id
   * of its own.
   */
  async function skip(): Promise<FocusSession> {
    const finished = await finish(false, 'skip')
    await file(finished)
    advanceCycle(finished.kind)
    await persist()
    return finished
  }

  async function tick(): Promise<FocusSession | null> {
    if (session === null) return null
    if (elapsedMs(session, clock.now()) < session.plannedDurationMs) return null
    return complete()
  }

  /**
   * Reconciles a persisted state into this timer, as the app starts up.
   *
   * The plan's rules, exactly:
   *
   * ```
   * read activeSession
   *   ├─ none      → idle
   *   ├─ paused    → still paused (pauses are patient — a week-old pause is fine)
   *   └─ running
   *        ├─ elapsed < planned + 30s  → auto-resume silently
   *        └─ otherwise                → completed with actualMs, notify, idle
   * ```
   *
   * The "completed while you were away" case is *completed and recorded*, not
   * discarded: the session is filed in the history, the cycle advances, and
   * the timer lands on idle. The notification is day 7's work, so the outcome
   * carries the session and the app decides what to say about it.
   */
  async function restore(state: PersistedTimerState | null): Promise<RestoreOutcome> {
    if (state === null) {
      return { resumed: null, completedWhileAway: null }
    }

    focusCount = state.focusCount
    currentPresetId = state.currentPresetId

    const restored = state.activeSession
    if (restored === null) {
      return { resumed: null, completedWhileAway: null }
    }

    // A corrupt record must not become a NaN countdown. localStorage validates
    // nothing at all, so the guard belongs here rather than in the adapter.
    if (!isUsable(restored)) {
      return { resumed: null, completedWhileAway: null }
    }

    // Pauses are patient. A week-old pause is still a pause, and the plan says
    // so: it is restored as paused, not treated as a session that ended.
    if (restored.pauseStartedAt !== null) {
      session = Object.freeze({ ...restored })
      return { resumed: session, completedWhileAway: null }
    }

    const now = clock.now()
    const elapsed = elapsedMs(restored, now)

    if (elapsed < restored.plannedDurationMs + RESUME_GRACE_MS) {
      session = Object.freeze({ ...restored })
      return { resumed: session, completedWhileAway: null }
    }

    // It finished while the app was away. The plan's wording: "completed with
    // actualMs, notify, idle" — completed, recorded, and left on idle.
    const finished = Object.freeze({
      ...restored,
      endedAt: now,
      actualMs: Math.min(elapsed, restored.plannedDurationMs),
      completed: true,
    })

    await file(finished)
    advanceCycle(finished.kind)
    await persist()
    await announce(finished, true)

    return { resumed: null, completedWhileAway: finished }
  }

  return { getState, start, pause, resume, tick, endEarly, skip, extend, restore }
}

/**
 * A session is usable only if its numbers are finite.
 *
 * The persisted record is the app's own past, and localStorage validates
 * nothing at all — one truncated or hand-edited entry must not turn the
 * countdown into `NaN` and the elapsed time into a number that compares
 * false against everything.
 */
function isUsable(session: FocusSession): boolean {
  return (
    Number.isFinite(session.startedAt) &&
    Number.isFinite(session.plannedDurationMs) &&
    Number.isFinite(session.accumulatedPausedMs) &&
    (session.pauseStartedAt === null || Number.isFinite(session.pauseStartedAt))
  )
}
