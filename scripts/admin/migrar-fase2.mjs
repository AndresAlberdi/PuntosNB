#!/usr/bin/env node
/**
 * Migración de datos de la Fase 2.
 *
 * 1. Separa cada comercio en dos documentos: `comercios/{id}` conserva el perfil público y
 *    `comercios_privado/{id}` recibe lo fiscal y lo económico, que deja de ser legible por
 *    cualquier usuario autenticado.
 * 2. Calcula en el documento público las dos señales derivadas que usa la interfaz:
 *    `operativoHasta` y `puedeCanjearPremios`.
 * 3. Crea el perfil público mínimo de cada influencer en `influencers_publico/{uid}`.
 *
 * Es idempotente: se puede correr dos veces sin efectos distintos.
 *
 * Uso:
 *   node scripts/admin/migrar-fase2.mjs --project puntosnb --dry-run
 *   node scripts/admin/migrar-fase2.mjs --project puntosnb
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const projectId = opt('project');
const simular = args.includes('--dry-run');
if (!projectId) {
  console.error('Uso: --project <id> [--dry-run]');
  process.exit(1);
}

process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= projectId;
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

/** Campos que se mudan al documento privado. */
const CAMPOS_PRIVADOS = [
  'nit_rut', 'razonSocial', 'recibeFactura', 'plan', 'mensualidadBs', 'costoPorPremioBs',
  'costoPorCodigoComercio', 'saldoPremiosBs', 'consumidoPremiosBs', 'mesesPagados',
];

const claveMes = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;

function operativoHasta(comercio, ahora = new Date()) {
  if (!comercio.modalidadPago || comercio.modalidadPago === 'PILOTO') return null;
  const pagados = new Set(comercio.mesesPagados ?? []);
  if (!pagados.has(claveMes(ahora))) return 0;
  let ultimo = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  for (;;) {
    const siguiente = new Date(ultimo.getFullYear(), ultimo.getMonth() + 1, 1);
    if (!pagados.has(claveMes(siguiente))) break;
    ultimo = siguiente;
  }
  return new Date(ultimo.getFullYear(), ultimo.getMonth() + 1, 0, 23, 59, 59).getTime();
}

function puedeCanjear(comercio) {
  if (!comercio.modalidadPago || comercio.modalidadPago === 'PILOTO') return true;
  const costo = comercio.costoPorPremioBs && comercio.costoPorPremioBs > 0 ? comercio.costoPorPremioBs : 1.25;
  return operativoHasta(comercio) > Date.now() && (comercio.saldoPremiosBs ?? 0) >= costo;
}

console.log(`Migración de la Fase 2 en ${projectId}${simular ? ' · SIMULACIÓN' : ''}\n`);

const comercios = await db.collection('comercios').get();
const filasComercios = [];

for (const docComercio of comercios.docs) {
  const datos = docComercio.data();
  const privado = { id: docComercio.id, modalidadPago: datos.modalidadPago ?? 'PILOTO' };
  for (const campo of CAMPOS_PRIVADOS) {
    if (datos[campo] !== undefined) privado[campo] = datos[campo];
  }
  privado.saldoPremiosBs ??= 0;
  privado.consumidoPremiosBs ??= 0;
  privado.mesesPagados ??= [];

  const derivados = {
    operativoHasta: operativoHasta({ ...datos, ...privado }),
    puedeCanjearPremios: puedeCanjear({ ...datos, ...privado }),
    modalidadPago: datos.modalidadPago ?? 'PILOTO',
  };

  const aBorrar = CAMPOS_PRIVADOS.filter((c) => datos[c] !== undefined);

  filasComercios.push({
    comercio: datos.nombre ?? docComercio.id,
    camposMudados: aBorrar.length,
    saldoPremiosBs: privado.saldoPremiosBs,
    operativoHasta: derivados.operativoHasta === null ? 'PILOTO' : new Date(derivados.operativoHasta).toISOString().slice(0, 10),
    puedeCanjear: derivados.puedeCanjearPremios,
  });

  if (!simular) {
    await db.collection('comercios_privado').doc(docComercio.id).set(privado, { merge: true });
    const limpieza = Object.fromEntries(aBorrar.map((c) => [c, FieldValue.delete()]));
    await docComercio.ref.set({ ...derivados, ...limpieza }, { merge: true });
  }
}

console.table(filasComercios);

const influencers = await db.collection('users').where('rol', '==', 'influencer').get();
const filasInfluencers = [];
for (const docUsuario of influencers.docs) {
  const d = docUsuario.data();
  filasInfluencers.push({ uid: docUsuario.id.slice(0, 8) + '…', nombre: d.nombre ?? '', prefijo: d.prefijoCodigo ?? '—' });
  if (!simular) {
    await db.collection('influencers_publico').doc(docUsuario.id).set({
      uid: docUsuario.id,
      nombre: d.nombre ?? '',
      prefijoCodigo: d.prefijoCodigo ?? '',
      avatarUrl: d.avatarUrl ?? '',
      descripcion: d.descripcion ?? '',
      redesSociales: d.redesSociales ?? [],
      seguidores: d.seguidores ?? 0,
      estado: d.estado ?? 'activo',
    }, { merge: true });
  }
}

console.log('Perfiles públicos de influencer:');
console.table(filasInfluencers.length ? filasInfluencers : [{ resultado: 'ninguno' }]);
console.log(simular ? '\nSimulación: no se escribió nada.' : '\nMigración aplicada.');
