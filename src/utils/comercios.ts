/**
 * Carga de comercios con su parte privada.
 *
 * Desde la Fase 2 el comercio vive en dos documentos: `comercios/{id}` es público y
 * `comercios_privado/{id}` guarda lo fiscal y lo económico. Las pantallas de los roles que pueden
 * ver los montos —administrador del comercio, contador y superadministrador— usan estas funciones
 * para trabajar con la vista combinada, como antes. Las demás pantallas siguen leyendo solo el
 * documento público.
 */
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { Comercio, ComercioPrivado } from '../types';

/** Comercio público + privado, para quien tiene permiso de ver los montos. */
export async function cargarComercioCompleto(comercioId: string): Promise<Comercio | null> {
  const publico = await getDoc(doc(db, 'comercios', comercioId));
  if (!publico.exists()) return null;

  let privado: ComercioPrivado = { id: comercioId };
  try {
    const snap = await getDoc(doc(db, 'comercios_privado', comercioId));
    if (snap.exists()) privado = snap.data() as ComercioPrivado;
  } catch {
    // Sin permiso para la parte privada: la pantalla funciona con las señales públicas.
  }

  return { ...publico.data(), ...privado, id: publico.id } as Comercio;
}

/** Todos los comercios con su parte privada, para el contador y el superadministrador. */
export async function cargarComerciosCompletos(): Promise<Comercio[]> {
  const [publicos, privados] = await Promise.all([
    getDocs(collection(db, 'comercios')),
    getDocs(collection(db, 'comercios_privado')).catch(() => null),
  ]);

  const porId = new Map<string, ComercioPrivado>();
  privados?.forEach((d) => porId.set(d.id, d.data() as ComercioPrivado));

  return publicos.docs.map((d) => ({ ...d.data(), ...(porId.get(d.id) ?? {}), id: d.id }) as Comercio);
}
