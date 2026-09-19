/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

// Configuración de las pruebas de reglas de Firestore.
// Se ejecutan en Node contra el emulador, no en jsdom: `npm run test:rules`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/security/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
})
