/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

/**
 * Versión que se muestra en pantalla.
 *
 * Sale de la etiqueta de git —`v1.3.0`, o `v1.3.0-4-gabc1234` si hay commits encima— para que al
 * mirar la aplicación se sepa exactamente qué versión está corriendo un comercio. Si el
 * repositorio todavía no tiene etiquetas, cae al hash corto del commit, y si no hay git
 * disponible (por ejemplo, en un contenedor de compilación sin historial), a `package.json`.
 */
function versionDesdeGit(): string {
  try {
    return execSync('git describe --tags --always --dirty', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return pkg.version
  }
}

function commitCorto(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return 'desconocido'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(versionDesdeGit()),
    __APP_COMMIT__: JSON.stringify(commitCorto()),
    __APP_FECHA_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    // Las pruebas de reglas corren aparte, contra el emulador: `npm run test:rules`.
    exclude: ['**/node_modules/**', 'dist/**', 'functions/**', 'src/__tests__/security/**'],
  },
})
