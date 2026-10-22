// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { describeSessionRepositoryContract } from '@chronos/core/testing'
import { makeFocusSession, makePersistedTimerState } from '@chronos/core/testing'
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

  it('treats a record from another schema generation as absent', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    // What a v2 build might leave behind. This build must not misread it as
    // v1 — the per-record version exists precisely so the answer to "what is
    // this?" is decided at read time, per record.
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
  })

  it('treats a corrupt value as absent rather than failing the read', async () => {
    const repo = new LocalSessionRepository(window.localStorage)
    window.localStorage.clear()

    // localStorage validates nothing at all (DATA-MODEL.md §type fidelity).
    // One truncated key — a write interrupted, a user in devtools — must not
    // take the whole app down with it.
    window.localStorage.setItem('chronos:active', '{"schemaVersion":1,"acti')
    window.localStorage.setItem('chronos:session:broken', 'not json at all')

    expect(await repo.loadState()).toBeNull()
    expect(await repo.list()).toEqual([])
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
