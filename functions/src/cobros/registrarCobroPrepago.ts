/**
 * Registro de un cobro de prepago: el cobro y la acreditación ocurren juntos o no ocurren.
 *
 * Antes eran dos escrituras sueltas desde el navegador del contador: si la segunda fallaba, el
 * comercio pagaba sin recibir saldo. Además el monto lo calculaba el cliente; aquí se recalcula
 * desde la mensualidad configurada del comercio.
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../comun/firebase';
import { opcionesCallable } from '../comun/config';
import { validar } from '../comun/validacion';
import { conflicto, errorInterno, noEncontrado } from '../comun/errores';
import { actorDe, exigirRol } from '../comun/sesion';
import { auditarEnTransaccion } from '../comun/auditoria';
import { conIdempotencia } from '../comun/idempotencia';
import { actualizarDerivados, leerComercioEnTx, refPrivado } from '../comun/comercio';

const Entrada = z.object({
  comercioId: z.string().trim().min(1).max(64),
  mesesPagados: z.array(z.string().regex(/^\d{4}-\d{2}$/, 'el mes se escribe AAAA-MM')).max(24).default([]),
  montoPremios: z.number().nonnegative().max(100_000).default(0),
  codigoDeposito: z.string().trim().min(1).max(60),
  // El comprobante llega ya reducido por el navegador (presupuesto de 90 KB). El límite deja
  // margen para la codificación base64 y corta cualquier intento de subir la foto original.
  comprobanteUrl: z.string().trim().max(140_000, 'la imagen del comprobante es demasiado grande').optional(),
  recibeFactura: z.boolean().default(false),
  clave: z.string().trim().max(64).optional(),
});

export const registrarCobroPrepago = onCall(opcionesCallable, async (req) => {
  const actor = actorDe(req);
  exigirRol(actor, 'contador', 'superadmin');
  const datos = validar(Entrada, req.data);

  if (datos.mesesPagados.length === 0 && datos.montoPremios <= 0) {
    throw conflicto('El cobro debe incluir al menos un mes de mensualidad o un monto de premios.');
  }

  try {
    return await conIdempotencia(datos.clave, 'registrarCobroPrepago', actor.uid, async () =>
      db.runTransaction(async (tx) => {
        const vista = await leerComercioEnTx(tx, datos.comercioId);
        if (!vista.existe) throw noEncontrado('El comercio no existe.');
        const comercio = vista.completo as typeof vista.completo & {
          nombre?: string; nit_rut?: string; razonSocial?: string; mensualidadBs?: number;
        };

        // El monto no lo decide el cliente: sale de la mensualidad configurada del comercio.
        const mensualidad = comercio.mensualidadBs && comercio.mensualidadBs > 0 ? comercio.mensualidadBs : 25;
        const montoMensualidad = Math.round(mensualidad * datos.mesesPagados.length * 100) / 100;
        const montoTotal = Math.round((montoMensualidad + datos.montoPremios) * 100) / 100;
        const costoPremio = comercio.costoPorPremioBs && comercio.costoPorPremioBs > 0 ? comercio.costoPorPremioBs : 1.25;

        const mesesPrevios = comercio.mesesPagados ?? [];
        const repetidos = datos.mesesPagados.filter((m) => mesesPrevios.includes(m));
        if (repetidos.length) {
          throw conflicto(`Estos meses ya figuran pagados: ${repetidos.join(', ')}.`);
        }

        const saldoPrevio = comercio.saldoPremiosBs ?? 0;
        const refCobro = db.collection('cobros_prepago').doc();

        tx.set(refCobro, {
          id: refCobro.id,
          comercioId: datos.comercioId,
          nombreComercio: comercio.nombre ?? '',
          nitRut: comercio.nit_rut ?? '',
          // La razón social es opcional: si el comercio no la tiene cargada, se usa su nombre.
          razonSocial: comercio.razonSocial || comercio.nombre || '',
          recibeFactura: datos.recibeFactura,
          contadorId: actor.uid,
          fechaHora: Date.now(),
          montoTotal,
          montoMensualidad,
          mesesPagados: datos.mesesPagados,
          montoPremios: datos.montoPremios,
          cantidadPremiosEquivalentes: Math.floor(datos.montoPremios / costoPremio),
          codigoDeposito: datos.codigoDeposito,
          ...(datos.comprobanteUrl ? { comprobanteUrl: datos.comprobanteUrl } : {}),
        });

        const nuevoSaldo = Math.round((saldoPrevio + datos.montoPremios) * 100) / 100;
        const nuevosMeses = Array.from(new Set([...mesesPrevios, ...datos.mesesPagados])).sort();
        tx.set(
          refPrivado(datos.comercioId),
          { saldoPremiosBs: nuevoSaldo, mesesPagados: nuevosMeses, modalidadPago: 'PREPAGO' },
          { merge: true },
        );
        actualizarDerivados(tx, datos.comercioId, {
          ...comercio, saldoPremiosBs: nuevoSaldo, mesesPagados: nuevosMeses, modalidadPago: 'PREPAGO',
        });

        auditarEnTransaccion(tx, {
          accion: 'cobro_prepago.registrado',
          actorUid: actor.uid,
          actorRol: actor.rol,
          comercioId: datos.comercioId,
          objetivo: refCobro.id,
          antes: { saldoPremiosBs: saldoPrevio, mesesPagados: mesesPrevios },
          despues: { saldoPremiosBs: saldoPrevio + datos.montoPremios, montoTotal, meses: datos.mesesPagados },
          ip: actor.ip,
          appCheckAppId: actor.appCheckAppId,
        });

        return { cobroId: refCobro.id, montoTotal, montoMensualidad, saldoPremiosBs: saldoPrevio + datos.montoPremios };
      }),
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});
