import { describe, it, expect } from 'vitest';
import { isStaging, APP_TITLE } from '../../utils/env';

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
});
