import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import json from '@eslint/json';
import { defineConfig } from 'eslint/config';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default defineConfig([
  {
    files: ['**/*.{ts,mts,cts}'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { globals: globals.node }
  },
  tseslint.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    files: ['**/*.json'],
    // @ts-expect-error known incompatibility
    plugins: { json },
    language: 'json/json',
    extends: ['json/recommended']
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // Express error handlers keep an unused `next` param to signal arity 4
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    ignores: [
      'dist/**/*.js',
      'node_modules',
      'dist',
      '*.json',
      'backup',
      '.opencode'
    ]
  }
]);
