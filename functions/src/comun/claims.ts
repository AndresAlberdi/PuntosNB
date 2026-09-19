/**
 * Custom claims: el rol y el comercio viajan firmados en el token, no en un documento editable.
 *
 * El documento `users/{uid}` sigue siendo la fuente de verdad administrativa; esta función lo
 * proyecta al token. Al terminar escribe `claimsUpdatedAt`, que el cliente observa para refrescar
 * su token sin necesidad de cerrar sesión.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { auth, db } from './firebase';
import { ROLES, type ClaimsHipatia, type Rol } from './tipos';

export interface ResultadoSincronizacion {
  uid: string;
  rol: Rol | null;
  comercioId: string | null;
  cambio: boolean;
  motivo?: string;
}

function mismosClaims(actuales: Record<string, unknown> | undefined, nuevos: ClaimsHipatia): boolean {
  return actuales?.rol === nuevos.rol && (actuales?.comercioId ?? undefined) === nuevos.comercioId;
}

/**
 * Proyecta el rol y el comercio del documento `users/{uid}` a los custom claims.
 * Es idempotente: si el token ya los tiene, no escribe nada.
 */
export async function sincronizarClaims(uid: string, opciones: { simular?: boolean } = {}): Promise<ResultadoSincronizacion> {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) {
    return { uid, rol: null, comercioId: null, cambio: false, motivo: 'sin documento en users' };
  }

  const datos = snap.data() ?? {};
  const rol = datos.rol as Rol | undefined;
  if (!rol || !ROLES.includes(rol)) {
    return { uid, rol: null, comercioId: null, cambio: false, motivo: `rol ausente o desconocido: ${String(rol)}` };
  }

  const comercioId = typeof datos.comercioId === 'string' && datos.comercioId ? datos.comercioId : undefined;
  const nuevos: ClaimsHipatia = comercioId ? { rol, comercioId } : { rol };

  let usuarioAuth;
  try {
    usuarioAuth = await auth.getUser(uid);
  } catch {
    return { uid, rol, comercioId: comercioId ?? null, cambio: false, motivo: 'sin cuenta en Firebase Auth' };
  }

  if (mismosClaims(usuarioAuth.customClaims, nuevos)) {
    return { uid, rol, comercioId: comercioId ?? null, cambio: false, motivo: 'ya estaba al día' };
  }

  if (opciones.simular) {
    return { uid, rol, comercioId: comercioId ?? null, cambio: true, motivo: 'simulación' };
  }

  await auth.setCustomUserClaims(uid, nuevos);
  await snap.ref.update({ claimsUpdatedAt: FieldValue.serverTimestamp() });
  logger.info('Claims sincronizados', { uid, rol, comercioId: comercioId ?? null });
  return { uid, rol, comercioId: comercioId ?? null, cambio: true };
}

/** Revoca los tokens vigentes de una cuenta: se usa al bloquear o al bajar de rol. */
export async function revocarSesiones(uid: string): Promise<void> {
  await auth.revokeRefreshTokens(uid);
  logger.info('Sesiones revocadas', { uid });
}
