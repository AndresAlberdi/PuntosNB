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

/**
 * Opciones comunes de las funciones invocables desde el cliente.
 *
 * El techo de instancias es deliberadamente bajo: con dos docenas de funciones, la suma de CPU
 * reservada choca contra la cuota de Cloud Run del proyecto, y además acota lo que puede costar
 * un bucle descontrolado. Tres instancias por función sobran para el volumen actual —unos pocos
 * comercios y decenas de operaciones por día— y se sube cuando las métricas lo pidan.
 */
export const opcionesCallable = {
  region: REGION,
  enforceAppCheck: EXIGIR_APP_CHECK,
  memory: '256MiB' as const,
  timeoutSeconds: 30,
  // Cloud Run reserva CPU por instancia máxima: el proyecto de producción tiene un límite de
  // 20 CPU en la región y son dos docenas de funciones. Un cuarto de CPU alcanza de sobra para
  // estas operaciones, que son lecturas y una transacción corta.
  cpu: 0.25,
  maxInstances: 2,
};

/**
 * Opciones para el ingreso del vendedor. Es la única función que hace trabajo de cálculo real
 * —derivar el hash scrypt del PIN—, así que se le deja una CPU entera.
 */
export const opcionesLogin = {
  ...{
    region: REGION,
    enforceAppCheck: EXIGIR_APP_CHECK,
    memory: '512MiB' as const,
    timeoutSeconds: 30,
  },
  cpu: 1,
  maxInstances: 2,
};

/** Opciones de las funciones administrativas, que no se invocan desde la aplicación. */
export const opcionesAdmin = {
  region: REGION,
  enforceAppCheck: false,
  memory: '512MiB' as const,
  timeoutSeconds: 300,
  cpu: 0.5,
  maxInstances: 1,
};
