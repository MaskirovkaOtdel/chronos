import type { FocusSession, PersistedTimerState } from '../session.js'
import type { SessionListOptions, SessionRepository } from '../repository.js'

/**
 * ASCII comparison for tie-breaking.
 *
 * Deliberately not `localeCompare`: that consults the ICU locale data of the
 * machine running the test, so the same two ids can order differently on a CI
 * runner than on a developer's laptop — and a history list that reorders itself
 * between environments makes streak and bucketing tests flake for no real reason.
 */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * A `SessionRepository` backed by memory — no localStorage, no network, no I/O.
 *
 * This is the test double the whole of `core` leans on: with it, every piece of
 * timer logic can be exercised against a "database" that never fails, never
 * lags and resets between tests. The real adapters (localStorage, Firestore)
 * only have to satisfy the same contract, not re-prove the domain's behaviour.
 *
 * Storage is **defensive and frozen**:
 *
 * - A copy is taken on write, so a caller mutating its own object afterwards
 *   cannot silently rewrite history.
 * - The stored copy is `Object.freeze`d, so a stray mutation inside a test fails
 *   loudly instead of corrupting state that a later assertion reads.
 *
 * Both apply to the active document too, and there the copy has to reach one
 * level down: `PersistedTimerState` is flat, but it *points at* a
 * `FocusSession`. Copying only the outer record would leave the stored state
 * aliasing the caller's session, so mutating `state.activeSession` after
 * `saveState` would edit a document that was supposed to be written. The
 * session is therefore copied and frozen alongside the state it sits in.
 */
export class InMemorySessionRepository implements SessionRepository {
  #state: PersistedTimerState | null = null
  readonly #sessions = new Map<string, FocusSession>()

  /**
   * `null` only until the first `saveState` — afterwards a written document
   * that goes idle comes back as `activeSession: null`, not top-level `null`.
   * The two are deliberately distinguishable, exactly as the contract requires.
   */
  async loadState(): Promise<PersistedTimerState | null> {
    return this.#state
  }

  async saveState(state: PersistedTimerState): Promise<void> {
    this.#state = Object.freeze(this.#copyState(state))
  }

  #copyState(state: PersistedTimerState): PersistedTimerState {
    const activeSession =
      state.activeSession === null ? null : Object.freeze({ ...state.activeSession })
    return { ...state, activeSession }
  }

  async list(options?: SessionListOptions): Promise<FocusSession[]> {
    const from = options?.from
    const to = options?.to

    const matched: FocusSession[] = []
    for (const session of this.#sessions.values()) {
      if (from !== undefined && session.startedAt < from) continue
      if (to !== undefined && session.startedAt > to) continue
      matched.push(session)
    }

    // Ascending by startedAt, ties by id — the ordering the contract promises.
    matched.sort((a, b) => a.startedAt - b.startedAt || compareIds(a.id, b.id))
    return matched
  }

  async put(session: FocusSession): Promise<void> {
    this.#sessions.set(session.id, Object.freeze({ ...session }))
  }

  async delete(id: string): Promise<void> {
    // Absent id is a no-op, not a failure — the outbox retries writes.
    this.#sessions.delete(id)
  }

  /** Test-only helper: how many sessions are in history. */
  size(): number {
    return this.#sessions.size
  }
}
