import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import prettier from 'eslint-config-prettier'

export default [
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2023, sourceType: 'module', ecmaFeatures: { jsx: true } },
      globals: { window: 'readonly', document: 'readonly', console: 'readonly', process: 'readonly' }
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-undef': 'off',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart']
    }
  },
  prettier
]
