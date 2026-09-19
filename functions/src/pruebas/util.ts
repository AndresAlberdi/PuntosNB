/**
 * Utilidades para las pruebas de integración contra los emuladores.
 *
 * Se ejecutan con `npm run test:functions` desde la raíz, que levanta los emuladores de
 * Firestore, Auth y Functions y define las variables de entorno correspondientes.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

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
