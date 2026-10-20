/**
 * Domain vocabulary for a timed segment.
 *
 * `focus` drives the timer the user actually came for. The two break kinds are
 * separate values rather than a boolean because the UI, the notification copy
 * and the cycle maths all treat them differently — collapsing them into
 * `isBreak` pushes a third branch into every one of those sites later.
 */
export type SegmentKind = 'focus' | 'short_break' | 'long_break'

/**
 * One timed segment, as it exists on disk or in Firestore.
 *
 * Every field is `readonly` on purpose: the timer engine moves between states
 * by producing a *new* session object and persisting it, never by mutating a
 * session that may already be written somewhere. Mutable persisted state is
 * how you end up with two copies disagreeing after a reload.
 */
export interface FocusSession {
  readonly id: string

  readonly kind: SegmentKind

  /**
   * Epoch milliseconds — always a number, never a string.
   *
   * This is a storage contract, not a style preference: JSON round-trips lose
   * nothing, but a string date coerces silently under `>`/`<` comparisons and
   * Firestore stores strings as strings, so one stray `toISOString()` would
   * change the type of everything downstream.
   */
  readonly startedAt: number

  /**
   * Non-null exactly while paused, and holds the instant the pause began.
   *
   * The paused condition is *derived* from this field rather than carried as a
   * separate `isPaused` flag — two sources of truth for "am I paused" is the
   * classic way a timer ends up both running and paused after a reload.
   */
  readonly pauseStartedAt: number | null

  /** Total duration of all pauses that have already ended. */
  readonly accumulatedPausedMs: number

  /** Target length of the segment. Elapsed time never legitimately exceeds it. */
  readonly plannedDurationMs: number

  /** User-supplied note, or null when the session was started bare. */
  readonly label: string | null

  /** Which preset produced `plannedDurationMs` — kept so history stays legible
   *  if presets are later edited. */
  readonly presetId: string

  /** Null while the session is live. */
  readonly endedAt: number | null

  /**
   * Actual elapsed time, excluding pause time, **capped at the planned
   * duration**. Null until the session ends.
   *
   * The cap is a rule, not a rounding: a segment is 25 minutes long, and
   * running two minutes over is a grace period rather than two minutes of
   * credit. The *live* elapsed time is not capped — that is how an overrun is
   * detected at all — so the overrun stays visible on the countdown while the
   * record says what the segment was worth.
   */
  readonly actualMs: number | null

  /**
   * Whether the session reached its planned duration rather than being ended
   * early. Drives completion rates, streaks and long-break cadence — so a
   * partial must never be counted as a completion anywhere downstream.
   */
  readonly completed: boolean
}

/**
 * Everything that must survive a reload for the timer to resume coherently.
 *
 * `focusCount` lives here rather than on the session because it is *cycle
 * position*, not a property of any one session — but it still has to persist,
 * or the long-break cadence resets every time the tab closes.
 *
 * **It counts focus segments that have run to a conclusion — completed or
 * ended early.** It is the position in the cycle, and the cycle is a rhythm
 * of *focuses run*: every fourth focus is followed by a long break whether it
 * was finished or abandoned. A count of completions cannot drive that
 * rhythm, because a skipped focus leaves the completions and the positions
 * out of step — the count would hand out a second long break in a row, or a
 * long break before anything had been finished.
 *
 * Whether a focus actually reached its plan is a *different* question, and it
 * is answered per session by `FocusSession.completed`. The statistics read
 * the history to answer it; this count answers only "where in the cycle are
 * we". Keeping them apart is what makes both honest: the cadence never
 * excuses a partial, and the record never overstates one.
 */
export interface PersistedTimerState {
  readonly activeSession: FocusSession | null
  readonly focusCount: number
  readonly currentPresetId: string
}
