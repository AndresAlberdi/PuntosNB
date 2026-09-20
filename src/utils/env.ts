declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_FECHA_BUILD__: string;

/** Etiqueta de git de esta compilación; si el repositorio no tiene etiquetas, el hash corto. */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.2.1';
export const APP_COMMIT = typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : 'desconocido';
export const APP_FECHA_BUILD = typeof __APP_FECHA_BUILD__ !== 'undefined' ? __APP_FECHA_BUILD__ : '';

/**
 * Texto de versión para mostrar en pantalla, en los dos entornos: en pruebas se avisa que lo es,
 * y en producción se muestra discreto, para poder saber qué versión corre un comercio sin
 * preguntarle nada a nadie.
 */
export const VERSION_VISIBLE = `${APP_VERSION} · ${APP_FECHA_BUILD}`;
export const isStaging = import.meta.env.VITE_FIREBASE_PROJECT_ID === 'puntosnb' || import.meta.env.MODE === 'staging';
export const APP_TITLE = isStaging ? `Hipatia (pruebas v${APP_VERSION})` : 'Hipatia';

// La lista de superadministradores se eliminó del cliente (hallazgo H-09 del plan de
// hardening): el rol se asigna únicamente desde el servidor con
// `scripts/admin/set-superadmin.mjs` y, a partir de la Fase 1, mediante custom claims.
