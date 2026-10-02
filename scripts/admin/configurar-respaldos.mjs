#!/usr/bin/env node
/**
 * Configura la recuperación y los respaldos de Firestore: recuperación a un punto en el tiempo
 * (PITR), protección contra borrado de la base y dos respaldos programados.
 *
 * Por qué hace falta. Hasta el 02-oct-2026 las dos bases (`puntosnb` y `hipatia-puntos`) tenían
 * PITR y protección contra borrado deshabilitadas, retención de versiones de una hora y ninguna
 * programación de respaldo. Un borrado o una escritura errónea masiva no tenían vuelta atrás,
 * y `puntosnb` guarda datos reales de los pilotos.
 *
 * Qué deja configurado, en la base `(default)`:
 *   - PITR activo (se puede leer o restaurar la base a cualquier instante de los últimos 7 días).
 *   - Protección contra borrado activa (la base no se puede eliminar sin desactivarla antes).
 *   - Respaldo diario, retención de 7 días (604800 s).
 *   - Respaldo semanal (domingo), retención de 8 semanas (4838400 s).
 * Son las dos programaciones que Firestore admite como máximo: una diaria y una semanal.
 *
 * Detalles que conviene saber:
 *   - Firestore NO admite un respaldo manual: el primero aparece dentro de las 24 horas
 *     siguientes a crear la programación.
 *   - Los respaldos quedan en la ubicación de la base. Una restauración de producción se hace
 *     siempre en `nam5`, dentro de `hipatia-puntos`; nunca se copian datos de producción a
 *     `puntosnb`.
 *
 * Es idempotente: lee el estado y solo cambia lo que difiere. Correrlo dos veces no cambia nada
 * la segunda vez. Reconoce sus programaciones por recurrencia y retención, así que no crea
 * duplicados.
 *
 * Modos:
 *   (sin bandera)  aplica los cambios.
 *   --dry-run      imprime el estado actual y los cambios que haría; no escribe nada.
 *   --verificar    SOLO LECTURA. Imprime PASA/FALLA por cada punto y sale con código distinto
 *                  de cero si alguno falla.
 *   --revertir     borra SOLO las programaciones de este script, desactiva PITR y quita la
 *                  protección contra borrado. Los respaldos ya hechos se conservan hasta
 *                  vencer. Admite --dry-run.
 *
 * Seguridad: solo admite `puntosnb` y `hipatia-puntos`; esta última exige además
 * `--confirmar-produccion`. El token sale de `gcloud auth print-access-token` y no se imprime.
 *
 * Uso:
 *   node scripts/admin/configurar-respaldos.mjs --project puntosnb --dry-run
 *   node scripts/admin/configurar-respaldos.mjs --project puntosnb
 *   node scripts/admin/configurar-respaldos.mjs --project puntosnb --verificar
 *   node scripts/admin/configurar-respaldos.mjs --project hipatia-puntos --confirmar-produccion --dry-run
 *   node scripts/admin/configurar-respaldos.mjs --project puntosnb --revertir --dry-run
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  analizarArgumentos, crearClienteGcp, esperarOperacion, ErrorUso, ErrorGcp, sanearTexto,
} from './lib/gcp.mjs';
import {
  PITR_ACTIVO, PROTECCION_ACTIVA, planificarCambios, evaluarVerificacion, PROGRAMACIONES,
  esDeEsteScript,
} from './lib/respaldos.mjs';

const API = 'https://firestore.googleapis.com/v1';

const si = (valor) => (valor ? 'activo' : 'apagado');

/** Lee de la API el estado que importa (solo lectura). */
async function leerEstado(cliente, urlBase) {
  const base = await cliente.solicitar('GET', urlBase);
  const lista = await cliente.solicitar('GET', `${urlBase}/backupSchedules`);
  return {
    base: {
      pitr: base?.pointInTimeRecoveryEnablement === PITR_ACTIVO,
      proteccion: base?.deleteProtectionState === PROTECCION_ACTIVA,
      earliestVersionTime: base?.earliestVersionTime ?? null,
      versionRetentionPeriod: base?.versionRetentionPeriod ?? null,
      ubicacion: base?.locationId ?? 'desconocida',
    },
    programaciones: lista?.backupSchedules ?? [],
  };
}

function imprimirEstado(estado, titulo, escribir) {
  escribir(`${titulo}`);
  escribir(`  Ubicación de la base      : ${estado.base.ubicacion}`);
  escribir(`  PITR                      : ${si(estado.base.pitr)}`);
  escribir(`  Protección contra borrado : ${si(estado.base.proteccion)}`);
  escribir(`  Retención de versiones    : ${estado.base.versionRetentionPeriod ?? 'ausente'}`);
  if (!estado.programaciones.length) {
    escribir('  Programaciones de respaldo: ninguna');
  } else {
    escribir('  Programaciones de respaldo:');
    for (const p of estado.programaciones) {
      const tipo = p.dailyRecurrence !== undefined
        ? 'diaria'
        : `semanal (${p.weeklyRecurrence?.day ?? '?'})`;
      const propia = PROGRAMACIONES.some((d) => esDeEsteScript(p, d)) ? ' [de este script]' : '';
      escribir(`    - ${tipo}, retención ${p.retention ?? '?'}${propia}`);
    }
  }
}

