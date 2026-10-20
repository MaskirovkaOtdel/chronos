import type { FocusSession } from '../session.js'
import { dayKey, hourOfDay } from './dayKeys.js'

/**
 * The stats band (§6): *"total focus time · completed sessions · completion rate (neutral
 * number) · peak hours (24h distribution) · current + longest streak · daily average."*
 *
 * **Everything here is about focus sessions.** Breaks are shown in the ribbon,
 * not in the numbers — this is a focus timer, and a "total time" that quietly
 * included breaks would be a different product.
 *
 * **Nothing here is stored.** The data model says stats are derived, never
 * persisted, so a number that disagrees with the history cannot be
 * authoritative — it is recomputed from the sessions on every read.
 */
export interface StatsSummary {
  /** The focus time, summed over the focus sessions. */
  readonly totalFocusMs: number
  /** How many focus sessions reached their planned duration. */
  readonly completedSessions: number
  /** How many focus sessions ran at all, completed or not. */
  readonly totalSessions: number
  /**
   * Completed over total, or `null` when nothing ran.
   *
   * `null` rather than zero: "no sessions" and "zero percent of sessions
   * completed" are different facts, and a band that shows `0%` when the user
   * has simply not used the app yet is telling them something false.
   */
  readonly completionRate: number | null
  /** The focus time per local hour — 24 entries, the shape of the working day. */
  readonly hourlyFocusMs: readonly number[]
  /** The mean focus time across the days that had any focus. */
  readonly dailyAverageMs: number
}

/**
 * The stats band, derived from the history.
 *
 * `zone` is the user's **home** timezone ✓ — the plan is explicit that it is
 * settable and that it *"drives streak bucketing"* ✓. It is an input rather
 * than a global because the whole point of day 9 is a user whose home zone
 * changes mid-streak ✓.
 */
export function summary(sessions: readonly FocusSession[], zone: string): StatsSummary {
  const focus = sessions.filter((session) => session.kind === 'focus')

  let totalFocusMs = 0
  let completedSessions = 0
  const hourlyFocusMs = new Array<number>(24).fill(0)
  const days = new Set<string>()

  for (const session of focus) {
    const actual = session.actualMs ?? 0
    totalFocusMs += actual
    if (session.completed) completedSessions += 1

    const hour = hourOfDay(session.startedAt, zone)
    hourlyFocusMs[hour] = (hourlyFocusMs[hour] ?? 0) + actual
    days.add(dayKey(session.startedAt, zone))
  }

  return {
    totalFocusMs,
    completedSessions,
    totalSessions: focus.length,
    completionRate: focus.length === 0 ? null : completedSessions / focus.length,
    hourlyFocusMs,
    dailyAverageMs: days.size === 0 ? 0 : totalFocusMs / days.size,
  }
}
