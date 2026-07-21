import { describe, it, expect } from 'vitest';
import { isStaging, APP_TITLE, isSuperAdminEmail, SUPER_ADMIN_EMAILS } from '../../utils/env';

describe('Environment Config Utility', () => {
  it('should evaluate isStaging based on project ID or mode', () => {
    const expectedIsStaging = import.meta.env.VITE_FIREBASE_PROJECT_ID === 'puntosnb' || import.meta.env.MODE === 'staging';
    expect(isStaging).toBe(expectedIsStaging);
  });

  it('should return correct APP_TITLE based on isStaging', () => {
    if (isStaging) {
      expect(APP_TITLE).toBe('Hipatia (pruebas)');
    } else {
      expect(APP_TITLE).toBe('Hipatia');
    }
  });

  it('should identify authorized superadmin emails (including dot and hyphen variants)', () => {
    expect(SUPER_ADMIN_EMAILS).toEqual([
      'alberdi.andres@gmail.com',
      'nbruzonic@gmail.com',
      'hipatia-admin@gmail.com',
      'hipatia.admin@gmail.com'
    ]);

    expect(isSuperAdminEmail('alberdi.andres@gmail.com')).toBe(true);
    expect(isSuperAdminEmail('nbruzonic@gmail.com')).toBe(true);
    expect(isSuperAdminEmail('hipatia-admin@gmail.com')).toBe(true);
    expect(isSuperAdminEmail('hipatia.admin@gmail.com')).toBe(true);
    expect(isSuperAdminEmail('HIPATIA.ADMIN@GMAIL.COM')).toBe(true);
    expect(isSuperAdminEmail('otro.usuario@gmail.com')).toBe(false);
    expect(isSuperAdminEmail(null)).toBe(false);
  });
});
