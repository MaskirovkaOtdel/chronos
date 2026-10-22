// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createTimer } from '@chronos/core'
import { describeSessionRepositoryContract } from '@chronos/core/testing'
import {
  FakeNotifier,
  FOCUS_25_MIN,
  ManualClock,
  makeFocusSession,
  makePersistedTimerState,
} from '@chronos/core/testing'
import { LocalSessionRepository } from './LocalSessionRepository'

/**
 * The same contract core runs against the in-memory double, run against the
 * real localStorage adapter — phase 4A day 1.
 *
 * This is the claim that makes the double trustworthy in both directions: if
 * both implementations pass one suite, the suite describes the *interface*,
 * and every core test that leaned on `InMemorySessionRepository` was testing
 * the contract rather than the double's habits.
 *
 * The factory clears storage before each test: jsdom's `localStorage` persists
 * for the whole file, and a suite that leaks state between tests passes for
 * the wrong reason.
 */
describeSessionRepositoryContract('LocalSessionRepository', () => {
  window.localStorage.clear()
  return new LocalSessionRepository(window.localStorage)
})

/**
 * The contract cannot see the *storage layout* — it treats the repository as
 * a black box, which is its job. These tests look inside, and pin the parts
 * `docs/DATA-MODEL.md` designed in phase 1: the prefix, the envelope, and the
 * one-key-per-session mapping that keeps the localStorage and Firestore
 * backends 1:1.
 */
describe('LocalSessionRepository — the designed storage layout', () => {
  it('writes the active document under the chronos:active key', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    await repo.saveState(makePersistedTimerState({ focusCount: 2 }))

    const raw = window.localStorage.getItem('chronos:active')
    expect(raw).not.toBeNull()
    const record = JSON.parse(raw ?? '') as Record<string, unknown>
    expect(record['schemaVersion']).toBe(1)
    expect(record['focusCount']).toBe(2)
  })

  it('writes one key per session, prefixed chronos:session:', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    await repo.put(makeFocusSession({ id: 'sess-1' }))
    await repo.put(makeFocusSession({ id: 'sess-2' }))

    expect(window.localStorage.getItem('chronos:session:sess-1')).not.toBeNull()
    expect(window.localStorage.getItem('chronos:session:sess-2')).not.toBeNull()
    expect(window.localStorage.length).toBe(2)
  })

  it('ignores keys outside its two spaces when listing', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    // A foreign key under the same origin — another app's data, or a future
    // chronos space (settings, phase 4E). The prefix scan must not treat it
    // as a session.
    window.localStorage.setItem('chronos:settings', '{"schemaVersion":1}')
    window.localStorage.setItem('someone-else', 'untouched')
    await repo.put(makeFocusSession({ id: 'sess-1', startedAt: 100 }))

    const sessions = await repo.list()
    expect(sessions.map((s) => s.id)).toEqual(['sess-1'])
  })

  it('treats a record from another schema generation as absent — and says so distinctly', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    // What a v2 build might leave behind. This build must not misread it as
    // v1 — the per-record version exists precisely so the answer to "what is
    // this?" is decided at read time, per record. And the verdict is *not*
    // "damaged": the data is fine, this build just cannot read it. The two
    // reasons exist so the UI can say different things about them.
    window.localStorage.setItem(
      'chronos:active',
      JSON.stringify({ schemaVersion: 2, activeSession: null, focusCount: 99 }),
    )
    window.localStorage.setItem(
      'chronos:session:future',
      JSON.stringify({ schemaVersion: 2, id: 'future', startedAt: 1 }),
    )

    expect(await repo.loadState()).toBeNull()
    expect(await repo.list()).toEqual([])
    expect(repo.skipped()).toEqual([
      { key: 'chronos:active', reason: 'unrecognized-version' },
      { key: 'chronos:session:future', reason: 'unrecognized-version' },
    ])
  })

  it('treats a corrupt value as absent rather than failing the read — and records the damage', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    // localStorage validates nothing at all (DATA-MODEL.md §type fidelity).
    // One truncated key — a write interrupted, a user in devtools — must not
    // take the whole app down with it. But skipping it silently would lose
    // the user's data twice: first to the corruption, then to the
    // not-knowing. So the read degrades and the damage is recorded for the
    // UI to surface (the surfacing itself is day 4's binding).
    window.localStorage.setItem('chronos:active', '{"schemaVersion":1,"acti')
    window.localStorage.setItem('chronos:session:broken', 'not json at all')

    expect(await repo.loadState()).toBeNull()
    expect(await repo.list()).toEqual([])
    expect(repo.skipped()).toEqual([
      { key: 'chronos:active', reason: 'damaged' },
      { key: 'chronos:session:broken', reason: 'damaged' },
    ])
  })

  it('never mutates what it is given — the write is a serialization, not an adoption', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    const session = makeFocusSession({ id: 'sess-1', label: null })
    await repo.put(session)
    await repo.saveState(makePersistedTimerState({ activeSession: session }))

    // The stored copy was serialized at write time; the caller's object is
    // still its own. (Mutation afterwards must not reach storage — the
    // contract suite pins the read side of this; this pins the write side.)
    const stored = window.localStorage.getItem('chronos:session:sess-1')
    expect(JSON.parse(stored ?? '')).toEqual({ schemaVersion: 1, ...session })
  })
})

