import type { FocusSession } from '../session.js'
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
 * `FocusSession` is a flat record of primitives, so a shallow copy is a full
 * copy. If a nested object is ever added to the type, both of these need to
 * become deep.
 */
export class InMemorySessionRepository implements SessionRepository {
  #active: FocusSession | null = null
  readonly #sessions = new Map<string, FocusSession>()

  async getActive(): Promise<FocusSession | null> {
    return this.#active
  }

  async saveActive(session: FocusSession): Promise<void> {
    this.#active = Object.freeze({ ...session })
  }

  async clearActive(): Promise<void> {
    this.#active = null
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
