import { EmptyState } from '../components/EmptyState'

export function HistoryRoute() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <h1 tabIndex={-1}>History</h1>

      {/* Warm and forward-looking, per §9's "no shame mechanics" — it says what
          will appear, never what has been failed to do. */}
      <EmptyState>Nothing recorded yet. Your days will draw themselves here.</EmptyState>

      <p className="mx-auto max-w-md text-center text-sm text-muted">
        Placeholder — session log, analytics and the shared period selector.
      </p>
    </div>
  )
}
