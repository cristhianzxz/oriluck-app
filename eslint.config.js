import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    ignores: ["dist/", ".vite/"],
  },
  {
    files: ["**/*.{js,jsx}"],
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
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'warn',
      'no-unused-vars': ['warn', { 'varsIgnorePattern': '^_', 'argsIgnorePattern': '^_' }],
    },
  },
  // Configuración específica para el backend en la carpeta 'functions'
  {
    files: ["functions/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      }
    },
    rules: {
        'no-unused-vars': ['warn', { 'varsIgnorePattern': '^_', 'argsIgnorePattern': '^_' }],
    }
  },
  {
    files: ["functions/.eslintrc.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      }
    }
  }
];