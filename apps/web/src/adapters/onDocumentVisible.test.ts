import { describe, expect, it } from 'vitest'
import { onDocumentVisible } from './onDocumentVisible'

/**
 * The subscription's behavior, on a document of our own: a Set of listeners
 * plus a one-method simulation of the browser's flip-then-fire. Node
 * environment, no jsdom — nothing here needs a real DOM, only the exact
 * three members the module declares it touches.
 *
 * The listener signatures mirror the DOM's (callback as a function or
 * handler object, options after them) so the double is assignable to the
 * real `Pick<...>` type without a cast; the tests then hand listeners as the
 * plain functions they are.
 */
class FakeDocument {
  visibilityState: 'hidden' | 'visible' = 'hidden'
  readonly #listeners = new Set<EventListener>()

  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    _options?: boolean | AddEventListenerOptions,
  ): void {
    if (type === 'visibilitychange' && typeof callback === 'function') {
      this.#listeners.add(callback)
    }
  }

  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    _options?: boolean | EventListenerOptions,
  ): void {
    if (type === 'visibilitychange' && typeof callback === 'function') {
      this.#listeners.delete(callback)
    }
  }

  /** Flips the document's state, then fires the change event — as a real one does. */
  changeTo(state: 'hidden' | 'visible'): void {
    this.visibilityState = state
    for (const listener of [...this.#listeners]) {
      listener({ type: 'visibilitychange' } as unknown as Event)
    }
  }

  /** How many listeners are currently attached to visibilitychange. */
  get changeListenerCount(): number {
    return this.#listeners.size
  }
}

describe('onDocumentVisible', () => {
  it('fires when the document becomes visible', () => {
    const doc = new FakeDocument()
    let calls = 0

    onDocumentVisible(doc, () => {
      calls += 1
    })
    doc.changeTo('visible')

    expect(calls).toBe(1)
  })

  it('does not fire when the document becomes hidden', () => {
    const doc = new FakeDocument()
    doc.visibilityState = 'visible'
    let calls = 0

    onDocumentVisible(doc, () => {
      calls += 1
    })
    doc.changeTo('hidden')

    expect(calls).toBe(0)
  })

  it('fires only on transitions, not on registration', () => {
    const doc = new FakeDocument()
    doc.visibilityState = 'visible'
    let calls = 0

    onDocumentVisible(doc, () => {
      calls += 1
    })

    expect(calls).toBe(0)
  })

  it('fires again on each return', () => {
    const doc = new FakeDocument()
    let calls = 0

    onDocumentVisible(doc, () => {
      calls += 1
    })
    doc.changeTo('visible')
    doc.changeTo('hidden')
    doc.changeTo('visible')

    expect(calls).toBe(2)
  })

  it('stops firing — and detaches — after the returned function', () => {
    const doc = new FakeDocument()
    let calls = 0

    const detach = onDocumentVisible(doc, () => {
      calls += 1
    })
    detach()

    expect(doc.changeListenerCount).toBe(0)

    doc.changeTo('visible')

    expect(calls).toBe(0)
  })

  it('leaves other subscriptions undisturbed when one detaches', () => {
    const doc = new FakeDocument()
    let first = 0
    let second = 0

    const detachFirst = onDocumentVisible(doc, () => {
      first += 1
    })
    onDocumentVisible(doc, () => {
      second += 1
    })

    detachFirst()
    doc.changeTo('visible')

    expect(first).toBe(0)
    expect(second).toBe(1)
  })
})
