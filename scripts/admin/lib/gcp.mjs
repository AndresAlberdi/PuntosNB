/**
 * Utilidades compartidas por los scripts de administración que hablan con las API REST de Google
 * Cloud (Firestore, y las que sigan en las próximas fases de hardening).
 *
 * Por qué existe. Estos scripts escriben sobre infraestructura real, así que comparten tres
 * salvaguardas que no conviene reescribir (ni olvidar) en cada uno:
 *   1. Una lista PERMITIDA de proyectos. Cualquier otro identificador aborta antes de pedir el
 *      token o de hacer una sola llamada.
 *   2. Producción (`hipatia-puntos`) exige además `--confirmar-produccion`, para que un comando
 *      pegado de memoria no la toque por accidente.
 *   3. El token de acceso nunca se imprime, y los errores de la API se reducen al código HTTP y
 *      al código simbólico de Google: el cuerpo completo podría traer datos que no deben quedar
 *      en una terminal ni en un registro.
 *
 * Solo usa módulos `node:` y `fetch`: no agrega dependencias.
 */
import { execFileSync } from 'node:child_process';

/** Proyectos sobre los que estos scripts pueden operar. Ningún otro. */
export const PROYECTOS_PERMITIDOS = ['puntosnb', 'hipatia-puntos'];

/** Proyecto de producción: exige confirmación explícita. */
export const PROYECTO_PRODUCCION = 'hipatia-puntos';

/** Error de uso (argumentos inválidos). El script lo captura, lo muestra y sale con código 1. */
export class ErrorUso extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorUso';
  }
}

/** Error de una llamada a la API. El mensaje nunca lleva el cuerpo de la respuesta. */
export class ErrorGcp extends Error {
  constructor(mensaje, { estado, codigo } = {}) {
    super(mensaje);
    this.name = 'ErrorGcp';
    this.estado = estado;
    this.codigo = codigo;
  }
}

const BANDERAS_SIN_VALOR = ['--dry-run', '--revertir', '--verificar', '--confirmar-produccion',
  '--confirmar-revertir'];

/**
 * Analiza los argumentos de línea de comandos.
 *
 * Es estricta a propósito: una bandera desconocida (por ejemplo un `--dryrun` mal escrito) aborta
 * en lugar de ignorarse, porque ignorarla convertiría una simulación en una escritura real.
 *
 * @param {string[]} argv argumentos sin `node` ni la ruta del script
 * @returns {{ project: string, simular: boolean, revertir: boolean, verificar: boolean,
 *             confirmarProduccion: boolean, confirmarRevertir: boolean }}
 */
export function analizarArgumentos(argv) {
  let project;
  const banderas = new Set();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project') {
      const valor = argv[i + 1];
      if (!valor || valor.startsWith('--')) throw new ErrorUso('Falta el valor de --project.');
      if (project !== undefined) throw new ErrorUso('--project se indicó más de una vez.');
      project = valor;
      i++;
    } else if (BANDERAS_SIN_VALOR.includes(arg)) {
      banderas.add(arg);
    } else {
      throw new ErrorUso(`Argumento no reconocido: ${sanearTexto(arg)}`);
    }
  }

  if (!project) throw new ErrorUso('Falta --project <id>.');
  validarProyecto(project, banderas.has('--confirmar-produccion'));

  if (banderas.has('--verificar') && banderas.has('--revertir')) {
    throw new ErrorUso('--verificar y --revertir no se combinan: --verificar es solo lectura.');
  }

  // Revertir es destructivo (apaga el PITR y borra programaciones): solo se hace de verdad con
  // una confirmación explícita, en cualquier proyecto. La simulación no la necesita.
  if (banderas.has('--revertir') && !banderas.has('--dry-run') && !banderas.has('--confirmar-revertir')) {
    throw new ErrorUso(
      '--revertir es destructivo: apaga el PITR (se pierde el historial de los últimos 7 días) y ' +
      'borra programaciones de respaldo. Para hacerlo de verdad agregue --confirmar-revertir; ' +
      'para ver qué haría, use --dry-run.'
    );
  }

  return {
    project,
    simular: banderas.has('--dry-run'),
    revertir: banderas.has('--revertir'),
    verificar: banderas.has('--verificar'),
    confirmarProduccion: banderas.has('--confirmar-produccion'),
    confirmarRevertir: banderas.has('--confirmar-revertir'),
  };
}