/** Ejecuta los cambios del plan, en orden. Solo se llama fuera de --dry-run y --verificar. */
async function ejecutar(cliente, urlBase, cambios, escribir) {
  for (const cambio of cambios) {
    escribir(`  Aplicando: ${cambio.descripcion}`);
    if (cambio.tipo === 'actualizarBase') {
      const mascara = Object.keys(cambio.campos).join(',');
      const operacion = await cliente.solicitar(
        'PATCH', `${urlBase}?updateMask=${mascara}`, cambio.campos
      );
      await esperarOperacion(cliente, API, operacion);
    } else if (cambio.tipo === 'crearProgramacion') {
      await cliente.solicitar('POST', `${urlBase}/backupSchedules`, cambio.cuerpo);
    } else if (cambio.tipo === 'borrarProgramacion') {
      await cliente.solicitar('DELETE', `${API}/${cambio.name}`);
    }
  }
}

/**
 * Flujo principal. No lee `process.argv` ni llama a `process.exit`: recibe el cliente y las
 * opciones, escribe por `escribir` y devuelve el código de salida. Así se puede probar con un
 * cliente falso que lance ante cualquier escritura.
 *
 * @param {object} args
 * @param {{ solicitar: Function }} args.cliente
 * @param {{ project: string, simular?: boolean, revertir?: boolean, verificar?: boolean }} args.opciones
 * @param {(texto: string) => void} [args.escribir]
 * @returns {Promise<number>} código de salida
 */
export async function principal({ cliente, opciones, escribir = console.log }) {
  const { project, simular, revertir, verificar } = opciones;
  const urlBase = `${API}/projects/${project}/databases/(default)`;
  const modoTexto = verificar ? ' (verificación, solo lectura)' : simular ? ' (simulación)' : '';
  escribir(`\nRespaldos de Firestore en ${project}${revertir ? ' · REVERTIR' : ''}${modoTexto}\n`);

  const estado = await leerEstado(cliente, urlBase);
  imprimirEstado(estado, 'Estado actual:', escribir);

  if (verificar) {
    const resultados = evaluarVerificacion(estado);
    escribir('\nVerificación:');
    for (const r of resultados) escribir(`  ${r.pasa ? 'PASA ' : 'FALLA'}  ${r.punto}`);
    const fallas = resultados.filter((r) => !r.pasa).length;
    escribir(
      fallas
        ? `\n${fallas} punto(s) fallan. Corra sin --verificar (primero con --dry-run) para configurarlos.`
        : '\nTodos los puntos pasan.'
    );
    return fallas ? 1 : 0;
  }

  const { cambios, conflictos } = planificarCambios(estado, revertir ? 'revertir' : 'aplicar');

  if (conflictos.length) {
    escribir('\nConflictos (no se resuelven solos):');
    for (const c of conflictos) escribir(`  - ${c}`);
  }

  if (!cambios.length) {
    escribir('\nNada que cambiar: el estado ya es el deseado.');
    return conflictos.length ? 2 : 0;
  }

  escribir(`\nCambios${simular ? ' que haría' : ' a aplicar'}:`);
  for (const c of cambios) escribir(`  - ${c.descripcion}`);

  if (simular) {
    escribir('\nSimulación: no se escribió nada. Corra sin --dry-run para aplicarlo.');
    return conflictos.length ? 2 : 0;
  }

  if (conflictos.length) {
    escribir('\nHay conflictos: no se aplica nada hasta resolverlos.');
    return 2;
  }

  escribir('');
  await ejecutar(cliente, urlBase, cambios, escribir);

  const final = await leerEstado(cliente, urlBase);
  escribir('');
  imprimirEstado(final, 'Estado resultante:', escribir);
  if (!revertir) {
    escribir(
      '\nEl primer respaldo aparece dentro de las 24 horas siguientes. Compruébelo con --verificar.'
    );
  } else {
    escribir('\nLos respaldos ya existentes se conservan hasta vencer su retención.');
  }
  return 0;
}

/** Punto de entrada: analiza los argumentos, crea el cliente real y sale con el código. */
async function main() {
  let opciones;
  try {
    opciones = analizarArgumentos(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ErrorUso) {
      console.error(`${error.message}\n`);
      console.error(
        'Uso: --project <puntosnb|hipatia-puntos> [--dry-run] [--verificar] [--revertir] ' +
        '[--confirmar-produccion]'
      );
      process.exit(1);
    }
    throw error;
  }

  try {
    const cliente = crearClienteGcp({ project: opciones.project });
    process.exit(await principal({ cliente, opciones }));
  } catch (error) {
    const mensaje = error instanceof ErrorGcp || error instanceof ErrorUso
      ? error.message
      : 'Error inesperado.';
    console.error(`\n${sanearTexto(mensaje)}`);
    process.exit(1);
  }
}

// Solo corre como script; al importarlo desde las pruebas no hace nada.
const esScript = process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (esScript) await main();
