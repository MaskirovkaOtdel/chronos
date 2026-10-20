import { EmptyState } from '../components/EmptyState'

export function WorldRoute() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <h1 tabIndex={-1}>World</h1>

      {/* §6.2's copy, verbatim. */}
      <EmptyState>Add a city to see the other side of the world light up.</EmptyState>

      <p className="mx-auto max-w-md text-center text-sm text-muted">
        The world clock, converter and daylight astronomy arrive in phase 3. Temporal stays
        lazy-loaded behind this route; it never enters the Focus bundle.
      </p>
    </div>
  )
}
