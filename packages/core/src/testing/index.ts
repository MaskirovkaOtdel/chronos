/**
 * Test doubles for `@chronos/core`.
 *
 * Kept off the root export on purpose. A browser bundle should never be able to
 * pull in the in-memory repository by accident, and `import ... from
 * '@chronos/core/testing'` states at the call site that this is test scaffolding
 * rather than product code.
 */
export { InMemorySessionRepository } from './InMemorySessionRepository.js'
export { ManualClock } from './ManualClock.js'
export { FOCUS_25_MIN, makeFocusSession, makePersistedTimerState } from './fixtures.js'