/**
 * Field-level validation — phase 4A day 2, where `restore()` leaves off.
 *
 * The envelope only says a record *claims* to be v1. These tests pin the
 * second line of distrust: every field's type and finiteness, checked where
 * the bytes become domain types — because that is the only place the silent
 * type-changes JSON is capable of can be caught (a NaN became null on the way
 * through, an undefined key simply vanished, a string compares false against
 * everything).
 *
 * The distinction these protect: a v1 record with broken fields is **ours and
 * hurt** (`damaged`), never mistaken for foreign, and never mistaken for
 * absent without a trace.
 */
describe('LocalSessionRepository — field-level validation', () => {
  it('skips a v1 session whose numbers were nulled by serialization — and records it as damaged', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    // The hazard verbatim: `JSON.stringify({ n: NaN })` is `{"n":null}`. A
    // completed session whose actualMs was NaN arrives looking live, and a
    // live one whose startedAt was NaN would countdown from null.
    window.localStorage.setItem(
      'chronos:session:nan',
      JSON.stringify({ schemaVersion: 1, ...makeFocusSession({ id: 'nan' }), startedAt: null }),
    )
    window.localStorage.setItem(
      'chronos:session:good',
      JSON.stringify({ schemaVersion: 1, ...makeFocusSession({ id: 'good', startedAt: 100 }) }),
    )

    // One hurt record must not take the history down with it — the one-key-
    // per-session layout exists for exactly this.
    expect((await repo.list()).map((s) => s.id)).toEqual(['good'])
    expect(repo.skipped()).toEqual([{ key: 'chronos:session:nan', reason: 'damaged' }])
  })

  it('skips a v1 session missing a field — JSON drops undefined keys, so absent is damage, not a default', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    const { label: _dropped, ...withoutLabel } = makeFocusSession({ id: 'sess-1' })
    window.localStorage.setItem(
      'chronos:session:sess-1',
      JSON.stringify({ schemaVersion: 1, ...withoutLabel }),
    )

    expect(await repo.list()).toEqual([])
    expect(repo.skipped()).toEqual([{ key: 'chronos:session:sess-1', reason: 'damaged' }])
  })

  it('skips a version-less record as damaged, not foreign — no generation of this app wrote one', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    // A record under our keys carrying every field but the envelope. Nothing
    // a newer build writes looks like this — newer builds stamp `2` — so this
    // is ours, mangled, and the verdict must not accuse a version that does
    // not exist of having written it.
    window.localStorage.setItem('chronos:session:nameless', JSON.stringify(makeFocusSession()))

    expect(await repo.list()).toEqual([])
    expect(repo.skipped()).toEqual([{ key: 'chronos:session:nameless', reason: 'damaged' }])
  })

  it('skips a v1 session whose kind is not one of the three', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    window.localStorage.setItem(
      'chronos:session:kind',
      JSON.stringify({ schemaVersion: 1, ...makeFocusSession({ id: 'kind' }), kind: 'break' }),
    )

    expect(await repo.list()).toEqual([])
    expect(repo.skipped()).toEqual([{ key: 'chronos:session:kind', reason: 'damaged' }])
  })

  it('rejects a v1 active document with a fractional focusCount — 2.5 % 4 is no cycle position', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    window.localStorage.setItem(
      'chronos:active',
      JSON.stringify({ schemaVersion: 1, ...makePersistedTimerState({ focusCount: 2.5 }) }),
    )

    expect(await repo.loadState()).toBeNull()
    expect(repo.skipped()).toEqual([{ key: 'chronos:active', reason: 'damaged' }])
  })

  it('rejects a v1 active document whose active session has broken fields — ours, and hurt', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    const session = { ...makeFocusSession({ id: 'sess-1' }), plannedDurationMs: 0 }
    window.localStorage.setItem(
      'chronos:active',
      JSON.stringify({ schemaVersion: 1, ...makePersistedTimerState({ activeSession: session }) }),
    )

    expect(await repo.loadState()).toBeNull()
    expect(repo.skipped()).toEqual([{ key: 'chronos:active', reason: 'damaged' }])
  })

  it('records a damaged key once, however many times it is re-read', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    window.localStorage.setItem('chronos:session:sess-1', 'not json')

    // list() runs on every history render — the report must not grow with
    // the number of renders.
    await repo.list()
    await repo.list()
    await repo.list()

    expect(repo.skipped()).toEqual([{ key: 'chronos:session:sess-1', reason: 'damaged' }])
  })

  it('forgives a key that is read cleanly later — the list reports the present, not the past', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    window.localStorage.setItem('chronos:session:sess-1', 'not json')
    await repo.list()
    expect(repo.skipped()).toHaveLength(1)

    // A restored backup, a newer build rewriting in place, the same id
    // re-filed — whatever the cause, the record reads now, so the complaint
    // is stale and must drop.
    await repo.put(makeFocusSession({ id: 'sess-1' }))
    expect(repo.skipped()).toEqual([])
    expect((await repo.list()).map((s) => s.id)).toEqual(['sess-1'])
  })

  it('forgives the active key when a fresh document is written over the damaged one', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    window.localStorage.setItem('chronos:active', 'not json')
    await repo.loadState()
    expect(repo.skipped()).toHaveLength(1)

    await repo.saveState(makePersistedTimerState({}))
    expect(repo.skipped()).toEqual([])
    expect(await repo.loadState()).not.toBeNull()
  })

  it('never reports foreign keys — another app’s data was never ours to read', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    window.localStorage.setItem('someone-else', 'not json at all')
    window.localStorage.setItem('chronos:settings', 'also not json')
    await repo.put(makeFocusSession({ id: 'sess-1' }))
    await repo.list()

    expect(repo.skipped()).toEqual([])
  })
})

