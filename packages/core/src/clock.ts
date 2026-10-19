/**
 * Time, as an input rather than an assumption.
 *
 * Everything in `core` that needs to know what time it is asks a `Clock`.
 * That is the single decision that makes the hard parts of this product —
 * drift, DST, forward/backward jumps, an 8-hour sleep, a week-long pause —
 * testable in microseconds instead of untestable.
 *
 * `now()` returns epoch milliseconds as a number, deliberately not a Temporal
 * type: `@js-temporal/polyfill` is quarantined to the world-clock route, and
 * letting it into the timer domain would drag it onto the Focus route's bundle.
 */
export interface Clock {
  /** Current time in epoch milliseconds. */
  now(): number
}
