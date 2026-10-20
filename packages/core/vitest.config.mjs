import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Colocated tests are emitted into `dist` by `tsc -b` — they have to be,
    // so that the build typechecks them alongside everything else. Without
    // this exclusion vitest finds BOTH copies and runs every test twice:
    // counts double, and half the run exercises stale compiled output rather
    // than the source under test.
    exclude: [...configDefaults.exclude, '**/dist/**'],

    /**
     * The coverage check (phase 2, day 10).
     *
     * A threshold, not a target: the numbers are a *diagnostic*, and the
     * thresholds exist so that a file nobody tested cannot slip in without
     * the number moving. They sit a little below the measured figures so
     * that ordinary work does not trip them — a gate that cries wolf gets
     * ignored, and an ignored gate is worse than no gate.
     *
     * `src/testing` is excluded: those are doubles for *consumers'* tests, not
     * product code, and a double's own lines are not a statement about
     * whether the product works.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/testing/**'],
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 95,
        lines: 95,
      },
    },
  },
})
