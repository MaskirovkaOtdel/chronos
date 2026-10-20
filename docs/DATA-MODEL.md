# CHRONOS — data model

> **Status:** design artifact — phase 1, day 10. **Nothing described here is implemented.**
> The localStorage adapter lands in phase 4, Firebase in phase 5. The Firestore section is a
> **written layout, deliberately not created**: no dependency, no collections, no rules, no
> indexes exist yet. Designing the schema now is what stops phase 5 from retrofitting one.

## What persists, and what deliberately does not

| Concern                                                  | Domain type                           | Store                                          | Phase |
| -------------------------------------------------------- | ------------------------------------- | ---------------------------------------------- | ----- |
| Active timer + history                                   | `PersistedTimerState`, `FocusSession` | localStorage now · Firestore when sync arrives | 4 · 5 |
| Settings (theme, sound, notifications, presets)          | _not yet specified_                   | both, same layout discipline                   | 4     |
| Derived stats (today totals, streak, peak hours, ribbon) | —                                     | **nowhere — always derived from sessions**     | 2     |
| Sync outbox                                              | —                                     | localStorage only, never synced as domain data | 5     |

**Stats are not persisted.** The moment a stored number like `completedFocusCount`-style state is
_duplicated_ into a stats record, two sources of truth exist and they drift — and the invariants
in plan phase 2 ("completes exactly once", "partials excluded from streaks") are only checkable
against a single source. Deriving is O(history) on read, which is the right trade while history
fits comfortably in memory. **Revisit trigger:** if a history scan is ever visibly slow (§Revisit).

## The rule that makes the mapping provable

Both backends store **the same JSON object for the same record**:

```
{ "schemaVersion": 1, ...FocusSession }        // one session
{ "schemaVersion": 1, ...PersistedTimerState } // the active slot
```

The only things that differ are _where_ the object is addressed and _how it is carried_ — a key
versus a document path, a string versus a Firestore map. Everything else is identical, so the
mapping is 1:1 by construction rather than by inspection.

Two consequences follow, and both are load-bearing:

