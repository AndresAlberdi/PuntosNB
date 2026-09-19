/** Configuración común de todas las funciones. */

/**
 * Región de despliegue. Debe coincidir con la ubicación de la base de Firestore:
 * `hipatia-puntos` está en nam5 (multirregión de EE. UU.) y `puntosnb` en us-central1;
 * us-central1 sirve a ambas sin salto de región.
 */
export const REGION = 'us-central1';

/**
 * App Check se exige solo donde ya está registrado y con tráfico verificado. Se controla por
 * variable de entorno para poder activarlo primero en pruebas: se enciende al cerrar la Fase 2.
 */
export const EXIGIR_APP_CHECK = process.env.EXIGIR_APP_CHECK === 'true';

/** Opciones comunes de las funciones invocables desde el cliente. */
export const opcionesCallable = {
  region: REGION,
  enforceAppCheck: EXIGIR_APP_CHECK,
  memory: '256MiB' as const,
  timeoutSeconds: 30,
  maxInstances: 10,
};

/** Opciones de las funciones administrativas, que no se invocan desde la aplicación. */
export const opcionesAdmin = {
  region: REGION,
  enforceAppCheck: false,
  memory: '512MiB' as const,
  timeoutSeconds: 300,
  maxInstances: 2,
};
