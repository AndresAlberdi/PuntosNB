/**
 * Errores en español, sin filtrar detalles internos.
 *
 * El mensaje que viaja al cliente describe qué hacer, nunca por qué falló por dentro:
 * los detalles quedan en los registros del servidor.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

export const sinSesion = (): HttpsError =>
  new HttpsError('unauthenticated', 'Tu sesión expiró. Vuelve a iniciar sesión.');

export const sinPermiso = (detalleInterno?: string): HttpsError => {
  if (detalleInterno) logger.warn('Permiso denegado', { detalleInterno });
  return new HttpsError('permission-denied', 'No tienes permiso para realizar esta operación.');
};

export const datosInvalidos = (mensaje: string): HttpsError =>
  new HttpsError('invalid-argument', mensaje);

export const noEncontrado = (mensaje: string): HttpsError =>
  new HttpsError('not-found', mensaje);

export const conflicto = (mensaje: string): HttpsError =>
  new HttpsError('failed-precondition', mensaje);

export const demasiadosIntentos = (mensaje: string): HttpsError =>
  new HttpsError('resource-exhausted', mensaje);

export const errorInterno = (detalleInterno: unknown): HttpsError => {
  logger.error('Error interno', { detalleInterno });
  return new HttpsError('internal', 'No se pudo completar la operación. Inténtalo de nuevo.');
};
