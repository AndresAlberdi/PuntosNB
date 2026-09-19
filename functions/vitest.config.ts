import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Las pruebas de las funciones corren contra los emuladores de Firestore y Auth.
// Se lanzan con `npm run test:functions` desde la raíz del repositorio.
const aqui = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: aqui,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 40000,
    fileParallelism: false,
  },
});
