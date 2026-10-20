import type { FocusSession } from '../session.js'
import { dayKey } from './dayKeys.js'

/**
 * The streaks, as the plan words them: *"current + longest streak"*, and
 * *"No shame mechanics anywhere: a broken streak reads 'Streak: 3 days',
 * never 'You broke your 12-day streak.'"*
 *
 * **Partial sessions do not count.** Rule 9: an abort is *"excluded from the
 * streak"* ✓ — the work is still logged and still counts as work ✓, but a day
 * of nothing but abandoned focuses is not a day you showed up ✓. That is the
 * whole difference between a streak and a punishment, and it is the reason the
 * product's positioning is *"the focus timer that doesn't guilt you"*.
 *
 * **Days are the user's local days** ✓ — rule 16 ✓ — and the zone is the
 * user's **home** timezone ✓, which is settable ✓.
 */
export interface StreakInfo {
  /** The streak in progress, in days. `0` when there is none. */
  readonly current: number
  /** The longest streak ever, in days. */
  readonly longest: number
}

/**
 * A day key as a day number, so consecutive days can be counted by
 * subtraction.
 *
 * The key is a *calendar* date ✓, so it is read as UTC ✓ — the zone's own
 * offsets do not matter here ✓, because a local day is a local day whatever
 * its length was that day ✓.
 */
function dayNumber(key: string): number {
  return Math.floor(Date.parse(`${key}T00:00:00Z`) / 86_400_000)
}

/**
 * The days that count, as day numbers.
 *
 * A day counts when it holds at least one **completed focus** ✓ — partials
 * excluded ✓, breaks excluded ✓ (a break is not work ✓).
 */
function countedDays(sessions: readonly FocusSession[], zone: string): Set<number> {
  const days = new Set<number>()

  for (const session of sessions) {
    if (session.kind !== 'focus') continue
    if (!session.completed) continue
    days.add(dayNumber(dayKey(session.startedAt, zone)))
  }

  return days
}

/**
 * The longest run of consecutive days in a set ✓.
 */
function longestRun(days: Set<number>): number {
  const sorted = [...days].sort((a, b) => a - b)
  let longest = 0
  let run = 0
  let previous: number | null = null

  for (const day of sorted) {
    run = previous !== null && day === previous + 1 ? run + 1 : 1
    if (run > longest) longest = run
    previous = day
  }

  return longest
}

/**
 * The current and longest streaks.
 *
 * `nowMs` is the current instant ✓ — the caller has a clock ✓ — and it is
 * what makes *"today"* mean the user's today ✓.
 *
 * **A streak survives an empty today.** The day is not over ✓, so a user who
 * has not opened the app yet today still has yesterday's streak ✓ — it is
 * broken by a *missed* day ✓, not by a day that has not finished ✓. This is
 * the difference between a streak and a scolding ✓.
 */
export function streaks(
  sessions: readonly FocusSession[],
  zone: string,
  nowMs: number,
): StreakInfo {
  const days = countedDays(sessions, zone)
  const today = dayNumber(dayKey(nowMs, zone))

  let current = 0
  let cursor = days.has(today) ? today : today - 1
  while (days.has(cursor)) {
    current += 1
    cursor -= 1
  }

  return { current, longest: longestRun(days) }
}