1. **`schemaVersion` is the only envelope field, and it exists in both.** Backends may carry
   _transport_ metadata (phase 5's `updatedAt` for conflict resolution), but it is stripped at the
   adapter boundary and **never enters the domain types**. Domain payload is 1:1; envelope is
   backend-local and additive.
2. **`schemaVersion` lives on every record, not in one manifest key.** localStorage could get away
   with a single generation flag, but Firestore genuinely holds _mixed_ generations — an old
   document written by another device years earlier. Per-record versioning makes read-time
   migration per record, which is also safe against a migration that is interrupted halfway: a
   global flag leaves half the data on the old version with no way to know which half.

## localStorage schema

Prefix `chronos:`. Two spaces, matching the two spaces of `SessionRepository` exactly.

| Key                    | Value                                       | Written                       |
| ---------------------- | ------------------------------------------- | ----------------------------- |
| `chronos:active`       | `{ schemaVersion, ...PersistedTimerState }` | on **every** timer transition |
| `chronos:session:{id}` | `{ schemaVersion, ...FocusSession }`        | on `put` (a session ending)   |

### Why one key per session rather than one document of everything

`repository.ts` describes the localStorage adapter parenthetically as "one document". The designed
layout is **one key per session**, and the comment is updated to match, because:

- **Write amplification.** Phase 2 requires a write on _every transition_. An active-session write
  is a few hundred bytes either way, but if history were bundled into the same value, every
  transition would re-stringify the entire history — ~260 bytes per session, ~20 sessions a day,
  so ~1.9 MB/year, growing unboundedly against a **~5 MB per-origin quota that localStorage shares
  with everything else on the origin.** Splitting keeps both writes O(1).
- **It is what makes the mapping literally 1:1.** `chronos:session:{id}` ↔ `sessions/{id}` is a
  keyed-for-keyed correspondence. One array key ↔ _N_ documents would not be 1:1 in any sense the
  phrase can be made to mean, and the plan asks for exactly that verification.
- **Quota failure stays local.** A full-quota write loses one session's persistence, not a
  re-serialization of everything.
- **Atomicity is not given up.** `SessionRepository` already declares the two spaces _independent_
  — writing the active session does not add it to `list()`, and deleting from history does not
  clear the active slot. A write that lands between two keys therefore cannot produce
  contradictory state; the worst case is one lost completed session or one lost live session, and
  startup reconciliation covers the live case.

### Reading and ordering

`list()` must return **ascending `startedAt`, ties broken by ascending `id`** — this is part of
the repository contract, not an implementation detail, because local-day bucketing, streaks and
the history ribbon all read it and the in-memory tests assert it.

localStorage has no ordering and no range query, so `list()` enumerates `chronos:session:*`
(prefix scan over `localStorage.key(i)`), filters on `from`/`to` when present, and **sorts
explicitly** by the contract's comparator. An omitted bound is _omitted_, never `undefined` —
under `exactOptionalPropertyTypes` those differ, and `{ from: undefined }` is rejected so a cleared
value cannot silently widen a query.

**Never rename the `chronos:` prefix.** A new layout must be reached by migrating values in place,
or the old keys become orphans that quota-forever and are invisible to the new code.

## Firestore document schema — written, not created

```
users/{uid}
  ├── active/current                     { schemaVersion, ...PersistedTimerState }
  └── sessions/{sessionId}               { schemaVersion, ...FocusSession }
```

Two subcollections — matching the two localStorage spaces and the two `SessionRepository` spaces.
Exactly one document in `active`, addressed by the fixed id `current`.

**Indexes required when this is created (phase 5):** a composite index on
`sessions: startedAt ASC, id ASC`. It is not optional — `orderBy('startedAt').orderBy('id')`
rejects without it, and the range predicates `startedAt >= from && <= to` ride on the same prefix.
Creating it only when the query first fails in production mode is the classic way this is
discovered late.

**Scoping and rules:** every path is under `users/{uid}` so ownership is a path property, which is
what makes a one-line rule (`allow read, write: if request.auth.uid == uid`) able to enforce it.
`firestore.rules` is **deferred to phase 5** along with `firebase-tools` — designing the path
hierarchy now is the part that cannot be bolted on afterwards.

### Type fidelity — the differences that will actually bite

| Hazard                       | localStorage                                             | Firestore                             | Consequence                                                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startedAt` as a `Timestamp` | n/a (JSON number)                                        | `Timestamp` is a distinct type        | **Breaks the `number` contract.** `session.ts` already pins this: one stray `toISOString()` and every downstream comparison changes type. Store plain epoch ms.                                            |
| `NaN` / `±Infinity`          | `JSON.stringify(NaN)` is **`null`** — silent type change | not JSON, so the two need not agree   | A `number` field silently becomes `null`. Whatever a backend does with it, **persisted numbers must be finite.**                                                                                           |
| `undefined`                  | key dropped by `JSON.stringify`                          | field ignored                         | Field vanishes, the type still says `number`, read fails at runtime. This is why every nullable field is `\| null` **and not optional** — the design already chose correctly; do not "simplify" it to `?`. |
| `kind` enum                  | stored as a string, nothing checks it                    | stored as a string, nothing checks it | **Deserialization is a validation boundary.** Firestore validates types at write; localStorage validates nothing at all, so the same corruption fails eagerly in one backend and silently in the other.    |
| Quota / limits               | ~5 MB per origin, shared                                 | 1 MB per document                     | Two different ceilings on the same data — see §Revisit.                                                                                                                                                    |

Epoch milliseconds are far inside double precision (~1.7e12 « 2^53), so both backends round-trip
them exactly. That is not a reason to be casual about it: it is why `number` is safe to rely on.

## The 1:1 mapping

### Structural

| Concept                                | localStorage           | Firestore                          |
| -------------------------------------- | ---------------------- | ---------------------------------- |
| Active slot (superset: cycle position) | `chronos:active`       | `users/{uid}/active/current`       |
| One completed session                  | `chronos:session:{id}` | `users/{uid}/sessions/{sessionId}` |
| Addressing                             | id is the key suffix   | id is the document id              |
| Missing record on `delete`             | `removeItem` — no-op   | `delete` — no-op                   |
| Upsert                                 | `setItem` (replace)    | `set` (replace)                    |

Both `delete`s are idempotent, which is exactly what the outbox's backoff retry needs — a
throwing delete would poison every retry with a failure that means nothing.

### Field-by-field — `FocusSession` (11 fields, identical in both)

| Field                 | TypeScript                                 | Stored as         | Nullable |
| --------------------- | ------------------------------------------ | ----------------- | -------- |
| `id`                  | `string`                                   | string            | no       |
| `kind`                | `'focus' \| 'short_break' \| 'long_break'` | string            | no       |
| `startedAt`           | `number`                                   | number (epoch ms) | no       |
| `pauseStartedAt`      | `number \| null`                           | number or `null`  | yes      |
| `accumulatedPausedMs` | `number`                                   | number            | no       |
| `plannedDurationMs`   | `number`                                   | number            | no       |
| `label`               | `string \| null`                           | string or `null`  | yes      |
| `presetId`            | `string`                                   | string            | no       |
| `endedAt`             | `number \| null`                           | number or `null`  | yes      |
| `actualMs`            | `number \| null`                           | number or `null`  | yes      |
| `completed`           | `boolean`                                  | boolean           | no       |

### `PersistedTimerState` (3 fields, identical in both)

| Field                 | TypeScript             | Stored as                   | Nullable |
| --------------------- | ---------------------- | --------------------------- | -------- |
| `activeSession`       | `FocusSession \| null` | nested map/object or `null` | yes      |
| `completedFocusCount` | `number`               | number                      | no       |
| `currentPresetId`     | `string`               | string                      | no       |

Note `activeSession` nests a _complete_ `FocusSession`, so every row above applies recursively —
one definition, applied twice, no special case for the nested copy.

`completedFocusCount` lives on the state and not on the session because it is **cycle position**,
not a property of any one session — but it must still persist, or the long-break cadence resets
every time the tab closes.

> **`activeSession` and the cycle fields must be written atomically.** They describe one instant
> ("we just finished focus #3 of 4 and are idle"). A crash between two separate writes yields a
> session completed without the counter moving, or a counter moved while the active session still
> looks live — and no reconciliation rule can tell which half is right.
>
> **Resolved (week 3, before phase 2): `SessionRepository` writes the whole document.**
> `getActive`/`saveActive`/`clearActive` were **replaced** by `loadState(): Promise<PersistedTimerState | null>`
> and `saveState(state: PersistedTimerState): Promise<void>` — one transition, one call.
>
> Two candidates were considered and rejected:
>
> - _Extending `SessionRepository` with cycle-state accessors._ Leaves two writes per transition,
>   so the crash window this section exists to prevent survives untouched.
> - _Adding a `TimerStateRepository` port, with `SessionRepository`'s active methods delegating to
>   it._ Two ports over one document: whichever is called first wins the ordering, and delegation
>   only hides the race rather than removing it.
>
> The whole-document shape also happens to be the cheapest moment to choose it — at week 3
> `SessionRepository` had no consumer beyond its in-memory double, and after phase 4's localStorage
> and Firestore adapters exist the same change would ripple through three implementations instead
> of one.
>
> `loadState()` returns `null` **only before the first write**. That is distinct from
> `activeSession: null`, which means idle with cycle position already persisted — so core never has
> to invent a default `currentPresetId` to answer "nothing stored", which is precisely the reason
> presets stay a phase 2 domain concept rather than leaking into the persistence layer.

## Settings (designed, not specified)

`SettingsRoute` is a placeholder listing presets, sound, notifications, theme picker and data. The
layout is the same shape, and it should not need rethinking when it is specified:

```
chronos:settings   ↔   users/{uid}/settings/current
```

Theme is stored by **id from the eight community themes** (not by raw colour values — a stored
palette would bypass the contrast gate entirely and let a migrated theme rot). Preset _selection_
is `currentPresetId`, already part of `PersistedTimerState`; preset _definitions_ are code in V1.

## Verification

The mapping is checked two ways, because a table that nobody re-reads is not a verification.

1. **Analytically** — the tables above. Every domain field appears in exactly one row, with the
   same type and the same nullability in both backends, and every structural space has exactly one
   counterpart.
2. **Mechanically** — `packages/core/src/data-model.test.ts` proves that JSON serialization
   (which _is_ localStorage's serializer — it stores strings) round-trips a fully-populated session
   and an all-null session without adding, dropping, renaming or coercing a single field, that
   every persisted number is finite, and that no field goes missing.

> **The tripwire:** that test carries an explicit field list mirroring the tables above. Adding a
> field to `FocusSession` makes the fixture fail to compile, which makes its key set mismatch the
> explicit list, which fails the test — so **this document and the code cannot drift apart without
> a red gate.** If you change the type, update the table and the test in the same commit.

The test lives in `core` and reads no files: `tsconfig.base.json` sets `"types": []`, so `node:fs`
does not typecheck there. That is deliberate — it is the structural enforcement of _core has zero
I/O_. A test that read this document from disk would have to weaken the very invariant it is
checking.

## Revisit triggers

| Signal                   | Why it matters                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| History approaches ~3 MB | localStorage shares a ~5 MB quota with the whole origin. Options then: retention window, archive, or export. **Do not prune silently** — streaks and peak-hour stats read full history, so pruning changes what the app reports.                                                     |
| `list()` visibly slow    | Today's answer is "enumerate, filter, sort in memory". If it stops being true, the fix is a bounded index key — knowing that a derived index is a second source of truth and must be regenerated, never trusted.                                                                     |
| Session fields need a v2 | Per-record `schemaVersion` means migration runs per record on read. Add the field with a default, migrate lazily, never rename the `chronos:` prefix.                                                                                                                                |
| Sync lands (phase 5)     | Adds `updatedAt` (server timestamp) as **Firestore-only transport metadata**, stripped on read. `sessions/{id}` is immutable once `put`, so inserts converge and only `active/current` needs last-write-wins. The outbox is localStorage-local and never part of the synced payload. |
