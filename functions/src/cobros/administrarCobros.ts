/**
 * Anulación y conciliación de cobros de prepago.
 *
 * Anular devuelve el saldo y quita los meses en la misma transacción en que se borra el cobro:
 * antes eran dos escrituras sueltas desde el navegador del contador.
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../comun/firebase';
import { opcionesCallable } from '../comun/config';
import { validar } from '../comun/validacion';
import { conflicto, errorInterno, noEncontrado, sinPermiso } from '../comun/errores';
import { actorDe, exigirRol } from '../comun/sesion';
import { auditarEnTransaccion } from '../comun/auditoria';
import { actualizarDerivados, leerComercioEnTx, refPrivado } from '../comun/comercio';

const PorId = z.object({ cobroId: z.string().trim().min(1).max(64) });

export const anularCobroPrepago = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'contador', 'superadmin');
  const { cobroId } = validar(PorId, req.data);

  try {
    return await db.runTransaction(async (tx) => {
      const refCobro = db.collection('cobros_prepago').doc(cobroId);
      const snapCobro = await tx.get(refCobro);
      if (!snapCobro.exists) throw noEncontrado('Ese cobro no existe.');

      const cobro = snapCobro.data() as {
        comercioId: string; montoPremios?: number; mesesPagados?: string[];
        contadorId?: string; estado?: string;
      };

      if (actor.rol === 'contador' && cobro.contadorId !== actor.uid) {
        throw sinPermiso('el cobro lo registró otro contador');
      }
      if (cobro.estado === 'VERIFICADO') {
        throw conflicto('Ese cobro ya fue conciliado por el superadministrador y no se puede anular.');
      }

      const vista = await leerComercioEnTx(tx, cobro.comercioId);
      if (!vista.existe) throw noEncontrado('El comercio del cobro no existe.');

      const saldoPrevio = vista.completo.saldoPremiosBs ?? 0;
      const consumido = vista.completo.consumidoPremiosBs ?? 0;
      const devolver = cobro.montoPremios ?? 0;

      // No se puede devolver lo que el comercio ya gastó en premios.
      const saldoNuevo = Math.round((saldoPrevio - devolver) * 100) / 100;
      if (saldoNuevo < 0) {
        throw conflicto(
          `No se puede anular: el comercio ya consumió parte de ese saldo (quedan Bs ${saldoPrevio.toFixed(2)} de los Bs ${devolver.toFixed(2)} acreditados).`,
        );
      }

      const mesesPrevios = vista.completo.mesesPagados ?? [];
      const mesesNuevos = mesesPrevios.filter((m) => !(cobro.mesesPagados ?? []).includes(m));

      tx.set(refPrivado(cobro.comercioId), { saldoPremiosBs: saldoNuevo, mesesPagados: mesesNuevos }, { merge: true });
      actualizarDerivados(tx, cobro.comercioId, {
        ...vista.completo, saldoPremiosBs: saldoNuevo, mesesPagados: mesesNuevos,
      });
      tx.delete(refCobro);

      auditarEnTransaccion(tx, {
        accion: 'cobro_prepago.anulado',
        actorUid: actor.uid,
        actorRol: actor.rol,
        comercioId: cobro.comercioId,
        objetivo: cobroId,
        antes: { saldoPremiosBs: saldoPrevio, mesesPagados: mesesPrevios, consumidoPremiosBs: consumido },
        despues: { saldoPremiosBs: saldoNuevo, mesesPagados: mesesNuevos },
        ip: actor.ip,
        appCheckAppId: actor.appCheckAppId,
      });

      return { saldoPremiosBs: saldoNuevo };
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});

export const conciliarCobroPrepago = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'superadmin');
  const { cobroId } = validar(PorId, req.data);

  try {
    const ref = db.collection('cobros_prepago').doc(cobroId);
    const snap = await ref.get();
    if (!snap.exists) throw noEncontrado('Ese cobro no existe.');

    await ref.update({ estado: 'VERIFICADO', verificadoPor: actor.uid, verificadoEn: Date.now() });
    return { ok: true };
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});
