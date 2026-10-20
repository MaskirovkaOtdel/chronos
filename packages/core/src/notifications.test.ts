import { describe, expect, it } from 'vitest'
import type { FocusSession } from './session.js'
import {
  EXTEND_FIVE_MINUTES,
  notificationFor,
  SESSION_NOTIFICATION_TAG,
  shouldAskForPermission,
  SKIP_TO_BREAK,
} from './notifications.js'
import { createTimer } from './timer.js'
import { InMemorySessionRepository } from './testing/InMemorySessionRepository.js'
import { FakeNotifier } from './testing/FakeNotifier.js'
import { ManualClock } from './testing/ManualClock.js'
import { makeFocusSession } from './testing/fixtures.js'

const GRANTED = { supported: true, permission: 'granted', whileAway: false } as const
const DENIED = { supported: true, permission: 'denied', whileAway: false } as const
const UNSUPPORTED = { supported: false, permission: 'granted', whileAway: false } as const

function finishedFocus(): FocusSession {
  return makeFocusSession({
    id: 's1',
    kind: 'focus',
    endedAt: 1_500_000,
    actualMs: 1_500_000,
    completed: true,
  })
}

function finishedBreak(): FocusSession {
  return makeFocusSession({
    id: 'b1',
    kind: 'short_break',
    presetId: 'short-break-5',
    endedAt: 300_000,
    actualMs: 300_000,
    completed: true,
  })
}

describe('the notification policy', () => {
  it("says the plan's words when a focus completes", () => {
    const notification = notificationFor(finishedFocus(), GRANTED)

    expect(notification?.title).toBe('Session complete.')
    expect(notification?.body).toBe("Look up — you've earned a break.")
  })

  it("says the plan's words when a break completes", () => {
    const notification = notificationFor(finishedBreak(), GRANTED)

    expect(notification?.title).toBe("Break's over.")
    expect(notification?.body).toBe('Ready when you are.')
  })

  it('says the session finished while you were away', () => {
    const notification = notificationFor(finishedFocus(), { ...GRANTED, whileAway: true })

    expect(notification?.body).toBe('Completed while you were away.')
  })

  it('carries one tag, so notifications replace rather than stack', () => {
    const notification = notificationFor(finishedFocus(), GRANTED)

    expect(notification?.tag).toBe(SESSION_NOTIFICATION_TAG)
    expect(SESSION_NOTIFICATION_TAG).toBe('chronos-session')
  })

  it('offers Extend 5m and Skip to break after a focus', () => {
    const notification = notificationFor(finishedFocus(), GRANTED)

    expect(notification?.actions?.map((action) => action.id)).toEqual([
      EXTEND_FIVE_MINUTES,
      SKIP_TO_BREAK,
    ])
    expect(notification?.actions?.map((action) => action.label)).toEqual([
      'Extend 5m',
      'Skip to break',
    ])
  })

  it('offers only Extend 5m after a break — there is no break after a break', () => {
    const notification = notificationFor(finishedBreak(), GRANTED)

    expect(notification?.actions?.map((action) => action.id)).toEqual([EXTEND_FIVE_MINUTES])
  })

  it('says nothing when the user refused permission', () => {
    expect(notificationFor(finishedFocus(), DENIED)).toBeNull()
  })

  it('says nothing on a platform with no notifications', () => {
    expect(notificationFor(finishedFocus(), UNSUPPORTED)).toBeNull()
  })

  it('is pure — the same segment always produces the same notification', () => {
    expect(notificationFor(finishedFocus(), GRANTED)).toEqual(
      notificationFor(finishedFocus(), GRANTED),
    )
  })
})

describe('the ask flow', () => {
  it('asks once, when nothing has been decided yet', () => {
    expect(
      shouldAskForPermission({ supported: true, permission: 'default', hasAsked: false }),
    ).toBe(true)
  })

  it('never asks again once it has asked', () => {
    expect(shouldAskForPermission({ supported: true, permission: 'default', hasAsked: true })).toBe(
      false,
    )
  })

  it('never asks a user who already said no', () => {
    expect(shouldAskForPermission({ supported: true, permission: 'denied', hasAsked: true })).toBe(
      false,
    )
  })

  it('never asks on a platform without notifications', () => {
    expect(
      shouldAskForPermission({ supported: false, permission: 'default', hasAsked: false }),
    ).toBe(false)
  })
})

