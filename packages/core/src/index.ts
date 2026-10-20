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
export { createTimer } from './timer.js'
export type { Timer, TimerState, TimerPhase, SegmentSpec, TimerDeps } from './timer.js'

// Ports
export type { Clock } from './clock.js'
export type { SessionRepository, SessionListOptions } from './repository.js'
export type { Notifier, NotificationRequest, NotificationPermissionState } from './notifier.js'
export type { Audio, AudioCue } from './audio.js'
