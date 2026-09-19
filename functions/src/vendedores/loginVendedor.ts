/**
 * Inicio de sesión del vendedor por PIN, validado en el servidor (H-04).
 *
 * Sustituye a la comparación en el navegador y a la "sesión" en localStorage: el PIN se compara
 * contra un hash scrypt guardado en `vendedores_secretos` (colección cerrada al cliente) y, si
 * coincide, se emite un custom token con los claims `rol` y `comercioId`. A partir de ahí el
 * vendedor tiene identidad verificable y `request.auth` en las reglas.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { auth, db } from '../comun/firebase';
import { opcionesCallable } from '../comun/config';
import { validar } from '../comun/validacion';
import { conflicto, demasiadosIntentos, errorInterno } from '../comun/errores';
import { verificarPin, type SecretoPin, PIN_VALIDO } from '../comun/pin';
import {
  estaBloqueado, estadoLimpio, minutosRestantes, refIntentosIp, siguienteEstadoTrasFallo,
  type EstadoIntentos,
} from '../comun/bloqueo';
import { auditar } from '../comun/auditoria';

const Entrada = z.object({
  usuario: z.string().trim().toLowerCase().min(3).max(120),
  pin: z.string().regex(PIN_VALIDO, 'el PIN es de 6 dígitos'),
});

/** Mensaje único para usuario inexistente, PIN incorrecto y cuenta sin PIN: no se enumera nada. */
const CREDENCIAL_INVALIDA = 'Usuario o PIN incorrectos.';

export const loginVendedor = onCall(opcionesCallable, async (req) => {
  const { usuario, pin } = validar(Entrada, req.data);
  const ip = req.rawRequest?.ip ?? null;
  const refIp = refIntentosIp(ip);

  try {
    const estadoIp = (await refIp.get()).data() as EstadoIntentos | undefined;
    if (estaBloqueado(estadoIp)) {
      throw demasiadosIntentos(
        `Demasiados intentos desde esta conexión. Espera ${minutosRestantes(estadoIp)} minutos.`,
      );
    }

    const registrarFallo = async (motivo: string, uid?: string): Promise<never> => {
      const { bloqueado: _ignorado, ...nuevoIp } = siguienteEstadoTrasFallo(estadoIp);
      await refIp.set(nuevoIp, { merge: true });

      if (uid) {
        const refSecreto = db.collection('vendedores_secretos').doc(uid);
        const estadoUsuario = (await refSecreto.get()).data() as EstadoIntentos | undefined;
        const { bloqueado, ...nuevoUsuario } = siguienteEstadoTrasFallo(estadoUsuario);
        await refSecreto.set(nuevoUsuario, { merge: true });
        if (bloqueado) {
          // Si alguien está probando PIN contra esta cuenta, se cortan también sus sesiones vivas.
          await auth.revokeRefreshTokens(uid).catch(() => undefined);
          await auditar({
            accion: 'vendedor.bloqueado_por_intentos',
            actorUid: null,
            objetivo: uid,
            detalle: { motivo },
          });
        }
      }

      // El motivo real queda en el registro del servidor; al cliente va siempre el mismo mensaje.
      logger.warn('Intento de ingreso de vendedor fallido', { motivo });
      throw new HttpsError('permission-denied', CREDENCIAL_INVALIDA);
    };

    const consulta = await db
      .collection('users')
      .where('email', '==', usuario)
      .where('rol', '==', 'vendedor')
      .limit(1)
      .get();

    if (consulta.empty) return await registrarFallo('usuario inexistente');

    const docUsuario = consulta.docs[0]!;
    const datos = docUsuario.data();
    const uid = docUsuario.id;

    if (datos.estado === 'bloqueado') {
      throw conflicto('Tu cuenta de vendedor está bloqueada. Contacta al administrador de tu comercio.');
    }
    if (!datos.comercioId) {
      throw conflicto('Tu cuenta de vendedor no tiene un comercio asignado. Contacta al administrador.');
    }

    const snapSecreto = await db.collection('vendedores_secretos').doc(uid).get();
    const secreto = snapSecreto.data() as (SecretoPin & EstadoIntentos) | undefined;

    if (estaBloqueado(secreto)) {
      throw demasiadosIntentos(
        `Esta cuenta está bloqueada por intentos fallidos. Espera ${minutosRestantes(secreto)} minutos.`,
      );
    }
    if (!secreto?.hash) return await registrarFallo('vendedor sin PIN configurado', uid);
    if (!(await verificarPin(pin, secreto))) return await registrarFallo('PIN incorrecto', uid);

    await Promise.all([
      db.collection('vendedores_secretos').doc(uid).set(estadoLimpio(), { merge: true }),
      refIp.set(estadoLimpio(), { merge: true }),
    ]);

    const token = await auth.createCustomToken(uid, {
      rol: 'vendedor',
      comercioId: datos.comercioId as string,
    });

    await auditar({
      accion: 'vendedor.login',
      actorUid: uid,
      actorRol: 'vendedor',
      comercioId: datos.comercioId as string,
      appCheckAppId: req.app?.appId ?? null,
    });

    return {
      token,
      vendedor: {
        uid,
        nombre: datos.nombre ?? 'Vendedor',
        comercioId: datos.comercioId as string,
        rotacionRequerida: secreto.rotacionRequerida === true,
      },
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'httpErrorCode' in error) throw error;
    throw errorInterno(error);
  }
});
