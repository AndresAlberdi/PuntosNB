/**
 * Eventos de seguridad estructurados para Cloud Logging.
 *
 * El SDK de firebase-functions no registra los `HttpsError`, así que cada evento relevante se
 * emite aquí con campos estables, sin datos personales: nada de correos, teléfonos, direcciones
 * IP, hash de IP ni tokens. El `uid` sí se admite.
 *
 * IMPORTANTE para las alertas: los filtros de alerta y las métricas basadas en registros deben
 * usar SIEMPRE `jsonPayload.evento` (y los demás campos de `jsonPayload`), nunca `message`. En
 * nivel ERROR el logger convierte `message` en un stack, de modo que filtrar por el texto no es
 * confiable.
 */
import { logger } from 'firebase-functions/v2';

export const EVENTOS = [
  'seguridad.permiso_denegado',
  'seguridad.ingreso_vendedor_fallido',
  'seguridad.bloqueo_pin',
  'seguridad.rol_privilegiado_asignado',
  'seguridad.rol_asignado',
  'seguridad.sesiones_revocadas',
  'seguridad.cuenta_bloqueada',
  'error.interno',
] as const;
export type NombreEvento = (typeof EVENTOS)[number];

export type Severidad = 'INFO' | 'WARNING' | 'ERROR';

export interface ErrorSerializado {
  tipo: string;
  codigo: string | null;
  mensaje: string;
}

export interface CamposEvento {
  uid?: string;
  actorUid?: string;
  rol?: string;
  rolAnterior?: string | null;
  rolNuevo?: string;
  comercioId?: string | null;
  comercioIdAnterior?: string | null;
  motivo?: string;
  alcance?: 'cuenta' | 'ip';
  detalle?: string;
  error?: ErrorSerializado;
}

const LARGO_MAXIMO = 300;

/**
 * Correo electrónico, con letras y números Unicode (la bandera `u` se aplica solo a esta
 * expresión). El lookbehind inicial impide empezar a mitad de una corrida de caracteres de la
 * parte local: sin él, esta expresión es cuadrática con cadenas como `a.a.a.…` (64 000
 * caracteres tardaban 5 a 7 segundos de CPU); con él es lineal.
 */
const PATRON_CORREO = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;

/**
 * Quita de un texto lo que no debe llegar a los registros: correos, teléfonos, direcciones IP
 * y tokens (JWT y `Bearer`).
 */
export function redactar(texto: string): string {
  return texto
    .replace(PATRON_CORREO, '<correo>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, '<token>')
    .replace(/eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*)*/g, '<token>')
    .replace(/\+\d{7,15}/g, '<telefono>')
    .replace(/(?:::ffff:)?\b\d{1,3}(?:\.\d{1,3}){3}\b/gi, '<ip>')
    .replace(/(?<![\w:])(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}(?![\w:])/gi, '<ip>')
    .replace(/(?<![\w:])[0-9a-f:]*::[0-9a-f:]*(?![\w:])/gi, '<ip>')
    // Teléfonos con separadores; va DESPUÉS de las IP para no romperlas.
    .replace(/\+?\d[\d\s().-]{6,18}\d/g, '<telefono>');
}

/**
 * Tope del texto que se entrega a `redactar`. La redacción no debe depender de él para ser
 * lineal (la expresión de correo ya lo es), pero acotar la entrada mantiene el costo predecible
 * ante cualquier texto del cliente. Como el resultado final se corta a 300 caracteres, basta con
 * acotarla antes de redactar.
 */
const LARGO_MAXIMO_ENTRADA = 1000;

/**
 * Acota, redacta y corta a 300 caracteres. Se acota ANTES de redactar por el costo predecible
 * de las expresiones regulares y se corta DESPUÉS, para no dejar a medias un dato personal.
 *
 * Si el texto supera el tope, se descarta además la palabra final incompleta: un correo,
 * teléfono o IP cortado a medias no coincide con ninguna expresión y, como las sustituciones
 * (`<correo>`, `<token>`) achican el texto, ese fragmento caería dentro de los 300 finales.
 */
function limpiar(texto: string): string {
  const acotado =
    texto.length > LARGO_MAXIMO_ENTRADA
      ? texto.slice(0, LARGO_MAXIMO_ENTRADA).replace(/\S*$/, '')
      : texto;
  return redactar(acotado).slice(0, LARGO_MAXIMO);
}

