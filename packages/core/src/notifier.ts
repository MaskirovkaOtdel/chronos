/**
 * An action the user can take straight from the notification.
 *
 * The web's `Notification` constructor cannot carry actions — that needs a
 * service worker — so this is the *policy's* description of what the user is
 * being offered, and the adapter decides what it can actually render. The ids
 * are domain strings; the policy that produces them is what names them.
 */
export interface NotificationAction {
  readonly id: string
  readonly label: string
}

/** Content of a single notification. */
export interface NotificationRequest {
  readonly title: string
  readonly body: string
  /**
   * Replaces any prior notification with the same tag.
   *
   * Needed because a timer fires on a schedule the user can outrun — dismiss
   * three notifications and you get three cards. One tag means "the timer is
   * done" stays a single, current fact.
   */
  readonly tag: string
  /** What the user may do with it. Omitted when there is nothing to offer. */
  readonly actions?: readonly NotificationAction[]
}

export type NotificationPermissionState = 'default' | 'granted' | 'denied'

/**
 * Pushing a notification, as a port rather than a direct call.
 *
 * Browsers gate notifications behind a user gesture and a permission prompt,
 * and desktop/mobile shells differ again — so the domain must be able to ask
 * *whether* that is possible before it decides to bother the user, and must
 * degrade to a no-op rather than throw when it is not.
 */
export interface Notifier {
  /** False where the platform has no notification API at all (e.g. some webviews). */
  readonly supported: boolean

  /** Current permission. Never triggers a prompt — reading is side-effect free. */
  readonly permission: NotificationPermissionState

  /**
   * Prompts the user, if the platform allows prompting.
   * Returns the resulting state; a refusal resolves to `denied`, it does not throw.
   */
  requestPermission(): Promise<'granted' | 'denied'>

  /** Shows a notification. Resolves without throwing when permission is absent. */
  notify(notification: NotificationRequest): Promise<void>
}
