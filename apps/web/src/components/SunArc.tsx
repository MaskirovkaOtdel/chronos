/**
 * The sun-arc motif (§8): *"a warm arc filling like the sun crossing the sky —
 * dawn → amber → dusk."* It is a **system**, not a one-off — the timer ring, the
 * world-clock daylight bands, the day ribbons, the loading indicator and empty
 * states all reuse it, which is why it lives as a component from day one rather
 * than being drawn inline wherever it is needed.
 *
 * Day 8 ships it **static**: the dim, desaturated arc of the idle Focus screen
 * (§6.1), with the sun still sitting at the dawn end. The fill becomes live in
 * phase 2 and is driven by CSS/rAF — §8 is explicit that **no React re-render
 * happens per frame**, so nothing here may read React state to position the
 * fill. `progress` is only ever set between frames, never during one.
 *
 * Decorative by contract: the timer's text carries the state, so the arc is
 * `aria-hidden`. §9 requires the arc to *survive* `prefers-reduced-motion`
 * once it conveys information — that belongs to the live arc, not this one.
 */

const CX = 60
const CY = 60
const R = 52
/** Top semicircle, dawn (left) to dusk (right). Same sweep as the brand mark. */
const ARC = `M${CX - R} ${CY} A${R} ${R} 0 0 1 ${CX + R} ${CY}`
/** πr — the path length, for `stroke-dashoffset`. */
const ARC_LENGTH = Math.PI * R

type SunArcProps = {
  /** 0 = dawn, 1 = dusk. The idle placeholder ships at 0. */
  progress?: number
  className?: string
}

export function SunArc({ progress = 0, className }: SunArcProps) {
  // Clamped rather than trusted: a bad value would push the dot off the path.
  const p = Math.min(1, Math.max(0, progress))
  const theta = p * Math.PI
  const dotX = CX - R * Math.cos(theta)
  const dotY = CY - R * Math.sin(theta)

  return (
    <svg viewBox="0 0 120 68" fill="none" aria-hidden="true" className={className}>
      {/* Track — dim and desaturated, which is what "idle" reads as. */}
      <path
        d={ARC}
        stroke="var(--muted)"
        strokeOpacity="0.3"
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* Fill — drawn from the dawn end. Nothing at progress 0. */}
      <path
        d={ARC}
        stroke="var(--focus)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={ARC_LENGTH}
        strokeDashoffset={ARC_LENGTH * (1 - p)}
      />
      {/* The sun, still at dawn until the session starts. */}
      <circle cx={dotX} cy={dotY} r="5" fill="var(--focus)" />
    </svg>
  )
}
