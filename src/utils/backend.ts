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
    throw new Error(mensajeDeError(error));
  }
}

export function mensajeDeError(error: unknown): string {
  const e = error as { code?: string; message?: string };
  if (e?.message && !e.message.startsWith('internal')) return e.message;
  if (e?.code === 'functions/unavailable') {
    return 'No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.';
  }
  return 'No se pudo completar la operación. Inténtalo de nuevo.';
}
