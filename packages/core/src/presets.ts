import type { SegmentKind } from './session.js'

/**
 * A preset: the *definition* of a segment — how long it runs and what it is.
 *
 * `FocusSession.presetId` points back at one of these, so history stays legible
 * if the catalogue changes later. A preset is deliberately the only place a
 * duration lives: a session that also carried its own duration could disagree
 * with the preset that produced it, and the two numbers would then mean
 * different things in the history and on the timer.
 */
export interface Preset {
  readonly id: string
  readonly kind: SegmentKind
  readonly durationMs: number
}

/**
 * A focus preset, which also carries the long-break cadence.
 *
 * The cadence belongs to the *focus* preset and not to the app: "after four
 * 25-minute focuses, take a long break" and "after three 50-minute focuses,
 * take a long break" are different rhythms, and only the focus being run knows
 * which one applies.
 */
export interface FocusPreset extends Preset {
  readonly kind: 'focus'
  /**
   * How many completed focus sessions run before the long break replaces the
   * short one. The classic cadence is 4.
   */
  readonly longBreakAfter: number
}

/** A break preset. Breaks carry no cadence of their own. */
export interface BreakPreset extends Preset {
  readonly kind: 'short_break' | 'long_break'
}

export type AnyPreset = FocusPreset | BreakPreset

/** The default focus preset: 25 minutes, long break every fourth focus. */
export const FOCUS_25: FocusPreset = {
  id: 'focus-25',
  kind: 'focus',
  durationMs: 25 * 60 * 1000,
  longBreakAfter: 4,
}

/** The break that follows an ordinary focus session. */
export const SHORT_BREAK: BreakPreset = {
  id: 'short-break-5',
  kind: 'short_break',
  durationMs: 5 * 60 * 1000,
}

/** The break that follows the focus that completes the cadence. */
export const LONG_BREAK: BreakPreset = {
  id: 'long-break-15',
  kind: 'long_break',
  durationMs: 15 * 60 * 1000,
}

/**
 * The catalogue, keyed by id.
 *
 * Three presets, and that is a deliberate minimum rather than a catalogue:
 * the cycle needs exactly one focus preset (to know the cadence), one short
 * break and one long break. A user-facing catalogue of focus lengths is a
 * settings feature, and it belongs to phase 4 with the settings screen that
 * will choose between them — a `PRESETS` table that grew here would be
 * guessing at a list the user has not been asked for yet.
 */
export const PRESETS: Readonly<Record<string, AnyPreset>> = {
  [FOCUS_25.id]: FOCUS_25,
  [SHORT_BREAK.id]: SHORT_BREAK,
  [LONG_BREAK.id]: LONG_BREAK,
}

/** The preset for `id`, or `null` when the catalogue has no such entry. */
export function findPreset(id: string): AnyPreset | null {
  return PRESETS[id] ?? null
}
