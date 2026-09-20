/**
 * Canje de premios: el cliente abre la sesión y el vendedor la confirma.
 *
 * El servidor valida el saldo de puntos, guarda el premio elegido y, en comercios PREPAGO,
 * **bloquea el canje si no hay saldo en bolivianos** en lugar de dejarlo en cero (H-12).
 * El consumo se registra en `consumidoPremiosBs`, que antes no existía.
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
import { nuevoCodigo, vencimiento } from '../comun/codigos';
import { costoPorPremio, estadoPrepago } from '../comun/negocio';
import { actualizarDerivados, leerComercio, leerComercioEnTx, refPrivado } from '../comun/comercio';

const CrearSesionCanje = z.object({
  comercioId: z.string().trim().min(1).max(64),
  premioId: z.string().trim().min(1).max(64),
});

const Confirmar = z.object({
  codigo: z.string().trim().regex(/^\d{6}$/, 'el código es de 6 dígitos'),
});

export const crearSesionCanje = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'cliente', 'influencer');
  const datos = validar(CrearSesionCanje, req.data);

  try {
    const vista = await leerComercio(datos.comercioId);
    if (!vista.existe) throw noEncontrado('El comercio no existe.');
    const comercio = vista.completo;

    const premio = (comercio.premios ?? []).find((p) => p.id === datos.premioId && p.activo !== false);
    if (!premio) throw noEncontrado('Ese premio ya no está disponible.');

    const estado = estadoPrepago(comercio);
    if (!estado.puedeOperar) throw conflicto('El comercio está deshabilitado temporalmente.');
    if (!estado.puedeCanjearPremios) {
      throw conflicto('El comercio no tiene saldo para entregar premios en este momento.');
    }

    const requeridos = premio.puntosRequeridos ?? 0;
    const saldo = (await db.collection('puntos_saldos').doc(`${actor.uid}_${datos.comercioId}`).get()).data();
    const disponibles = (saldo?.saldoTotal as number | undefined) ?? 0;
    if (disponibles < requeridos) {
      throw conflicto(`Te faltan ${requeridos - disponibles} puntos para este premio.`);
    }

    const ahora = Date.now();
    let codigo = '';
    for (let intento = 0; intento < 8 && !codigo; intento++) {
      const candidato = nuevoCodigo();
      const ref = db.collection('sesiones_qr').doc(candidato);
      const libre = await db.runTransaction(async (tx) => {
        const existente = await tx.get(ref);
        const d = existente.data();
        if (existente.exists && d?.estado === 'PENDIENTE' && (d?.expiresAt ?? 0) > ahora) return false;

        tx.set(ref, {
          id: candidato,
          tipo: 'CANJE',
          creadorId: actor.uid,
          comercioId: datos.comercioId,
          estado: 'PENDIENTE',
          createdAt: ahora,
          expiresAt: vencimiento(ahora),
          premioId: datos.premioId,
          puntosCalculados: requeridos,
        });
        return true;
      });
      if (libre) codigo = candidato;
    }
    if (!codigo) throw errorInterno('no se pudo reservar un código libre');

    return { codigo, puntosRequeridos: requeridos, expiraEn: vencimiento(ahora) };
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});

export const confirmarCanje = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'vendedor', 'admin_comercio', 'superadmin');
  const { codigo } = validar(Confirmar, req.data);

  try {
    return await db.runTransaction(async (tx) => {
      const refSesion = db.collection('sesiones_qr').doc(codigo);
      const snapSesion = await tx.get(refSesion);
      if (!snapSesion.exists) throw noEncontrado('El código no es válido.');

      const sesion = snapSesion.data() as {
        tipo?: string; estado?: string; comercioId?: string; creadorId?: string;
        premioId?: string; puntosCalculados?: number; expiresAt?: number;
      };

      if (sesion.tipo !== 'CANJE') throw conflicto('Ese código no es de canje.');
      if (sesion.estado !== 'PENDIENTE') throw conflicto('Ese código ya fue utilizado.');
      if ((sesion.expiresAt ?? 0) <= Date.now()) {
        // Igual que en la acumulación: marcar y cortar fuera, para que el marcado quede escrito.
        tx.update(refSesion, { estado: 'EXPIRADO' });
        return { expirado: true as const };
      }

      const comercioId = sesion.comercioId!;
      if (actor.rol !== 'superadmin' && actor.comercioId !== comercioId) {
        throw conflicto('Ese canje pertenece a otro comercio.');
      }

      const vista = await leerComercioEnTx(tx, comercioId);
      if (!vista.existe) throw noEncontrado('El comercio no existe.');
      const comercio = vista.completo;

      const refSaldo = db.collection('puntos_saldos').doc(`${sesion.creadorId}_${comercioId}`);
      const snapSaldo = await tx.get(refSaldo);
      const puntos = sesion.puntosCalculados ?? 0;
      const saldoPuntos = (snapSaldo.data()?.saldoTotal as number | undefined) ?? 0;
      if (saldoPuntos < puntos) {
        throw conflicto(`El cliente tiene ${saldoPuntos} puntos y el premio requiere ${puntos}.`);
      }

      // En PREPAGO el premio se cobra del saldo del comercio: si no alcanza, no se entrega.
      const costo = costoPorPremio(comercio);
      const saldoBs = comercio.saldoPremiosBs ?? 0;
      if (costo > 0 && saldoBs < costo) {
        throw conflicto('El comercio no tiene saldo para entregar este premio. Debe recargar su prepago.');
      }

      const refTx = db.collection('transacciones').doc();
      tx.set(refTx, {
        id: refTx.id,
        fechaHora: Date.now(),
        clienteId: sesion.creadorId,
        comercioId,
        vendedorId: actor.uid,
        puntos: -puntos,
        tipo: 'CANJE',
        premioId: sesion.premioId ?? null,
        nroFactura: 'CANJE PREMIO',
        montoFactura: 0,
      });

      tx.update(refSaldo, { saldoTotal: saldoPuntos - puntos, updatedAt: Date.now() });

      if (costo > 0) {
        const nuevoSaldo = Math.round((saldoBs - costo) * 100) / 100;
        tx.set(
          refPrivado(comercioId),
          {
            saldoPremiosBs: nuevoSaldo,
            consumidoPremiosBs: Math.round(((comercio.consumidoPremiosBs ?? 0) + costo) * 100) / 100,
          },
          { merge: true },
        );
        actualizarDerivados(tx, comercioId, { ...comercio, saldoPremiosBs: nuevoSaldo });
      }

      tx.update(refSesion, { estado: 'USADO', confirmadoPor: actor.uid, usadoEn: FieldValue.serverTimestamp() });

      auditarEnTransaccion(tx, {
        accion: 'canje.confirmado',
        actorUid: actor.uid,
        actorRol: actor.rol,
        comercioId,
        objetivo: codigo,
        antes: { saldoPuntos, saldoPremiosBs: saldoBs },
        despues: { saldoPuntos: saldoPuntos - puntos, saldoPremiosBs: saldoBs - costo, premioId: sesion.premioId ?? null },
        ip: actor.ip,
        appCheckAppId: actor.appCheckAppId,
      });

      return { puntos, premioId: sesion.premioId ?? null, costoBs: costo, expirado: false as const };
    }).then((resultado) => {
      if (resultado.expirado) throw conflicto('Ese código expiró. Pide al cliente que genere uno nuevo.');
      return resultado;
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});
