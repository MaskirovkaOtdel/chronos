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

  /** Actual elapsed time, excluding pause time. Null until the session ends. */
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
 * `completedFocusCount` lives here rather than on the session because it is
 * *cycle* position, not a property of any one session — but it still has to
 * persist, or the long-break cadence resets every time the tab closes.
 */
export interface PersistedTimerState {
  readonly activeSession: FocusSession | null
  readonly completedFocusCount: number
  readonly currentPresetId: string
}
