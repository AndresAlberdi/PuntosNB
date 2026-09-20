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
import { actualizarDerivados, refPrivado, refPublico } from '../comun/comercio';

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

/**
 * Mantiene el perfil público del influencer.
 *
 * Los datos de contacto y el documento completo del influencer dejan de ser legibles por cualquier
 * autenticado (H-16): en su lugar queda un perfil mínimo con lo que el comercio necesita ver.
 */
export async function sincronizarPerfilPublicoInfluencer(uid: string): Promise<void> {
  const snap = await db.collection('users').doc(uid).get();
  const ref = db.collection('influencers_publico').doc(uid);

  if (!snap.exists || snap.data()?.rol !== 'influencer') {
    await ref.delete().catch(() => undefined);
    return;
  }

  const d = snap.data() ?? {};
  await ref.set({
    uid,
    nombre: d.nombre ?? '',
    prefijoCodigo: d.prefijoCodigo ?? '',
    avatarUrl: d.avatarUrl ?? '',
    descripcion: d.descripcion ?? '',
    redesSociales: d.redesSociales ?? [],
    seguidores: d.seguidores ?? 0,
    estado: d.estado ?? 'activo',
  });
}

const PerfilInfluencer = z.object({
  uid: z.string().trim().min(1).max(128),
  nombre: z.string().trim().min(2).max(80).optional(),
  prefijoCodigo: z.string().trim().max(10).optional(),
  descripcion: z.string().trim().max(500).optional(),
  seguidores: z.number().int().min(0).max(1_000_000_000).optional(),
  redesSociales: z.array(z.string().trim().max(200)).max(10).optional(),
  telefono: z.string().trim().max(24).optional(),
});

/** Edita el perfil de un influencer y actualiza su espejo público. */
export const actualizarPerfilInfluencer = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'superadmin');
  const datos = validar(PerfilInfluencer, req.data);

  try {
    const ref = db.collection('users').doc(datos.uid);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.rol !== 'influencer') throw noEncontrado('Ese influencer no existe.');

    if (datos.prefijoCodigo) {
      const repetido = await db.collection('users')
        .where('rol', '==', 'influencer')
        .where('prefijoCodigo', '==', datos.prefijoCodigo.toUpperCase())
        .get();
      if (repetido.docs.some((d) => d.id !== datos.uid)) {
        throw conflicto(`El prefijo "${datos.prefijoCodigo.toUpperCase()}" ya lo usa otro influencer.`);
      }
    }

    const { uid: _uid, prefijoCodigo, ...resto } = datos;
    await ref.update({
      ...resto,
      ...(prefijoCodigo ? { prefijoCodigo: prefijoCodigo.toUpperCase() } : {}),
    });
    await sincronizarPerfilPublicoInfluencer(datos.uid);

    await auditar({
      accion: 'influencer.perfil_editado',
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
    await sincronizarPerfilPublicoInfluencer(datos.uid);

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
    const ref = datos.comercioId ? refPublico(datos.comercioId) : db.collection('comercios').doc();
    const snap = await ref.get();

    if (datos.comercioId && !snap.exists) throw noEncontrado('El comercio no existe.');

    // Lo público: lo que cualquier usuario autenticado puede ver del comercio.
    const publico: Record<string, unknown> = {
      nombre: datos.nombre,
      dominio: datos.dominio ?? '',
      ...(datos.estado ? { estado: datos.estado } : {}),
      ...(datos.logoUrl !== undefined ? { logoUrl: datos.logoUrl } : {}),
      ...(datos.paletteId ? { paletteId: datos.paletteId } : {}),
      ...(datos.modalidadPago ? { modalidadPago: datos.modalidadPago } : {}),
    };

    // Lo privado: datos fiscales y económicos, fuera del alcance de cualquier cliente.
    const privado: Record<string, unknown> = {
      nit_rut: datos.nit_rut,
      razonSocial: datos.razonSocial ?? '',
      ...(datos.plan ? { plan: datos.plan } : {}),
      ...(datos.modalidadPago ? { modalidadPago: datos.modalidadPago } : {}),
      ...(datos.mensualidadBs !== undefined ? { mensualidadBs: datos.mensualidadBs } : {}),
      ...(datos.costoPorPremioBs !== undefined ? { costoPorPremioBs: datos.costoPorPremioBs } : {}),
      ...(datos.costoPorCodigoComercio !== undefined ? { costoPorCodigoComercio: datos.costoPorCodigoComercio } : {}),
      ...(datos.recibeFactura !== undefined ? { recibeFactura: datos.recibeFactura } : {}),
    };

    if (!snap.exists) {
      // Un comercio nuevo nace PILOTO y sin saldo: el prepago lo activa el contador al cobrar.
      Object.assign(publico, {
        id: ref.id,
        createdAt: Date.now(),
        reglas: [],
        premios: [],
        productos: [],
        estado: datos.estado ?? 'activo',
        modalidadPago: datos.modalidadPago ?? 'PILOTO',
        operativoHasta: null,
        puedeCanjearPremios: true,
      });
      Object.assign(privado, {
        id: ref.id,
        modalidadPago: datos.modalidadPago ?? 'PILOTO',
        saldoPremiosBs: 0,
        consumidoPremiosBs: 0,
        mesesPagados: [],
      });
    }

    const lote = db.batch();
    lote.set(ref, publico, { merge: true });
    lote.set(refPrivado(ref.id), privado, { merge: true });
    await lote.commit();

    await db.runTransaction(async (tx) => {
      const [pub, priv] = await Promise.all([tx.get(ref), tx.get(refPrivado(ref.id))]);
      actualizarDerivados(tx, ref.id, { ...pub.data(), ...priv.data() });
    });

    await auditar({
      accion: snap.exists ? 'comercio.editado' : 'comercio.creado',
      actorUid: actor.uid,
      actorRol: actor.rol,
      comercioId: ref.id,
      objetivo: ref.id,
      antes: snap.exists ? { nombre: snap.data()?.nombre ?? null } : null,
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

/** Bloquea o reactiva un comercio. El estado vive en el documento público. */
export const cambiarEstadoComercio = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'superadmin');
  const datos = validar(
    z.object({ comercioId: z.string().trim().min(1).max(64), bloquear: z.boolean() }),
    req.data,
  );

  try {
    const ref = refPublico(datos.comercioId);
    const snap = await ref.get();
    if (!snap.exists) throw noEncontrado('El comercio no existe.');

    const estado = datos.bloquear ? 'bloqueado' : 'activo';
    await ref.update({ estado });

    await auditar({
      accion: datos.bloquear ? 'comercio.bloqueado' : 'comercio.desbloqueado',
      actorUid: actor.uid,
      actorRol: actor.rol,
      comercioId: datos.comercioId,
      objetivo: datos.comercioId,
      antes: { estado: snap.data()?.estado ?? 'activo' },
      despues: { estado },
      ip: actor.ip,
      appCheckAppId: actor.appCheckAppId,
    });

    return { estado };
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
