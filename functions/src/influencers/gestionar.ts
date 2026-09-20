/**
 * Campañas de influencer y sus códigos, decididos en el servidor (H-08).
 *
 * La bolsa de puntos (`puntosParaClientes`) es moneda: la fija y la mueve el comercio a través de
 * estas funciones, nunca el navegador. Cada acción comprueba quién puede hacerla: el comercio
 * invita, acepta y recarga; el influencer propone, acepta y configura su código.
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../comun/firebase';
import { opcionesCallable } from '../comun/config';
import { validar } from '../comun/validacion';
import { conflicto, errorInterno, noEncontrado, sinPermiso } from '../comun/errores';
import { actorDe, exigirRol, type Actor } from '../comun/sesion';
import { auditar, auditarEnTransaccion } from '../comun/auditoria';

const ACCIONES = ['invitar', 'proponer', 'aceptar', 'rechazar', 'bloquear', 'desbloquear', 'editarRatio', 'recargarBolsa', 'eliminar'] as const;

const Asignacion = z.object({
  accion: z.enum(ACCIONES),
  comercioId: z.string().trim().min(1).max(64),
  influencerId: z.string().trim().min(1).max(128),
  puntosParaClientes: z.number().int().min(0).max(1_000_000).optional(),
  ratioCliente: z.number().int().min(0).max(10_000).optional(),
  ratioInfluencer: z.number().int().min(0).max(10_000).optional(),
});

const Codigo = z.object({
  accion: z.enum(['configurar', 'renovar', 'activar', 'desactivar', 'eliminar']),
  codigo: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, 'usa entre 4 y 20 letras o números'),
  comercioId: z.string().trim().min(1).max(64).optional(),
  puntosPorCanje: z.number().int().min(1).max(10_000).optional(),
});

/** El comercio de la campaña, o el influencer dueño de ella. */
function exigirParteDeLaCampana(actor: Actor, comercioId: string, influencerId: string): 'comercio' | 'influencer' {
  if (actor.rol === 'superadmin') return 'comercio';
  if (actor.rol === 'admin_comercio' && actor.comercioId === comercioId) return 'comercio';
  if (actor.rol === 'influencer' && actor.uid === influencerId) return 'influencer';
  throw sinPermiso(`${actor.uid} (${actor.rol}) intentó operar la campaña ${comercioId}_${influencerId}`);
}

export const gestionarAsignacionInfluencer = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'admin_comercio', 'influencer', 'superadmin');
  const datos = validar(Asignacion, req.data);
  const parte = exigirParteDeLaCampana(actor, datos.comercioId, datos.influencerId);

  const id = `${datos.comercioId}_${datos.influencerId}`;
  const ref = db.collection('asignaciones_influencer').doc(id);

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const actual = snap.data() as
        | { estado?: string; puntosParaClientes?: number; ratio?: { cliente?: number; influencer?: number } }
        | undefined;

      const auditoriaBase = {
        actorUid: actor.uid,
        actorRol: actor.rol,
        comercioId: datos.comercioId,
        objetivo: id,
        ip: actor.ip,
        appCheckAppId: actor.appCheckAppId,
      };

      switch (datos.accion) {
        case 'invitar':
        case 'proponer': {
          if (snap.exists) throw conflicto('Ya existe una colaboración con este influencer.');
          if (datos.accion === 'invitar' && parte !== 'comercio') throw sinPermiso('solo el comercio invita');
          if (datos.accion === 'proponer' && parte !== 'influencer') throw sinPermiso('solo el influencer propone');

          const perfil = await tx.get(db.collection('users').doc(datos.influencerId));
          if (!perfil.exists || perfil.data()?.rol !== 'influencer') throw noEncontrado('Ese influencer no existe.');

          tx.set(ref, {
            id,
            comercioId: datos.comercioId,
            influencerId: datos.influencerId,
            puntosParaClientes: 0,
            ratio: { cliente: datos.ratioCliente ?? 10, influencer: datos.ratioInfluencer ?? 0 },
            estado: 'PENDIENTE',
            iniciadoPor: datos.accion === 'invitar' ? 'COMERCIO' : 'INFLUENCER',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          auditarEnTransaccion(tx, { ...auditoriaBase, accion: 'campana.creada', despues: { iniciadoPor: datos.accion } });
          return { estado: 'PENDIENTE' };
        }

        case 'aceptar': {
          if (!snap.exists) throw noEncontrado('Esa colaboración no existe.');
          if (actual?.estado === 'ACEPTADO') return { estado: 'ACEPTADO' };
          // Quien acepta es la contraparte de quien inició, y la bolsa solo la pone el comercio.
          const bolsa = parte === 'comercio' ? (datos.puntosParaClientes ?? actual?.puntosParaClientes ?? 0) : (actual?.puntosParaClientes ?? 0);
          tx.update(ref, {
            estado: 'ACEPTADO',
            puntosParaClientes: bolsa,
            ratio: {
              cliente: datos.ratioCliente ?? actual?.ratio?.cliente ?? 10,
              influencer: datos.ratioInfluencer ?? actual?.ratio?.influencer ?? 0,
            },
            bloqueadoPor: null,
            updatedAt: Date.now(),
          });
          auditarEnTransaccion(tx, { ...auditoriaBase, accion: 'campana.aceptada', antes: { estado: actual?.estado ?? null }, despues: { estado: 'ACEPTADO', bolsa } });
          return { estado: 'ACEPTADO', puntosParaClientes: bolsa };
        }

        case 'recargarBolsa': {
          if (!snap.exists) throw noEncontrado('Esa colaboración no existe.');
          if (parte !== 'comercio') throw sinPermiso('solo el comercio recarga la bolsa');
          const agregado = datos.puntosParaClientes ?? 0;
          if (agregado <= 0) throw conflicto('Indica cuántos puntos quieres agregar a la bolsa.');
          const nueva = (actual?.puntosParaClientes ?? 0) + agregado;
          tx.update(ref, { puntosParaClientes: nueva, updatedAt: Date.now() });
          auditarEnTransaccion(tx, { ...auditoriaBase, accion: 'campana.bolsa_recargada', antes: { bolsa: actual?.puntosParaClientes ?? 0 }, despues: { bolsa: nueva } });
          return { puntosParaClientes: nueva };
        }

        case 'editarRatio': {
          if (!snap.exists) throw noEncontrado('Esa colaboración no existe.');
          if (parte !== 'comercio') throw sinPermiso('solo el comercio edita el reparto');
          tx.update(ref, {
            ratio: { cliente: datos.ratioCliente ?? 10, influencer: datos.ratioInfluencer ?? 0 },
            updatedAt: Date.now(),
          });
          return { ok: true };
        }

        case 'rechazar':
        case 'bloquear':
        case 'desbloquear': {
          if (!snap.exists) throw noEncontrado('Esa colaboración no existe.');
          const estado = datos.accion === 'rechazar' ? 'RECHAZADO' : datos.accion === 'bloquear' ? 'BLOQUEADO' : 'ACEPTADO';
          tx.update(ref, {
            estado,
            bloqueadoPor: datos.accion === 'bloquear' ? (parte === 'comercio' ? 'COMERCIO' : 'INFLUENCER') : null,
            updatedAt: Date.now(),
          });
          auditarEnTransaccion(tx, { ...auditoriaBase, accion: `campana.${datos.accion}`, antes: { estado: actual?.estado ?? null }, despues: { estado } });
          return { estado };
        }

        case 'eliminar': {
          if (!snap.exists) return { ok: true };
          // Los códigos de esa campaña dejan de existir con ella: si no, quedarían canjeables.
          const codigos = await tx.get(
            db.collection('codigos_influencer')
              .where('influencerId', '==', datos.influencerId)
              .where('comercioId', '==', datos.comercioId),
          );
          for (const codigo of codigos.docs) tx.delete(codigo.ref);
          tx.delete(ref);
          auditarEnTransaccion(tx, {
            ...auditoriaBase,
            accion: 'campana.eliminada',
            antes: { estado: actual?.estado ?? null, bolsa: actual?.puntosParaClientes ?? 0 },
            detalle: { codigosBorrados: codigos.size },
          });
          return { ok: true };
        }
      }
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});

