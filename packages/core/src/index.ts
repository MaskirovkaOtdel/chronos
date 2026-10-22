/**
 * `@chronos/core` — domain logic and port contracts.
 *
 * Core is pure: it never reaches for React, `localStorage` or `fetch` — each
 * platform supplies an adapter behind one of the ports below. That rule is
 * about *sources* rather than about types, which is why the exports are
 * either types, pure functions (`elapsedMs`), or factories that take their
 * impurity as arguments (`createTimer({ clock, repository, notifier })`).
 *
 * Test doubles live behind `@chronos/core/testing` so they cannot reach a
 * production bundle.
 */

// Domain
export type { SegmentKind, FocusSession, PersistedTimerState } from './session.js'
export { elapsedMs } from './elapsed.js'
export { createTimer, RESUME_GRACE_MS } from './timer.js'
export type {
  Timer,
  TimerState,
  TimerPhase,
  SegmentSpec,
  TimerDeps,
  RestoreOutcome,
} from './timer.js'
export { PRESETS, FOCUS_25, SHORT_BREAK, LONG_BREAK, findPreset } from './presets.js'
export type { Preset, FocusPreset, BreakPreset, AnyPreset } from './presets.js'
export { nextSegmentAfterFinish } from './cycle.js'
export type { NextSegment } from './cycle.js'
export { isFocusSession, isPersistedTimerState } from './validation.js'
export {
  notificationFor,
  shouldAskForPermission,
  SESSION_NOTIFICATION_TAG,
  EXTEND_FIVE_MINUTES,
  SKIP_TO_BREAK,
} from './notifications.js'
export type { NotificationContext } from './notifications.js'

// Statistics
export {
  dayKey,
  hourOfDay,
  dayFraction,
  dayLengthMs,
  summary,
  streaks,
  ribbonForDay,
} from './stats/index.js'
export type { StatsSummary, StreakInfo, RibbonSegment } from './stats/index.js'

// Ports
export type { Clock } from './clock.js'
export type { SessionRepository, SessionListOptions } from './repository.js'
export type { Notifier, NotificationRequest, NotificationPermissionState } from './notifier.js'
export type { Audio, AudioCue } from './audio.js'
