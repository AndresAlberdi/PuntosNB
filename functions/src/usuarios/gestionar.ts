/**
 * Alta y administración de cuentas y comercios: la única vía para asignar rol y comercio.
 *
 * El rol deja de ser un campo que el cliente puede escribir: lo fija el servidor en el documento
 * y en los custom claims del token (H-01, H-09). Bajar de rol o bloquear revoca las sesiones vivas.
 */
import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../comun/firebase';
import { opcionesCallable } from '../comun/config';
import { validar } from '../comun/validacion';
import { conflicto, errorInterno, noEncontrado } from '../comun/errores';
import { actorDe, exigirRol } from '../comun/sesion';
import { auditar } from '../comun/auditoria';
import { revocarSesiones, sincronizarClaims } from '../comun/claims';
import { ROLES } from '../comun/tipos';

const AsignarRol = z.object({
  uid: z.string().trim().min(1).max(128),
  rol: z.enum(ROLES),
  comercioId: z.string().trim().max(64).optional(),
});

const EstadoUsuario = z.object({
  uid: z.string().trim().min(1).max(128),
  bloquear: z.boolean(),
});

const GuardarComercio = z.object({
  comercioId: z.string().trim().max(64).optional(),
  nombre: z.string().trim().min(2).max(80),
  nit_rut: z.string().trim().min(1).max(40),
  razonSocial: z.string().trim().max(120).optional(),
  dominio: z.string().trim().max(120).optional(),
  plan: z.enum(['regular', 'premium']).optional(),
  modalidadPago: z.enum(['PREPAGO', 'PILOTO']).optional(),
  mensualidadBs: z.number().nonnegative().max(100_000).optional(),
  costoPorPremioBs: z.number().nonnegative().max(10_000).optional(),
  costoPorCodigoComercio: z.number().nonnegative().max(10_000).optional(),
  recibeFactura: z.boolean().optional(),
  estado: z.enum(['activo', 'bloqueado']).optional(),
  logoUrl: z.string().trim().max(2_000_000).optional(),
  paletteId: z.string().trim().max(40).optional(),
});

/** Asigna rol y comercio, y los refleja en el token. Solo el superadministrador. */
export const asignarRol = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'superadmin');
  const datos = validar(AsignarRol, req.data);

  if ((datos.rol === 'vendedor' || datos.rol === 'admin_comercio') && !datos.comercioId) {
    throw conflicto('Ese rol necesita un comercio asignado.');
  }

  try {
    const ref = db.collection('users').doc(datos.uid);
    const snap = await ref.get();
    if (!snap.exists) throw noEncontrado('Esa cuenta no tiene perfil en el sistema.');

    if (datos.comercioId) {
      const comercio = await db.collection('comercios').doc(datos.comercioId).get();
      if (!comercio.exists) throw noEncontrado('El comercio indicado no existe.');
    }

    const rolAnterior = snap.data()?.rol as string | undefined;
    await ref.update({
      rol: datos.rol,
      ...(datos.comercioId ? { comercioId: datos.comercioId } : { comercioId: FieldValue.delete() }),
    });
    await sincronizarClaims(datos.uid);

    // Si pierde privilegios, sus tokens actuales dejan de valer de inmediato.
    const privilegiados = ['superadmin', 'contador', 'admin_comercio'];
    if (rolAnterior && privilegiados.includes(rolAnterior) && rolAnterior !== datos.rol) {
      await revocarSesiones(datos.uid);
    }

    await auditar({
      accion: 'usuario.rol_asignado',
      actorUid: actor.uid,
      actorRol: actor.rol,
      objetivo: datos.uid,
      antes: { rol: rolAnterior ?? null, comercioId: snap.data()?.comercioId ?? null },
      despues: { rol: datos.rol, comercioId: datos.comercioId ?? null },
      ip: actor.ip,
      appCheckAppId: actor.appCheckAppId,
    });

    return { ok: true };
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});

