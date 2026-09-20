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
    // Estas reglas estuvieron rebajadas a aviso mientras quedaba deuda de calidad anterior al
    // pipeline en el código de interfaz. Saldada esa deuda —`src/` no tiene hallazgos—, vuelven
    // a bloquear, igual que en el backend (`functions/`): un `any`, un efecto que actualiza el
    // estado de forma síncrona o un render impuro detienen la compuerta en vez de pasar como
    // aviso.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/purity': 'error',
      'react-refresh/only-export-components': 'error',
    },
  },
])
