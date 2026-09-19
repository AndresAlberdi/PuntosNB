/**
 * Bloqueo progresivo de intentos fallidos, por cuenta y por dirección IP.
 *
 * La IP no se guarda en claro: se almacena su hash con un pimiento fijo del proyecto, de modo que
 * la bitácora de intentos no sea un registro de direcciones de personas.
 */
import { createHmac } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from './firebase';

export const INTENTOS_MAXIMOS = 5;
export const MINUTOS_BLOQUEO = 15;
export const VENTANA_MINUTOS = 15;

const PIMIENTO = process.env.PIMIENTO_IP ?? 'hipatia-intentos';

export const idDeIp = (ip: string | null): string =>
  createHmac('sha256', PIMIENTO).update(ip ?? 'desconocida').digest('hex').slice(0, 32);

export interface EstadoIntentos {
  intentosFallidos?: number;
  bloqueadoHasta?: Timestamp | null;
  ventanaInicio?: Timestamp | null;
}

export const estaBloqueado = (estado: EstadoIntentos | undefined, ahora = Date.now()): boolean =>
  Boolean(estado?.bloqueadoHasta && estado.bloqueadoHasta.toMillis() > ahora);

export const minutosRestantes = (estado: EstadoIntentos | undefined, ahora = Date.now()): number =>
  estado?.bloqueadoHasta ? Math.max(1, Math.ceil((estado.bloqueadoHasta.toMillis() - ahora) / 60000)) : 0;

/** Suma un intento fallido y devuelve si con este se alcanzó el bloqueo. */
export function siguienteEstadoTrasFallo(estado: EstadoIntentos | undefined, ahora = Date.now()): EstadoIntentos & { bloqueado: boolean } {
  const ventanaVigente =
    estado?.ventanaInicio && ahora - estado.ventanaInicio.toMillis() < VENTANA_MINUTOS * 60000;
  const intentos = (ventanaVigente ? (estado?.intentosFallidos ?? 0) : 0) + 1;
  const bloqueado = intentos >= INTENTOS_MAXIMOS;

  return {
    intentosFallidos: intentos,
    ventanaInicio: ventanaVigente && estado?.ventanaInicio ? estado.ventanaInicio : Timestamp.fromMillis(ahora),
    bloqueadoHasta: bloqueado ? Timestamp.fromMillis(ahora + MINUTOS_BLOQUEO * 60000) : null,
    bloqueado,
  };
}

export const estadoLimpio = (): EstadoIntentos => ({
  intentosFallidos: 0,
  bloqueadoHasta: null,
  ventanaInicio: null,
});

export const refIntentosIp = (ip: string | null): FirebaseFirestore.DocumentReference =>
  db.collection('intentos_login_ip').doc(idDeIp(ip));
