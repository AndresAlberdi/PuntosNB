/** Pruebas del registro de cambios de rol: la clasificación es pura y el orden se prueba con dobles. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from 'firebase-functions/v2';

const doble = vi.hoisted(() => ({
  documento: { exists: true, data: () => ({ rol: 'superadmin' }) as Record<string, unknown>, ref: { update: vi.fn() } },
  claims: undefined as Record<string, unknown> | undefined,
  orden: [] as string[],
  setCustomUserClaims: vi.fn(),
}));

vi.mock('./firebase', () => ({
  db: { collection: () => ({ doc: () => ({ get: async () => doble.documento }) }) },
  auth: {
    getUser: async () => ({ customClaims: doble.claims }),
    setCustomUserClaims: doble.setCustomUserClaims,
  },
}));

import { clasificarCambioDeRol, sincronizarClaims } from './claims';

afterEach(() => {
  vi.restoreAllMocks();
  doble.orden.length = 0;
  doble.claims = undefined;
  doble.documento.data = () => ({ rol: 'superadmin' });
  doble.documento.ref.update.mockReset();
  doble.setCustomUserClaims.mockReset();
});

describe('clasificarCambioDeRol', () => {
  it.each([
    ['alta de privilegio', { rolPrevio: 'cliente', comercioIdPrevio: null, rol: 'superadmin', comercioId: null }, 'privilegiado'],
    ['pérdida de privilegio (superadmin a cliente)', { rolPrevio: 'superadmin', comercioIdPrevio: null, rol: 'cliente', comercioId: null }, 'privilegiado'],
    ['admin_comercio pasa de un comercio a otro', { rolPrevio: 'admin_comercio', comercioIdPrevio: 'c1', rol: 'admin_comercio', comercioId: 'c2' }, 'privilegiado'],
    ['admin_comercio pierde el comercio', { rolPrevio: 'admin_comercio', comercioIdPrevio: 'c1', rol: 'admin_comercio', comercioId: null }, 'privilegiado'],
    ['sin rol previo hacia un rol privilegiado', { rolPrevio: null, comercioIdPrevio: null, rol: 'contador', comercioId: null }, 'privilegiado'],
    ['sin rol previo hacia un rol no privilegiado', { rolPrevio: null, comercioIdPrevio: null, rol: 'cliente', comercioId: null }, 'informativo'],
    ['cliente a vendedor', { rolPrevio: 'cliente', comercioIdPrevio: null, rol: 'vendedor', comercioId: 'c1' }, 'informativo'],
    ['vendedor de un comercio a otro', { rolPrevio: 'vendedor', comercioIdPrevio: 'c1', rol: 'vendedor', comercioId: 'c2' }, 'informativo'],
    ['cliente a influencer', { rolPrevio: 'cliente', comercioIdPrevio: null, rol: 'influencer', comercioId: null }, 'informativo'],
    ['rol privilegiado sin cambio alguno', { rolPrevio: 'superadmin', comercioIdPrevio: null, rol: 'superadmin', comercioId: null }, 'ninguno'],
    ['admin_comercio sin cambio alguno', { rolPrevio: 'admin_comercio', comercioIdPrevio: 'c1', rol: 'admin_comercio', comercioId: 'c1' }, 'ninguno'],
    ['rol no privilegiado sin cambio alguno', { rolPrevio: 'cliente', comercioIdPrevio: null, rol: 'cliente', comercioId: null }, 'ninguno'],
  ] as const)('%s', (_nombre, entrada, esperado) => {
    expect(clasificarCambioDeRol(entrada)).toBe(esperado);
  });

  it('un rol previo desconocido que pasa a uno privilegiado es privilegiado', () => {
    expect(
      clasificarCambioDeRol({ rolPrevio: 'inventado', comercioIdPrevio: null, rol: 'superadmin', comercioId: null }),
    ).toBe('privilegiado');
  });
});

describe('sincronizarClaims: el evento se emite antes de la escritura que puede fallar', () => {
  it('la pérdida de privilegio y un cambio informativo llevan rolAnterior y comercioIdAnterior', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    doble.setCustomUserClaims.mockResolvedValue(undefined);
    doble.documento.ref.update.mockResolvedValue(undefined);

    doble.claims = { rol: 'superadmin' };
    doble.documento.data = () => ({ rol: 'cliente' });
    await sincronizarClaims('u1');
    expect(warn).toHaveBeenCalledWith(
      'seguridad.rol_privilegiado_asignado',
      expect.objectContaining({ rolAnterior: 'superadmin', rolNuevo: 'cliente', comercioIdAnterior: null }),
    );

    doble.claims = { rol: 'cliente' };
    doble.documento.data = () => ({ rol: 'vendedor', comercioId: 'c1' });
    await sincronizarClaims('u2', { actorUid: 'admin1' });
    expect(info).toHaveBeenCalledWith(
      'seguridad.rol_asignado',
      expect.objectContaining({
        uid: 'u2',
        actorUid: 'admin1',
        rolAnterior: 'cliente',
        rolNuevo: 'vendedor',
        comercioId: 'c1',
        comercioIdAnterior: null,
      }),
    );
  });

  it('un admin_comercio que pasa de un comercio a otro emite el evento privilegiado', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    doble.setCustomUserClaims.mockResolvedValue(undefined);
    doble.documento.ref.update.mockResolvedValue(undefined);
    doble.claims = { rol: 'admin_comercio', comercioId: 'c1' };
    doble.documento.data = () => ({ rol: 'admin_comercio', comercioId: 'c2' });

    await sincronizarClaims('u3', { actorUid: 'admin1' });

    expect(warn).toHaveBeenCalledWith(
      'seguridad.rol_privilegiado_asignado',
      expect.objectContaining({ rolAnterior: 'admin_comercio', comercioIdAnterior: 'c1', comercioId: 'c2' }),
    );
  });

  it('no emite nada si los claims ya estaban al día', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    doble.claims = { rol: 'superadmin' };

    const r = await sincronizarClaims('u4');

    expect(r.cambio).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
});
