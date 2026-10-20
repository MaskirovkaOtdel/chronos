import type { FocusSession, PersistedTimerState } from '../session.js'

/** The default preset duration, matching the `focus-25` id the tests use. */
export const FOCUS_25_MIN = 25 * 60 * 1000

/**
 * A `FocusSession` with every field filled in, for tests that only care about
 * the one or two they override.
 *
 * The defaults are a *bare focus session just started*: no pause, nothing
 * accumulated, no label, not ended. That shape is deliberate — a test that says
 * nothing about time is describing a session at `startedAt`, so the common case
 * costs one line and the interesting case costs one override.
 *
 * Why this lives in `@chronos/core/testing` rather than in each test file: it
 * was already duplicated in two of them, and phase 2 adds timer, persistence,
 * stats and bucketing suites that all need the same starting point. One
 * definition also means a new field has one default to reconcile — added to
 * the interface, `makeFocusSession` fails to compile until the default is
 * chosen, instead of silently inheriting `undefined` in half the suites.
 */
export function makeFocusSession(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'sess-1',
    kind: 'focus',
    startedAt: 0,
    pauseStartedAt: null,
    accumulatedPausedMs: 0,
    plannedDurationMs: FOCUS_25_MIN,
    label: null,
    presetId: 'focus-25',
    endedAt: null,
    actualMs: null,
    completed: false,
    ...overrides,
  }
}

/**
 * A mutable view of a readonly type.
 *
 * For tests that deliberately go around `readonly` to prove an implementation
 * defends itself — a caller reaching through a snapshot to rewrite the timer
 * it was only lent. Casting to `{ label: string | null }` would also work, but
 * it throws away the type of the other ten fields with it, so a typo in the
 * cast target passes silently. This keeps them checked.
 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/**
 * A `PersistedTimerState` for tests: idle, nothing run yet, first preset.
 *
 * A test that *has* run something overrides `focusCount`; one that
 * started a segment overrides `activeSession`. Both defaults are honest for a
 * fresh install, which is what every persistence test has to start from anyway.
 */
export function makePersistedTimerState(
  overrides: Partial<PersistedTimerState> = {},
): PersistedTimerState {
  return {
    activeSession: null,
    focusCount: 0,
    currentPresetId: 'focus-25',
    ...overrides,
  }
}
