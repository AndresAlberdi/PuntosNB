/**
 * Acumulación de puntos: el vendedor abre la sesión y el cliente la reclama.
 *
 * El servidor recalcula los puntos desde las reglas del comercio, genera el código con azar
 * criptográfico, le pone vencimiento y escribe el asiento y el saldo en una sola transacción.
 * El cliente ya no puede inventar `puntosCalculados` ni reutilizar un código (H-05, H-06, H-11).
 */
import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../comun/firebase';
import { opcionesCallable } from '../comun/config';
import { validar } from '../comun/validacion';
import { conflicto, errorInterno, noEncontrado } from '../comun/errores';
import { actorDe, exigirRol } from '../comun/sesion';
import { auditarEnTransaccion } from '../comun/auditoria';
import { conIdempotencia } from '../comun/idempotencia';
import { nuevoCodigo, vencimiento } from '../comun/codigos';
import { calcularPuntos, estadoPrepago } from '../comun/negocio';
import { leerComercio, leerComercioEnTx } from '../comun/comercio';

const CrearSesion = z.object({
  montoFactura: z.number().nonnegative().max(1_000_000).default(0),
  nroFactura: z.string().trim().max(40).optional(),
  reglaId: z.string().trim().max(64).optional(),
  productos: z
    .array(z.object({ reglaId: z.string().trim().max(64), cantidad: z.number().int().min(1).max(500) }))
    .max(50)
    .default([]),
  clave: z.string().trim().max(64).optional(),
});

const Reclamar = z.object({
  codigo: z.string().trim().regex(/^\d{6}$/, 'el código es de 6 dígitos'),
});

