/**
 * Hash del PIN de vendedor con scrypt y sal por usuario.
 *
 * El PIN nunca se guarda ni se registra en claro. La comparación es de tiempo constante para no
 * filtrar información por la duración de la respuesta.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (clave: string, sal: Buffer, longitud: number, opciones: ScryptOptions): Promise<Buffer> =>
  new Promise((resolver, rechazar) => {
    scryptCallback(clave, sal, longitud, opciones, (error, derivado) =>
      error ? rechazar(error) : resolver(derivado),
    );
  });

/** Parámetros de derivación. Se guardan junto al hash para poder endurecerlos sin romper lo existente. */
export const PARAMETROS_SCRYPT = { N: 16384, r: 8, p: 1, longitud: 64 } as const;

export interface SecretoPin {
  algoritmo: 'scrypt';
  hash: string;
  sal: string;
  parametros: typeof PARAMETROS_SCRYPT;
  /** Marca puesta por la migración: obliga a cambiar el PIN en el próximo ingreso. */
  rotacionRequerida?: boolean;
}

export const PIN_VALIDO = /^\d{6}$/;

async function derivar(pin: string, salHex: string, parametros: typeof PARAMETROS_SCRYPT): Promise<Buffer> {
  const { N, r, p, longitud } = parametros;
  return scrypt(pin.normalize('NFKC'), Buffer.from(salHex, 'hex'), longitud, { N, r, p });
}

/** Deriva el secreto que se guarda en `vendedores_secretos`. */
export async function hashearPin(pin: string): Promise<SecretoPin> {
  const sal = randomBytes(16).toString('hex');
  const hash = await derivar(pin, sal, PARAMETROS_SCRYPT);
  return { algoritmo: 'scrypt', hash: hash.toString('hex'), sal, parametros: PARAMETROS_SCRYPT };
}

/** Compara un PIN con el secreto guardado, en tiempo constante. */
export async function verificarPin(pin: string, secreto: SecretoPin): Promise<boolean> {
  const parametros = secreto.parametros ?? PARAMETROS_SCRYPT;
  const derivado = await derivar(pin, secreto.sal, parametros);
  const guardado = Buffer.from(secreto.hash, 'hex');
  if (derivado.length !== guardado.length) return false;
  return timingSafeEqual(derivado, guardado);
}