/**
 * A full disk — phase 4A day 2.
 *
 * `Storage` is a constructor argument precisely so a refusing one can be
 * injected: jsdom's `localStorage` does not enforce the ~5 MB per-origin
 * quota, so the failure is simulated with the shape the platform actually
 * raises — a `DOMException` named `QuotaExceededError`.
 *
 * What these pin, in order of importance:
 *
 * 1. **The error propagates.** No catch anywhere between `setItem` and the
 *    caller. The verb rejects; the UI learns the write did not land.
 * 2. **The stored document is untouched.** `setItem` is atomic by
 *    specification — a failed write leaves the previous value, never half a
 *    document.
 * 3. **The engine does not roll back.** The timer mutates then persists, so
 *    a rejected write leaves the transition done in memory and the error with
 *    the caller. That is deliberate: the user's running session is more
 *    important than the write, and rolling back a `start()` would make their
 *    timer vanish because the disk is full.
 * 4. **The next successful write re-converges.** Whole-document writes mean
 *    storage catches up with memory on the next transition, and the
 *    divergence is announced the whole time it lasts.
 */
describe('LocalSessionRepository — a full disk', () => {
  it('propagates the quota error from saveState — the verb rejects, loudly', async () => {
    const storage = new RefusingStorage()
    const repo = new LocalSessionRepository(storage)

    storage.refuseWrites = true
    await expect(repo.saveState(makePersistedTimerState({}))).rejects.toThrow(
      /quota has been exceeded/i,
    )
  })

  it('propagates the quota error from put — a session that cannot be filed says so', async () => {
    const storage = new RefusingStorage()
    const repo = new LocalSessionRepository(storage)

    storage.refuseWrites = true
    await expect(repo.put(makeFocusSession({ id: 'sess-1' }))).rejects.toThrow(
      /quota has been exceeded/i,
    )
  })

  it('leaves the previously stored document intact after a failed write — never half a document', async () => {
    const storage = new RefusingStorage()
    const repo = new LocalSessionRepository(storage)

    const before = makePersistedTimerState({ focusCount: 2 })
    await repo.saveState(before)

    storage.refuseWrites = true
    await expect(repo.saveState(makePersistedTimerState({ focusCount: 3 }))).rejects.toThrow()

    // The write failed whole — `setItem` is atomic by specification, and the
    // last good document is what a reload would restore.
    storage.refuseWrites = false
    expect((await repo.loadState())?.focusCount).toBe(2)
  })

  it('engine integration — start() rejects, the session keeps running in memory, storage re-converges', async () => {
    const storage = new RefusingStorage()
    const repo = new LocalSessionRepository(storage)
    const clock = new ManualClock(1_000)
    const timer = createTimer({ clock, repository: repo, notifier: new FakeNotifier() })

    // The disk fills up mid-session.
    storage.refuseWrites = true
    await expect(timer.start({ id: 's1', presetId: 'focus-25' })).rejects.toThrow()

    // The transition happened and the failure was announced — not rolled
    // back. The user's timer keeps running; what they were told is that it
    // is not being saved.
    expect(timer.getState().phase).toBe('running')
    expect(timer.getState().session?.id).toBe('s1')
    expect(storage.getItem('chronos:active')).toBeNull()

    // Space is freed; the next transition writes the whole document, and
    // storage catches up with memory in one atomic step.
    storage.refuseWrites = false
    clock.advance(60_000)
    await timer.pause()

    const stored = await repo.loadState()
    expect(stored?.activeSession?.id).toBe('s1')
    expect(stored?.activeSession?.pauseStartedAt).toBe(61_000)
    expect(stored?.focusCount).toBe(0)
    expect(timer.getState().phase).toBe('paused')
  })

  it('engine integration — a completed segment whose history write fails is loud, and restart recovers it', async () => {
    const storage = new RefusingStorage()
    const repo = new LocalSessionRepository(storage)
    const clock = new ManualClock(1_000)
    const timer = createTimer({ clock, repository: repo, notifier: new FakeNotifier() })

    await timer.start({ id: 's1', presetId: 'focus-25' })
    const before = storage.getItem('chronos:active')

    // The segment reaches its plan while the disk is full. `finish()` has
    // already ended it in memory; the history write then fails, so the verb
    // rejects. The finished segment is not resurrected — the write failure
    // does not put a concluded session back on the clock.
    clock.advance(FOCUS_25_MIN + 60_000)
    storage.refuseWrites = true
    await expect(timer.tick()).rejects.toThrow()
    expect(timer.getState().phase).toBe('idle')

    // The active document was not touched by the failed transition — it still
    // carries the running session, which is what makes the loss recoverable
    // rather than silent. `setItem` is atomic: a failed write leaves the
    // previous value, never half a document.
    expect(storage.getItem('chronos:active')).toBe(before)

    // Recovery, end to end: a fresh timer restores that document, sees a
    // session past its plan, and reconciles it as completed-while-away —
    // filed in history, cycle advanced, timer idle. The write failure cost a
    // notification, not a session.
    storage.refuseWrites = false
    const restarted = createTimer({
      clock,
      repository: new LocalSessionRepository(storage),
      notifier: new FakeNotifier(),
    })
    const outcome = await restarted.restore(await new LocalSessionRepository(storage).loadState())

    expect(outcome.completedWhileAway?.id).toBe('s1')
    expect(outcome.completedWhileAway?.completed).toBe(true)
    expect(restarted.getState().phase).toBe('idle')
    expect(restarted.getState().focusCount).toBe(1)

    const history = await new LocalSessionRepository(storage).list()
    expect(history.map((s) => s.id)).toEqual(['s1'])
  })
})

/**
 * A `Storage` that can be told to refuse writes, raising the same
 * `DOMException` the platform raises when the ~5 MB per-origin quota is hit.
 *
 * jsdom's `localStorage` does not enforce the quota, so the failure mode has
 * to be simulated — and it is simulated with the real shape rather than a
 * generic `Error`, because the platform's error carries the name
 * `QuotaExceededError` and a future adapter is allowed to tell quota failures
 * from other write failures by that name.
 *
 * Reads keep working while writes refuse: a full disk is a *write* problem,
 * and the adapter's reads must degrade independently of it.
 */
class RefusingStorage implements Storage {
  readonly #data = new Map<string, string>()
  refuseWrites = false

  get length(): number {
    return this.#data.size
  }

  key(index: number): string | null {
    return [...this.#data.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.#data.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.refuseWrites) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    this.#data.set(key, value)
  }

  removeItem(key: string): void {
    this.#data.delete(key)
  }

  clear(): void {
    this.#data.clear()
  }
}