export const crearSesionAcumulacion = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'vendedor', 'admin_comercio', 'superadmin');
  const datos = validar(CrearSesion, req.data);

  if (!actor.comercioId) throw conflicto('Tu cuenta no tiene un comercio asignado.');
  const comercioId = actor.comercioId;

  try {
    return await conIdempotencia(datos.clave, 'crearSesionAcumulacion', actor.uid, async () => {
      const vista = await leerComercio(comercioId);
      if (!vista.existe) throw noEncontrado('El comercio no existe.');
      const comercio = vista.completo;

      const estado = estadoPrepago(comercio);
      if (!estado.puedeOperar) {
        throw conflicto('El comercio está deshabilitado temporalmente por falta de pago de la mensualidad.');
      }

      const { puntos, regla } = calcularPuntos(comercio, datos.reglaId, datos.productos, datos.montoFactura);
      if (puntos <= 0) {
        throw conflicto('La operación no otorga puntos. Revisa el monto, la regla o los productos.');
      }

      // El código se reserva dentro de una transacción: una colisión no puede pisar una sesión ajena.
      const ahora = Date.now();
      let codigo = '';
      for (let intento = 0; intento < 8 && !codigo; intento++) {
        const candidato = nuevoCodigo();
        const ref = db.collection('sesiones_qr').doc(candidato);
        const libre = await db.runTransaction(async (tx) => {
          const existente = await tx.get(ref);
          const datosExistentes = existente.data();
          const sigueViva =
            existente.exists &&
            datosExistentes?.estado === 'PENDIENTE' &&
            (datosExistentes?.expiresAt ?? 0) > ahora;
          if (sigueViva) return false;

          tx.set(ref, {
            id: candidato,
            tipo: 'ACUMULACION',
            creadorId: actor.uid,
            comercioId,
            estado: 'PENDIENTE',
            createdAt: ahora,
            expiresAt: vencimiento(ahora),
            montoFactura: datos.montoFactura,
            nroFactura: regla?.tipo === 'POR_REGISTRO' ? 'BONO BIENVENIDA' : (datos.nroFactura || 'S/F'),
            puntosCalculados: puntos,
            reglaAplicadaId: regla?.id ?? null,
            intentosFallidos: 0,
          });
          auditarEnTransaccion(tx, {
            accion: 'acumulacion.sesion_creada',
            actorUid: actor.uid,
            actorRol: actor.rol,
            comercioId,
            objetivo: candidato,
            despues: { puntos, reglaId: regla?.id ?? null },
            ip: actor.ip,
            appCheckAppId: actor.appCheckAppId,
          });
          return true;
        });
        if (libre) codigo = candidato;
      }

      if (!codigo) throw errorInterno('no se pudo reservar un código libre');

      return { codigo, puntos, expiraEn: vencimiento(ahora) };
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});

export const reclamarAcumulacion = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'cliente', 'influencer');
  const { codigo } = validar(Reclamar, req.data);

  try {
    return await db.runTransaction(async (tx) => {
      const refSesion = db.collection('sesiones_qr').doc(codigo);
      const snapSesion = await tx.get(refSesion);
      if (!snapSesion.exists) throw noEncontrado('El código no es válido.');

      const sesion = snapSesion.data() as {
        tipo?: string; estado?: string; comercioId?: string; creadorId?: string;
        puntosCalculados?: number; expiresAt?: number; montoFactura?: number;
        nroFactura?: string; reglaAplicadaId?: string | null;
      };

      if (sesion.tipo !== 'ACUMULACION') throw conflicto('Ese código no es para acumular puntos.');
      if (sesion.estado !== 'PENDIENTE') throw conflicto('Ese código ya fue utilizado.');
      if ((sesion.expiresAt ?? 0) <= Date.now()) {
        // Se marca y se corta fuera de la transacción: lanzar aquí revertiría también el marcado.
        tx.update(refSesion, { estado: 'EXPIRADO' });
        return { expirado: true as const };
      }

      const comercioId = sesion.comercioId!;
      const vista = await leerComercioEnTx(tx, comercioId);
      if (!vista.existe) throw noEncontrado('El comercio no existe.');
      if (!estadoPrepago(vista.completo).puedeOperar) {
        throw conflicto('El comercio está deshabilitado temporalmente.');
      }

      // El bono de registro se entrega una sola vez por cliente y comercio.
      if (sesion.reglaAplicadaId) {
        const regla = vista.completo.reglas?.find((r) => r.id === sesion.reglaAplicadaId);
        if (regla?.tipo === 'POR_REGISTRO') {
          const previas = await tx.get(
            db.collection('transacciones')
              .where('clienteId', '==', actor.uid)
              .where('comercioId', '==', comercioId)
              .where('reglaAplicadaId', '==', regla.id)
              .limit(1),
          );
          if (!previas.empty) {
            throw conflicto('Ya recibiste el bono de bienvenida de este comercio.');
          }
        }
      }

      const puntos = sesion.puntosCalculados ?? 0;
      const idSaldo = `${actor.uid}_${comercioId}`;
      const refSaldo = db.collection('puntos_saldos').doc(idSaldo);
      const snapSaldo = await tx.get(refSaldo);
      const saldoPrevio = (snapSaldo.data()?.saldoTotal as number | undefined) ?? 0;

      const refTx = db.collection('transacciones').doc();
      tx.set(refTx, {
        id: refTx.id,
        fechaHora: Date.now(),
        clienteId: actor.uid,
        comercioId,
        vendedorId: sesion.creadorId ?? null,
        montoFactura: sesion.montoFactura ?? 0,
        nroFactura: sesion.nroFactura ?? 'S/F',
        puntos,
        tipo: 'ACUMULACION',
        ...(sesion.reglaAplicadaId ? { reglaAplicadaId: sesion.reglaAplicadaId } : {}),
      });

      tx.set(
        refSaldo,
        {
          id: idSaldo,
          clienteId: actor.uid,
          comercioId,
          saldoTotal: saldoPrevio + puntos,
          updatedAt: Date.now(),
        },
        { merge: true },
      );

      tx.update(refSesion, { estado: 'USADO', usadoPor: actor.uid, usadoEn: FieldValue.serverTimestamp() });

      auditarEnTransaccion(tx, {
        accion: 'acumulacion.reclamada',
        actorUid: actor.uid,
        actorRol: actor.rol,
        comercioId,
        objetivo: codigo,
        antes: { saldo: saldoPrevio },
        despues: { saldo: saldoPrevio + puntos, puntos },
        ip: actor.ip,
        appCheckAppId: actor.appCheckAppId,
      });

      return { puntos, saldoTotal: saldoPrevio + puntos, comercioId, expirado: false as const };
    }).then((resultado) => {
      if (resultado.expirado) throw conflicto('Ese código expiró. Pide al vendedor que genere uno nuevo.');
      return resultado;
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});
