#!/usr/bin/env node
/**
 * Proyecta el rol y el comercio de cada documento `users` a los custom claims del token.
 *
 * Es el paso de migración de la Fase 1: a partir de aquí las reglas pueden confiar en
 * `request.auth.token.rol` en lugar de leer Firestore en cada evaluación.
 *
 * Reutiliza la misma función que usan las Cloud Functions (`functions/lib/comun/claims.js`),
 * para que no existan dos implementaciones que puedan divergir. Requiere haber compilado:
 *   npm --prefix functions run build
 *
 * Uso:
 *   node scripts/admin/backfill-claims.mjs --project puntosnb --dry-run
 *   node scripts/admin/backfill-claims.mjs --project puntosnb
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '../..');
const compilado = resolve(raiz, 'functions/lib/comun/claims.js');

if (!existsSync(compilado)) {
  console.error('Falta compilar las funciones. Ejecuta: npm --prefix functions run build');
  process.exit(1);
}

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

process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= projectId;

const { sincronizarClaims } = await import(compilado);
const { db } = await import(resolve(raiz, 'functions/lib/comun/firebase.js'));

console.log(`Proyecto: ${projectId}${simular ? ' · SIMULACIÓN (no se escribe nada)' : ''}`);

const snap = await db.collection('users').get();
const resultados = [];
for (const doc of snap.docs) {
  resultados.push(await sincronizarClaims(doc.id, { simular }));
}

const cambiados = resultados.filter((r) => r.cambio);
const omitidos = resultados.filter((r) => !r.cambio);

console.table(
  cambiados.map((r) => ({ uid: r.uid.slice(0, 8) + '…', rol: r.rol, comercioId: r.comercioId ?? '—' })),
);
console.log(`Sincronizados: ${cambiados.length} de ${resultados.length}`);

const motivos = {};
for (const r of omitidos) motivos[r.motivo ?? 'sin motivo'] = (motivos[r.motivo ?? 'sin motivo'] ?? 0) + 1;
if (omitidos.length) {
  console.log('Sin cambios:');
  console.table(motivos);
}
process.exit(0);
