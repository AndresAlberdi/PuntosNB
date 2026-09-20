/**
 * Lectura del comercio repartido en dos documentos (Fase 2).
 *
 * `comercios/{id}` es el perfil público —nombre, catálogo, identidad visual— que cualquier
 * autenticado puede leer. `comercios_privado/{id}` guarda lo fiscal y lo económico: NIT, razón
 * social, plan, mensualidad, costos, saldo prepagado y meses pagados. Al cliente solo le llegan
 * dos señales derivadas, `operativoHasta` y `puedeCanjearPremios`, que le bastan para la interfaz
 * sin exponer montos (H-16).
 */
import type { Transaction } from 'firebase-admin/firestore';
import { db } from './firebase';
import { estadoPrepago, type Comercio } from './negocio';

export const refPublico = (comercioId: string): FirebaseFirestore.DocumentReference =>
  db.collection('comercios').doc(comercioId);
export const refPrivado = (comercioId: string): FirebaseFirestore.DocumentReference =>
  db.collection('comercios_privado').doc(comercioId);

export interface VistaComercio {
  existe: boolean;
  publico: Record<string, unknown>;
  privado: Record<string, unknown>;
  /** Vista combinada, para las funciones de negocio que necesitan ambas partes. */
  completo: Comercio;
}

function combinar(publico: Record<string, unknown>, privado: Record<string, unknown>): Comercio {
  return { ...publico, ...privado } as Comercio;
}

/** Lee las dos mitades dentro de una transacción. */
export async function leerComercioEnTx(tx: Transaction, comercioId: string): Promise<VistaComercio> {
  const [pub, priv] = await Promise.all([tx.get(refPublico(comercioId)), tx.get(refPrivado(comercioId))]);
  const publico = pub.data() ?? {};
  const privado = priv.data() ?? {};
  return { existe: pub.exists, publico, privado, completo: combinar(publico, privado) };
}

/** Lee las dos mitades fuera de una transacción. */
export async function leerComercio(comercioId: string): Promise<VistaComercio> {
  const [pub, priv] = await Promise.all([refPublico(comercioId).get(), refPrivado(comercioId).get()]);
  const publico = pub.data() ?? {};
  const privado = priv.data() ?? {};
  return { existe: pub.exists, publico, privado, completo: combinar(publico, privado) };
}

/** Fin del período prepagado: el último mes consecutivo pagado desde el actual. */
export function operativoHasta(comercio: Comercio, ahora = new Date()): number | null {
  if (!comercio.modalidadPago || comercio.modalidadPago === 'PILOTO') return null;

  const pagados = new Set(comercio.mesesPagados ?? []);
  const clave = (f: Date): string => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
  if (!pagados.has(clave(ahora))) return 0;

  let ultimo = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  for (;;) {
    const siguiente = new Date(ultimo.getFullYear(), ultimo.getMonth() + 1, 1);
    if (!pagados.has(clave(siguiente))) break;
    ultimo = siguiente;
  }
  return new Date(ultimo.getFullYear(), ultimo.getMonth() + 1, 0, 23, 59, 59).getTime();
}

/**
 * Deja en el documento público las dos señales derivadas. Se llama en cada operación que mueve
 * saldo o meses, de modo que la interfaz del vendedor y del cliente nunca quede desactualizada.
 */
export function actualizarDerivados(tx: Transaction, comercioId: string, completo: Comercio): void {
  const estado = estadoPrepago(completo);
  tx.set(
    refPublico(comercioId),
    {
      operativoHasta: operativoHasta(completo),
      puedeCanjearPremios: estado.puedeCanjearPremios,
      modalidadPago: completo.modalidadPago ?? 'PILOTO',
    },
    { merge: true },
  );
}
