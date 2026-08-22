import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * ESLint configuration.
 *
 * Added because the repo had none. Every scan was run with a throwaway
 * command-line config, which produced false positives that had to be
 * manually disproved each time — and meanwhile three REAL crash bugs
 * shipped that a linter catches instantly:
 *
 *   - clientGstSplit used but never imported (broke every invoice PDF)
 *   - vetId referenced out of scope (crashed the vet profile page)
 *   - STATUS_LABEL / STATUS_BADGE never defined (crashed the calendar)
 *
 * All three compiled and built cleanly. `no-undef` is the rule that
 * catches them, so it is an ERROR everywhere and non-negotiable.
 *
 * Deliberately NOT a strict style config. The goal is catching bugs the
 * build misses, not reformatting a working codebase — style rules would
 * bury the signal under thousands of cosmetic warnings.
 */
export default [
  {
    // Build output, dependencies, and the vet-native app (Expo has its
    // own toolchain and isn't deployed).
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      'apps/vet-native/**',
    ],
  },

  // --- Server: Node, ES modules ---
  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Unused variables are a warning, not an error: they're usually
      // cosmetic, and making them fail the lint run would give people a
      // reason to stop running it at all.
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'error',
      // Catches `const x = ...` referenced above its declaration — the
      // temporal-dead-zone crash that blanked the client journey page.
      'no-use-before-define': ['error', { functions: false, classes: false, variables: true }],
      'no-console': 'off', // server logging is intentional
    },
  },

  // --- Browser apps and the shared package: React ---
  {
    files: ['apps/web-*/**/*.{js,jsx}', 'packages/web-shared/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'error',
      // Rules of Hooks as an ERROR. A hook after an early return threw
      // and unmounted the whole client journey page in production —
      // exactly what this rule exists to prevent.
      'react-hooks/rules-of-hooks': 'error',
      // Dependency arrays are a warning: several effects here
      // intentionally omit deps to avoid re-running polls, and those
      // omissions are marked with disable comments.
      'react-hooks/exhaustive-deps': 'warn',
      // `styles` objects are conventionally declared at the bottom of a
      // component file and referenced above, so variables must be off
      // here — unlike the server, where that pattern doesn't apply.
      'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
    },
  },

  // --- Tests ---
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
