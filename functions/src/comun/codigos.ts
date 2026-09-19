/**
 * Generación de códigos de sesión con azar criptográfico (H-11).
 *
 * `Math.random()` es predecible; `crypto.randomInt` no. La unicidad se comprueba dentro de la
 * transacción que crea la sesión, de modo que una colisión no pueda sobrescribir una sesión ajena.
 */
import { randomInt } from 'node:crypto';

export const MINUTOS_VIGENCIA_SESION = 5;

export const nuevoCodigo = (): string => String(randomInt(100000, 1000000));

export const vencimiento = (desde = Date.now()): number => desde + MINUTOS_VIGENCIA_SESION * 60000;
