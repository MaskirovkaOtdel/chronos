import type { ReactNode } from 'react'
import { SunArc } from './SunArc'

/**
 * §8: the arc motif recurs in *"the loading indicator, empty states, and the
 * story screen"* — it is an identity, not a logo file. Every empty state is
 * therefore the same quiet arc at dawn with the message beneath it, rather than
 * an illustration each designer invents.
 *
 * Empty states carry real copy and must stay warm and non-shaming (§9: *"no
 * shame mechanics anywhere"*) — they describe what will appear, never what the
 * user has failed to do.
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 px-6 py-14 text-center">
      <SunArc className="w-32" />
      <p className="text-base leading-relaxed text-muted">{children}</p>
    </div>
  )
}
