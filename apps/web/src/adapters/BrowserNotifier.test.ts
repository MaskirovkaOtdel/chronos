import { beforeEach, describe, expect, it } from 'vitest'
import type { NotificationPermissionState, NotificationRequest } from '@chronos/core'
import { EXTEND_FIVE_MINUTES, SESSION_NOTIFICATION_TAG } from '@chronos/core'
import { BrowserNotifier } from './BrowserNotifier'

/**
 * The adapter's pin suite — every promise the port makes about the web
 * Notification API, made testable here because jsdom has no Notification at
 * all: the platform is a class of our own, its answers scripted by the test.
 *
 * Three of these pins are load-bearing and easy to break silently. `notify()`
 * must resolve on every failure path — a rejecting notify would reject the
 * timer's *finished* verb and make a completed segment look unfinished.
 * `requestPermission()` must answer with a value and never a throw. And the
 * ask counter — not the browser's permission state — is what stops a
 * dismissed prompt from becoming a nag on every subsequent start.
 */

/** A platform whose answers a test scripts; records every prompt and card. */
class FakeNotificationPlatform {
  static permission: NotificationPermissionState = 'default'
  static nextAnswer: NotificationPermissionState = 'granted'
  static requestFail = false
  static throwOnConstruct = false
  static promptCount = 0
  static instances: Array<{
    title: string
    options?: { body?: string; tag?: string } | undefined
  }> = []

  static reset(): void {
    FakeNotificationPlatform.permission = 'default'
    FakeNotificationPlatform.nextAnswer = 'granted'
    FakeNotificationPlatform.requestFail = false
    FakeNotificationPlatform.throwOnConstruct = false
    FakeNotificationPlatform.promptCount = 0
    FakeNotificationPlatform.instances = []
  }

  static requestPermission(): Promise<NotificationPermissionState> {
    FakeNotificationPlatform.promptCount += 1
    if (FakeNotificationPlatform.requestFail)
      return Promise.reject(new Error('the shell refused to ask'))

    const answer = FakeNotificationPlatform.nextAnswer
    FakeNotificationPlatform.permission = answer
    return Promise.resolve(answer)
  }

  readonly title: string
  readonly options: { body?: string; tag?: string } | undefined

  constructor(title: string, options?: { body?: string; tag?: string }) {
    if (FakeNotificationPlatform.throwOnConstruct)
      throw new Error('the OS refused this notification')

    this.title = title
    this.options = options
    FakeNotificationPlatform.instances.push({ title, options })
  }
}

const FOCUS_DONE: NotificationRequest = {
  title: 'Focus complete',
  body: 'Time for a break.',
  tag: SESSION_NOTIFICATION_TAG,
}

