import type { FocusSession, SegmentKind } from '../session.js'
import { dayFraction, dayKey, dayLengthMs } from './dayKeys.js'

/**
 * One segment on the day ribbon (§6).
 *
 * The ribbon is the app's signature visualisation — *"a 24-hour band, dawn→dusk gradient
 * left-to-right — the sun arc unrolled flat"* — and the plan is explicit about what goes on it:
 * *"Focus sessions as clay segments at **true clock positions**; breaks as thin sage ticks."*
 *
 * "True clock positions" is the whole point ✓: a session that ran from 09:30 to 10:05 belongs
 * at that place on the band ✓, and a ribbon that showed "three sessions, somewhere in the
 * morning" would show nothing at all ✓.
 */
export interface RibbonSegment {
  readonly id: string
  readonly kind: SegmentKind
  /** Whether the session reached its planned duration. */
  readonly completed: boolean
  /** Where it starts in the local day, `0`–`1`. */
  readonly start: number
  /** Where it ends in the local day, `0`–`1`. */
  readonly end: number
}

/**
 * The segments of one local day, in the order they happened.
 *
 * `day` is a day key ✓ — the same `YYYY-MM-DD` the rest of the stats use ✓ —
 * and `zone` is the user's home timezone ✓, so "the day" means the day the
 * user lived through ✓.
 *
 * A session that starts on this day but runs past its end is clipped to the
 * band ✓: the ribbon shows the day ✓, and the overflow belongs to the next
 * day's ribbon ✓.
 */
export function ribbonForDay(
  sessions: readonly FocusSession[],
  zone: string,
  day: string,
): RibbonSegment[] {
  const todays = sessions.filter((session) => dayKey(session.startedAt, zone) === day)
  if (todays.length === 0) return []

  // Any instant in the day gives the same day length ✓ — the day is 23 or 25
  // hours long twice a year ✓, and the ribbon has to know which.
  const length = dayLengthMs(todays[0]?.startedAt ?? 0, zone)
  const segments: RibbonSegment[] = []

  for (const session of todays) {
    const start = dayFraction(session.startedAt, zone)
    const end = start + (session.actualMs ?? 0) / length

    segments.push({
      id: session.id,
      kind: session.kind,
      completed: session.completed,
      start: Math.max(0, start),
      end: Math.min(1, end),
    })
  }

  return segments.sort((a, b) => a.start - b.start)
}
