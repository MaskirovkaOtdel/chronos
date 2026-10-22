/**
 * The document returning to view, as an event.
 *
 * This is the other half of the background-tab story. While the tab is
 * hidden, the browser throttles its timers — an overdue focus session may
 * finish minutes late in wall-clock terms. The engine already recomputes
 * everything from timestamps on each `tick()`, so the *one* thing the
 * binding needs is a prompt to call `tick()` the moment the user returns.
 * Or rather, the moment the user returns *early* — a tab left past the end
 * gets caught up by the first throttled tick anyway, and this event pulls
 * that reconciliation into real time instead of waiting for it.
 *
 * The document is an argument, not a global, for the same reason the
 * repository takes `Storage` and the notifier takes its platform: the
 * subscription's behavior is testable without a browser, and the day-4
 * wiring passes `document` in as the one place impurity enters.
 *
 * Fires only on *transitions* into visibility — reading `visibilityState`
 * live at event time, since the browser flips the flag before firing
 * `visibilitychange`. No payload trust, no extra options; the handler runs
 * after the flip, which is exactly what "the user can see it now" means.
 */

type VisibilityDocument = Pick<
  Document,
  'addEventListener' | 'removeEventListener' | 'visibilityState'
>

export function onDocumentVisible(doc: VisibilityDocument, handler: () => void): () => void {
  const listener = (): void => {
    if (doc.visibilityState === 'visible') handler()
  }

  doc.addEventListener('visibilitychange', listener)

  return () => {
    doc.removeEventListener('visibilitychange', listener)
  }
}
