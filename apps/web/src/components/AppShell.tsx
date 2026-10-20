import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'

/**
 * §6: Settings is a route **but deliberately not a nav item** — it is reached
 * through the gear icon. That distinction is what keeps the tab bar to Focus,
 * World and History without an ever-growing list of destinations.
 */
const TABS = [
  { to: '/', label: 'Focus' },
  { to: '/world', label: 'World' },
  { to: '/history', label: 'History' },
] as const

/**
 * §9: *"route change moves focus to the `h1`."*
 *
 * Without this, every tab click strands keyboard and screen-reader focus on the
 * element that was just unmounted, dropping it back to `<body>` — the user then
 * has to tab through the whole shell to reach the new page's content.
 *
 * The first render is skipped deliberately: a focus move on initial load would
 * steal focus from the document itself for no navigational reason.
 */
function RouteFocus() {
  const { pathname } = useLocation()
  const isInitialRender = useRef(true)

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false
      return
    }
    document.querySelector('h1')?.focus()
  }, [pathname])

  return null
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-6 w-6"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function BrandMark() {
  /*
   * §8 brand mark — *"arc + sun ... sun crossing the sky or a hand sweeping a
   * dial, both readings true."* The gradient runs dawn → sun using theme tokens
   * so it tracks all 8 themes rather than being pinned to Warm.
   */
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="h-7 w-7">
      <defs>
        <linearGradient id="chronos-mark" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--long-break)" />
          <stop offset="1" stopColor="var(--focus)" />
        </linearGradient>
      </defs>
      <path
        d="M5 25 A11 11 0 0 1 27 25"
        stroke="url(#chronos-mark)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="23.8" cy="17.2" r="4.5" fill="var(--focus)" />
    </svg>
  )
}

/**
 * Structurally typed rather than importing `NavLinkRenderProps`: `NavLink`
 * calls this with `{ isActive, isPending, isTransitioning }`, and asking for
 * only `isActive` is both sufficient and stable across router versions.
 */
function tabClassName({ isActive }: { isActive: boolean }): string {
  return [
    'flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 px-2 py-1.5',
    'text-sm no-underline transition-colors',
    // Non-colour cues alongside `aria-current`: bar presence (shape) + weight.
    isActive ? 'font-semibold text-foreground' : 'font-normal text-muted',
  ].join(' ')
}

export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-20 focus:rounded-2xl focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:text-foreground"
      >
        Skip to content
      </a>

      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <BrandMark />
          {/* §8: the wordmark is Fraunces, carefully set — the display face's
              first real use. Not a link: the Focus tab already goes home, and a
              second "go home" target just duplicates it for screen readers. */}
          <span className="font-display text-lg tracking-tight text-foreground">Chronos</span>
        </div>

        <Link
          to="/settings"
          aria-label="Settings"
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition-colors hover:text-foreground"
        >
          <GearIcon />
        </Link>
      </header>

      <main id="main" tabIndex={-1} className="flex-1">
        <RouteFocus />
        <Outlet />
      </main>

      <nav
        aria-label="Primary"
        className="sticky bottom-0 z-10 bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="m-0 flex list-none p-0">
          {TABS.map((tab) => (
            <li key={tab.to} className="flex flex-1">
              <NavLink to={tab.to} end={tab.to === '/'} className={tabClassName} replace>
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={`h-1 w-7 rounded-full ${isActive ? 'bg-focus' : 'invisible'}`}
                    />
                    {tab.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