/**
 * Aborta si el proyecto no está en la lista permitida, o si es producción sin confirmación.
 * @param {string} project
 * @param {boolean} confirmarProduccion
 */
export function validarProyecto(project, confirmarProduccion) {
  if (!PROYECTOS_PERMITIDOS.includes(project)) {
    throw new ErrorUso(
      `Proyecto no permitido: «${sanearTexto(project)}». ` +
      `Solo se admite: ${PROYECTOS_PERMITIDOS.join(', ')}.`
    );
  }
  if (project === PROYECTO_PRODUCCION && !confirmarProduccion) {
    throw new ErrorUso(
      `${PROYECTO_PRODUCCION} es producción: agregue --confirmar-produccion si de verdad ` +
      'quiere operar sobre ella.'
    );
  }
}

/**
 * Obtiene un token de acceso con `gcloud`, sin shell y sin imprimirlo.
 * Si falla, el mensaje no incluye la salida de error de gcloud.
 * @returns {string}
 */
export function obtenerTokenGcloud() {
  try {
    const token = execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!token) throw new Error('vacío');
    return token;
  } catch {
    throw new ErrorGcp(
      'No se pudo obtener el token de acceso. Verifique que gcloud esté instalado y que ' +
      'haya una sesión activa (gcloud auth login).'
    );
  }
}

const ESPERA_REINTENTO_MS = 1000;
const MAX_INTENTOS = 5;
const ESTADOS_REINTENTABLES = [429, 503];
// Solo se reintentan métodos idempotentes. Un POST que el servidor sí procesó y se repite crearía
// un duplicado (y chocaría con el límite de una programación diaria por base); un DELETE repetido
// puede borrar de más o fallar con un error engañoso.
const METODOS_REINTENTABLES = ['GET', 'PATCH'];

const esperarReal = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/**
 * Crea un cliente HTTP para las API de Google Cloud.
 *
 * Cada llamada lleva `Authorization` y `X-Goog-User-Project`. Ante 429 o 503 reintenta con espera
 * exponencial, pero SOLO en GET y PATCH (idempotentes); POST y DELETE no se reintentan. Ante cualquier otro error lanza `ErrorGcp` con el código HTTP y el código
 * simbólico de Google (por ejemplo `PERMISSION_DENIED`), pero nunca el cuerpo.
 *
 * El token se pide la primera vez que hace falta, no al crear el cliente, para que un script que
 * aborta por argumentos inválidos no llegue a pedirlo.
 *
 * @param {object} opciones
 * @param {string} opciones.project proyecto de facturación y cuota de las llamadas
 * @param {() => string} [opciones.obtenerToken]
 * @param {typeof fetch} [opciones.fetchImpl]
 * @param {(ms: number) => Promise<void>} [opciones.esperar]
 */
export function crearClienteGcp({
  project,
  obtenerToken = obtenerTokenGcloud,
  fetchImpl = fetch,
  esperar = esperarReal,
}) {
  let token;

  /**
   * @param {'GET'|'POST'|'PATCH'|'DELETE'} metodo
   * @param {string} url
   * @param {object} [cuerpo]
   * @returns {Promise<any>} el JSON de la respuesta, o `null` si vino vacía
   */
  async function solicitar(metodo, url, cuerpo) {
    token ??= obtenerToken();
    const cabeceras = {
      Authorization: `Bearer ${token}`,
      'X-Goog-User-Project': project,
    };
    if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';

    for (let intento = 1; ; intento++) {
      let respuesta;
      try {
        respuesta = await fetchImpl(url, {
          method: metodo,
          headers: cabeceras,
          body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        });
      } catch {
        throw new ErrorGcp(`${metodo}: no hubo respuesta de la API (error de red).`);
      }

      if (respuesta.ok) {
        const texto = await respuesta.text();
        return texto ? JSON.parse(texto) : null;
      }

      if (
        METODOS_REINTENTABLES.includes(metodo) &&
        ESTADOS_REINTENTABLES.includes(respuesta.status) &&
        intento < MAX_INTENTOS
      ) {
        await esperar(ESPERA_REINTENTO_MS * 2 ** (intento - 1));
        continue;
      }

      throw new ErrorGcp(await describirError(metodo, respuesta), {
        estado: respuesta.status,
        codigo: await codigoSimbolico(respuesta),
      });
    }
  }

  return { solicitar };
}

