/**
 * Utilidades para las pruebas de integración contra los emuladores.
 *
 * Se ejecutan con `npm run test:functions` desde la raíz, que levanta los emuladores de
 * Firestore, Auth y Functions y define las variables de entorno correspondientes.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { claveDelMes, sumarMeses } from '../comun/fechaBolivia';

export { claveDelMes } from '../comun/fechaBolivia';

export const PROYECTO = process.env.GCLOUD_PROJECT ?? 'demo-hipatia-funciones';
export const REGION = 'us-central1';
const HOST_FUNCIONES = process.env.FUNCTIONS_EMULATOR_HOST ?? '127.0.0.1:5001';
const HOST_AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';

if (getApps().length === 0) initializeApp({ projectId: PROYECTO });
export const db = getFirestore();
export const auth = getAuth();

export interface RespuestaCallable<T = unknown> {
  ok: boolean;
  estado: number;
  datos?: T;
  codigo?: string;
  mensaje?: string;
}

/** Invoca una función `onCall` por HTTP, como lo hace el SDK del cliente. */
export async function llamar<T = unknown>(
  nombre: string,
  datos: unknown,
  opciones: { idToken?: string } = {},
): Promise<RespuestaCallable<T>> {
  const respuesta = await fetch(`http://${HOST_FUNCIONES}/${PROYECTO}/${REGION}/${nombre}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opciones.idToken ? { Authorization: `Bearer ${opciones.idToken}` } : {}),
    },
    body: JSON.stringify({ data: datos }),
  });

  const cuerpo = (await respuesta.json().catch(() => ({}))) as {
    result?: T;
    error?: { status?: string; message?: string };
  };

  return respuesta.ok
    ? { ok: true, estado: respuesta.status, datos: cuerpo.result }
    : {
        ok: false,
        estado: respuesta.status,
        codigo: cuerpo.error?.status,
        mensaje: cuerpo.error?.message,
      };
}

/** Canjea un custom token por un ID token en el emulador de Auth. */
export async function idTokenDesdeCustomToken(customToken: string): Promise<string> {
  const respuesta = await fetch(
    `http://${HOST_AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=falsa`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const cuerpo = (await respuesta.json()) as { idToken?: string; error?: { message?: string } };
  if (!cuerpo.idToken) throw new Error(`No se pudo canjear el token: ${cuerpo.error?.message ?? 'sin detalle'}`);
  return cuerpo.idToken;
}

/** Crea una cuenta con los claims indicados y devuelve un ID token listo para usar. */
export async function sesionComo(
  uid: string,
  claims: Record<string, unknown>,
): Promise<string> {
  await auth.createUser({ uid }).catch(() => undefined);
  await auth.setCustomUserClaims(uid, claims);
  return idTokenDesdeCustomToken(await auth.createCustomToken(uid, claims));
}

/** Borra todos los documentos de las colecciones indicadas. */
export async function limpiar(...colecciones: string[]): Promise<void> {
  for (const col of colecciones) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

/** Borra todas las cuentas del emulador de Auth. */
export async function limpiarCuentas(): Promise<void> {
  const { users } = await auth.listUsers(1000);
  if (users.length) await auth.deleteUsers(users.map((u) => u.uid));
}

/**
 * Mes futuro en el formato `YYYY-MM` que usa `mesesPagados`, contado desde hoy.
 *
 * Las pruebas de cobro prepago necesitan meses que todavía NO hayan llegado: `operativoHasta`
 * devuelve 0 mientras el mes corriente no figure pagado, y varias pruebas afirman justamente eso.
 * Escribir los meses a mano —'2026-10', '2026-12'— las convierte en una bomba de tiempo: el
 * 1-oct-2026 a las 00:00 UTC, octubre pasó a ser el mes corriente y la suite se cayó en `main`
 * sin que nadie hubiera tocado el código. Con esta función el desfase es siempre el mismo.
 * El mes corriente se toma en la zona del negocio, igual que el servidor.
 *
 * @param meses cuántos meses hacia adelante; 1 es el mes que viene. Debe ser >= 1.
 */
export function mesFuturo(meses: number): string {
  if (meses < 1) throw new Error(`mesFuturo espera un desplazamiento >= 1, recibió ${meses}`);
  return sumarMeses(claveDelMes(), meses);
}
