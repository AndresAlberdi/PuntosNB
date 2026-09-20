/**
 * Canje de códigos promocionales, de influencer o del propio comercio (H-08).
 *
 * El servidor resuelve de qué tipo es el código, valida vigencia, campaña, tope de la bolsa y
 * unicidad por cliente, descuenta la bolsa del influencer y acredita los puntos en una sola
 * transacción. Antes todo esto se decidía en el navegador y las reglas no validaban nada.
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../comun/firebase';
import { opcionesCallable } from '../comun/config';
import { validar } from '../comun/validacion';
import { conflicto, errorInterno, noEncontrado } from '../comun/errores';
import { actorDe, exigirRol } from '../comun/sesion';
import { auditarEnTransaccion } from '../comun/auditoria';
import { estadoPrepago } from '../comun/negocio';
import { leerComercioEnTx } from '../comun/comercio';

const Entrada = z.object({
  codigo: z.string().trim().toUpperCase().min(3).max(40),
});

interface CodigoInfluencer {
  influencerId: string;
  comercioId: string;
  puntosPorCanje?: number;
  estado?: 'ACTIVO' | 'INACTIVO';
  fechaUltimaRenovacion?: number;
}

interface CodigoComercio {
  comercioId: string;
  puntosPorCanje?: number;
  estado?: 'ACTIVO' | 'INACTIVO';
  fechaInicio?: number;
  fechaFin?: number;
}

export const canjearCodigo = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'cliente', 'influencer');
  const { codigo } = validar(Entrada, req.data);

  try {
    const [snapInfluencer, snapComercio] = await Promise.all([
      db.collection('codigos_influencer').doc(codigo).get(),
      db.collection('codigos_comercio').doc(codigo).get(),
    ]);

    if (!snapInfluencer.exists && !snapComercio.exists) {
      throw noEncontrado('Ese código no existe o ya no está vigente.');
    }

    const esDeInfluencer = snapInfluencer.exists;
    const datosCodigo = (esDeInfluencer ? snapInfluencer.data() : snapComercio.data()) as
      | CodigoInfluencer
      | CodigoComercio;
    const comercioId = datosCodigo.comercioId;

    return await db.runTransaction(async (tx) => {
      const vista = await leerComercioEnTx(tx, comercioId);
      if (!vista.existe) throw noEncontrado('El comercio del código no existe.');
      if (!estadoPrepago(vista.completo).puedeOperar) {
        throw conflicto('El comercio está deshabilitado temporalmente.');
      }

      const canjesPrevios = await tx.get(
        db.collection('canjes_codigo')
          .where('clienteId', '==', actor.uid)
          .where('codigoId', '==', codigo),
      );

      // Todas las lecturas van antes de la primera escritura: Firestore lo exige dentro de una
      // transacción y, si no, la operación falla en cuanto hay que descontar la bolsa.
      const idSaldo = `${actor.uid}_${comercioId}`;
      const refSaldo = db.collection('puntos_saldos').doc(idSaldo);
      const snapSaldo = await tx.get(refSaldo);
      const saldoPrevio = (snapSaldo.data()?.saldoTotal as number | undefined) ?? 0;

      let puntos: number;
      let influencerId: string | null = null;

      if (esDeInfluencer) {
        const cod = datosCodigo as CodigoInfluencer;
        if (cod.estado === 'INACTIVO') throw conflicto('Ese código está inactivo.');

        influencerId = cod.influencerId;
        const refAsignacion = db.collection('asignaciones_influencer').doc(`${comercioId}_${cod.influencerId}`);
        const snapAsignacion = await tx.get(refAsignacion);
        if (!snapAsignacion.exists) throw noEncontrado('La campaña del influencer no existe.');

        const asignacion = snapAsignacion.data() as {
          estado?: string; puntosParaClientes?: number; ratio?: { cliente?: number };
        };
        if (asignacion.estado !== 'ACEPTADO') throw conflicto('La campaña del influencer no está activa.');

        // Un canje por cliente y por campaña: la renovación del influencer habilita el siguiente.
        const renovacion = cod.fechaUltimaRenovacion ?? 0;
        const yaCanjeado = canjesPrevios.docs.some((d) => (d.data().fechaCanje ?? 0) > renovacion);
        if (yaCanjeado) {
          throw conflicto('Ya usaste este código en su campaña actual. Espera a que el influencer lo renueve.');
        }

        puntos = cod.puntosPorCanje && cod.puntosPorCanje > 0 ? cod.puntosPorCanje : (asignacion.ratio?.cliente ?? 10);
        const bolsa = asignacion.puntosParaClientes ?? 0;
        if (bolsa < puntos) throw conflicto('El código agotó los puntos disponibles de esta campaña.');

        tx.update(refAsignacion, { puntosParaClientes: bolsa - puntos, updatedAt: Date.now() });
      } else {
        const cod = datosCodigo as CodigoComercio;
        const ahora = Date.now();
        if (cod.estado === 'INACTIVO') throw conflicto('Ese código está inactivo.');
        if (cod.fechaInicio && ahora < cod.fechaInicio) throw conflicto('Ese código todavía no está vigente.');
        if (cod.fechaFin && ahora > cod.fechaFin) throw conflicto('Ese código ya venció.');
        if (!canjesPrevios.empty) throw conflicto('Ya canjeaste este código anteriormente.');

        puntos = cod.puntosPorCanje ?? 0;
        if (puntos <= 0) throw conflicto('Ese código no otorga puntos.');
      }

      const refCanje = db.collection('canjes_codigo').doc();
      tx.set(refCanje, {
        id: refCanje.id,
        clienteId: actor.uid,
        codigoId: codigo,
        comercioId,
        fechaCanje: Date.now(),
      });

      const refTx = db.collection('transacciones').doc();
      tx.set(refTx, {
        id: refTx.id,
        fechaHora: Date.now(),
        clienteId: actor.uid,
        comercioId,
        codigoId: codigo,
        puntos,
        montoFactura: 0,
        tipo: esDeInfluencer ? 'CODIGO_INFLUENCER' : 'CODIGO_COMERCIO',
        ...(influencerId ? { influencerId, vendedorId: influencerId } : { vendedorId: comercioId }),
      });

      tx.set(
        refSaldo,
        { id: idSaldo, clienteId: actor.uid, comercioId, saldoTotal: saldoPrevio + puntos, updatedAt: Date.now() },
        { merge: true },
      );

      auditarEnTransaccion(tx, {
        accion: esDeInfluencer ? 'codigo_influencer.canjeado' : 'codigo_comercio.canjeado',
        actorUid: actor.uid,
        actorRol: actor.rol,
        comercioId,
        objetivo: codigo,
        despues: { puntos, saldo: saldoPrevio + puntos },
        ip: actor.ip,
        appCheckAppId: actor.appCheckAppId,
      });

      return { puntos, saldoTotal: saldoPrevio + puntos, comercioId, tipo: esDeInfluencer ? 'influencer' : 'comercio' };
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});
