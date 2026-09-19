/**
 * Alta, rotación de PIN y bloqueo de vendedores, siempre desde el servidor.
 *
 * Reemplaza la creación desde `SuperAdminDashboard`, que escribía el PIN en claro en `users` y
 * generaba un uid sintético inexistente en Firebase Auth, de modo que el vendedor nunca podía
 * entrar (H-22). Ahora cada vendedor tiene una cuenta real en Auth —sin contraseña ni correo de
 * acceso— para poder revocarle las sesiones cuando se lo bloquea.
 */
import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { auth, db } from '../comun/firebase';
import { opcionesCallable } from '../comun/config';
import { validar } from '../comun/validacion';
import { conflicto, errorInterno, noEncontrado } from '../comun/errores';
import { actorDe, exigirComercio, exigirRol } from '../comun/sesion';
import { hashearPin, PIN_VALIDO } from '../comun/pin';
import { estadoLimpio } from '../comun/bloqueo';
import { auditar } from '../comun/auditoria';

const Crear = z.object({
  usuario: z.string().trim().toLowerCase().min(3).max(120),
  nombre: z.string().trim().min(2).max(80),
  comercioId: z.string().trim().min(1).max(64),
  pin: z.string().regex(PIN_VALIDO, 'el PIN es de 6 dígitos'),
  telefono: z.string().trim().max(24).optional(),
});

const Rotar = z.object({
  uid: z.string().trim().min(1).max(128),
  pin: z.string().regex(PIN_VALIDO, 'el PIN es de 6 dígitos'),
});

const Bloquear = z.object({
  uid: z.string().trim().min(1).max(128),
  bloquear: z.boolean(),
});

/** PIN demasiado obvio: seis dígitos iguales o una secuencia corrida. */
function pinDebil(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  const corridas = ['0123456789', '9876543210'];
  return corridas.some((c) => c.includes(pin));
}

export const crearVendedor = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'superadmin', 'admin_comercio');
  const datos = validar(Crear, req.data);
  exigirComercio(actor, datos.comercioId);

  if (pinDebil(datos.pin)) {
    throw conflicto('Ese PIN es demasiado fácil de adivinar. Evita dígitos repetidos o secuencias.');
  }

  try {
    const comercio = await db.collection('comercios').doc(datos.comercioId).get();
    if (!comercio.exists) throw noEncontrado('El comercio indicado no existe.');

    const repetido = await db.collection('users').where('email', '==', datos.usuario).limit(1).get();
    if (!repetido.empty) throw conflicto(`El usuario "${datos.usuario}" ya está registrado.`);

    // Cuenta en Auth sin método de acceso propio: el vendedor entra con custom token tras su PIN.
    const cuenta = await auth.createUser({ displayName: datos.nombre });
    await auth.setCustomUserClaims(cuenta.uid, { rol: 'vendedor', comercioId: datos.comercioId });

    const secreto = await hashearPin(datos.pin);
    const lote = db.batch();
    lote.set(db.collection('users').doc(cuenta.uid), {
      uid: cuenta.uid,
      email: datos.usuario,
      usuario: datos.usuario,
      nombre: datos.nombre,
      rol: 'vendedor',
      comercioId: datos.comercioId,
      estado: 'activo',
      createdAt: Date.now(),
      claimsUpdatedAt: FieldValue.serverTimestamp(),
      ...(datos.telefono ? { telefono: datos.telefono } : {}),
    });
    lote.set(db.collection('vendedores_secretos').doc(cuenta.uid), {
      ...secreto,
      ...estadoLimpio(),
      rotacionRequerida: false,
      actualizadoEn: FieldValue.serverTimestamp(),
      actualizadoPor: actor.uid,
    });
    await lote.commit();

    await auditar({
      accion: 'vendedor.creado',
      actorUid: actor.uid,
      actorRol: actor.rol,
      comercioId: datos.comercioId,
      objetivo: cuenta.uid,
      ip: actor.ip,
      appCheckAppId: actor.appCheckAppId,
    });

    return { uid: cuenta.uid, usuario: datos.usuario };
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});

export const rotarPinVendedor = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'superadmin', 'admin_comercio');
  const datos = validar(Rotar, req.data);

  if (pinDebil(datos.pin)) {
    throw conflicto('Ese PIN es demasiado fácil de adivinar. Evita dígitos repetidos o secuencias.');
  }

  try {
    const snap = await db.collection('users').doc(datos.uid).get();
    if (!snap.exists || snap.data()?.rol !== 'vendedor') throw noEncontrado('Ese vendedor no existe.');
    exigirComercio(actor, snap.data()?.comercioId as string);

    const secreto = await hashearPin(datos.pin);
    await db.collection('vendedores_secretos').doc(datos.uid).set({
      ...secreto,
      ...estadoLimpio(),
      rotacionRequerida: false,
      actualizadoEn: FieldValue.serverTimestamp(),
      actualizadoPor: actor.uid,
    });
    // El PIN cambió: las sesiones abiertas con el anterior dejan de valer.
    await auth.revokeRefreshTokens(datos.uid).catch(() => undefined);

    await auditar({
      accion: 'vendedor.pin_rotado',
      actorUid: actor.uid,
      actorRol: actor.rol,
      comercioId: snap.data()?.comercioId ?? null,
      objetivo: datos.uid,
      ip: actor.ip,
      appCheckAppId: actor.appCheckAppId,
    });

    return { ok: true };
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});

export const bloquearVendedor = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'superadmin', 'admin_comercio');
  const datos = validar(Bloquear, req.data);

  try {
    const ref = db.collection('users').doc(datos.uid);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.rol !== 'vendedor') throw noEncontrado('Ese vendedor no existe.');
    exigirComercio(actor, snap.data()?.comercioId as string);

    await ref.update({ estado: datos.bloquear ? 'bloqueado' : 'activo' });
    if (datos.bloquear) await auth.revokeRefreshTokens(datos.uid).catch(() => undefined);

    await auditar({
      accion: datos.bloquear ? 'vendedor.bloqueado' : 'vendedor.desbloqueado',
      actorUid: actor.uid,
      actorRol: actor.rol,
      comercioId: snap.data()?.comercioId ?? null,
      objetivo: datos.uid,
      antes: { estado: snap.data()?.estado ?? 'activo' },
      despues: { estado: datos.bloquear ? 'bloqueado' : 'activo' },
      ip: actor.ip,
      appCheckAppId: actor.appCheckAppId,
    });

    return { ok: true };
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});
