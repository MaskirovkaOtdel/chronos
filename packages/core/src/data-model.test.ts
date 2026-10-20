import { describe, expect, it } from 'vitest'
import type { FocusSession, PersistedTimerState } from './session.js'

/**
 * The executable half of `docs/DATA-MODEL.md`.
 *
 * Two jobs:
 *
 * 1. Prove the persisted shape survives JSON — which *is* localStorage's
 *    serializer, since it stores strings — without a field being renamed,
 *    dropped, added or coerced. The same object is what Firestore would store,
 *    so a loss here is a loss in both backends.
 * 2. Act as a tripwire between the document and the type. The lists below are
 *    the document's tables written as code. Add a field to `FocusSession` and
 *    `makeSession()` stops compiling, which makes the key set mismatch these
 *    lists, which fails this suite — so the document cannot silently drift.
 *
 * Update `SESSION_FIELDS`, `STATE_FIELDS` and the tables in the document in
 * the same commit.
 */

const SESSION_FIELDS = [
  'accumulatedPausedMs',
  'actualMs',
  'completed',
  'endedAt',
  'id',
  'kind',
  'label',
  'pauseStartedAt',
  'plannedDurationMs',
  'presetId',
  'startedAt',
] as const

const STATE_FIELDS = ['activeSession', 'currentPresetId', 'focusCount'] as const

/** Every nullable field carries a real value, so a dropped field cannot hide. */
function makePopulatedSession(): FocusSession {
  return {
    id: 'sess-1',
    kind: 'long_break',
    startedAt: 1_781_000_000_000,
    pauseStartedAt: 1_781_000_060_000,
    accumulatedPausedMs: 60_000,
    plannedDurationMs: 15 * 60 * 1000,
    label: 'Deep work',
    presetId: 'long-break-15',
    endedAt: 1_781_000_900_000,
    actualMs: 840_000,
    completed: true,
  }
}

/** The other extreme: every nullable field empty, as it is while live. */
function makeLiveSession(): FocusSession {
  return {
    id: 'sess-2',
    kind: 'focus',
    startedAt: 1_781_100_000_000,
    pauseStartedAt: null,
    accumulatedPausedMs: 0,
    plannedDurationMs: 25 * 60 * 1000,
    label: null,
    presetId: 'focus-25',
    endedAt: null,
    actualMs: null,
    completed: false,
  }
}

/** localStorage's serializer: stringify on write, parse on read. */
function stored(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

describe('persisted shape — the 1:1 mapping with docs/DATA-MODEL.md', () => {
  it('documents exactly the fields FocusSession declares', () => {
    expect(Object.keys(makePopulatedSession()).sort()).toEqual(SESSION_FIELDS)
    expect(Object.keys(makeLiveSession()).sort()).toEqual(SESSION_FIELDS)
  })

  it('documents exactly the fields PersistedTimerState declares', () => {
    const state: PersistedTimerState = {
      activeSession: makePopulatedSession(),
      focusCount: 3,
      currentPresetId: 'focus-25',
    }
    expect(Object.keys(state).sort()).toEqual(STATE_FIELDS)
  })

  it('round-trips a fully populated session with nothing renamed or coerced', () => {
    const session = makePopulatedSession()
    const roundTripped = stored(session) as FocusSession

    expect(roundTripped).toEqual(session)
    expect(Object.keys(roundTripped).sort()).toEqual(SESSION_FIELDS)
  })

  it('round-trips a live session, where half the fields are null', () => {
    const session = makeLiveSession()
    const roundTripped = stored(session) as FocusSession

    expect(roundTripped).toEqual(session)
    expect(Object.keys(roundTripped).sort()).toEqual(SESSION_FIELDS)
  })

  it('keeps null as an explicit field instead of deleting the key', () => {
    const roundTripped = stored(makeLiveSession()) as Record<string, unknown>

    for (const field of ['label', 'pauseStartedAt', 'endedAt', 'actualMs']) {
      // Presence is the point: a missing key fails the type, a null does not.
      expect(roundTripped).toHaveProperty(field)
      expect(roundTripped[field]).toBeNull()
    }
  })

  it('round-trips PersistedTimerState with its nested session intact', () => {
    const state: PersistedTimerState = {
      activeSession: makeLiveSession(),
      focusCount: 2,
      currentPresetId: 'focus-25',
    }

    const roundTripped = stored(state) as PersistedTimerState

    expect(roundTripped).toEqual(state)
    expect(roundTripped.activeSession).toEqual(state.activeSession)
    expect(roundTripped.activeSession && Object.keys(roundTripped.activeSession).sort()).toEqual(
      SESSION_FIELDS,
    )
  })

  it('round-trips the versioned envelope both backends store', () => {
    const envelope = { schemaVersion: 1, ...makePopulatedSession() }

    expect(stored(envelope)).toEqual(envelope)
    expect(Object.keys(stored(envelope) as object).sort()).toEqual(
      [...SESSION_FIELDS, 'schemaVersion'].sort(),
    )
  })

  it('round-trips the active slot with its envelope', () => {
    const envelope = {
      schemaVersion: 1,
      activeSession: makeLiveSession(),
      focusCount: 4,
      currentPresetId: 'focus-25',
    }

    expect(stored(envelope)).toEqual(envelope)
    expect(Object.keys(stored(envelope) as object).sort()).toEqual(
      [...STATE_FIELDS, 'schemaVersion'].sort(),
    )
  })
})

/**
 * These pin *why* the schema's rules are what they are. Without them the
 * document asserts an invariant and nothing stops the next change from
 * quietly violating it.
 */
describe('type-fidelity hazards the schema rules exist to prevent', () => {
  it('cannot represent NaN, which is why every persisted number must be finite', () => {
    // `actualMs: null` is *legal*, so JSON's substitution is undetectable on
    // read — the value silently changes meaning rather than erroring.
    expect(stored({ actualMs: Number.NaN })).toEqual({ actualMs: null })
    expect(stored({ actualMs: Number.POSITIVE_INFINITY })).toEqual({ actualMs: null })
  })

  it('drops undefined keys, which is why nullable fields are `| null` and never optional', () => {
    // If these were typed `label?: string` instead of `label: string | null`,
    // an unset label would vanish and the type would still promise a string.
    expect(stored({ label: undefined })).toEqual({})
    expect(stored({ label: null })).toEqual({ label: null })
  })

  it('holds no non-finite number in a canonical fixture', () => {
    const session = makePopulatedSession()
    const numbers = Object.values(session).filter(
      (value): value is number => typeof value === 'number',
    )

    expect(numbers.length).toBeGreaterThan(0)
    for (const value of numbers) expect(Number.isFinite(value)).toBe(true)
  })
})
