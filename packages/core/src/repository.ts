import type { FocusSession } from './session.js'

/**
 * Range bounds for {@link SessionRepository.list}, applied to `startedAt`.
 *
 * Both bounds are inclusive. An omitted bound means unbounded on that side —
 * note this is *omitted*, not `undefined`: under `exactOptionalPropertyTypes`
 * the two differ, and `{ from: undefined }` is rejected so a caller cannot
 * silently widen a query by passing a cleared value.
 */
export interface SessionListOptions {
  readonly from?: number
  readonly to?: number
}

/**
 * Persistence for sessions.
 *
 * Two orthogonal spaces:
 *
 * 1. **Active** — the single session the timer is currently running, at most
 *    one at a time. This is what a reload reads to resume.
 * 2. **History** — every finished session, addressed by `id` and listed by
 *    range.
 *
 * A session lives in the active slot *until it is `put`* — writing the active
 * session does not add it to `list()`, and deleting it from history does not
 * clear the active slot. Keeping these independent is what lets the localStorage
 * adapter (one document) and the Firestore adapter (two collections) implement
 * the same interface without either growing special cases.
 *
 * Implementations are **async even when in memory**: the real adapters are
 * localStorage and Firestore, and an interface that returns values synchronously
 * cannot be implemented by either. Core would then have to branch on sync/async,
 * which is exactly the leak this boundary exists to prevent.
 */
export interface SessionRepository {
  /** The session currently being run, or null when idle. */
  getActive(): Promise<FocusSession | null>

  /** Sets the active session. Replaces any existing one. */
  saveActive(session: FocusSession): Promise<void>

  /** Returns to idle. Idempotent — calling it while already idle is fine. */
  clearActive(): Promise<void>

  /**
   * Sessions with `startedAt` inside the inclusive range, **ascending by
   * `startedAt`**, ties broken by ascending `id`.
   *
   * The ordering is part of the contract rather than an implementation detail:
   * local-day bucketing, streaks and the history ribbon all read this list, and
   * Firestore's natural `orderBy` ordering must match what the in-memory tests
   * assert or the two will disagree about streak boundaries.
   */
  list(options?: SessionListOptions): Promise<FocusSession[]>

  /** Inserts or overwrites by `id`. Upserting is what makes retries safe. */
  put(session: FocusSession): Promise<void>

  /**
   * Removes a session by `id`. Deleting an id that does not exist is a **no-op,
   * not an error** — the outbox retries writes on backoff, and a throwing
   * delete would poison every retry loop with a failure that means nothing.
   */
  delete(id: string): Promise<void>
}
