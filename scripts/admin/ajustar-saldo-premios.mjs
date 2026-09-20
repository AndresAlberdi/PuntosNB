#!/usr/bin/env node
/**
 * Ajuste manual del saldo de premios de un comercio, con asiento de auditoría.
 *
 * Es la vía para corregir un descuadre detectado —por ejemplo, saldo perdido por una escritura
 * del navegador sobre un dato desactualizado— sin inventar un cobro que nunca ocurrió. El ajuste
 * y su asiento se escriben en una sola transacción, y el asiento guarda el antes, el después,
 * quién lo pidió y por qué.
 *
 * Uso:
 *   node scripts/admin/ajustar-saldo-premios.mjs --project puntosnb --comercio <id> \
 *     --monto 10 --motivo "reposición del descuadre H-25" --autoriza "Andrés Alberdi" --dry-run
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const projectId = opt('project');
const comercioId = opt('comercio');
const monto = Number(opt('monto'));
const motivo = opt('motivo');
const autoriza = opt('autoriza');
const simular = args.includes('--dry-run');

if (!projectId || !comercioId || !Number.isFinite(monto) || monto === 0 || !motivo || !autoriza) {
  console.error('Uso: --project <id> --comercio <id> --monto <Bs> --motivo "..." --autoriza "..." [--dry-run]');
  process.exit(1);
}

process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= projectId;
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const ref = db.collection('comercios').doc(comercioId);
const snap = await ref.get();
if (!snap.exists) {
  console.error('Ese comercio no existe.');
  process.exit(2);
}

const antes = snap.data()?.saldoPremiosBs ?? 0;
const despues = Math.round((antes + monto) * 100) / 100;
console.log(`Comercio: ${snap.data()?.nombre ?? comercioId}`);
console.log(`Saldo de premios: ${antes} Bs → ${despues} Bs (${monto > 0 ? '+' : ''}${monto})`);
console.log(`Motivo: ${motivo}`);
console.log(`Autoriza: ${autoriza}`);

if (simular) {
  console.log('\nSimulación: no se escribió nada.');
  process.exit(0);
}

await db.runTransaction(async (tx) => {
  const actual = await tx.get(ref);
  const saldoActual = actual.data()?.saldoPremiosBs ?? 0;
  if (saldoActual !== antes) {
    throw new Error(`El saldo cambió mientras se preparaba el ajuste (${antes} → ${saldoActual}). No se aplicó nada.`);
  }
  tx.update(ref, { saldoPremiosBs: despues });
  tx.set(db.collection('auditoria').doc(), {
    accion: 'comercio.ajuste_saldo_premios',
    actorUid: null,
    actorRol: 'administración',
    comercioId,
    objetivo: comercioId,
    antes: { saldoPremiosBs: antes },
    despues: { saldoPremiosBs: despues },
    detalle: { monto, motivo, autoriza, origen: 'scripts/admin/ajustar-saldo-premios.mjs' },
    fechaHora: FieldValue.serverTimestamp(),
  });
});

console.log('\nAjuste aplicado y registrado en la auditoría.');
