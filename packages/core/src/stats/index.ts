/**
 * Statistics over the history.
 *
 * Everything in here is **derived** — the data model says stats are never
 * persisted, so a number that disagrees with the sessions cannot be
 * authoritative ✓. The zone is always an input ✓, because the user's home
 * timezone drives the bucketing and is settable ✓.
 */
export { dayKey, hourOfDay, dayFraction, dayLengthMs } from './dayKeys.js'
export { summary } from './summaries.js'
export type { StatsSummary } from './summaries.js'
export { streaks } from './streaks.js'
export type { StreakInfo } from './streaks.js'
export { ribbonForDay } from './ribbon.js'
export type { RibbonSegment } from './ribbon.js'
