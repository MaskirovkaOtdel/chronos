import { describe, expect, it } from 'vitest'
import type { FocusSession, PersistedTimerState } from './session.js'
import { InMemorySessionRepository } from './testing/InMemorySessionRepository.js'

const FOCUS_25_MIN = 25 * 60 * 1000

function makeSession(overrides: Partial<FocusSession> = {}): FocusSession {
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

function makeState(overrides: Partial<PersistedTimerState> = {}): PersistedTimerState {
  return {
    activeSession: null,
    completedFocusCount: 0,
    currentPresetId: 'focus-25',
    ...overrides,
  }
}

/**
 * The repository is a *contract*, not a class: the localStorage and Firestore
 * adapters are written against these assertions, and `InMemorySessionRepository`
 * is the oracle they are compared to. Behaviour pinned here — ordering, range
 * inclusivity, upsert, no-op delete, the independence of the two spaces and the
 * whole-document write — is therefore not an implementation detail of the
 * double. It is what stops the three storage layers from disagreeing about
 * streak boundaries or about how many focus sessions a day contains.
 */
describe('SessionRepository contract', () => {
  describe('list — history space', () => {
    it('returns sessions ascending by startedAt', async () => {
      const repo = new InMemorySessionRepository()
      await repo.put(makeSession({ id: 'c', startedAt: 300 }))
      await repo.put(makeSession({ id: 'a', startedAt: 100 }))
      await repo.put(makeSession({ id: 'b', startedAt: 200 }))

      const ids = (await repo.list()).map((s) => s.id)
      expect(ids).toEqual(['a', 'b', 'c'])
    })

    it('breaks startedAt ties by ascending id', async () => {
      const repo = new InMemorySessionRepository()
      await repo.put(makeSession({ id: 'z', startedAt: 100 }))
      await repo.put(makeSession({ id: 'a', startedAt: 100 }))
      await repo.put(makeSession({ id: 'm', startedAt: 100 }))

      const ids = (await repo.list()).map((s) => s.id)
      expect(ids).toEqual(['a', 'm', 'z'])
    })

    it('applies both bounds inclusively', async () => {
      const repo = new InMemorySessionRepository()
      for (const startedAt of [10, 20, 30]) {
        await repo.put(makeSession({ id: `s${startedAt}`, startedAt }))
      }

      const all = await repo.list({ from: 10, to: 30 })
      expect(all.map((s) => s.startedAt)).toEqual([10, 20, 30])
    })

    it('leaves an omitted bound unbounded on that side', async () => {
      const repo = new InMemorySessionRepository()
      for (const startedAt of [10, 20, 30]) {
        await repo.put(makeSession({ id: `s${startedAt}`, startedAt }))
      }

      expect((await repo.list({ from: 20 })).map((s) => s.startedAt)).toEqual([20, 30])
      expect((await repo.list({ to: 20 })).map((s) => s.startedAt)).toEqual([10, 20])
      expect(await repo.list()).toHaveLength(3)
    })

    it('overwrites by id so a retried write cannot duplicate a session', async () => {
      const repo = new InMemorySessionRepository()
      await repo.put(makeSession({ id: 'dup', label: 'first' }))
      await repo.put(makeSession({ id: 'dup', label: 'second', completed: true }))

      expect(repo.size()).toBe(1)
      const [stored] = await repo.list()
      expect(stored?.label).toBe('second')
      expect(stored?.completed).toBe(true)
    })

    it('treats deleting an absent id as a no-op rather than a failure', async () => {
      const repo = new InMemorySessionRepository()
      await repo.put(makeSession({ id: 'kept', startedAt: 100 }))

      await expect(repo.delete('never-written')).resolves.toBeUndefined()
      expect((await repo.list()).map((s) => s.id)).toEqual(['kept'])
    })

    it('stores a frozen copy, so mutating the caller cannot rewrite history', async () => {
      const repo = new InMemorySessionRepository()
      const original = makeSession({ id: 'sess-1', label: null })
      await repo.put(original)

      // `FocusSession` is readonly by type; the double must survive a caller
      // that goes around it, because a test fixture is not a security boundary.
      const tampered = original as unknown as { label: string | null }
      tampered.label = 'tampered'

      const [stored] = await repo.list()
      expect(stored?.label).toBeNull()
      expect(Object.isFrozen(stored)).toBe(true)
    })
  })

  describe('loadState / saveState — active space', () => {
    it('reports nothing persisted until the first write', async () => {
      const repo = new InMemorySessionRepository()

      expect(await repo.loadState()).toBeNull()
    })

    it('distinguishes never-written from written-and-idle', async () => {
      const repo = new InMemorySessionRepository()
      await repo.saveState(makeState({ activeSession: null, completedFocusCount: 3 }))

      // Top-level non-null: cycle position exists even though nothing is running.
      const state = await repo.loadState()
      expect(state).not.toBeNull()
      expect(state?.activeSession).toBeNull()
      expect(state?.completedFocusCount).toBe(3)
    })

    it('writes the whole document in one call, so a transition is atomic', async () => {
      const repo = new InMemorySessionRepository()
      const running = makeSession({ id: 'sess-1' })
      await repo.saveState(makeState({ activeSession: running }))

      // The completion transition — session out, counter up — is one save.
      await repo.saveState(makeState({ activeSession: null, completedFocusCount: 1 }))

      const state = await repo.loadState()
      expect(state?.activeSession).toBeNull()
      expect(state?.completedFocusCount).toBe(1)
      expect(state?.currentPresetId).toBe('focus-25')
    })

    it('leaves history untouched: state writes are not sessions', async () => {
      const repo = new InMemorySessionRepository()
      const running = makeSession({ id: 'sess-1' })
      await repo.saveState(makeState({ activeSession: running }))

      expect(repo.size()).toBe(0)
      expect(await repo.list()).toEqual([])
    })

    it('returns a frozen copy of the state, session included', async () => {
      const repo = new InMemorySessionRepository()
      const session = makeSession({ id: 'sess-1' })
      // Deliberately not annotated `PersistedTimerState`: this test *is* the
      // caller who ignores `readonly`, which is the case the copy exists for.
      const source = {
        activeSession: session as FocusSession | null,
        completedFocusCount: 2,
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
      source.completedFocusCount = 99
      expect((await repo.loadState())?.activeSession?.id).toBe('sess-1')
      expect((await repo.loadState())?.completedFocusCount).toBe(2)
    })
  })

  describe('the two spaces are independent', () => {
    it('keeps history writes out of the active document', async () => {
      const repo = new InMemorySessionRepository()
      await repo.put(makeSession({ id: 'finished' }))

      expect(await repo.loadState()).toBeNull()
    })

    it('keeps active writes out of history', async () => {
      const repo = new InMemorySessionRepository()
      const running = makeSession({ id: 'running' })
      await repo.saveState(makeState({ activeSession: running }))

      expect(repo.size()).toBe(0)
      expect(await repo.list()).toEqual([])
    })

    it('leaves the active document standing when a history session is deleted', async () => {
      const repo = new InMemorySessionRepository()
      const session = makeSession({ id: 'sess-1' })
      await repo.saveState(makeState({ activeSession: session, completedFocusCount: 1 }))

      await repo.delete('sess-1')

      expect((await repo.loadState())?.activeSession?.id).toBe('sess-1')
      expect((await repo.loadState())?.completedFocusCount).toBe(1)
    })
  })
})
