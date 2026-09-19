/** Lectura de la identidad de quien invoca, siempre desde el token firmado. */
import type { CallableRequest } from 'firebase-functions/v2/https';
import { sinPermiso, sinSesion } from './errores';
import { ROLES, type Rol } from './tipos';

export interface Actor {
  uid: string;
  rol: Rol;
  comercioId: string | null;
  ip: string | null;
  appCheckAppId: string | null;
}

/**
 * Devuelve el actor a partir del token. El rol se lee de los custom claims, nunca de Firestore:
 * un documento se puede editar, un token firmado no.
 */
export function actorDe(req: CallableRequest<unknown>): Actor {
  if (!req.auth) throw sinSesion();

  const rol = req.auth.token.rol as Rol | undefined;
  if (!rol || !ROLES.includes(rol)) {
    throw sinPermiso(`token sin rol válido (uid ${req.auth.uid})`);
  }

  const comercioId = typeof req.auth.token.comercioId === 'string' ? req.auth.token.comercioId : null;

  return {
    uid: req.auth.uid,
    rol,
    comercioId,
    ip: req.rawRequest?.ip ?? null,
    appCheckAppId: req.app?.appId ?? null,
  };
}

/** Exige que el actor tenga alguno de los roles indicados. */
export function exigirRol(actor: Actor, ...roles: Rol[]): void {
  if (!roles.includes(actor.rol)) {
    throw sinPermiso(`rol ${actor.rol} intentó una operación de ${roles.join('/')}`);
  }
}

/** Exige que el actor pertenezca al comercio sobre el que quiere operar. */
export function exigirComercio(actor: Actor, comercioId: string): void {
  if (actor.rol === 'superadmin') return;
  if (!actor.comercioId || actor.comercioId !== comercioId) {
    throw sinPermiso(`${actor.uid} (${actor.comercioId ?? 'sin comercio'}) intentó operar sobre ${comercioId}`);
  }
}
