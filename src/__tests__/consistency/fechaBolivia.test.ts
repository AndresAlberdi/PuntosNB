// @vitest-environment node
/**
 * Las dos copias de `fechaBolivia.ts` deben ser idénticas byte a byte.
 *
 * `functions/` salió del espacio de trabajo de pnpm (commit 336361a), así que el servidor y la
 * interfaz no comparten módulos. Un comentario pidiendo que no diverjan ya existía y divergieron
 * igual: esta prueba es lo que lo impide, porque rompe `npm test` en el CI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Consistencia de fechaBolivia.ts entre functions/ y src/', () => {
  it('las dos copias son idénticas byte a byte', () => {
    const servidor = readFileSync(new URL('../../../functions/src/comun/fechaBolivia.ts', import.meta.url));
    const interfaz = readFileSync(new URL('../../utils/fechaBolivia.ts', import.meta.url));
    expect(
      servidor.equals(interfaz),
      'Las dos copias de fechaBolivia.ts difieren. functions/ no comparte módulos con src/ (commit 336361a): copie el archivo entero de un lado al otro.',
    ).toBe(true);
  });
});
