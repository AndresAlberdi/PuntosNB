#!/usr/bin/env node
/**
 * Recalcula las dos señales derivadas del documento público de cada comercio:
 * `operativoHasta` y `puedeCanjearPremios`.
 *
 * Por qué hace falta. Hasta el 01-oct-2026 esas señales se calculaban con la zona horaria del
 * proceso, y las Cloud Functions corren en UTC mientras el negocio opera en Bolivia (UTC−4). Los
 * valores ya escritos cortan cuatro horas antes de lo correcto. Arreglar el servidor no los
 * corrige: siguen guardados tal cual, y la interfaz los lee.
 *
 * Y hay un lazo que no se abre solo: la interfaz bloquea la operación porque la señal dice
 * "impago", y al bloquearla impide la escritura que recalcularía la señal. Por eso hace falta
 * una corrección externa y no basta con esperar a la próxima operación.
 *
 * Es idempotente: correrlo dos veces no cambia nada la segunda vez. Solo escribe los documentos
 * cuyo valor difiere del calculado.
 *
 * Requiere las funciones compiladas, porque reutiliza su módulo de calendario en vez de llevar
 * una cuarta copia de la regla:
 *   npm --prefix functions run build
 *
 * Uso:
 *   node scripts/admin/recalcular-senales.mjs --project puntosnb --dry-run
 *   node scripts/admin/recalcular-senales.mjs --project puntosnb
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

let finDelPeriodoPagado;
try {
  ({ finDelPeriodoPagado } = await import('../../functions/lib/comun/fechaBolivia.js'));
} catch {
  console.error(
    'No se encontró functions/lib/comun/fechaBolivia.js.\n' +
    'Compile las funciones antes de correr este script:  npm --prefix functions run build'
  );
  process.exit(1);
}

process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= projectId;
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

/** Mismo criterio que `estadoPrepago` del backend: mes corriente pagado y saldo para un premio. */
function senales(comercio, ahora = new Date()) {
  if (comercio.estado === 'bloqueado') return { operativoHasta: 0, puedeCanjearPremios: false };
  if (!comercio.modalidadPago || comercio.modalidadPago === 'PILOTO') {
    return { operativoHasta: null, puedeCanjearPremios: true };
  }
  const hasta = finDelPeriodoPagado(comercio.mesesPagados ?? [], ahora);
  const costo = comercio.costoPorPremioBs && comercio.costoPorPremioBs > 0 ? comercio.costoPorPremioBs : 1.25;
  const saldo = comercio.saldoPremiosBs ?? 0;
  return { operativoHasta: hasta, puedeCanjearPremios: hasta >= ahora.getTime() && saldo >= costo };
}

const enBolivia = (ms) =>
  ms === null ? 'PILOTO'
  : ms === 0 ? 'impago'
  : new Date(ms).toLocaleString('es-BO', { timeZone: 'America/La_Paz' });

console.log(`\nRecálculo de señales derivadas en ${projectId}${simular ? ' (simulación)' : ''}\n`);

const publicos = await db.collection('comercios').get();
const filas = [];
let escritos = 0;

for (const doc of publicos.docs) {
  const publico = doc.data();
  const privado = (await db.collection('comercios_privado').doc(doc.id).get()).data() ?? {};
  const completo = { ...publico, ...privado };
  const esperado = senales(completo);

  const iguales =
    (publico.operativoHasta ?? null) === esperado.operativoHasta &&
    (publico.puedeCanjearPremios ?? true) === esperado.puedeCanjearPremios;
  if (iguales) continue;

  filas.push({
    comercio: publico.nombre ?? doc.id,
    modalidad: completo.modalidadPago ?? 'PILOTO',
    antes: enBolivia(publico.operativoHasta ?? null),
    despues: enBolivia(esperado.operativoHasta),
    canjeAntes: publico.puedeCanjearPremios ?? true,
    canjeDespues: esperado.puedeCanjearPremios,
  });

  if (!simular) {
    await doc.ref.set(esperado, { merge: true });
    escritos++;
  }
}

if (!filas.length) {
  console.log(`Nada que corregir: las señales de los ${publicos.size} comercios ya son correctas.`);
} else {
  console.table(filas);
  console.log(
    simular
      ? `\n${filas.length} comercio(s) quedarían corregidos. Corra sin --dry-run para aplicarlo.`
      : `\n${escritos} comercio(s) corregidos.`
  );
}
process.exit(0);
