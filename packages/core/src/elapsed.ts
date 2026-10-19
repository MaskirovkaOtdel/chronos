import type { FocusSession } from './session.js'

/**
 * Active time elapsed for `session` at instant `nowMs`, in milliseconds.
 *
 * Time spent paused is subtracted twice over in the naive reading of this —
 * once as accumulated pauses that have already closed, and once as the pause
 * currently in progress — so both terms are needed:
 *
 * ```
 * elapsed = now − startedAt − accumulatedPausedMs − (current pause tail)
 * ```
 *
 * The result is floored at **0** (invariant: *elapsed is never negative*).
 * A clock that jumps backwards, or a `nowMs` earlier than `startedAt`, is a
 * real occurrence — timezone changes and manual clock adjustment both do it —
 * and a negative bar on screen is the visible symptom of letting it through.
 *
 * Deliberately **not** capped at `plannedDurationMs` here. Overrun is a
 * distinct domain event: the engine detects it, auto-completes the segment and
 * decides what `actualMs` should record. Clamping inside the formula would
 * erase the very signal that detects it.
 *
 * Pure: no `Clock` of its own. Tests drive it with a `ManualClock` so a week of
 * paused time costs a microsecond.
 */
export function elapsedMs(session: FocusSession, nowMs: number): number {
  const pausedNow = session.pauseStartedAt === null ? 0 : nowMs - session.pauseStartedAt

  const elapsed = nowMs - session.startedAt - session.accumulatedPausedMs - pausedNow

  return elapsed < 0 ? 0 : elapsed
}
