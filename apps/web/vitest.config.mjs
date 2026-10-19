import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/dist/**', 'node_modules/**'],
    /**
     * Vitest otherwise strips CSS imports to an empty string, which silently
     * gutts `contrast.test.ts` — it would parse zero themes and every
     * assertion would pass vacuously. The query is part of the module id, so
     * the pattern has to allow the `?raw` suffix.
     */
    css: { include: [/themes\.css(\?raw)?$/] },
  },
})
