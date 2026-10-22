import { describe, expect, it } from 'vitest'
import type { FocusSession } from '../session.js'
import type { SessionRepository } from '../repository.js'
import { makeFocusSession, makePersistedTimerState } from './fixtures.js'
import type { Mutable } from './fixtures.js'

/**
 * The repository *contract*, as a suite any implementation can be run
 * against — phase 4A day 1.
 *
 * These assertions used to live in core's own `repository.test.ts`, pinned to
 * the in-memory double. That made them a description of the double rather than
 * of the interface: the localStorage adapter (and later the Firestore one)
 * would have needed the same expectations restated, and two copies of one
 * contract is how the three storage layers end up disagreeing about streak
 * boundaries. One suite, run against every implementation, is the only shape
 * in which "the adapter satisfies the contract" is a statement rather than a
 * hope.
 *
 * Everything here speaks the **interface only** — no `size()`, no internals.
 * Behaviour pinned here (ordering, range inclusivity, upsert, no-op delete, the
 * independence of the two spaces, the whole-document write, and the defensive
 * copy) is therefore not an implementation detail of any one repository. It is
 * what stops localStorage, memory and Firestore from drifting apart.
 *
 * The factory is called once per test, so an implementation whose storage
 * persists between tests (localStorage in jsdom) gets a clean slate each time.
 */
