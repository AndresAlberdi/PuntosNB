/**
 * Acceso al backend de confianza.
 *
 * Toda operación que el cliente no puede decidir por sí mismo —ingreso del vendedor, emisión y
 * consumo de puntos, cobros— pasa por aquí. El error que llega del servidor ya viene en español y
 * sin detalles internos, así que se muestra tal cual.
 */
import { httpsCallable, type HttpsCallableResult } from 'firebase/functions';
import { functions } from '../firebase';

export interface RespuestaLoginVendedor {
  token: string;
  vendedor: { uid: string; nombre: string; comercioId: string; rotacionRequerida: boolean };
}

/** Invoca una función del backend y normaliza el error para mostrarlo al usuario. */
export async function invocar<Entrada, Salida>(nombre: string, datos: Entrada): Promise<Salida> {
  try {
    const fn = httpsCallable<Entrada, Salida>(functions, nombre);
    const resultado: HttpsCallableResult<Salida> = await fn(datos);
    return resultado.data;
  } catch (error) {
    throw new Error(mensajeDeError(error), { cause: error });
  }
}

export function mensajeDeError(error: unknown): string {
  const e = errorFirebase(error);
  if (e.message && !e.message.startsWith('internal')) return e.message;
  if (e.code === 'functions/unavailable') {
    return 'No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.';
  }
  return 'No se pudo completar la operación. Inténtalo de nuevo.';
}

/**
 * Lee `code` y `message` de un error capturado sin suponer su tipo.
 *
 * Los SDK de Firebase lanzan objetos con esos campos, pero TypeScript entrega `unknown` en un
 * `catch`, que es lo correcto: cualquier cosa puede lanzarse. Esta función acota el acceso en un
 * solo lugar en vez de repartir `any` por todas las pantallas.
 */
export function errorFirebase(error: unknown): { code?: string; message?: string } {
  return typeof error === 'object' && error !== null ? (error as { code?: string; message?: string }) : {};
}
