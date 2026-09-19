import { describe, it, expect } from 'vitest';
import * as env from '../../utils/env';
import { isStaging, APP_TITLE, APP_VERSION } from '../../utils/env';

describe('Environment Config Utility', () => {
  it('should evaluate isStaging based on project ID or mode', () => {
    const expectedIsStaging = import.meta.env.VITE_FIREBASE_PROJECT_ID === 'puntosnb' || import.meta.env.MODE === 'staging';
    expect(isStaging).toBe(expectedIsStaging);
  });

  it('should return correct APP_TITLE and APP_VERSION based on isStaging', () => {
    expect(APP_VERSION).toBeDefined();
    if (isStaging) {
      expect(APP_TITLE).toBe(`Hipatia (pruebas v${APP_VERSION})`);
    } else {
      expect(APP_TITLE).toBe('Hipatia');
    }
  });

  it('no expone ninguna lista de superadministradores en el cliente (H-09)', () => {
    // El rol de superadministrador se asigna solo desde el servidor
    // (scripts/admin/set-superadmin.mjs). Ningún correo debe viajar en el bundle.
    expect('SUPER_ADMIN_EMAILS' in env).toBe(false);
    expect('isSuperAdminEmail' in env).toBe(false);
    const valores = JSON.stringify(Object.values(env));
    expect(valores).not.toContain('@');
  });
});
