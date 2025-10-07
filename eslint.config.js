import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  // Ignorar directorios de build y dependencias cacheadas
  globalIgnores(['dist', '.vite', 'node_modules']),

  // Configuración para Cloud Functions (entorno Node.js)
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
      'no-undef': 'off', // 'require' is not defined, etc.
    },
  },

  // Configuración para el código fuente de React (entorno de navegador)
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
        'react-hooks': reactHooks,
        'react-refresh': reactRefresh,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
        react: {
            version: 'detect'
        }
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
    },
  },
]);