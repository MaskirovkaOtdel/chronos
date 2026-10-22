import type { FocusSession, PersistedTimerState } from '@chronos/core'
import type { SessionListOptions, SessionRepository } from '@chronos/core'
import { isFocusSession, isPersistedTimerState } from '@chronos/core'

/**
 * The two spaces of {@link SessionRepository}, as the two key spaces
 * `docs/DATA-MODEL.md` designed in phase 1 — phase 4A days 1–2.
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
 * explicitly, so tests inject jsdom's `localStorage`, the quota tests inject a
 * `Storage` that refuses writes, and nothing in this module reaches for a
 * global on its own.
 *
 * **Reads travel three lines of distrust**, each catching what the one above
 * cannot — this module, core's guards, and `restore()`'s finite checks:
 *
 * 1. **Envelope** — is this a v1 record at all? A record from another
 *    generation is skipped as `unrecognized-version`: the data is fine, this
 *    build simply cannot read it. That is a different fact from damage and is
 *    never reported as damage.
 * 2. **Fields** — `isFocusSession`/`isPersistedTimerState` (core, phase 4A
 *    day 2) check every field's type and finiteness. JSON is where types die
 *    silently: `NaN` serialized to `null`, `undefined` keys dropped, a string
 *    where a number belongs. A record failing here is skipped as `damaged`.
 * 3. **The live surface** — `restore()` still distrusts the four numbers of a
 *    session about to *run*, because any caller may construct state by hand,
 *    including one that never passed through this adapter.
 *
 * **A record that fails is skipped, recorded, and surfaced** — never thrown
 * on. One corrupted key must not stop the app from opening, and skipping it
 * silently would lose the user's data twice: first to the corruption, then to
 * the not-knowing. Every skip lands in `skipped()` so the UI can say which
 * records were left behind and why (the surfacing itself is day 4's binding).
 * A key read cleanly later is forgiven — the list reports what is *currently*
 * unreadable, not an audit log.
 *
 * **Writes fail loudly and never partially.** No `try` touches `setItem`: a
 * full disk raises `QuotaExceededError`, the adapter propagates it, and the
 * verb that was persisting rejects. The engine keeps the transition it already
 * made in memory and the caller learns the write did not land; the next
 * successful write re-converges storage with memory (pinned by test). What
 * must never happen — and what catching would cause — is a timer that appears
 * to be saving while the disk is full.
 */
const PREFIX = 'chronos:'
const ACTIVE_KEY = `${PREFIX}active`
const SESSION_PREFIX = `${PREFIX}session:`

/** The envelope every stored record carries — see DATA-MODEL.md §1:1. */
const SCHEMA_VERSION = 1

/** Why a record was left behind — see the module doc's second line of distrust. */
export type SkippedReason = 'damaged' | 'unrecognized-version'

/** A record this build could not read, as of the last time it looked. */
export interface SkippedRecord {
  readonly key: string
  readonly reason: SkippedReason
}

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

/**
 * The envelope's verdict, kept distinct at each step so the caller can tell
 * *why* a record was left behind. `ok` carries the fields with the envelope
 * still in place; stripping it is the caller's business, because stripping
 * before the version check is how a v2 document gets misread as v1.
 */
type ParsedRecord =
  | { readonly outcome: 'ok'; readonly fields: Record<string, unknown> }
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'damaged' }
  | { readonly outcome: 'unrecognized-version' }

export class LocalSessionRepository implements SessionRepository {
  readonly #storage: Storage
  /**
   * Keys read badly, most recent verdict each — a Map so a key re-read badly
   * twenty times is still one entry, and a key read cleanly is dropped rather
   * than accumulating an apology forever.
   */
  readonly #skipped = new Map<string, SkippedReason>()

  constructor(storage: Storage) {
    this.#storage = storage
  }

