/**
 * Custom claims: el rol y el comercio viajan firmados en el token, no en un documento editable.
 *
 * El documento `users/{uid}` sigue siendo la fuente de verdad administrativa; esta función lo
 * proyecta al token. Al terminar escribe `claimsUpdatedAt`, que el cliente observa para refrescar
 * su token sin necesidad de cerrar sesión.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { registrarEvento } from './eventos';
import { auth, db } from './firebase';
import { ROLES, ROLES_PRIVILEGIADOS, type ClaimsHipatia, type Rol } from './tipos';

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

export type ClasificacionCambio = 'privilegiado' | 'informativo' | 'ninguno';

const esPrivilegiado = (rol: string | null): boolean =>
  rol !== null && ROLES_PRIVILEGIADOS.some((privilegiado) => privilegiado === rol);

/**
 * Clasifica un cambio de claims para el registro de seguridad. Función pura.
 *
 * - `ninguno`: no cambia ni el rol ni el comercio.
 * - `privilegiado` (WARNING): cambia el rol o el comercio y el rol nuevo o el anterior es
 *   privilegiado. Incluye la pérdida de privilegio y el traspaso de un `admin_comercio` a otro
 *   comercio, que también interesan a quien vigila las cuentas con acceso amplio.
 * - `informativo` (INFO): cualquier otro cambio.
 */
export function clasificarCambioDeRol(cambio: {
  rolPrevio: string | null;
  comercioIdPrevio: string | null;
  rol: string;
  comercioId: string | null;
}): ClasificacionCambio {
  const cambiaRol = cambio.rolPrevio !== cambio.rol;
  const cambiaComercio = cambio.comercioIdPrevio !== cambio.comercioId;
  if (!cambiaRol && !cambiaComercio) return 'ninguno';
  return esPrivilegiado(cambio.rol) || esPrivilegiado(cambio.rolPrevio) ? 'privilegiado' : 'informativo';
}

/**
 * Proyecta el rol y el comercio del documento `users/{uid}` a los custom claims.
 * Es idempotente: si el token ya los tiene, no escribe nada.
 */
export async function sincronizarClaims(
  uid: string,
  opciones: { simular?: boolean; actorUid?: string } = {},
): Promise<ResultadoSincronizacion> {
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

  const rolPrevio = typeof usuarioAuth.customClaims?.rol === 'string' ? usuarioAuth.customClaims.rol : null;
  const comercioIdPrevio =
    typeof usuarioAuth.customClaims?.comercioId === 'string' ? usuarioAuth.customClaims.comercioId : null;
  await auth.setCustomUserClaims(uid, nuevos);

  // El evento se emite ANTES de la escritura siguiente, que puede fallar: si `update` falla, el
  // privilegio ya está aplicado en el token y debe quedar constancia de quién lo recibió.
  const clasificacion = clasificarCambioDeRol({
    rolPrevio,
    comercioIdPrevio,
    rol,
    comercioId: comercioId ?? null,
  });
  if (clasificacion !== 'ninguno') {
    registrarEvento(
      clasificacion === 'privilegiado' ? 'seguridad.rol_privilegiado_asignado' : 'seguridad.rol_asignado',
      {
        uid,
        rolAnterior: rolPrevio,
        rolNuevo: rol,
        comercioId: comercioId ?? null,
        comercioIdAnterior: comercioIdPrevio,
        actorUid: opciones.actorUid,
      },
      clasificacion === 'privilegiado' ? 'WARNING' : 'INFO',
    );
  }

  await snap.ref.update({ claimsUpdatedAt: FieldValue.serverTimestamp() });
  return { uid, rol, comercioId: comercioId ?? null, cambio: true };
}

/** Revoca los tokens vigentes de una cuenta: se usa al bloquear o al bajar de rol. */
export async function revocarSesiones(uid: string): Promise<void> {
  await auth.revokeRefreshTokens(uid);
  registrarEvento('seguridad.sesiones_revocadas', { uid }, 'INFO');
}