/** Bloquea o desbloquea una cuenta. Al bloquear se revocan sus sesiones. */
export const cambiarEstadoUsuario = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'superadmin');
  const datos = validar(EstadoUsuario, req.data);

  if (datos.uid === actor.uid) throw conflicto('No puedes bloquear tu propia cuenta.');

  try {
    const ref = db.collection('users').doc(datos.uid);
    const snap = await ref.get();
    if (!snap.exists) throw noEncontrado('Esa cuenta no existe.');

    await ref.update({ estado: datos.bloquear ? 'bloqueado' : 'activo' });
    if (datos.bloquear) await revocarSesiones(datos.uid).catch(() => undefined);

    await auditar({
      accion: datos.bloquear ? 'usuario.bloqueado' : 'usuario.desbloqueado',
      actorUid: actor.uid,
      actorRol: actor.rol,
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

/** Crea o edita un comercio, incluidos sus campos de facturación. Solo el superadministrador. */
export const guardarComercio = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'superadmin');
  const datos = validar(GuardarComercio, req.data);

  try {
    const ref = datos.comercioId
      ? db.collection('comercios').doc(datos.comercioId)
      : db.collection('comercios').doc();
    const snap = await ref.get();

    if (datos.comercioId && !snap.exists) throw noEncontrado('El comercio no existe.');

    const campos: Record<string, unknown> = {
      nombre: datos.nombre,
      nit_rut: datos.nit_rut,
      razonSocial: datos.razonSocial ?? '',
      dominio: datos.dominio ?? '',
      ...(datos.plan ? { plan: datos.plan } : {}),
      ...(datos.modalidadPago ? { modalidadPago: datos.modalidadPago } : {}),
      ...(datos.mensualidadBs !== undefined ? { mensualidadBs: datos.mensualidadBs } : {}),
      ...(datos.costoPorPremioBs !== undefined ? { costoPorPremioBs: datos.costoPorPremioBs } : {}),
      ...(datos.costoPorCodigoComercio !== undefined ? { costoPorCodigoComercio: datos.costoPorCodigoComercio } : {}),
      ...(datos.recibeFactura !== undefined ? { recibeFactura: datos.recibeFactura } : {}),
      ...(datos.estado ? { estado: datos.estado } : {}),
      ...(datos.logoUrl !== undefined ? { logoUrl: datos.logoUrl } : {}),
      ...(datos.paletteId ? { paletteId: datos.paletteId } : {}),
    };

    if (!snap.exists) {
      // Un comercio nuevo nace PILOTO y sin saldo: el prepago lo activa el contador al cobrar.
      Object.assign(campos, {
        id: ref.id,
        createdAt: Date.now(),
        reglas: [],
        premios: [],
        productos: [],
        estado: datos.estado ?? 'activo',
        modalidadPago: datos.modalidadPago ?? 'PILOTO',
        saldoPremiosBs: 0,
        consumidoPremiosBs: 0,
        mesesPagados: [],
      });
    }

    await ref.set(campos, { merge: true });

    await auditar({
      accion: snap.exists ? 'comercio.editado' : 'comercio.creado',
      actorUid: actor.uid,
      actorRol: actor.rol,
      comercioId: ref.id,
      objetivo: ref.id,
      antes: snap.exists ? { plan: snap.data()?.plan ?? null, modalidadPago: snap.data()?.modalidadPago ?? null } : null,
      despues: { plan: datos.plan ?? null, modalidadPago: datos.modalidadPago ?? null },
      ip: actor.ip,
      appCheckAppId: actor.appCheckAppId,
    });

    return { comercioId: ref.id };
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});

/** Sincroniza los claims de una cuenta puntual, para reparar desfases. */
export const sincronizarClaimsUsuario = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'superadmin');
  const { uid } = validar(z.object({ uid: z.string().trim().min(1).max(128) }), req.data);
  try {
    return await sincronizarClaims(uid);
  } catch (error) {
    throw errorInterno(error);
  }
});