export function describeSessionRepositoryContract(
  label: string,
  createRepository: () => SessionRepository,
): void {
  describe(`${label} — SessionRepository contract`, () => {
    describe('list — history space', () => {
      it('returns sessions ascending by startedAt', async () => {
        const repo = createRepository()
        await repo.put(makeFocusSession({ id: 'c', startedAt: 300 }))
        await repo.put(makeFocusSession({ id: 'a', startedAt: 100 }))
        await repo.put(makeFocusSession({ id: 'b', startedAt: 200 }))

        const ids = (await repo.list()).map((s) => s.id)
        expect(ids).toEqual(['a', 'b', 'c'])
      })

      it('breaks startedAt ties by ascending id', async () => {
        const repo = createRepository()
        await repo.put(makeFocusSession({ id: 'z', startedAt: 100 }))
        await repo.put(makeFocusSession({ id: 'a', startedAt: 100 }))
        await repo.put(makeFocusSession({ id: 'm', startedAt: 100 }))

        const ids = (await repo.list()).map((s) => s.id)
        expect(ids).toEqual(['a', 'm', 'z'])
      })

      it('applies both bounds inclusively', async () => {
        const repo = createRepository()
        for (const startedAt of [10, 20, 30]) {
          await repo.put(makeFocusSession({ id: `s${startedAt}`, startedAt }))
        }

        const all = await repo.list({ from: 10, to: 30 })
        expect(all.map((s) => s.startedAt)).toEqual([10, 20, 30])
      })

      it('leaves an omitted bound unbounded on that side', async () => {
        const repo = createRepository()
        for (const startedAt of [10, 20, 30]) {
          await repo.put(makeFocusSession({ id: `s${startedAt}`, startedAt }))
        }

        expect((await repo.list({ from: 20 })).map((s) => s.startedAt)).toEqual([20, 30])
        expect((await repo.list({ to: 20 })).map((s) => s.startedAt)).toEqual([10, 20])
        expect(await repo.list()).toHaveLength(3)
      })

      it('overwrites by id so a retried write cannot duplicate a session', async () => {
        const repo = createRepository()
        await repo.put(makeFocusSession({ id: 'dup', label: 'first' }))
        await repo.put(makeFocusSession({ id: 'dup', label: 'second', completed: true }))

        expect(await repo.list()).toHaveLength(1)
        const [stored] = await repo.list()
        expect(stored?.label).toBe('second')
        expect(stored?.completed).toBe(true)
      })

      it('treats deleting an absent id as a no-op rather than a failure', async () => {
        const repo = createRepository()
        await repo.put(makeFocusSession({ id: 'kept', startedAt: 100 }))

        await expect(repo.delete('never-written')).resolves.toBeUndefined()
        expect((await repo.list()).map((s) => s.id)).toEqual(['kept'])
      })

      it('stores a frozen copy, so mutating the caller cannot rewrite history', async () => {
        const repo = createRepository()
        const original = makeFocusSession({ id: 'sess-1', label: null })
        await repo.put(original)

        // `FocusSession` is readonly by type; the implementation must survive a
        // caller that goes around it, because a type is not a security
        // boundary.
        const tampered = original as Mutable<FocusSession>
        tampered.label = 'tampered'

        const [stored] = await repo.list()
        expect(stored?.label).toBeNull()
        expect(Object.isFrozen(stored)).toBe(true)
      })
    })

    describe('loadState / saveState — active space', () => {
      it('reports nothing persisted until the first write', async () => {
        const repo = createRepository()

        expect(await repo.loadState()).toBeNull()
      })

      it('distinguishes never-written from written-and-idle', async () => {
        const repo = createRepository()
        await repo.saveState(makePersistedTimerState({ activeSession: null, focusCount: 3 }))

        // Top-level non-null: cycle position exists even though nothing is
        // running.
        const state = await repo.loadState()
        expect(state).not.toBeNull()
        expect(state?.activeSession).toBeNull()
        expect(state?.focusCount).toBe(3)
      })

      it('writes the whole document in one call, so a transition is atomic', async () => {
        const repo = createRepository()
        const running = makeFocusSession({ id: 'sess-1' })
        await repo.saveState(makePersistedTimerState({ activeSession: running }))

        // The completion transition — session out, counter up — is one save.
        await repo.saveState(makePersistedTimerState({ activeSession: null, focusCount: 1 }))

        const state = await repo.loadState()
        expect(state?.activeSession).toBeNull()
        expect(state?.focusCount).toBe(1)
        expect(state?.currentPresetId).toBe('focus-25')
      })

      it('leaves history untouched: state writes are not sessions', async () => {
        const repo = createRepository()
        const running = makeFocusSession({ id: 'sess-1' })
        await repo.saveState(makePersistedTimerState({ activeSession: running }))

        expect(await repo.list()).toEqual([])
      })

      it('returns a frozen copy of the state, session included', async () => {
        const repo = createRepository()
        const session = makeFocusSession({ id: 'sess-1' })
        // Deliberately not annotated `PersistedTimerState`: this test *is* the
        // caller who ignores `readonly`, which is the case the copy exists
        // for.
        const source = {
          activeSession: session as FocusSession | null,
          focusCount: 2,
          currentPresetId: 'focus-25',
        }

        await repo.saveState(source)

        const stored = await repo.loadState()
        expect(stored).not.toBe(source)
        expect(Object.isFrozen(stored)).toBe(true)
        expect(stored?.activeSession).not.toBeNull()
        expect(Object.isFrozen(stored?.activeSession)).toBe(true)

        // Neither the outer record nor the session it points at can be edited
        // after the fact — `activeSession` must not alias the caller's object.
        source.activeSession = null
        source.focusCount = 99
        expect((await repo.loadState())?.activeSession?.id).toBe('sess-1')
        expect((await repo.loadState())?.focusCount).toBe(2)
      })
    })

    describe('the two spaces are independent', () => {
      it('keeps history writes out of the active document', async () => {
        const repo = createRepository()
        await repo.put(makeFocusSession({ id: 'finished' }))

        expect(await repo.loadState()).toBeNull()
      })

      it('keeps active writes out of history', async () => {
        const repo = createRepository()
        const running = makeFocusSession({ id: 'running' })
        await repo.saveState(makePersistedTimerState({ activeSession: running }))

        expect(await repo.list()).toEqual([])
      })

      it('leaves the active document standing when a history session is deleted', async () => {
        const repo = createRepository()
        const session = makeFocusSession({ id: 'sess-1' })
        await repo.saveState(makePersistedTimerState({ activeSession: session, focusCount: 1 }))

        await repo.delete('sess-1')

        expect((await repo.loadState())?.activeSession?.id).toBe('sess-1')
        expect((await repo.loadState())?.focusCount).toBe(1)
      })
    })
  })
}
