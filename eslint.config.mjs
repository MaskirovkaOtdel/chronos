import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,

  // Type-aware rules — the layer that actually pays for strict TypeScript.
  // projectService resolves each file to its nearest tsconfig automatically,
  // which is what makes this work in a monorepo without listing projects.
  //
  // The TS-prefixed rules live HERE, inside the same object as the plugin —
  // a bare rules object would apply to .mjs files where the plugin is not
  // registered, and ESLint rejects rules whose plugin it cannot resolve.
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Imports of types only should say so — keeps `verbatimModuleSyntax` honest
      // and makes the bundle boundary visible in the source.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      // OFF deliberately. Our ports are async because their real adapters
      // (localStorage, Firestore, Notification, AudioContext) are — but the
      // in-memory and no-op adapters implement them synchronously, which is
      // exactly what this rule forbids. The bug it guards against, a promise
      // built and dropped, is still caught by `no-floating-promises`, which
      // stays on and is part of the type-checked set above.
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Accessibility is a product requirement here, not a lint afterthought (§9).
  // Scoped to JSX so it stays inert until apps/web exists.
  {
    files: ['**/*.tsx', '**/*.jsx'],
    extends: [jsxA11y.flatConfigs.recommended],
  },

  {
    rules: {
      // console is for genuine diagnostics; the UI has a real place to report.
      // Plugin-agnostic — this block is intentionally unscoped.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Tests may reach for anything.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts', '**/__tests__/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Repo tooling. Plain .mjs never reaches the TypeScript plugin, so
  // typescript-eslint does not get to disable `no-undef` for it the way it does
  // for .ts — the globals have to be declared by hand. Listed explicitly rather
  // than pulling in the `globals` package for two names.
  //
  // `console.log` is the deliverable of a CLI, not a stray debug statement,
  // so the no-console rule is off for these files.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Keep last — it disables every rule Prettier would fight with.
  prettier,
)
