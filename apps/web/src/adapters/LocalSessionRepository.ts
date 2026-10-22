import type { FocusSession, PersistedTimerState } from '@chronos/core'
import type { SessionListOptions, SessionRepository } from '@chronos/core'

/**
 * The two spaces of {@link SessionRepository}, as the two key spaces
 * `docs/DATA-MODEL.md` designed in phase 1 — phase 4A day 1.
 *
 * | Key                    | Value                                       | Written                       |
 * |------------------------|---------------------------------------------|-------------------------------|
 * | `chronos:active`       | `{ schemaVersion, ...PersistedTimerState }` | on **every** timer transition |
 * | `chronos:session:{id}` | `{ schemaVersion, ...FocusSession }`        | on `put` (a session ending)   |
 *
 * One key per session rather than one document of everything: a transition
 * re-writes the active key in O(1) instead of re-serialising the whole
 * history against a ~5 MB per-origin quota, and the mapping to Firestore's
 * `sessions/{id}` stays keyed-for-keyed. The prefix is never renamed — a new
 * layout migrates values in place or the old keys quota-forever as orphans.
 *
 * **`Storage` is a constructor argument, not a global.** The same discipline
 * core keeps (`createTimer({ clock, repository, notifier })` — impurity as an
 * argument) applies at this boundary: the adapter takes the platform's storage
 * explicitly, so tests inject jsdom's `localStorage`, the quota tests of day 2
 * inject a `Storage` that refuses writes, and nothing in this module reaches
 * for a global on its own.
 *
 * **Reads are validated at the envelope and unvalidated below it — for
 * today.** `schemaVersion` is checked, because a record from another
 * generation must not be misread as this one; field-level validation (finite
 * numbers, string ids) is day 2's, placed where `restore()` leaves off. A
 * value that fails to parse is treated as absent rather than thrown on: one
 * corrupted key must not stop the app from opening, and `restore()` already
 * distrusts what it is given. What that costs — silently skipping a corrupt
 * session — is recorded here so day 2 can decide whether to surface it.
 */
const PREFIX = 'chronos:'
const ACTIVE_KEY = `${PREFIX}active`
const SESSION_PREFIX = `${PREFIX}session:`

/** The envelope every stored record carries — see DATA-MODEL.md §1:1. */
const SCHEMA_VERSION = 1

/**
 * ASCII comparison for tie-breaking — the same rule as the in-memory double,
 * restated because this module cannot import core's internals (it is not a
 * core file) and because the shared contract suite (`@chronos/core/testing`)
 * pins both implementations to the same order.
 *
 * Deliberately not `localeCompare`: that consults the ICU locale data of the
 * machine, so ids can order differently on CI than on a laptop — and a
 * history list that reorders itself between environments makes streak and
 * bucketing tests flake for no real reason.
 */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export class LocalSessionRepository implements SessionRepository {
  readonly #storage: Storage

  constructor(storage: Storage) {
    this.#storage = storage
  }

  async loadState(): Promise<PersistedTimerState | null> {
    const raw = this.#storage.getItem(ACTIVE_KEY)
    const record = parseEnvelope(raw)
    if (record === null) return null

    const { schemaVersion: _version, ...rest } = record
    // The cast is the seam between the two halves of this adapter's validation
    // — the envelope is checked above, the fields are not (yet): day 2 owns
    // the field-level guard, placed where `restore()` leaves off. It is
    // written here rather than hidden so the seam is visible.
    const state = rest as unknown as PersistedTimerState

    // Two levels of freeze, matching the in-memory double: the document and
    // the session it points at. JSON.parse already handed us a fresh object
    // — nothing can alias storage — but freezing is what makes a stray
    // mutation fail loudly instead of silently diverging from what was read.
    if (state.activeSession !== null) Object.freeze(state.activeSession)
    return Object.freeze(state)
  }

  async saveState(state: PersistedTimerState): Promise<void> {
    this.#storage.setItem(ACTIVE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...state }))
  }

  async list(options?: SessionListOptions): Promise<FocusSession[]> {
    const from = options?.from
    const to = options?.to

    const matched: FocusSession[] = []
    for (let index = 0; index < this.#storage.length; index += 1) {
      const key = this.#storage.key(index)
      if (key === null || !key.startsWith(SESSION_PREFIX)) continue

      const raw = this.#storage.getItem(key)
      const record = parseEnvelope(raw)
      if (record === null) continue

      const { schemaVersion: _version, ...rest } = record
      // Same seam as `loadState`: envelope checked, fields day 2's.
      const session = rest as unknown as FocusSession
      if (from !== undefined && session.startedAt < from) continue
      if (to !== undefined && session.startedAt > to) continue

      matched.push(Object.freeze(session))
    }

    // localStorage has no ordering and no range query — the contract's
    // ordering is applied here, not inherited. Ascending by startedAt, ties
    // by id.
    matched.sort((a, b) => a.startedAt - b.startedAt || compareIds(a.id, b.id))
    return matched
  }

  async put(session: FocusSession): Promise<void> {
    // `setItem` replaces by key, which is the upsert the contract asks for:
    // a retried write of the same id cannot duplicate the session.
    this.#storage.setItem(
      `${SESSION_PREFIX}${session.id}`,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...session }),
    )
  }

  async delete(id: string): Promise<void> {
    // `removeItem` on an absent key is a no-op by specification — exactly the
    // behaviour the outbox's backoff retry needs.
    this.#storage.removeItem(`${SESSION_PREFIX}${id}`)
  }
}

/**
 * Parse a stored value into a record, or `null` when it is absent or not a
 * v1 record this build understands.
 *
 * The `schemaVersion` check is the whole point of putting it on every record
 * (DATA-MODEL.md): a future generation's document must fail here rather than
 * be read field-for-field as this one. Field-level validation is day 2's —
 * this function is the envelope, not the domain.
 */
function parseEnvelope(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  // Bracket access, not dot: `noPropertyAccessFromIndexSignature` is on, and
  // an envelope read is exactly the index-signature case it exists for.
  if (record['schemaVersion'] !== SCHEMA_VERSION) return null
  return record
}
