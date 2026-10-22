// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Clock } from '@chronos/core'
import { BrowserClock } from './BrowserClock'

/**
 * The one place wall-clock time enters the app.
 *
 * The test is close to tautological — `Date.now()` is right there — and it
 * earns its place anyway: it pins that the platform clock *satisfies the
 * port* (`Clock` is satisfied structurally, so any drift in either side
 * surfaces here first), and that it reads the wall clock rather than a
 * monotonic source, which is the decision the whole clock-robustness story
 * rests on.
 */
describe('BrowserClock', () => {
  it('reads the system wall clock', () => {
    const clock: Clock = new BrowserClock()

    const before = Date.now()
    const now = clock.now()
    const after = Date.now()

    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(after)
  })
})
