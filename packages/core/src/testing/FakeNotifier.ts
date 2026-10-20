import type { NotificationPermissionState, NotificationRequest, Notifier } from '../notifier.js'

/**
 * A notifier that records what it was asked to send.
 *
 * The notification policy is pure, so what the tests check is not "a
 * notification appeared" but "*this exact* request was produced" — and that
 * needs a notifier that keeps what it was given.
 *
 * It also lets a test set the platform's answers: `supported = false` for a
 * shell with no notification API, `permission = 'denied'` for a user who
 * clicked Block.
 */
export class FakeNotifier implements Notifier {
  /** Every notification that was sent, in order. */
  readonly sent: NotificationRequest[] = []

  /** How many times permission was requested. */
  permissionRequests = 0

  supported = true
  permission: NotificationPermissionState = 'default'

  async requestPermission(): Promise<'granted' | 'denied'> {
    this.permissionRequests += 1
    this.permission = 'granted'
    return 'granted'
  }

  async notify(notification: NotificationRequest): Promise<void> {
    this.sent.push(notification)
  }
}