/**
 * Resume un error para el registro: tipo, código y mensaje redactado. Nunca `httpResponse`,
 * cabeceras ni cuerpo (los errores de Auth los traen y exponen datos del servicio).
 */
export function serializarError(e: unknown): ErrorSerializado {
  if (e instanceof Error || (e !== null && typeof e === 'object')) {
    const obj = e as { name?: unknown; code?: unknown; message?: unknown; errorInfo?: { code?: unknown } };
    const tipo = typeof obj.name === 'string' && obj.name ? obj.name : 'Error';
    const codigoCrudo = typeof obj.code === 'string' ? obj.code : obj.errorInfo?.code;
    const codigo = typeof codigoCrudo === 'string' ? limpiar(codigoCrudo) : null;
    const mensaje = typeof obj.message === 'string' ? limpiar(obj.message) : '';
    return { tipo: limpiar(tipo), codigo, mensaje };
  }
  return { tipo: typeof e, codigo: null, mensaje: typeof e === 'string' ? limpiar(e) : '' };
}

const limpiarTexto = (valor: unknown): string | undefined =>
  typeof valor === 'string' ? limpiar(valor) : undefined;

/**
 * Los identificadores (uid, comercioId) y los valores de catálogo (rol, motivo) NO se redactan:
 * `redactar` busca tokens por patrón y corrompería un uid legítimo que contenga, por ejemplo,
 * `eyJ` (se registraría como `Kq3<token>`), con lo que las alertas por `jsonPayload.uid` no
 * verían esa cuenta. Si el valor tiene la forma de un identificador se conserva tal cual; si no,
 * es probablemente texto del cliente y pasa por `limpiar`.
 */
const PATRON_IDENTIFICADOR = /^[A-Za-z0-9_-]{1,128}$/;
const limpiarIdentificador = (valor: unknown): string | undefined => {
  if (typeof valor !== 'string') return undefined;
  return PATRON_IDENTIFICADOR.test(valor) ? valor : limpiar(valor);
};

/**
 * Arma la entrada del registro. Función pura con LISTA BLANCA de claves: lo que no esté
 * previsto aquí se descarta, y todo texto se redacta y se corta.
 */
export function construirEntrada(
  evento: NombreEvento,
  campos: CamposEvento,
): Record<string, unknown> {
  const entrada: Record<string, unknown> = {
    evento,
    v: 1,
    funcion: process.env.FUNCTION_TARGET ?? null,
  };

  for (const clave of ['uid', 'actorUid', 'rol', 'rolNuevo', 'motivo'] as const) {
    const valor = limpiarIdentificador(campos[clave]);
    if (valor !== undefined) entrada[clave] = valor;
  }
  // `detalle` es texto libre: siempre se redacta.
  const detalle = limpiarTexto(campos.detalle);
  if (detalle !== undefined) entrada.detalle = detalle;
  // `null` es significativo: «sin rol anterior» / «sin comercio» / «sin comercio anterior».
  for (const clave of ['rolAnterior', 'comercioId', 'comercioIdAnterior'] as const) {
    const valor = campos[clave];
    if (valor === null) entrada[clave] = null;
    else {
      const texto = limpiarIdentificador(valor);
      if (texto !== undefined) entrada[clave] = texto;
    }
  }
  if (campos.alcance === 'cuenta' || campos.alcance === 'ip') entrada.alcance = campos.alcance;
  if (campos.error) {
    // Se reconstruye solo con las tres claves previstas, aunque llegue algo más.
    entrada.error = {
      tipo: limpiarTexto(campos.error.tipo) ?? 'Error',
      codigo: limpiarTexto(campos.error.codigo) ?? null,
      mensaje: limpiarTexto(campos.error.mensaje) ?? '',
    };
  }

  return entrada;
}

/** Emite un evento estructurado en Cloud Logging con la severidad indicada. */
export function registrarEvento(
  evento: NombreEvento,
  campos: CamposEvento,
  severidad: Severidad,
): void {
  const entrada = construirEntrada(evento, campos);
  if (severidad === 'ERROR') logger.error(evento, entrada);
  else if (severidad === 'WARNING') logger.warn(evento, entrada);
  else logger.info(evento, entrada);
}
