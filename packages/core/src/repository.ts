import type { FocusSession, PersistedTimerState } from './session.js'

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
 * Persistence for the timer's state and its history.
 *
 * Two orthogonal spaces:
 *
 * 1. **Active** — a single document holding the whole
 *    {@link PersistedTimerState}: the session being run *together with* the
 *    cycle position that has to survive a reload beside it. At most one.
 * 2. **History** — every finished session, addressed by `id` and listed by
 *    range.
 *
 * A session joins history when it is `put` — and only then. Writing the active
 * document does not add anything to `list()`, and deleting from history leaves
 * the active document alone. Keeping the spaces independent is what lets the
 * localStorage adapter (`chronos:active` plus one key per session) and the
 * Firestore adapter (two collections) implement this interface without either
 * growing special cases — and it is what makes a write that lands *between*
 * the two spaces safe: neither constrains the other, so a half-completed write
 * cannot produce contradictory state. The designed layout for both is
 * `docs/DATA-MODEL.md`.
 *
 * Implementations are **async even when in memory**: the real adapters are
 * localStorage and Firestore, and an interface that returns values synchronously
 * cannot be implemented by either. Core would then have to branch on sync/async,
 * which is exactly the leak this boundary exists to prevent.
 */
export interface SessionRepository {
  /**
   * The active document, or `null` when nothing has ever been persisted.
   *
   * Top-level `null` means *never written* and is **not** the same as
   * `activeSession: null`, which means idle with cycle position already on
   * disk. The distinction matters on first run: core deliberately supplies no
   * default `currentPresetId` to paper over the gap, because presets are a
   * domain concept the timer engine introduces (phase 2) and inventing a
   * default here would put a preset name inside the persistence layer.
   *
   * A caller wanting just the session reads `state?.activeSession ?? null`.
   */
  loadState(): Promise<PersistedTimerState | null>

  /**
   * Writes the active document **as a whole**, atomically.
   *
   * This is the resolution of a question the state shape forces. Completing a
   * session moves `activeSession` to `null` *and* advances
   * `completedFocusCount` in the same instant — the two facts describe one
   * moment, "we just finished focus #3 of 4". A crash between two separate
   * writes leaves either a completed session the counter never saw, or a
   * counter that advanced while the session still looks live. **Both halves
   * are individually valid, so no reconciliation rule can tell which is the
   * truth.**
   *
   * So the write unit is the document: one transition, one call. Separate
   * accessors for the session and the cycle position would reintroduce exactly
   * the split this is here to prevent — which is why `getActive`,
   * `saveActive` and `clearActive` were *replaced* rather than supplemented.
   * Two independent writers of one document is the bug, not the fix.
   *
   * Replacing the active session therefore reads the state, swaps
   * `activeSession`, and writes back in one call; the adapter owns that
   * round-trip rather than every caller re-implementing it.
   */
  saveState(state: PersistedTimerState): Promise<void>

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
