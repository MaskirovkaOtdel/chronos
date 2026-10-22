import type { NotificationPermissionState, NotificationRequest, Notifier } from '@chronos/core'
import { shouldAskForPermission } from '@chronos/core'

/**
 * The slice of the platform's Notification API this adapter touches —
 * injected, like `Storage` is into the repository adapter.
 *
 * The injection is *required*, not stylistic: jsdom has no Notification API
 * at all, and neither do some webviews the app may ship into. With the
 * platform as an argument, every permission state is constructible in tests,
 * and `supported` stays a decision of the wiring that knows whether
 * `window.Notification` even exists — nothing here reaches for a global on
 * its own.
 *
 * The shape mirrors the DOM's static members (`Notification.permission`,
 * `Notification.requestPermission`) and its construct call, but deliberately
 * describes only the members this adapter uses — the day-4 wiring adapts
 * `window.Notification` onto it with one shim, and the tests stand in for the
 * whole surface with a class of their own.
 */
export interface NotificationPlatform {
  /** Constructs a notification — `new Notification(title, options)`. */
  new (title: string, options?: { body?: string; tag?: string }): void
  /** The current permission, readable without side effects. */
  readonly permission: NotificationPermissionState
  /** Shows the prompt. The promise resolves to whatever the user chose. */
  requestPermission(): Promise<NotificationPermissionState>
}

/**
 * Notifications over the web Notification API — phase 4A day 3.
 *
 * Everything *policy* is already done and pure in core (`notifications.ts`);
 * this is delivery, and it has exactly two obligations that shape its code:
 *
 * **It never throws, on any path.** A refused permission resolves to no-op,
 * and so does a platform constructor that fails even though permission was
 * granted — the OS can refuse what the browser accepted. Catching here is not
 * swallowing an inconvenient failure, it is the redundancy ladder's design:
 * the tab title, the chime and the favicon dot still reach the user, whereas
 * a throwing `notify` would reject the timer's *verb* and make it look like
 * the segment never completed. `core`'s `announce()` awaits it inline; the
 * delivery channel must be the most reliable one in the app, and reliability
 * here means *silently optional*, never load-bearing.
 *
 * **It renders only what the web can render.** The `Notification` constructor
 * cannot carry action buttons — that needs a service worker's
 * `registration.showNotification()`. The policy's `actions` (Extend 5m,
 * Skip to break) arrive through the *app* instead (phase 4B's completion UX),
 * so they are passed over, deliberately and with a comment, not lost.
 *
 * The ask flow: the *decision* of whether to ask is core's pure
 * `shouldAskForPermission`; the *counting* is here, in memory. That is the
 * recorded decision — one prompt at most per app instance, only ever called
 * from a user gesture, because a dismissed Chrome prompt keeps permission at
 * `'default'` and only the counter knows we already asked this session. The
 * counter resetting on reload is accepted: each prompt still rides a gesture,
 * and the settings work (phase 4E) will persist the real preference.
 */
export class BrowserNotifier implements Notifier {
  readonly #platform: NotificationPlatform | null
  #hasAsked = false

  constructor(platform?: NotificationPlatform | null) {
    this.#platform = platform ?? null
  }

  /** False on a platform with no notification API — some webviews. */
  get supported(): boolean {
    return this.#platform !== null
  }

  /**
   * The platform's current permission, never a prompt trigger.
   *
   * `'default'` on an unsupported platform is not a claim that prompting is
   * possible — it is the value every core policy *ignores*, because both
   * `notificationFor` and `shouldAskForPermission` short-circuit on
   * `supported` before consulting it.
   */
  get permission(): NotificationPermissionState {
    return this.#platform?.permission ?? 'default'
  }

  /**
   * The prompt itself, as the port describes it: the answer, never a throw.
   *
   * A dismissed prompt (Chrome keeps `permission` at `'default'`) resolves to
   * `'denied'`, because at this port's granularity the answer is binary —
   * granted, or not granted. The *permission getter* still reads the
   * platform's real state; the pure policy consults that, not this result.
   */
  async requestPermission(): Promise<'granted' | 'denied'> {
    const platform = this.#platform
    if (platform === null) return 'denied'

    try {
      const answer = await platform.requestPermission()
      return answer === 'granted' ? 'granted' : 'denied'
    } catch {
      // A platform can reject the promise (legacy or a refusing shell). The
      // port's shape is a value, so even its failure mode is one.
      return 'denied'
    }
  }

  /**
   * The bounded ask: core's pure policy decides *whether*, this drive counts.
   *
   * Resolves `'granted'`/`'denied'` when a prompt was shown, `null` when this
   * moment warrants none — already answered (granted or denied is a state the
   * browser itself remembers), already asked this session, or no platform at
   * all. The flag is raised *before* the prompt's await, so two rapid callers
   * share one prompt rather than stacking two.
   */
  async askForPermission(): Promise<'granted' | 'denied' | null> {
    const platform = this.#platform
    if (platform === null) return null

    if (
      !shouldAskForPermission({
        supported: true,
        permission: platform.permission,
        hasAsked: this.#hasAsked,
      })
    ) {
      return null
    }
    this.#hasAsked = true

    return this.requestPermission()
  }

  /** Shows a notification, or resolves having shown nothing. */
  async notify(request: NotificationRequest): Promise<void> {
    const platform = this.#platform
    if (platform === null) return
    // The pure policy never hands over a request without granted permission;
    // the guard below is the same defensiveness the port's doc calls for —
    // permission "absent" resolves rather than throws.
    if (platform.permission !== 'granted') return

    try {
      // Title, body, tag — nothing else. The web constructor cannot render
      // the policy's `actions` (service-worker territory); the app's own
      // completion screen offers them instead.
      new platform(request.title, { body: request.body, tag: request.tag })
    } catch {
      // Granted permission does not guarantee delivery: an OS-level refusal
      // throws on construction. Resolve — the other channels of the ladder
      // are still reaching the user.
    }
  }
}
