import type { PersistedTimerState } from '@chronos/core'
import { SunArc } from '../components/SunArc'

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

/**
 * §6.1 idle: *"dim desaturated arc, `25:00`"*. Nunito sets the digits — the
 * day-6 gate ruled Fraunces out for numerals. `clamp()` per §9 so the timer
 * reflows at 200% zoom and 320px.
 */
const IDLE_DISPLAY = '25:00'

export function FocusRoute() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      {/* `tabIndex={-1}` makes this §9's route-change focus target without
          putting the heading into the tab order; `index.css` suppresses the
          ring on it. */}
      <h1 tabIndex={-1}>Focus</h1>

      {/* Static placeholder arc (day 8). The live fill arrives in phase 2 and
          is driven by CSS/rAF, never by a React render per frame (§8). */}
      <div className="relative mx-auto mt-6 w-full max-w-sm">
        <SunArc className="w-full" />
        <div className="absolute inset-0 flex items-end justify-center pb-4">
          <span className="text-[clamp(2.5rem,12vw,4rem)] leading-none font-semibold text-foreground">
            {IDLE_DISPLAY}
          </span>
        </div>
      </div>

      <p className="mt-8 text-center text-muted">
        Idle · preset <code>{INITIAL_STATE.currentPresetId}</code>
      </p>
      <p className="mt-2 text-center text-muted">Placeholder — the timer arrives in phase 2.</p>
    </div>
  )
}
