/**
 * Local-day keys.
 *
 * **Why not UTC.** A streak that counts UTC days breaks the moment the user
 * travels: a session at 23:30 in Tokyo is the *previous* day in UTC, so a
 * streak can silently lose a day. The plan's rule 16 is blunt about it —
 * *"Streaks bucket by the user's local day, not UTC — or travelling silently
 * breaks the streak."*
 *
 * **Why not Temporal.** The plan's rule 17: *"Temporal never enters the Focus
 * route. Local-day keys use `Intl.DateTimeFormat`."* Temporal is quarantined
 * behind `/world` ✓, and `Intl` is already in every browser and every Node
 * runtime ✓, so a day key costs nothing to ship.
 *
 * **Why the locale is irrelevant.** The key is assembled from
 * `formatToParts`, not from a formatted string: a formatted string would
 * carry the user's locale's separators and order, and "20/10/2026" is not a
 * key anything can compare.
 */

/** The formatters are cached per zone — the plan's world-clock performance trap. */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(zone: string): Intl.DateTimeFormat {
  const cached = formatters.get(zone)
  if (cached !== undefined) return cached

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  })

  formatters.set(zone, formatter)
  return formatter
}

/** The parts of an instant, as seen in a zone. */
interface ZonedParts {
  readonly year: string
  readonly month: string
  readonly day: string
  readonly hour: string
  readonly minute: string
  readonly second: string
}

function partsIn(epochMs: number, zone: string): ZonedParts {
  const parts = formatterFor(zone).formatToParts(new Date(epochMs))

  const value = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type)
    return part?.value ?? '0'
  }

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

/**
 * The local day an instant falls on, as `YYYY-MM-DD`.
 *
 * The key is a plain string because that is what makes the rest of the stats
 * cheap: sorting day keys sorts days ✓, and a set of them is a set of days ✓.
 */
export function dayKey(epochMs: number, zone: string): string {
  const { year, month, day } = partsIn(epochMs, zone)
  return `${year}-${month}-${day}`
}

/** The hour of the local day an instant falls on, `0`–`23`. */
export function hourOfDay(epochMs: number, zone: string): number {
  return Number(partsIn(epochMs, zone).hour)
}

/**
 * Where an instant sits in its local day, as a fraction from `0` to `1`.
 *
 * The day ribbon places sessions at *"true clock positions"* (§6) — a session
 * that started at 09:30 belongs at 09:30, not at "some time in the morning" ✓.
 *
 * The fraction is over the day's **actual** length ✓, which is 23 or 25 hours
 * twice a year ✓ — see {@link dayLengthMs}.
 */
export function dayFraction(epochMs: number, zone: string): number {
  const timeOfDayMs = timeOfDayInMs(epochMs, zone)
  return timeOfDayMs / dayLengthMs(epochMs, zone)
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function zoneOffsetMs(epochMs: number, zone: string): number {
  const { year, month, day, hour, minute, second } = partsIn(epochMs, zone)
  const wallClock = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )
  return wallClock - Math.floor(epochMs / 1000) * 1000
}

/** The local time of day, in milliseconds since local midnight. */
function timeOfDayInMs(epochMs: number, zone: string): number {
  const { hour, minute, second } = partsIn(epochMs, zone)
  return (Number(hour) * 3600 + Number(minute) * 60 + Number(second)) * 1000
}

/** The UTC instant of the local midnight of the day containing `epochMs`. */
function localMidnightUtc(epochMs: number, zone: string): number {
  const guess = Math.floor((epochMs - timeOfDayInMs(epochMs, zone)) / 1000) * 1000

  // The guess was computed with the offset *now*, and at a DST boundary the
  // offset at the midnight is a different one — so correct it by the
  // difference. On an ordinary day the two offsets are equal and this is a
  // no-op.
  const offsetNow = zoneOffsetMs(epochMs, zone)
  const offsetThere = zoneOffsetMs(guess, zone)
  return guess + offsetNow - offsetThere
}

/**
 * The whole day's length in milliseconds, in a zone.
 *
 * Almost always 24 hours, and **not always**: on the day a zone springs
 * forward the day is 23 hours long, and on the day it falls back, 25 ✓. A
 * ribbon that assumed 86 400 000 would misplace every session on those two
 * days a year ✓ — and the plan's day 9 exists precisely to hunt for that.
 */
export function dayLengthMs(epochMs: number, zone: string): number {
  const start = localMidnightUtc(epochMs, zone)
  // The next local midnight is at most 25 hours away, so 25 hours from *this
  // midnight* is always inside the next day — and is the next day's midnight.
  // (Measured from an arbitrary instant instead, the step can overshoot into
  // the day after next: noon plus 36 hours is midnight two days later.)
  const next = localMidnightUtc(start + 25 * 60 * 60 * 1000, zone)
  return next - start
}
