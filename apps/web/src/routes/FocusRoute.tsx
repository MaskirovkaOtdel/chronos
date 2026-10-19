import type { PersistedTimerState } from '@chronos/core'

/**
 * The state the app must be able to reconstruct before the timer knows
 * anything else (§4). Declaring it here — and importing it through the
 * `@chronos/core` package rather than a relative path — is what proves the
 * workspace dependency, the package `exports` map and the declaration emit all
 * line up. The timer logic itself is phase 2.
 */
const INITIAL_STATE: PersistedTimerState = {
  activeSession: null,
  completedFocusCount: 0,
  currentPresetId: 'focus-25',
}

export function FocusRoute() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1>Focus</h1>
      <p className="text-muted">
        Idle · preset <code>{INITIAL_STATE.currentPresetId}</code>
      </p>
      <p className="text-muted">Placeholder — the timer arrives in phase 2.</p>
    </main>
  )
}
