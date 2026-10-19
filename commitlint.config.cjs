/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Types we actually use for this project.
    'type-enum': [
      2,
      'always',
      [
        'feat', // new capability
        'fix', // bug fix
        'perf', // performance
        'refactor', // behaviour-preserving restructure
        'test', // tests only
        'docs', // documentation
        'build', // tooling, deps, config
        'ci', // workflows
        'chore', // anything else
        'revert',
      ],
    ],
    // Scope is encouraged but not mandatory.
    'scope-case': [2, 'always', 'kebab-case'],
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 100],
  },
}
