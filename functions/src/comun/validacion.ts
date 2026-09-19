/** Validación de entrada con zod, traducida a un error de argumento legible. */
import type { ZodType } from 'zod';
import { datosInvalidos } from './errores';

export function validar<T>(esquema: ZodType<T>, datos: unknown): T {
  const resultado = esquema.safeParse(datos);
  if (!resultado.success) {
    const primero = resultado.error.issues[0];
    const campo = primero?.path.join('.') ?? 'entrada';
    throw datosInvalidos(`Dato inválido en "${campo}": ${primero?.message ?? 'no cumple el formato esperado'}.`);
  }
  return resultado.data;
}
