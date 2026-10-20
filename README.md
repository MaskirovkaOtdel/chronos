# CHRONOS

**A focus timer and a world clock that don't guilt you.**

Chronos is a local-first timer for people who do deep work across time zones. Two features,
built properly: a focus timer with presets, cycles and history, and a world clock that is
DST-correct rather than decorative.

> **Status: in development — phase 1 (foundation).** The core package, design tokens and
> all eight themes are in place. See [Roadmap](#roadmap) for what is left.

---

## Why it exists

Most focus timers are stopwatches with a subscription attached. Chronos is the opposite
shape: two features, no accounts required, no billing anywhere in the codebase, and
everything stored on your device first.

The scope cut is deliberate and is the most important decision in the project. **V1 ships a
focus timer and a world clock, and nothing else** — no time tracking, no calendar, no
reports, no team features. Protecting that list is treated as a project risk, not an
aspiration.

## What V1 will include

- **Focus timer** — presets, cycles, breaks, and a history you can actually read
- **World clock** — multi-city live clocks, **DST-correct**, an instant converter that
  surfaces ambiguous times instead of guessing, and daylight state chips
- **Local-first** — works offline, export and import your data, no account needed
- **Eight themes**, light and dark, each verified by an automated contrast gate
- **Installable PWA**, full keyboard and screen-reader accessibility

**Accounts and free cross-device sync** arrive at phase 5. Sync is free and ungated — there
is no entitlement check and no upgrade prompt, then or later.

**Not in V1, by design:** time tracker · calendar · timesheets · meeting planner · reports ·
team features · CLI. _Never:_ billing, paid tiers, ads.

## Getting started

Prerequisites: **Node 26** and **pnpm 12**.

```bash
git clone https://github.com/MaskirovkaOtdel/chronos.git
cd chronos
pnpm install
pnpm dev
```

### Commands

| Command                           | What it does                                   |
| --------------------------------- | ---------------------------------------------- |
| `pnpm dev`                        | Run the web app                                |
| `pnpm build`                      | Build every package and the app                |
| `pnpm test`                       | Run the test suites                            |
| `pnpm typecheck`                  | Strict TypeScript across the workspace         |
| `pnpm lint` / `pnpm format:check` | ESLint and Prettier                            |
| `pnpm themes:derive`              | Regenerate dark themes from their light source |

### Repository layout

A Turborepo monorepo:

```
packages/core     Domain logic behind port contracts. Zero I/O, enforced by tsconfig.
scripts/          Repo tooling (theme derivation).
docs/             Design artifacts — the data model and its schema layouts.
apps/web          The web application.
```

`@chronos/core` is deliberately isolated from the platform. It talks to the outside world
only through ports — `Clock`, `SessionRepository`, `Notifier`, `Audio` — with in-memory and
no-op adapters supplied for testing. Reaching for `window` or `process` inside it fails to
compile rather than failing at runtime.

Time-zone logic is quarantined behind a `/world` boundary — a design rule the project
enforces, so the rest of the codebase never performs raw `Date` arithmetic.

Persistence is designed before it is built: [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) holds
the localStorage schema and the Firestore document layout as a written design, together with
the field-by-field 1:1 mapping between them. A test in `@chronos/core` fails if the schema
document and the domain types ever drift apart.

## Roadmap

**V1 — focus timer and world clock**

| Phase                      | Scope                                                                      |
| -------------------------- | -------------------------------------------------------------------------- |
| **1 · Foundation**         | Toolchain, strict TypeScript, core ports, themed shell, design tokens, CI  |
| **2 · Timer engine**       | Elapsed formula, state machine, persistence, property-based fuzzing        |
| **3 · World clock engine** | Zone primitives, offsets, DST, real solar astronomy, ~2,000-city gazetteer |
| **4 · Web app**            | Adapters, then Focus, World, History and Settings, then cross-cutting      |
| **5 · Firebase**           | Auth, free cross-device sync, security rules, privacy policy               |

**V2** — meeting planner, desktop (Tauri), mobile (Capacitor), iOS Live Activities,
high-contrast themes.

**Deliberately deferred to an expansion decision:** store distribution and timesheets.
Everything else on the V2 list is committed.

## Two repositories

This repository holds the **community edition** — the complete, fully functional app,
including sync. It is the whole product.

A separate **premium edition** is under active development and is not published. It builds
on the same foundation and carries additional features and experiments. Because it is a
separate distribution rather than a gated tier of this one, there is no upgrade prompt,
paywall or feature flag in this codebase.

## Self-hosting the backend

Chronos needs no server to work. Sync is optional and brings your own Firebase project:

1. Create a free Firebase project — no payment method, no Docker, no server
2. Copy `.env.example` to `.env` and fill in your project's config
3. Deploy the security rules

The public repository ships `.env.example` only and **never contains live credentials**.
Otherwise every fork would create accounts in the same project and exhaust its free quota.

## Accessibility

Accessibility is a product requirement, not a checklist. A few things that are load-bearing:

- The timer uses **tabular numerals** so digits never shift width as the clock ticks
- Every theme is checked by a CI gate computing WCAG contrast ratios for **every token
  pair in every theme** — 4.5:1 for body text, 3:1 for the arc and other meaningful
  graphics
- The world clock is built on **real solar astronomy** rather than an aesthetic gradient,
  because a sunrise band that is wrong at latitude 65° is a lie the product tells

## License

**[PolyForm Noncommercial License 1.0.0](LICENSE)** — see [`LICENSE`](LICENSE).

Use, study, modify and share it freely for any noncommercial purpose: personal projects,
learning, research, hobby work, and use by charitable, educational, research and
government organisations are all expressly permitted.

What you may not do is exploit it commercially — sell it, offer it as a paid or
ad-supported service, or otherwise use it for commercial advantage or monetary
compensation. This protects the project from being monetised by others without adding
friction for the community it is for. A commercial licence can be arranged directly.

### Font licensing

The bundled [Fraunces](https://github.com/undercasetype/Fraunces) and
[Nunito](https://github.com/googlefonts/nunito) font files are third-party works under the
**[SIL Open Font License 1.1](apps/web/src/assets/fonts/OFL.txt)**, which is unaffected by
the application's noncommercial terms. Both are self-hosted and subset to Latin + digits, so
the app makes no third-party request at runtime.
