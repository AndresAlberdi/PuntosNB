/**
 * Idempotencia de las operaciones del libro mayor.
 *
 * Una caja con mala conexión reintenta; sin esto, el reintento cobraría o acreditaría dos veces.
 * La primera ejecución guarda su resultado bajo la clave que manda el cliente y los reintentos
 * devuelven ese mismo resultado sin volver a tocar el libro.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase';

const COLECCION = 'operaciones_idempotentes';

export async function conIdempotencia<T extends Record<string, unknown>>(
  clave: string | undefined,
  operacion: string,
  actorUid: string,
  ejecutar: () => Promise<T>,
): Promise<T & { reintento?: boolean }> {
  if (!clave) return ejecutar();

  const ref = db.collection(COLECCION).doc(`${operacion}_${clave}`);
  const previo = await ref.get();
  if (previo.exists) {
    return { ...(previo.data()?.resultado as T), reintento: true };
  }

  const resultado = await ejecutar();
  await ref.set({
    operacion,
    actorUid,
    resultado,
    fechaHora: FieldValue.serverTimestamp(),
  });
  return resultado;
}
