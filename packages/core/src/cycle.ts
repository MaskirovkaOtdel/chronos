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
 * Which segment follows a session that has just finished.
 *
 * "Finished" covers both ways a session ends: it reached its plan
 * (*completed*) or the user stopped it (*partial*). Both ask the same
 * question, and the answer branches on the **kind**, not on how the session
 * ended — so a partial focus and a completed focus are both followed by a
 * break, and they are followed by the *same* break.
 *
 * **The cycle.** A focus is always followed by a break, and a break is always
 * followed by a focus — so the interesting decision is only *which* break. It
 * is the long one when the focus that just finished completed the cadence:
 *
 * ```
 * focusCount % focusPreset.longBreakAfter === 0
 * ```
 *
 * With the classic cadence of 4, the fourth focus earns a long break and the
 * first three earn a short one. The boundary is where the arithmetic is
 * load-bearing, which is why it is the only thing in this file.
 *
 * **`focusCount` is the cycle position, and it is the count as it stands
 * after the session that just finished.** The caller advances it for every
 * focus that reaches a conclusion — completed *or* ended early — and leaves
 * it alone for a break.
 *
 * That is the whole point of counting positions rather than completions. The
 * cycle is a rhythm of *focuses run*: every fourth focus gets the long break
 * whether it was finished or abandoned. A count of completions cannot drive
 * it, because one skipped focus leaves the completions and the positions out
 * of step — the count would then hand out a second long break in a row, or a
 * long break before anything had been finished at all.
 *
 * This is the one place where "how much have I done" and "how far through the
 * cadence am I" come apart, and they are deliberately different questions:
 *
 * - **the cadence** counts focuses run, because a cadence of "four focuses"
 *   means four focuses in the cycle — and it is a rhythm, not a reward;
 * - **the history** records every finished session, partial or not, with
 *   `completed` saying which — and the statistics read *that* to report how
 *   much was actually done.
 *
 * A partial is still recorded honestly. It simply does not excuse the user
 * from the cycle, and it is never reported as a finished focus.
 *
 * Breaks do not advance the count either. The count answers "how many focuses
 * have run", and a break is not a focus.
 *
 * Pure: no clock, no repository, no state. The whole cycle decision is one
 * function over three values, which is why it can be tested exhaustively.
 */
export function nextSegmentAfterFinish(
  finishedKind: SegmentKind,
  focusCount: number,
  focusPreset: FocusPreset = FOCUS_25,
): NextSegment {
  if (finishedKind !== 'focus') {
    return {
      kind: 'focus',
      presetId: focusPreset.id,
      durationMs: focusPreset.durationMs,
    }
  }

  const breakPreset = focusCount % focusPreset.longBreakAfter === 0 ? LONG_BREAK : SHORT_BREAK

  return {
    kind: breakPreset.kind,
    presetId: breakPreset.id,
    durationMs: breakPreset.durationMs,
  }
}