export const gestionarCodigoInfluencer = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'influencer', 'superadmin');
  const datos = validar(Codigo, req.data);

  try {
    const ref = db.collection('codigos_influencer').doc(datos.codigo);

    if (datos.accion === 'configurar') {
      if (!datos.comercioId || !datos.puntosPorCanje) {
        throw conflicto('Indica el comercio y cuántos puntos entrega el código.');
      }
      const asignacion = await db.collection('asignaciones_influencer').doc(`${datos.comercioId}_${actor.uid}`).get();
      if (!asignacion.exists || asignacion.data()?.estado !== 'ACEPTADO') {
        throw conflicto('Necesitas una colaboración aceptada con ese comercio.');
      }

      const existente = await ref.get();
      if (existente.exists && existente.data()?.influencerId !== actor.uid) {
        throw conflicto(`El código "${datos.codigo}" ya está en uso.`);
      }
      const deComercio = await db.collection('codigos_comercio').doc(datos.codigo).get();
      if (deComercio.exists) throw conflicto(`El código "${datos.codigo}" ya está en uso.`);

      await ref.set({
        id: datos.codigo,
        influencerId: actor.uid,
        comercioId: datos.comercioId,
        puntosPorCanje: datos.puntosPorCanje,
        estado: 'ACTIVO',
        createdAt: existente.data()?.createdAt ?? Date.now(),
        fechaUltimaRenovacion: Date.now(),
      });
      await auditar({
        accion: 'codigo_influencer.configurado',
        actorUid: actor.uid,
        actorRol: actor.rol,
        comercioId: datos.comercioId,
        objetivo: datos.codigo,
        despues: { puntosPorCanje: datos.puntosPorCanje },
        ip: actor.ip,
      });
      return { codigo: datos.codigo };
    }

    const snap = await ref.get();
    if (!snap.exists) throw noEncontrado('Ese código no existe.');
    if (actor.rol !== 'superadmin' && snap.data()?.influencerId !== actor.uid) {
      throw sinPermiso('el código pertenece a otro influencer');
    }

    if (datos.accion === 'eliminar') {
      await ref.delete();
      return { ok: true };
    }
    if (datos.accion === 'renovar') {
      await ref.update({ fechaUltimaRenovacion: Date.now(), estado: 'ACTIVO' });
      return { ok: true };
    }
    await ref.update({ estado: datos.accion === 'activar' ? 'ACTIVO' : 'INACTIVO' });
    return { ok: true };
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});
