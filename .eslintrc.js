module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: {
    react: { version: 'detect' },
  },
  env: {
    browser: false,
    node: true,
    es2020: true,
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'react-native'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    // React 17+ doesn't need React in scope for JSX
    'react/react-in-jsx-scope': 'off',
    // Prop types not needed with TypeScript
    'react/prop-types': 'off',
    // Allow empty interfaces for type extension patterns
    '@typescript-eslint/no-empty-interface': 'off',
    // Allow explicit any in limited cases (Realtime payloads)
    '@typescript-eslint/no-explicit-any': 'warn',
    // Unused vars — error except for underscore-prefixed
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // No console.log in production code — only warn (console.error/warn are fine)
    'no-console': ['warn', { allow: ['error', 'warn', 'info'] }],
    // React hooks
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
  overrides: [
    {
      // Relax rules for test files
      files: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.test.tsx', 'test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
      },
    },
    {
      // Supabase Edge Functions use Deno globals
      files: ['supabase/functions/**/*.ts'],
      env: { node: false },
      globals: { Deno: 'readonly' },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
      },
    },
  ],
}
