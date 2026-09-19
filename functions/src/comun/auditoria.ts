/**
 * Bitácora de auditoría: toda operación sensible deja rastro de quién, qué y cuándo.
 *
 * La colección `auditoria` no es legible ni escribible desde el cliente (reglas `if false`).
 */
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { db } from './firebase';

export interface AsientoAuditoria {
  accion: string;
  actorUid: string | null;
  actorRol?: string | null;
  comercioId?: string | null;
  objetivo?: string | null;
  antes?: unknown;
  despues?: unknown;
  ip?: string | null;
  appCheckAppId?: string | null;
  detalle?: Record<string, unknown>;
}

function conFechas(asiento: AsientoAuditoria): Record<string, unknown> {
  return { ...asiento, fechaHora: FieldValue.serverTimestamp() };
}

/** Registra un asiento dentro de una transacción, para que comparta su atomicidad. */
export function auditarEnTransaccion(tx: Transaction, asiento: AsientoAuditoria): void {
  tx.set(db.collection('auditoria').doc(), conFechas(asiento));
}

/** Registra un asiento fuera de una transacción. */
export async function auditar(asiento: AsientoAuditoria): Promise<void> {
  await db.collection('auditoria').add(conFechas(asiento));
}
