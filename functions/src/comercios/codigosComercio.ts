/**
 * Códigos promocionales del comercio, cobrados en el servidor.
 *
 * Antes el navegador descontaba el costo del código del saldo prepagado; ahora el descuento y la
 * creación ocurren en la misma transacción, con el costo tomado de la configuración del comercio.
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../comun/firebase';
import { opcionesCallable } from '../comun/config';
import { validar } from '../comun/validacion';
import { conflicto, errorInterno, noEncontrado } from '../comun/errores';
import { actorDe, exigirComercio, exigirRol } from '../comun/sesion';
import { auditarEnTransaccion } from '../comun/auditoria';
import { actualizarDerivados, leerComercioEnTx, refPrivado } from '../comun/comercio';
import { estadoPrepago } from '../comun/negocio';

const DIAS_VIGENCIA = 30;

const Crear = z.object({
  codigo: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, 'usa entre 4 y 20 letras o números'),
  puntosPorCanje: z.number().int().min(1).max(10_000),
  comercioId: z.string().trim().min(1).max(64),
  // Fecha de inicio opcional: el comercio puede programar el código, pero nunca hacia atrás.
  fechaInicio: z.number().int().positive().optional(),
});

const CambiarEstado = z.object({
  codigo: z.string().trim().toUpperCase().min(4).max(20),
  activo: z.boolean(),
});

export const crearCodigoComercio = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'admin_comercio', 'superadmin');
  const datos = validar(Crear, req.data);
  exigirComercio(actor, datos.comercioId);

  try {
    return await db.runTransaction(async (tx) => {
      const vista = await leerComercioEnTx(tx, datos.comercioId);
      if (!vista.existe) throw noEncontrado('El comercio no existe.');
      const comercio = vista.completo;

      if (!estadoPrepago(comercio).puedeOperar) {
        throw conflicto('El comercio está deshabilitado temporalmente por falta de pago de la mensualidad.');
      }

      const refCodigo = db.collection('codigos_comercio').doc(datos.codigo);
      const existente = await tx.get(refCodigo);
      if (existente.exists) throw conflicto(`El código "${datos.codigo}" ya está en uso.`);
      const ajeno = await tx.get(db.collection('codigos_influencer').doc(datos.codigo));
      if (ajeno.exists) throw conflicto(`El código "${datos.codigo}" ya está en uso.`);

      // El costo sale de la configuración del comercio, no de lo que mande el navegador.
      const costo = comercio.modalidadPago === 'PREPAGO'
        ? (comercio.costoPorCodigoComercio && comercio.costoPorCodigoComercio > 0 ? comercio.costoPorCodigoComercio : 10)
        : 0;
      const saldo = comercio.saldoPremiosBs ?? 0;
      if (costo > 0 && saldo < costo) {
        throw conflicto(`Te faltan Bs ${(costo - saldo).toFixed(2)} de saldo para publicar este código.`);
      }

      const ahora = Date.now();
      const inicio = datos.fechaInicio && datos.fechaInicio > ahora ? datos.fechaInicio : ahora;
      const fin = new Date(inicio);
      fin.setDate(fin.getDate() + DIAS_VIGENCIA);
      fin.setHours(23, 59, 59, 999);

      tx.set(refCodigo, {
        id: datos.codigo,
        comercioId: datos.comercioId,
        puntosPorCanje: datos.puntosPorCanje,
        fechaInicio: inicio,
        fechaFin: fin.getTime(),
        estado: 'ACTIVO',
        createdAt: ahora,
        creadoPor: actor.uid,
      });

      if (costo > 0) {
        const nuevoSaldo = Math.round((saldo - costo) * 100) / 100;
        tx.set(refPrivado(datos.comercioId), { saldoPremiosBs: nuevoSaldo }, { merge: true });
        actualizarDerivados(tx, datos.comercioId, { ...comercio, saldoPremiosBs: nuevoSaldo });
      }

      auditarEnTransaccion(tx, {
        accion: 'codigo_comercio.creado',
        actorUid: actor.uid,
        actorRol: actor.rol,
        comercioId: datos.comercioId,
        objetivo: datos.codigo,
        despues: { puntosPorCanje: datos.puntosPorCanje, costoBs: costo, fechaFin: fin.getTime() },
        ip: actor.ip,
        appCheckAppId: actor.appCheckAppId,
      });

      return { codigo: datos.codigo, costoBs: costo, fechaFin: fin.getTime() };
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});

export const cambiarEstadoCodigoComercio = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'admin_comercio', 'superadmin');
  const datos = validar(CambiarEstado, req.data);

  try {
    const ref = db.collection('codigos_comercio').doc(datos.codigo);
    const snap = await ref.get();
    if (!snap.exists) throw noEncontrado('Ese código no existe.');
    exigirComercio(actor, snap.data()?.comercioId as string);

    await ref.update({ estado: datos.activo ? 'ACTIVO' : 'INACTIVO' });
    return { ok: true };
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});
