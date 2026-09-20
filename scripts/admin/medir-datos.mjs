#!/usr/bin/env node
/**
 * Mide cuánto ocupa cada colección y dónde está el peso.
 *
 * Firestore cobra por almacenamiento, por lectura y por transferencia: un logotipo guardado como
 * data URL dentro de un documento se paga cada vez que alguien lo lee. Este informe identifica los
 * campos grandes para saber qué conviene mover a Cloud Storage o reducir antes de subir.
 *
 * Solo lectura. Uso:
 *   node scripts/admin/medir-datos.mjs --project puntosnb
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const projectId = opt('project');
if (!projectId) {
  console.error('Uso: --project <id>');
  process.exit(1);
}

process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= projectId;
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

/** Tamaño aproximado del valor serializado. Sirve para comparar, no para facturar. */
const pesa = (valor) => Buffer.byteLength(JSON.stringify(valor ?? null), 'utf8');

const colecciones = (await db.listCollections()).map((c) => c.id);
const filas = [];
const camposGrandes = [];
let totalGeneral = 0;

for (const nombre of colecciones) {
  const snap = await db.collection(nombre).get();
  let total = 0;
  let mayor = { id: null, bytes: 0 };

  for (const documento of snap.docs) {
    const datos = documento.data();
    const bytes = pesa(datos);
    total += bytes;
    if (bytes > mayor.bytes) mayor = { id: documento.id, bytes };

    for (const [campo, valor] of Object.entries(datos)) {
      const tamano = pesa(valor);
      // Umbral: 20 KB. Por debajo de eso, ningún campo mueve la aguja.
      if (tamano > 20_000) {
        camposGrandes.push({
          coleccion: nombre,
          documento: documento.id.slice(0, 12) + '…',
          campo,
          tamano: kb(tamano),
          tipo: typeof valor === 'string' && valor.startsWith('data:') ? valor.slice(5, valor.indexOf(';')) : typeof valor,
        });
      }
    }
  }

  totalGeneral += total;
  filas.push({
    coleccion: nombre,
    documentos: snap.size,
    total: kb(total),
    promedio: snap.size ? kb(total / snap.size) : '—',
    mayor: mayor.id ? `${mayor.id.slice(0, 10)}… (${kb(mayor.bytes)})` : '—',
  });
}

filas.sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
console.log(`\nProyecto ${projectId} · total aproximado: ${mb(totalGeneral)}\n`);
console.table(filas);

if (camposGrandes.length) {
  console.log('\nCampos de más de 20 KB (candidatos a Cloud Storage o a reducción antes de subir):');
  camposGrandes.sort((a, b) => parseFloat(b.tamano) - parseFloat(a.tamano));
  console.table(camposGrandes.slice(0, 25));
  const pesoImagenes = camposGrandes.reduce((s, c) => s + parseFloat(c.tamano) * 1024, 0);
  console.log(`Suman ${mb(pesoImagenes)} de los ${mb(totalGeneral)} del proyecto.`);
} else {
  console.log('\nNingún campo supera los 20 KB.');
}