describe('the timer, delivering what the policy decided', () => {
  function makeTimer() {
    const clock = new ManualClock(1_000)
    const repository = new InMemorySessionRepository()
    const notifier = new FakeNotifier()
    const timer = createTimer({ clock, repository, notifier })
    return { clock, timer, repository, notifier }
  }

  it('announces a completed focus', async () => {
    const { clock, timer, notifier } = makeTimer()
    notifier.permission = 'granted'

    await timer.start({ id: 's1', presetId: 'focus-25' })
    clock.advance(25 * 60 * 1000)
    await timer.tick()

    expect(notifier.sent).toHaveLength(1)
    expect(notifier.sent[0]?.title).toBe('Session complete.')
    expect(notifier.sent[0]?.tag).toBe(SESSION_NOTIFICATION_TAG)
  })

  it('announces nothing when permission was refused', async () => {
    const { clock, timer, notifier } = makeTimer()
    notifier.permission = 'denied'

    await timer.start({ id: 's1', presetId: 'focus-25' })
    clock.advance(25 * 60 * 1000)
    await timer.tick()

    expect(notifier.sent).toHaveLength(0)
  })

  it('announces nothing for a partial — a segment that did not finish is not news', async () => {
    const { clock, timer, notifier } = makeTimer()
    notifier.permission = 'granted'

    await timer.start({ id: 's1', presetId: 'focus-25' })
    clock.advance(60_000)
    await timer.endEarly()

    expect(notifier.sent).toHaveLength(0)
  })
})

describe('Extend 5m', () => {
  function makeTimer() {
    const clock = new ManualClock(1_000)
    const repository = new InMemorySessionRepository()
    const notifier = new FakeNotifier()
    const timer = createTimer({ clock, repository, notifier })
    return { clock, timer, repository, notifier }
  }

  async function runToCompletion() {
    const made = makeTimer()
    await made.timer.start({ id: 's1', presetId: 'focus-25' })
    made.clock.advance(25 * 60 * 1000)
    const finished = await made.timer.tick()
    return { ...made, finished }
  }

  it('adds to the planned duration and resumes the segment', async () => {
    const { timer, finished } = await runToCompletion()

    await timer.extend(finished as FocusSession, 5 * 60 * 1000)

    const state = timer.getState()
    expect(state.phase).toBe('running')
    expect(state.session?.plannedDurationMs).toBe(30 * 60 * 1000)
    expect(state.session?.endedAt).toBeNull()
    expect(state.session?.completed).toBe(false)
    // The work already done is untouched.
    expect(state.session?.startedAt).toBe(1_000)
  })

  it('undoes the cycle advance — the segment has not concluded after all', async () => {
    const { timer, finished } = await runToCompletion()
    expect(timer.getState().focusCount).toBe(1)

    await timer.extend(finished as FocusSession, 5 * 60 * 1000)

    expect(timer.getState().focusCount).toBe(0)
    expect(timer.getState().currentPresetId).toBe('focus-25')
  })

  it('takes the segment back out of the history — it is running again', async () => {
    const { timer, repository, finished } = await runToCompletion()
    expect(await repository.list()).toHaveLength(1)

    await timer.extend(finished as FocusSession, 5 * 60 * 1000)

    expect(await repository.list()).toHaveLength(0)
  })

  it('refuses while a segment is already running', async () => {
    const { timer } = makeTimer()
    await timer.start({ id: 's1', presetId: 'focus-25' })

    await expect(timer.extend(makeFocusSession({ id: 'old' }), 60_000)).rejects.toThrow(
      'extend() refused: a segment is already running',
    )
  })

  it('refuses an extension that is not a positive number of milliseconds', async () => {
    const { timer, finished } = await runToCompletion()

    for (const extraMs of [0, -1, Number.NaN]) {
      await expect(timer.extend(finished as FocusSession, extraMs)).rejects.toThrow(
        'extend() refused: the extension must be a positive number of milliseconds',
      )
    }
  })
})
