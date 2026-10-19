/**
 * `@chronos/core` — domain logic and port contracts.
 *
 * Everything exported here is a type. Core has no runtime behaviour of its own
 * yet, and what it does gain later still must not import React, `localStorage`
 * or `fetch` — each platform supplies an adapter instead.
 *
 * Test doubles live behind `@chronos/core/testing` so they cannot reach a
 * production bundle.
 */

// Domain
export type { SegmentKind, FocusSession, PersistedTimerState } from './session.js'
export { elapsedMs } from './elapsed.js'

// Ports
export type { Clock } from './clock.js'
export type { SessionRepository, SessionListOptions } from './repository.js'
export type { Notifier, NotificationRequest, NotificationPermissionState } from './notifier.js'
export type { Audio, AudioCue } from './audio.js'
