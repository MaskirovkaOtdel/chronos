import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Colocated tests are emitted into `dist` by `tsc -b` — they have to be,
    // so that the build typechecks them alongside everything else. Without
    // this exclusion vitest finds BOTH copies and runs every test twice:
    // counts double, and half the run exercises stale compiled output rather
    // than the source under test.
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
})
