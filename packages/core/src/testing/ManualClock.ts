import type { Clock } from '../clock.js'

/**
 * A `Clock` you drive by hand, for tests.
 *
 * There is no `sleep()` here and there should never be one: a test that waits
 * for wall-clock time is a test that is slow, flaky, and unable to reach the
 * cases this product actually cares about — a clock that jumps forward 8 hours
 * while the laptop sleeps, or backwards because a timezone changed.
 *
 * `advance()` accepts negative values deliberately. Backward jumps are a real
 * failure mode the timer has to survive, and a clock that refuses to go
 * backwards makes that case untestable.
 */
export class ManualClock implements Clock {
  #now: number

  constructor(startAt = 0) {
    this.#now = startAt
  }

  now(): number {
    return this.#now
  }

  /** Moves time by `deltaMs`. Negative values move it backwards. */
  advance(deltaMs: number): void {
    this.#now += deltaMs
  }

  /** Jumps to an absolute instant. */
  set(epochMs: number): void {
    this.#now = epochMs
  }
}
