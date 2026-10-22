import { describe, expect, it } from 'vitest'
import { isFocusSession, isPersistedTimerState } from './validation.js'
import { makeFocusSession, makePersistedTimerState } from './testing/fixtures.js'
import type { Mutable } from './testing/fixtures.js'
import type { FocusSession } from './session.js'

/**
 * The record-shape guards — phase 4A day 2.
 *
 * These pin what `docs/DATA-MODEL.md` calls the deserialization boundary:
 * "localStorage validates nothing at all", so something has to. Each test
 * below is one row of the data model's hazard table made executable — the
 * silent type changes JSON is capable of (`NaN` → `null`, `undefined` →
 * key dropped, a string where a number belongs) and the shape rules that
 * keep the statistics pipeline honest.
 *
 * The last describe is the tripwire's counterpart: the guards must accept
 * everything the engine itself produces. A guard that rejects a session the
 * timer can create is not stricter, it is wrong — and the shared fixtures
 * are the engine's own output shape.
 */
describe('isFocusSession', () => {
  it('accepts a fully-populated session', () => {
    expect(isFocusSession(makeFocusSession({ id: 'sess-1' }))).toBe(true)
  })

  it('accepts a session with every nullable field null', () => {
    expect(
      isFocusSession(
        makeFocusSession({
          id: 'sess-1',
          pauseStartedAt: null,
          label: null,
          endedAt: null,
          actualMs: null,
        }),
      ),
    ).toBe(true)
  })

  describe('rejects — one test per hazard the data model names', () => {
    const reject = (value: unknown) => expect(isFocusSession(value)).toBe(false)

    it('a non-object', () => {
      reject(null)
      reject(undefined)
      reject('sess-1')
      reject(42)
      reject([])
    })

    it('a missing field — JSON drops `undefined` keys, so absent is damaged, not defaultable', () => {
      const { label: _dropped, ...withoutLabel } = makeFocusSession({ id: 'sess-1' })
      reject(withoutLabel)
      const { startedAt: _dropped2, ...withoutStart } = makeFocusSession({ id: 'sess-1' })
      reject(withoutStart)
    })

    it('NaN — which JSON serialized to `null`, so a number arrived wearing null’s clothes', () => {
      // The hazard verbatim: `JSON.stringify({ n: NaN })` is `{"n":null}`.
      const roundTripped: unknown = JSON.parse(
        JSON.stringify({ ...makeFocusSession({ id: 's' }), startedAt: NaN }),
      )
      reject(roundTripped)
    })

    it('Infinity held in a nullable field — null and Infinity are not the same value', () => {
      // Not round-tripped, deliberately: a nullable field *may* be null, so the
      // guard must still reject the raw non-finite number. This is the in-memory
      // hazard — a caller (or a future backend) constructing a record by hand.
      reject({ ...makeFocusSession({ id: 's' }), actualMs: Infinity })
      reject({ ...makeFocusSession({ id: 's' }), pauseStartedAt: -Infinity })
    })

    it('Infinity in a required field — JSON serialized it to null, and a number arrived as null', () => {
      // The disguise hazard, verbatim: `JSON.stringify({ n: Infinity })` is
      // `{"n":null}`. On a *required* number field that null cannot be legal,
      // so the boundary catches it. On a nullable field the round-trip is
      // undistinguishable from absent-by-design — accepted, because the engine
      // never writes non-finite numbers and `restore()` distrusts the live
      // surface anyway (timer.ts `isUsable`).
      const roundTripped: unknown = JSON.parse(
        JSON.stringify({ ...makeFocusSession({ id: 's' }), startedAt: Infinity }),
      )
      reject(roundTripped)
    })

    it('a string where a number belongs — `>` compares false against everything', () => {
      reject({ ...makeFocusSession({ id: 's' }), startedAt: '1760000000000' })
    })

    it('an unknown kind — a string the enum does not contain', () => {
      reject({ ...makeFocusSession({ id: 's' }), kind: 'break' })
    })

    it('a non-positive planned duration — the engine never starts such a segment', () => {
      reject({ ...makeFocusSession({ id: 's' }), plannedDurationMs: 0 })
      reject({ ...makeFocusSession({ id: 's' }), plannedDurationMs: -25 })
    })

    it('a nullable field holding undefined — `| null` means exactly null', () => {
      reject({ ...makeFocusSession({ id: 's' }), label: undefined })
      reject({ ...makeFocusSession({ id: 's' }), endedAt: undefined })
      reject({ ...makeFocusSession({ id: 's' }), pauseStartedAt: undefined })
    })

    it('a non-boolean completed — the partial/completion line must not be guessable', () => {
      reject({ ...makeFocusSession({ id: 's' }), completed: 'true' })
      reject({ ...makeFocusSession({ id: 's' }), completed: 1 })
    })

    it('a non-string id or presetId', () => {
      reject({ ...makeFocusSession({ id: 's' }), id: 7 })
      reject({ ...makeFocusSession({ id: 's' }), presetId: null })
    })
  })
})

describe('isPersistedTimerState', () => {
  it('accepts the state the engine persists', () => {
    const session = makeFocusSession({ id: 'sess-1' })
    expect(isPersistedTimerState(makePersistedTimerState({ activeSession: session }))).toBe(true)
  })

  it('accepts the idle-with-cycle-position document', () => {
    expect(isPersistedTimerState(makePersistedTimerState({ activeSession: null }))).toBe(true)
  })

  it('rejects a state whose active session is malformed', () => {
    const state = makePersistedTimerState({ activeSession: makeFocusSession({ id: 's' }) })
    rejectState({ ...state, activeSession: { ...state.activeSession, startedAt: 'no' } })
  })

  it('rejects a fractional focusCount — 2.5 % 4 is a cycle position no rhythm can use', () => {
    rejectState(makePersistedTimerState({ focusCount: 2.5 }))
  })

  it('rejects a NaN focusCount — integer-checking rejects it before modulo ever sees it', () => {
    rejectState(makePersistedTimerState({ focusCount: NaN }))
  })

  it('rejects a missing currentPresetId', () => {
    const { currentPresetId: _dropped, ...rest } = makePersistedTimerState({})
    rejectState(rest)
  })

  it('rejects a non-object', () => {
    rejectState(null)
    rejectState('{"focusCount":1}')
    rejectState([])
  })
})

function rejectState(value: unknown): void {
  expect(isPersistedTimerState(value)).toBe(false)
}

/**
 * The guards must accept the engine's own output — the direction that keeps
 * them honest. `Mutable` is deliberate: a fixture is not a security boundary,
 * and these assertions are about the guards, not about TypeScript.
 */
describe('the guards accept what the engine produces', () => {
  it('every session the fixtures can build', () => {
    const kinds: FocusSession['kind'][] = ['focus', 'short_break', 'long_break']
    for (const kind of kinds) {
      const session = makeFocusSession({ id: 'sess-1', kind })
      expect(isFocusSession(session)).toBe(true)
      expect(isPersistedTimerState(makePersistedTimerState({ activeSession: session }))).toBe(true)
    }
  })

  it('a session walked through every nullable field at once', () => {
    const session: Mutable<FocusSession> = {
      ...makeFocusSession({ id: 'sess-1' }),
      pauseStartedAt: 2_000,
      label: 'deep work',
      endedAt: 26_000,
      actualMs: 25_000,
    }
    expect(isFocusSession(session)).toBe(true)
  })
})
