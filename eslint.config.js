import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// `functions/` se analiza con su propia configuración (`functions/eslint.config.js`):
// incluirla aquí hace que typescript-eslint no sepa qué tsconfig usar.
export default defineConfig([
  globalIgnores(['dist', 'functions/**', 'coverage/**', 'lib/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Deuda de calidad anterior a que existiera el pipeline, en el código de interfaz.
    // Queda como aviso —visible en cada ejecución— en lugar de bloquear el despliegue de
    // correcciones de seguridad. El código nuevo del backend (`functions/`) mantiene
    // `no-explicit-any` como error, y lo que se toque aquí debe salir sin `any`.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
])
