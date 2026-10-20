import type {
  NotificationAction,
  NotificationPermissionState,
  NotificationRequest,
} from './notifier.js'
import type { FocusSession } from './session.js'

/**
 * The tag every session notification carries.
 *
 * One tag, so notifications **replace rather than stack**. A timer fires on a
 * schedule the user can outrun, and three "session complete" cards is worse
 * than one current fact.
 */
export const SESSION_NOTIFICATION_TAG = 'chronos-session'

/** Add five minutes to the segment and carry on. */
export const EXTEND_FIVE_MINUTES = 'extend_5m'

/** Stop the segment and take the break the cycle calls for. */
export const SKIP_TO_BREAK = 'skip_to_break'

/**
 * What the policy knows about the platform and the moment.
 *
 * Permission is **an enhancement, never a requirement** — a user who clicks
 * Block still gets a fully working product, through the other four channels
 * in the redundancy ladder (the tab title, the chime, the favicon dot, the
 * window flash). So `null` below means *"say this in the app instead"*, not
 * *"the user has failed"*.
 */
export interface NotificationContext {
  /** Whether the platform has a notification API at all. */
  readonly supported: boolean
  /** The current permission. */
  readonly permission: NotificationPermissionState
  /** The segment finished while the app was closed, not in front of the user. */
  readonly whileAway: boolean
}

/**
 * The copy, exactly as the plan writes it.
 *
 * Warm and personal, and never scolding: the user was doing something else
 * for two days, and the message says so without making them feel behind.
 */
const COPY = {
  focusComplete: { title: 'Session complete.', body: "Look up — you've earned a break." },
  breakComplete: { title: "Break's over.", body: 'Ready when you are.' },
  whileAway: { title: 'Session complete.', body: 'Completed while you were away.' },
} as const

/**
 * The actions offered with a finished segment.
 *
 * A focus that has just ended can be **extended** — the plan's "Extend 5m
 * (adds to `plannedDurationMs`, resumes)" — or **skipped to the break** the
 * cycle calls for. A break that has just ended can only be extended: there
 * is no break after a break, so offering "skip to break" there would be a
 * button that does nothing.
 */
function actionsFor(kind: FocusSession['kind']): readonly NotificationAction[] {
  const extend: NotificationAction = { id: EXTEND_FIVE_MINUTES, label: 'Extend 5m' }

  if (kind !== 'focus') {
    return [extend]
  }

  return [extend, { id: SKIP_TO_BREAK, label: 'Skip to break' }]
}

/**
 * The notification a finished segment warrants, or `null` when it warrants
 * none.
 *
 * `null` has exactly two causes: the platform has no notification API, or
 * the user has not granted permission. Both are ordinary states of a
 * working product, not errors — which is why the answer is a value rather
 * than a throw.
 *
 * Pure: no clock, no notifier, no I/O. The same finished segment always
 * produces the same notification, which is what makes the copy testable
 * without a browser.
 */
export function notificationFor(
  finished: FocusSession,
  context: NotificationContext,
): NotificationRequest | null {
  if (!context.supported || context.permission !== 'granted') {
    return null
  }

  const copy = context.whileAway
    ? COPY.whileAway
    : finished.kind === 'focus'
      ? COPY.focusComplete
      : COPY.breakComplete

  return {
    title: copy.title,
    body: copy.body,
    tag: SESSION_NOTIFICATION_TAG,
    actions: actionsFor(finished.kind),
  }
}

/**
 * Whether the ask flow should offer the permission prompt.
 *
 * The plan's rules, exactly: **never on load** — the app asks after the first
 * session has begun, so the prompt has context — and **re-offer once, then
 * stop permanently**. A user who has said no is never asked again; a user who
 * has said nothing yet is asked exactly once.
 */
export function shouldAskForPermission(state: {
  readonly supported: boolean
  readonly permission: NotificationPermissionState
  readonly hasAsked: boolean
}): boolean {
  return state.supported && state.permission === 'default' && !state.hasAsked
}
