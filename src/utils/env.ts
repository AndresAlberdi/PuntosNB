declare const __APP_VERSION__: string;

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.2.1';
export const isStaging = import.meta.env.VITE_FIREBASE_PROJECT_ID === 'puntosnb' || import.meta.env.MODE === 'staging';
export const APP_TITLE = isStaging ? `Hipatia (pruebas v${APP_VERSION})` : 'Hipatia';

// La lista de superadministradores se eliminó del cliente (hallazgo H-09 del plan de
// hardening): el rol se asigna únicamente desde el servidor con
// `scripts/admin/set-superadmin.mjs` y, a partir de la Fase 1, mediante custom claims.