/** Extrae solo `error.status` (p. ej. `PERMISSION_DENIED`); descarta el resto del cuerpo. */
async function codigoSimbolico(respuesta) {
  try {
    const cuerpo = JSON.parse(await respuesta.clone().text());
    const codigo = cuerpo?.error?.status;
    return typeof codigo === 'string' && /^[A-Z_]{3,40}$/.test(codigo) ? codigo : undefined;
  } catch {
    return undefined;
  }
}

async function describirError(metodo, respuesta) {
  const codigo = await codigoSimbolico(respuesta);
  return `${metodo} falló: HTTP ${respuesta.status}${codigo ? ` (${codigo})` : ''}.`;
}

/**
 * Espera a que termine una operación de larga duración de Google (por ejemplo, el PATCH de la
 * base de datos). Si la respuesta no es una operación pendiente, no espera nada.
 *
 * @param {{ solicitar: Function }} cliente
 * @param {string} urlBase raíz de la API, p. ej. `https://firestore.googleapis.com/v1`
 * @param {any} operacion respuesta de la llamada que inició la operación
 * @param {{ esperar?: (ms: number) => Promise<void>, intervaloMs?: number, maxIntentos?: number }} [opc]
 */
export async function esperarOperacion(cliente, urlBase, operacion, opc = {}) {
  const { esperar = esperarReal, intervaloMs = 3000, maxIntentos = 200 } = opc;
  let actual = operacion;
  for (let i = 0; i < maxIntentos; i++) {
    if (!actual?.name || actual.done !== false) break;
    await esperar(intervaloMs);
    actual = await cliente.solicitar('GET', `${urlBase}/${actual.name}`);
  }
  if (actual?.done === false) {
    throw new ErrorGcp('La operación no terminó en el tiempo previsto; revise su estado en la consola.');
  }
  if (actual?.error) {
    const codigo = Number.isInteger(actual.error.code) ? ` (código ${actual.error.code})` : '';
    throw new ErrorGcp(`La operación terminó con error${codigo}.`);
  }
  return actual;
}

/**
 * Enmascara un identificador dejando visibles solo los dos primeros y los dos últimos caracteres.
 * Los de 6 caracteres o menos se ocultan por completo.
 * @param {string} valor
 */
export function enmascarar(valor) {
  const texto = String(valor ?? '');
  if (texto.length <= 6) return '*'.repeat(texto.length);
  return `${texto.slice(0, 2)}${'*'.repeat(texto.length - 4)}${texto.slice(-2)}`;
}

/**
 * Enmascara una cuenta de facturación (`billingAccounts/XXXXXX-XXXXXX-XXXXXX`): deja visibles
 * solo los dos últimos caracteres de cada tramo.
 * @param {string} texto
 */
export function enmascararCuentaFacturacion(texto) {
  return String(texto).replace(
    /\b[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}\b/gi,
    (cuenta) => cuenta.split('-').map((t) => `****${t.slice(-2)}`).join('-')
  );
}

/**
 * Pasa por el enmascarado todo lo que pudiera colarse en un mensaje: tokens de acceso de Google
 * (`ya29.…`), cabeceras `Bearer`, y cuentas de facturación.
 * @param {string} texto
 */
export function sanearTexto(texto) {
  return enmascararCuentaFacturacion(String(texto))
    .replace(/Bearer\s+[\w.~+/=-]+/gi, 'Bearer ****')
    .replace(/\bya29\.[\w.~+/=-]+/g, '****');
}
