// ESLint flat config: src/ (main, preload, shared, renderer) and scripts/.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'out/',
      'dist/',
      'release/',
      'build/',
      'docs/',
      'design-system/',
      'packaging/',
      'resources/',
      'assets/',
      'test/',
      'tests/',
      'brag-output*/'
    ]
  },
  {
    files: ['src/**/*.{ts,tsx,mts,mjs}', 'scripts/**/*.{ts,mts,mjs}', '*.{ts,mjs,js}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      // Main/preload/scripts run on Node, the renderer and page-side script
      // snippets (shot-driver, smoke tests) in a browser.
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      // Filename/title/URL sanitising strips C0 control characters on purpose.
      'no-control-regex': 'off',
      // A leading underscore marks a binding kept on purpose (rest-omit, unused params).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
)
