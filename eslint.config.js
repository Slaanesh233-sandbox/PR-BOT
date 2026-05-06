// ESLint v9 flat config.
// Migrated from .eslintrc.cjs (legacy) because ESLint v9 no longer reads .eslintrc.* by default —
// without this file, `npm run lint` silently exits 0 without running any rules, defeating the
// lint CI gate planned in Plan 04 / D-18.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist/', 'dist-tsc/', 'node_modules/', '**/*.cjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json',
      },
      globals: {
        // Node globals (process, Buffer, console, etc.) are provided by typescript-eslint's
        // recommended set + @types/node; no need to redeclare here.
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
