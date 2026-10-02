/** El mensaje y el código que ve el cliente no cambian aunque ahora se emitan eventos. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from 'firebase-functions/v2';
import { errorInterno, sinPermiso } from './errores';

afterEach(() => {
  vi.restoreAllMocks();
});

// Valores que devolvía `origin/main` antes de añadir los eventos estructurados.
const PERMISO = { code: 'permission-denied', message: 'No tienes permiso para realizar esta operación.' };
const INTERNO = { code: 'internal', message: 'No se pudo completar la operación. Inténtalo de nuevo.' };

describe('mensaje hacia el cliente', () => {
  it('sinPermiso conserva su code y su message, con o sin contexto', () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    for (const error of [
      sinPermiso(),
      sinPermiso('detalle interno con ana@correo.com'),
      sinPermiso('detalle', { uid: 'u1', rol: 'cliente', comercioId: 'c1' }),
    ]) {
      expect(error.code).toBe(PERMISO.code);
      expect(error.message).toBe(PERMISO.message);
    }
  });

  it('errorInterno conserva su code y su message y no filtra el detalle', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const error = errorInterno(new Error('falló la consulta de ana@correo.com'));
    expect(error.code).toBe(INTERNO.code);
    expect(error.message).toBe(INTERNO.message);
    expect(error.message).not.toContain('ana@correo.com');
  });

  it('sinPermiso emite el evento con el contexto, sin cambiar lo que ve el cliente', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    sinPermiso('detalle', { uid: 'u1', rol: 'cliente', comercioId: 'c1' });
    expect(warn).toHaveBeenCalledWith(
      'seguridad.permiso_denegado',
      expect.objectContaining({ uid: 'u1', rol: 'cliente', comercioId: 'c1', detalle: 'detalle' }),
    );
  });
});
