#!/usr/bin/env node
/**
 * Métricas de App Check: cuánto del tráfico llega verificado.
 *
 * Sirve para decidir cuándo activar la exigencia (*enforcement*) sin dejar afuera a usuarios con
 * una versión vieja de la aplicación abierta. Lee Cloud Monitoring; no escribe nada.
 *
 * Uso:
 *   node scripts/admin/metricas-appcheck.mjs --project puntosnb --horas 24
 *   node scripts/admin/metricas-appcheck.mjs --todos --horas 48
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const horas = Number(opt('horas') ?? 24);
const proyectos = args.includes('--todos') ? ['puntosnb', 'hipatia-puntos'] : [opt('project')].filter(Boolean);
const CUENTA = process.env.CUENTA_GCLOUD ?? 'alberdi.andres@gmail.com';

if (!proyectos.length) {
  console.error('Uso: --project <id> [--horas N] · o --todos');
  process.exit(1);
}

const token = execFileSync('gcloud', ['auth', 'print-access-token', `--account=${CUENTA}`], { encoding: 'utf8' }).trim();

const desde = new Date(Date.now() - horas * 3600_000).toISOString();
const hasta = new Date().toISOString();

/** El criterio acordado para activar la exigencia. */
const UMBRAL_VERIFICADO = 95;

for (const projectId of proyectos) {
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`);
  // Métrica real del servicio: cuenta verificaciones por resultado (VALID, INVALID, …).
  url.searchParams.set('filter', 'metric.type="firebaseappcheck.googleapis.com/services/verification_count"');
  url.searchParams.set('interval.startTime', desde);
  url.searchParams.set('interval.endTime', hasta);
  url.searchParams.set('aggregation.alignmentPeriod', `${horas * 3600}s`);
  url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_SUM');

  const respuesta = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'X-Goog-User-Project': projectId },
  });
  const cuerpo = await respuesta.json();

  console.log(`\n=== ${projectId} · últimas ${horas} h ===`);
  if (cuerpo.error) {
    console.log('  No se pudieron leer las métricas:', cuerpo.error.message?.slice(0, 160));
    continue;
  }

  const series = cuerpo.timeSeries ?? [];
  if (!series.length) {
    console.log('  Sin tráfico registrado en la ventana. Si la aplicación se está usando, App Check');
    console.log('  todavía no está enviando tokens: conviene revisar la consola del navegador.');
    continue;
  }

  const porServicio = {};
  for (const s of series) {
    const servicio = s.resource?.labels?.service_id ?? '(sin servicio)';
    // `security` dice si la solicitud traía un token válido: VERIFIED, o el motivo por el que no.
    const resultado = s.metric?.labels?.security ?? '(sin dato)';
    const valor = (s.points ?? []).reduce((suma, p) => suma + Number(p.value?.int64Value ?? p.value?.doubleValue ?? 0), 0);
    porServicio[servicio] ??= {};
    porServicio[servicio][resultado] = (porServicio[servicio][resultado] ?? 0) + valor;
  }

  const filas = [];
  let listoParaExigir = true;
  for (const [servicio, resultados] of Object.entries(porServicio)) {
    const total = Object.values(resultados).reduce((a, b) => a + b, 0);
    const verificadas = resultados.VERIFIED ?? 0;
    const porcentaje = total ? (verificadas * 100) / total : 0;
    if (porcentaje < UMBRAL_VERIFICADO) listoParaExigir = false;
    filas.push({
      servicio,
      total,
      verificadas,
      'no verificadas': total - verificadas,
      '% verificado': `${porcentaje.toFixed(1)} %`,
      motivos: Object.entries(resultados)
        .filter(([k]) => k !== 'VERIFIED')
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ') || '—',
    });
  }

  console.table(filas);
  console.log(
    listoParaExigir
      ? `  Cumple el criterio: más del ${UMBRAL_VERIFICADO} % verificado en todos los servicios.`
      : `  Todavía no cumple el ${UMBRAL_VERIFICADO} % en todos los servicios: conviene esperar.`,
  );
  console.log('  Motivos frecuentes: MISSING_OUTDATED_CLIENT = versión vieja de la aplicación abierta;');
  console.log('  MISSING_UNKNOWN_ORIGIN = llamada sin token de App Check (script, herramienta o app sin registrar).');
}