  /**
   * The records this build could not read, sorted by key.
   *
   * Adapter-specific on purpose: the port describes sessions, not storage
   * failures, and the in-memory double in core has nothing to skip. Firestore
   * (phase 5) gets its own diagnostics shape when it has its own failure
   * modes to report.
   */
  skipped(): readonly SkippedRecord[] {
    return [...this.#skipped]
      .map(([key, reason]) => ({ key, reason }))
      .sort((a, b) => compareIds(a.key, b.key))
  }

  async loadState(): Promise<PersistedTimerState | null> {
    const parsed = parseRecord(this.#storage.getItem(ACTIVE_KEY))
    if (parsed.outcome === 'absent') return null
    if (parsed.outcome !== 'ok') {
      this.#noteSkipped(ACTIVE_KEY, parsed.outcome)
      return null
    }

    // Field-level validation is the second line — the envelope says this
    // *claims* to be v1, the guards say it actually is one. A record that
    // fails here is damaged, not foreign: it is ours, and it is hurt.
    if (!isPersistedTimerState(parsed.fields)) {
      this.#noteSkipped(ACTIVE_KEY, 'damaged')
      return null
    }
    this.#forgive(ACTIVE_KEY)

    const { schemaVersion: _version, ...rest } = parsed.fields
    const state = rest as PersistedTimerState

    // Two levels of freeze, matching the in-memory double: the document and
    // the session it points at. JSON.parse already handed us a fresh object
    // — nothing can alias storage — but freezing is what makes a stray
    // mutation fail loudly instead of silently diverging from what was read.
    if (state.activeSession !== null) Object.freeze(state.activeSession)
    return Object.freeze(state)
  }

  async saveState(state: PersistedTimerState): Promise<void> {
    this.#storage.setItem(ACTIVE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...state }))
    // No catch above: a `QuotaExceededError` propagates and the timer's verb
    // rejects. Writing a document *is* knowing it is readable — so a
    // successful write also clears any older complaint about the key.
    this.#forgive(ACTIVE_KEY)
  }

  async list(options?: SessionListOptions): Promise<FocusSession[]> {
    const from = options?.from
    const to = options?.to

    const matched: FocusSession[] = []
    for (let index = 0; index < this.#storage.length; index += 1) {
      const key = this.#storage.key(index)
      if (key === null || !key.startsWith(SESSION_PREFIX)) continue

      const parsed = parseRecord(this.#storage.getItem(key))
      if (parsed.outcome === 'absent') continue
      if (parsed.outcome !== 'ok') {
        this.#noteSkipped(key, parsed.outcome)
        continue
      }

      // Damaged sessions are skipped *individually* — one hurt record must
      // not take the history down with it, which is why the file layout kept
      // one key per session in the first place.
      if (!isFocusSession(parsed.fields)) {
        this.#noteSkipped(key, 'damaged')
        continue
      }
      this.#forgive(key)

      const { schemaVersion: _version, ...rest } = parsed.fields
      const session = rest as FocusSession
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
    this.#forgive(`${SESSION_PREFIX}${session.id}`)
  }

  async delete(id: string): Promise<void> {
    // `removeItem` on an absent key is a no-op by specification — exactly the
    // behaviour the outbox's backoff retry needs.
    const key = `${SESSION_PREFIX}${id}`
    this.#storage.removeItem(key)
    this.#forgive(key)
  }

  #noteSkipped(key: string, reason: SkippedReason): void {
    this.#skipped.set(key, reason)
  }

  #forgive(key: string): void {
    this.#skipped.delete(key)
  }
}

/**
 * Parse a stored value through the envelope, keeping the verdicts apart.
 *
 * Absent, damaged and foreign are three different facts and the skip list
 * tells them apart: absent is nothing to report, damaged is the user's data
 * hurt, foreign is the user's data intact and unreadable *by this build* —
 * the message for which must never accuse the data of corruption.
 */
function parseRecord(raw: string | null): ParsedRecord {
  if (raw === null) return { outcome: 'absent' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { outcome: 'damaged' }
  }

  if (typeof parsed !== 'object' || parsed === null) return { outcome: 'damaged' }

  const record = parsed as Record<string, unknown>
  // Bracket access, not dot: `noPropertyAccessFromIndexSignature` is on, and
  // an envelope read is exactly the index-signature case it exists for.
  const version = record['schemaVersion']
  // A record under our keys with *no* envelope at all is malformed, not
  // foreign: every generation this app has ever written stamps the version,
  // so its absence is damage. Reporting it as `unrecognized-version` would
  // tell the user it was written by a newer build — a lie the day-4 UI would
  // faithfully repeat. Anything present though not ours — 2, "1", null — is
  // the foreign verdict: the record is intact, merely another generation.
  if (version === undefined) return { outcome: 'damaged' }
  if (version !== SCHEMA_VERSION) return { outcome: 'unrecognized-version' }
  return { outcome: 'ok', fields: record }
}
