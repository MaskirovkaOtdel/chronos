import type { Notifier } from '../notifier.js'

/**
 * A notifier that does nothing, for tests that have no business with
 * notifications.
 *
 * Deliberately minimal: day 7 builds the real fake — permission states, queued
 * notifications, the policy decisions — and this is where it will live, so
 * that the two do not drift into being two different things.
 */
export const stubNotifier: Notifier = {
  supported: true,
  permission: 'default',
  requestPermission: async () => 'granted',
  notify: async () => undefined,
}
