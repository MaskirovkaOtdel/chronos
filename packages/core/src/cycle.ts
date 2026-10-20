import type { SegmentKind } from './session.js'
import type { FocusPreset } from './presets.js'
import { FOCUS_25, LONG_BREAK, SHORT_BREAK } from './presets.js'

/**
 * The segment that follows a completed one.
 *
 * The kind, the preset and the duration together, because "a short break" is
 * not a runnable instruction on its own — a caller needs the id to start and
 * the length to display.
 */
export interface NextSegment {
  readonly kind: SegmentKind
  readonly presetId: string
  readonly durationMs: number
}

/**
 * Which segment follows a completed one.
 *
 * **The cycle.** A focus is always followed by a break, and a break is always
 * followed by a focus — so the interesting decision is only *which* break. It
 * is the long one when the focus that just finished completed the cadence:
 *
 * ```
 * completedFocusCount % focusPreset.longBreakAfter === 0
 * ```
 *
 * With the classic cadence of 4, the fourth focus earns a long break and the
 * first three earn a short one. The boundary is where the arithmetic is
 * load-bearing, which is why it is the only thing in this file.
 *
 * **`completedFocusCount` is the count *after* the increment.** The caller has
 * already counted the focus that just finished, so the count says "we have
 * just finished focus #3 of 4" — and 3 is not a multiple of 4, while 4 is. An
 * off-by-one here silently demotes every long break to a short one, which is
 * exactly the kind of bug that only shows up weeks later.
 *
 * Breaks do not advance the count. Only completed focus sessions do, because
 * the count answers "how far through the cadence are we", and a break is not
 * part of the cadence.
 *
 * Pure: no clock, no repository, no state. The whole cycle decision is one
 * function over three values, which is why it can be tested exhaustively.
 */
export function nextSegmentAfterCompletion(
  completedKind: SegmentKind,
  completedFocusCount: number,
  focusPreset: FocusPreset = FOCUS_25,
): NextSegment {
  if (completedKind !== 'focus') {
    return {
      kind: 'focus',
      presetId: focusPreset.id,
      durationMs: focusPreset.durationMs,
    }
  }

  const breakPreset =
    completedFocusCount % focusPreset.longBreakAfter === 0 ? LONG_BREAK : SHORT_BREAK

  return {
    kind: breakPreset.kind,
    presetId: breakPreset.id,
    durationMs: breakPreset.durationMs,
  }
}
