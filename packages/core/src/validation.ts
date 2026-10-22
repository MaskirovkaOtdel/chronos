import type { FocusSession, PersistedTimerState, SegmentKind } from './session.js'

/**
 * Field-level validation for deserialized records — phase 4A day 2.
 *
 * Three layers of distrust now exist, and each guards a different door:
 *
 * 1. **`restore()`'s finite checks** (timer.ts) — the *live* surface. They
 *    stop a corrupt active session from becoming a `NaN` countdown. They run
 *    even when no deserialization happened, because any caller may construct
 *    state by hand.
 * 2. **This module** — the *record* surface. `isFocusSession` and
 *    `isPersistedTimerState` say what a well-formed record is, field by
 *    field, including the fields `restore()` never looks at: `kind`, `label`,
 *    `completed`, `endedAt`, `actualMs`, and every field of every **history**
 *    session — which flows straight into the statistics (day keys, streaks,
 *    ribbon) where a `NaN` `startedAt` would corrupt silently rather than
 *    visibly.
 * 3. **The envelope check** (the adapters) — `schemaVersion`, deciding which
 *    generation a record belongs to before either layer above runs.
 *
 * Lives in core because it is pure — a type guard reaches for nothing — and
 * because the adapters that need it are two: localStorage now, Firestore in
 * phase 5. Two copies of "what a session is" is how the backends start
 * disagreeing about which records are real.
 *
 * The rule these encode is the data model's own: **every nullable field is
 * `| null`, never optional.** JSON drops `undefined` keys on write, so an
 * optional field would vanish from the stored record and reappear at read
 * time as `undefined` where the type promises a value. A record missing a
 * field is therefore *damaged*, not defaulted — silently defaulting is how a
 * dropped number becomes a plausible zero.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isSegmentKind(value: unknown): value is SegmentKind {
  return value === 'focus' || value === 'short_break' || value === 'long_break'
}

/** Whether `value` is a well-formed `FocusSession` as the data model defines one. */
export function isFocusSession(value: unknown): value is FocusSession {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record['id'] === 'string' &&
    isSegmentKind(record['kind']) &&
    isFiniteNumber(record['startedAt']) &&
    isNullableFiniteNumber(record['pauseStartedAt']) &&
    isFiniteNumber(record['accumulatedPausedMs']) &&
    // Positive, not merely finite: the engine refuses to *start* a segment
    // with a non-positive plan, so a stored zero or negative duration was
    // never written by this app — reading it as a real plan would make the
    // overrun detector fire on the first millisecond.
    isFiniteNumber(record['plannedDurationMs']) &&
    record['plannedDurationMs'] > 0 &&
    isNullableString(record['label']) &&
    typeof record['presetId'] === 'string' &&
    isNullableFiniteNumber(record['endedAt']) &&
    isNullableFiniteNumber(record['actualMs']) &&
    typeof record['completed'] === 'boolean'
  )
}

/** Whether `value` is a well-formed `PersistedTimerState`. */
export function isPersistedTimerState(value: unknown): value is PersistedTimerState {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    (record['activeSession'] === null || isFocusSession(record['activeSession'])) &&
    // Integer, not merely finite: `focusCount` counts focus segments that
    // have run to a conclusion, and the engine only ever writes integers. A
    // fractional count was hand-edited or corrupted, and `2.5 % 4` is a cycle
    // position no rhythm can be built on. `Number.isInteger` rejects NaN and
    // the infinities too, so no separate finiteness check is needed.
    Number.isInteger(record['focusCount']) &&
    typeof record['currentPresetId'] === 'string'
  )
}