describe('BrowserNotifier', () => {
  beforeEach(() => {
    FakeNotificationPlatform.reset()
  })

  describe('supported', () => {
    it('reads false with no platform', () => {
      expect(new BrowserNotifier().supported).toBe(false)
    })

    it('reads true with an injected platform', () => {
      expect(new BrowserNotifier(FakeNotificationPlatform).supported).toBe(true)
    })
  })

  describe('permission', () => {
    it('mirrors the platform without prompting', () => {
      FakeNotificationPlatform.permission = 'denied'
      const notifier = new BrowserNotifier(FakeNotificationPlatform)

      expect(notifier.permission).toBe('denied')
      expect(FakeNotificationPlatform.promptCount).toBe(0)
    })

    it("reads 'default' when there is no platform", () => {
      expect(new BrowserNotifier().permission).toBe('default')
    })
  })

  describe('notify', () => {
    it('resolves without constructing when there is no platform', async () => {
      await expect(new BrowserNotifier().notify(FOCUS_DONE)).resolves.toBeUndefined()
      expect(FakeNotificationPlatform.instances).toHaveLength(0)
    })

    it('stays silent while permission is still default', async () => {
      await expect(
        new BrowserNotifier(FakeNotificationPlatform).notify(FOCUS_DONE),
      ).resolves.toBeUndefined()
      expect(FakeNotificationPlatform.instances).toHaveLength(0)
    })

    it('stays silent when the user denied', async () => {
      FakeNotificationPlatform.permission = 'denied'

      await expect(
        new BrowserNotifier(FakeNotificationPlatform).notify(FOCUS_DONE),
      ).resolves.toBeUndefined()
      expect(FakeNotificationPlatform.instances).toHaveLength(0)
    })

    it('renders title, body and tag exactly when granted', async () => {
      FakeNotificationPlatform.permission = 'granted'

      await expect(
        new BrowserNotifier(FakeNotificationPlatform).notify(FOCUS_DONE),
      ).resolves.toBeUndefined()

      expect(FakeNotificationPlatform.instances).toHaveLength(1)
      expect(FakeNotificationPlatform.instances[0]).toEqual({
        title: 'Focus complete',
        options: { body: 'Time for a break.', tag: SESSION_NOTIFICATION_TAG },
      })
    })

    it('passes nothing but body and tag — actions belong to the app', async () => {
      FakeNotificationPlatform.permission = 'granted'
      const withActions: NotificationRequest = {
        ...FOCUS_DONE,
        actions: [{ id: EXTEND_FIVE_MINUTES, label: '+5 minutes' }],
      }

      await expect(
        new BrowserNotifier(FakeNotificationPlatform).notify(withActions),
      ).resolves.toBeUndefined()

      expect(FakeNotificationPlatform.instances[0]?.options).toEqual({
        body: 'Time for a break.',
        tag: SESSION_NOTIFICATION_TAG,
      })
    })

    it('resolves even when the platform refuses to construct', async () => {
      FakeNotificationPlatform.permission = 'granted'
      FakeNotificationPlatform.throwOnConstruct = true

      await expect(
        new BrowserNotifier(FakeNotificationPlatform).notify(FOCUS_DONE),
      ).resolves.toBeUndefined()
    })
  })

  describe('requestPermission', () => {
    it("answers 'denied' without prompting when there is no platform", async () => {
      await expect(new BrowserNotifier().requestPermission()).resolves.toBe('denied')
      expect(FakeNotificationPlatform.promptCount).toBe(0)
    })

    it('forwards the prompt and resolves granted', async () => {
      FakeNotificationPlatform.nextAnswer = 'granted'

      await expect(new BrowserNotifier(FakeNotificationPlatform).requestPermission()).resolves.toBe(
        'granted',
      )
      expect(FakeNotificationPlatform.promptCount).toBe(1)
    })

    it('resolves denied when the user denies', async () => {
      FakeNotificationPlatform.nextAnswer = 'denied'

      await expect(new BrowserNotifier(FakeNotificationPlatform).requestPermission()).resolves.toBe(
        'denied',
      )
    })

    it("resolves denied for a dismissed prompt — 'default' granted nothing", async () => {
      FakeNotificationPlatform.nextAnswer = 'default'

      await expect(new BrowserNotifier(FakeNotificationPlatform).requestPermission()).resolves.toBe(
        'denied',
      )
    })

    it('resolves denied when the platform rejects the promise', async () => {
      FakeNotificationPlatform.requestFail = true

      await expect(new BrowserNotifier(FakeNotificationPlatform).requestPermission()).resolves.toBe(
        'denied',
      )
    })
  })

  describe('askForPermission', () => {
    it('returns null without prompting when there is no platform', async () => {
      await expect(new BrowserNotifier().askForPermission()).resolves.toBeNull()
      expect(FakeNotificationPlatform.promptCount).toBe(0)
    })

    it('a cold start with default permission prompts exactly once', async () => {
      const notifier = new BrowserNotifier(FakeNotificationPlatform)
      FakeNotificationPlatform.nextAnswer = 'granted'

      await expect(notifier.askForPermission()).resolves.toBe('granted')

      expect(FakeNotificationPlatform.promptCount).toBe(1)
      expect(notifier.permission).toBe('granted')
    })

    it('returns null when the platform already knows the answer as granted', async () => {
      FakeNotificationPlatform.permission = 'granted'

      await expect(
        new BrowserNotifier(FakeNotificationPlatform).askForPermission(),
      ).resolves.toBeNull()
      expect(FakeNotificationPlatform.promptCount).toBe(0)
    })

    it('returns null when the platform already knows the answer as denied', async () => {
      FakeNotificationPlatform.permission = 'denied'

      await expect(
        new BrowserNotifier(FakeNotificationPlatform).askForPermission(),
      ).resolves.toBeNull()
      expect(FakeNotificationPlatform.promptCount).toBe(0)
    })

    it('a second ask in the same instance resolves null — the counter, not permission, stops the repeat', async () => {
      const notifier = new BrowserNotifier(FakeNotificationPlatform)

      expect(await notifier.askForPermission()).toBe('granted')
      expect(await notifier.askForPermission()).toBeNull()
      expect(FakeNotificationPlatform.promptCount).toBe(1)
    })

    it('after a dismissed prompt it still refuses a second ask — permission stays default, so only the counter helps', async () => {
      const notifier = new BrowserNotifier(FakeNotificationPlatform)
      FakeNotificationPlatform.nextAnswer = 'default'

      expect(await notifier.askForPermission()).toBe('denied')
      expect(notifier.permission).toBe('default')

      expect(await notifier.askForPermission()).toBeNull()
      expect(FakeNotificationPlatform.promptCount).toBe(1)
    })

    it('two concurrent asks share one prompt', async () => {
      const notifier = new BrowserNotifier(FakeNotificationPlatform)

      const [first, second] = await Promise.all([
        notifier.askForPermission(),
        notifier.askForPermission(),
      ])

      expect(first).toBe('granted')
      expect(second).toBeNull()
      expect(FakeNotificationPlatform.promptCount).toBe(1)
    })
  })
})
