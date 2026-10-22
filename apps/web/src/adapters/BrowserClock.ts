import type { Clock } from '@chronos/core'

/**
 * The system clock, as a {@link Clock}.
 *
 * Trivial on purpose — one line with a contract behind it. Phase 2's whole
 * robustness story (the forward jump, the backward jump, the eight-hour sleep,
 * the two-day pause) exists because the engine asks a `Clock` what time it is
 * rather than calling `Date.now()` inline, and this class is where that
 * indirection stops being theoretical.
 *
 * `Date.now()` and not `performance.now()`: the timer domain is wall-clock
 * time — it has to agree with the timestamps that get persisted, with the
 * notification copy ("session complete"), and with a reload hours later.
 * Monotonic time would be immune to clock jumps but meaningless across a
 * restart, and core already treats jumps as a policy question (the elapsed
 * formula clamps at zero; the display's high-water mark is the UI's).
 */
export class BrowserClock implements Clock {
  now(): number {
    return Date.now()
  }
}
