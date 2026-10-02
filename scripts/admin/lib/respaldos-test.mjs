/**
 * Pruebas de la lógica pura de respaldos y de las salvaguardas de `gcp.mjs`.
 * Corren con el ejecutor integrado de Node, sin dependencias y sin tocar la nube:
 *   node --test scripts/admin/lib/respaldos-test.mjs
 *
 * El nombre termina en `-test` (no en `.test.`) a propósito: así Vitest, que recorre todo el
 * repositorio buscando `*.test.*`, no intenta correrlas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planificarCambios, evaluarVerificacion, esDeEsteScript, segundos, PROGRAMACIONES, ultimoSegmento,
  clavesEnConflicto,
  PITR_ACTIVO, PITR_INACTIVO, PROTECCION_ACTIVA, PROTECCION_INACTIVA,
} from './respaldos.mjs';
import {
  analizarArgumentos, crearClienteGcp, esperarOperacion, enmascarar,
  enmascararCuentaFacturacion, sanearTexto, ErrorUso, ErrorGcp,
} from './gcp.mjs';
import { principal } from '../configurar-respaldos.mjs';

const DIARIA = { name: 'projects/p/databases/(default)/backupSchedules/d1', retention: '604800s', dailyRecurrence: {} };
const SEMANAL = {
  name: 'projects/p/databases/(default)/backupSchedules/s1', retention: '4838400s',
  weeklyRecurrence: { day: 'SUNDAY' },
};

const apagado = () => ({
  base: { pitr: false, proteccion: false, earliestVersionTime: '2026-10-02T04:00:00Z', versionRetentionPeriod: '3600s' },
  programaciones: [],
});
const encendido = () => ({
  base: { pitr: true, proteccion: true, earliestVersionTime: '2026-10-02T00:00:00Z', versionRetentionPeriod: '604800s' },
  programaciones: [{ ...DIARIA }, { ...SEMANAL }],
});

/** Aplica un plan sobre el estado simulado, como lo haría la API real. */
function aplicarEnMemoria(estado, cambios) {
  const nuevo = structuredClone(estado);
  let n = 0;
  for (const c of cambios) {
    if (c.tipo === 'actualizarBase') {
      if ('pointInTimeRecoveryEnablement' in c.campos) {
        nuevo.base.pitr = c.campos.pointInTimeRecoveryEnablement === PITR_ACTIVO;
        nuevo.base.versionRetentionPeriod = nuevo.base.pitr ? '604800s' : '3600s';
      }
      if ('deleteProtectionState' in c.campos) {
        nuevo.base.proteccion = c.campos.deleteProtectionState === PROTECCION_ACTIVA;
      }
    } else if (c.tipo === 'crearProgramacion') {
      nuevo.programaciones.push({ name: `creada/${n++}`, ...c.cuerpo });
    } else if (c.tipo === 'borrarProgramacion') {
      nuevo.programaciones = nuevo.programaciones.filter((p) => p.name !== c.name);
    }
  }
  return nuevo;
}

test('segundos interpreta el formato de la API', () => {
  assert.equal(segundos('604800s'), 604800);
  assert.equal(segundos('604800.000s'), 604800);
  assert.ok(Number.isNaN(segundos('7d')));
  assert.ok(Number.isNaN(segundos(undefined)));
});

test('aplicar con todo apagado: activa la base y crea las dos programaciones', () => {
  const { cambios, conflictos } = planificarCambios(apagado(), 'aplicar');
  assert.deepEqual(conflictos, []);
  assert.equal(cambios.length, 3);
  assert.deepEqual(cambios[0].campos, {
    pointInTimeRecoveryEnablement: PITR_ACTIVO,
    deleteProtectionState: PROTECCION_ACTIVA,
  });
  assert.deepEqual(cambios[1].cuerpo, { retention: '604800s', dailyRecurrence: {} });
  assert.deepEqual(cambios[2].cuerpo, { retention: '4838400s', weeklyRecurrence: { day: 'SUNDAY' } });
});

test('aplicar con todo encendido: no cambia nada', () => {
  assert.deepEqual(planificarCambios(encendido(), 'aplicar'), { cambios: [], conflictos: [] });
});

test('aplicar a medias: solo agrega lo que falta', () => {
  const estado = encendido();
  estado.base.proteccion = false;
  estado.programaciones = [{ ...SEMANAL }];
  const { cambios } = planificarCambios(estado, 'aplicar');
  assert.equal(cambios.length, 2);
  assert.deepEqual(cambios[0].campos, { deleteProtectionState: PROTECCION_ACTIVA });
  assert.equal(cambios[1].tipo, 'crearProgramacion');
  assert.equal(cambios[1].clave, 'diaria');
});

test('aplicar con una programación duplicada: conserva una y borra la copia', () => {
  const estado = encendido();
  estado.programaciones.push({ ...DIARIA, name: 'projects/p/databases/(default)/backupSchedules/d2' });
  const { cambios } = planificarCambios(estado, 'aplicar');
  assert.equal(cambios.length, 1);
  assert.equal(cambios[0].tipo, 'borrarProgramacion');
  assert.equal(cambios[0].name, 'projects/p/databases/(default)/backupSchedules/d2');
});

test('aplicar con una diaria ajena (otra retención): informa conflicto y no crea ni borra', () => {
  const estado = encendido();
  estado.programaciones = [
    { name: 'ajena', retention: '86400s', dailyRecurrence: {} },
    { ...SEMANAL },
  ];
  const { cambios, conflictos } = planificarCambios(estado, 'aplicar');
  assert.deepEqual(cambios, []);
  assert.equal(conflictos.length, 1);
  assert.match(conflictos[0], /diaria/);
});

test('conflicto con la base desprotegida: aun así planifica PITR, protección y la otra programación', () => {
  const estado = apagado();
  estado.programaciones = [{ name: 'ajena', retention: '86400s', dailyRecurrence: {} }];
  const { cambios, conflictos } = planificarCambios(estado, 'aplicar');
  assert.equal(conflictos.length, 1);
  assert.match(conflictos[0], /diaria/);
  assert.deepEqual(cambios.map((c) => c.tipo), ['actualizarBase', 'crearProgramacion']);
  assert.deepEqual(Object.keys(cambios[0].campos).sort(), ['deleteProtectionState', 'pointInTimeRecoveryEnablement']);
  assert.equal(cambios[1].clave, 'semanal');
  // La diaria ajena no se toca ni se reemplaza.
  assert.ok(!cambios.some((c) => c.tipo === 'borrarProgramacion' || c.clave === 'diaria'));
});

test('una semanal en otro día es ajena: conflicto, no duplicado', () => {
  const estado = encendido();
  estado.programaciones = [{ ...DIARIA }, { name: 'lunes', retention: '4838400s', weeklyRecurrence: { day: 'MONDAY' } }];
  const { cambios, conflictos } = planificarCambios(estado, 'aplicar');
  assert.deepEqual(cambios, []);
  assert.equal(conflictos.length, 1);
});

test('es idempotente: aplicar dos veces no cambia nada la segunda', () => {
  for (const inicial of [apagado(), encendido(), { ...apagado(), programaciones: [{ ...DIARIA }] }]) {
    const primero = planificarCambios(inicial, 'aplicar');
    const despues = aplicarEnMemoria(inicial, primero.cambios);
    assert.deepEqual(planificarCambios(despues, 'aplicar'), { cambios: [], conflictos: [] });
  }
});

test('revertir con todo encendido: borra las dos programaciones y apaga la base', () => {
  const { cambios } = planificarCambios(encendido(), 'revertir');
  assert.equal(cambios.length, 3);
  assert.deepEqual(cambios[0].campos, {
    pointInTimeRecoveryEnablement: PITR_INACTIVO,
    deleteProtectionState: PROTECCION_INACTIVA,
  });
  assert.deepEqual(cambios.slice(1).map((c) => c.tipo), ['borrarProgramacion', 'borrarProgramacion']);
});

test('revertir con todo apagado: no cambia nada', () => {
  assert.deepEqual(planificarCambios(apagado(), 'revertir'), { cambios: [], conflictos: [] });
});

test('revertir no toca las programaciones ajenas', () => {
  const estado = encendido();
  estado.programaciones.push({ name: 'ajena', retention: '86400s', dailyRecurrence: {} });
  const { cambios } = planificarCambios(estado, 'revertir');
  const borradas = cambios.filter((c) => c.tipo === 'borrarProgramacion').map((c) => c.name);
  assert.ok(!borradas.includes('ajena'));
  assert.equal(borradas.length, 2);
});

test('revertir borra también las copias duplicadas y es idempotente', () => {
  const estado = encendido();
  estado.programaciones.push({ ...DIARIA, name: 'copia' });
  const primero = planificarCambios(estado, 'revertir');
  assert.equal(primero.cambios.filter((c) => c.tipo === 'borrarProgramacion').length, 3);
  const despues = aplicarEnMemoria(estado, primero.cambios);
  assert.deepEqual(planificarCambios(despues, 'revertir'), { cambios: [], conflictos: [] });
});

test('esDeEsteScript distingue por retención y recurrencia', () => {
  const [diaria, semanal] = PROGRAMACIONES;
  assert.ok(esDeEsteScript(DIARIA, diaria));
  assert.ok(!esDeEsteScript(DIARIA, semanal));
  assert.ok(!esDeEsteScript({ ...DIARIA, retention: '86400s' }, diaria));
});

test('verificar: el estado apagado falla en los cinco puntos', () => {
  const r = evaluarVerificacion(apagado());
  assert.equal(r.length, 5);
  assert.ok(r.every((x) => !x.pasa));
});

test('verificar: el estado encendido pasa en los cinco puntos', () => {
  assert.ok(evaluarVerificacion(encendido()).every((x) => x.pasa));
});

test('verificar: con la retención de 1 hora falla solo el punto de retención', () => {
  const estado = encendido();
  estado.base.versionRetentionPeriod = '3600s';
  const fallan = evaluarVerificacion(estado).filter((x) => !x.pasa);
  assert.equal(fallan.length, 1);
  assert.match(fallan[0].punto, /Retención de versiones/);
});

test('verificar: earliestVersionTime lleno NO basta para dar por activo el PITR', () => {
  // Es el defecto que tenía el chequeo anterior: el campo viene lleno con el PITR apagado.
  const estado = apagado();
  assert.ok(estado.base.earliestVersionTime, 'el estado apagado de la prueba trae earliestVersionTime');
  const resultados = evaluarVerificacion(estado);
  const retencion = resultados.find((x) => /Retención de versiones/.test(x.punto));
  assert.equal(retencion.pasa, false);
  assert.equal(resultados.filter((x) => x.pasa).length, 0, 'apagado: ningún punto debe pasar');
});

test('argumentos: solo se admiten los dos proyectos, y producción exige confirmación', () => {
  assert.equal(analizarArgumentos(['--project', 'puntosnb', '--dry-run']).simular, true);
  assert.equal(
    analizarArgumentos(['--project', 'hipatia-puntos', '--confirmar-produccion', '--verificar']).verificar,
    true
  );
  assert.throws(() => analizarArgumentos(['--project', 'encuentramebo-1']), ErrorUso);
  assert.throws(() => analizarArgumentos(['--project', 'hipatia-puntos', '--dry-run']), /confirmar-produccion/);
  assert.throws(() => analizarArgumentos(['--dry-run']), /--project/);
  assert.throws(() => analizarArgumentos(['--project']), ErrorUso);
});

test('argumentos: una bandera desconocida aborta y --verificar no se combina con --revertir', () => {
  assert.throws(() => analizarArgumentos(['--project', 'puntosnb', '--dryrun']), /no reconocido/);
  assert.throws(() => analizarArgumentos(['--project', 'puntosnb', '--verificar', '--revertir']), ErrorUso);
});

test('argumentos: --revertir de verdad exige --confirmar-revertir en cualquier proyecto', () => {
  assert.throws(() => analizarArgumentos(['--project', 'puntosnb', '--revertir']), /--confirmar-revertir/);
  assert.throws(
    () => analizarArgumentos(['--project', 'hipatia-puntos', '--confirmar-produccion', '--revertir']),
    /--confirmar-revertir/
  );
  const simulado = analizarArgumentos(['--project', 'puntosnb', '--revertir', '--dry-run']);
  assert.equal(simulado.revertir, true);
  assert.equal(simulado.confirmarRevertir, false);
  const real = analizarArgumentos(['--project', 'puntosnb', '--revertir', '--confirmar-revertir']);
  assert.equal(real.revertir, true);
  assert.equal(real.confirmarRevertir, true);
  // La bandera nueva es admitida; una parecida sigue abortando.
  assert.throws(() => analizarArgumentos(['--project', 'puntosnb', '--confirmar-revertirr']), /no reconocido/);
});

test('revertir: la descripción de cada borrado lleva SOLO el último segmento del name', () => {
  const { cambios } = planificarCambios(encendido(), 'revertir');
  const borrados = cambios.filter((c) => c.tipo === 'borrarProgramacion');
  assert.equal(borrados.length, 2);
  assert.match(borrados[0].descripcion, /\(id: d1\)/);
  assert.match(borrados[1].descripcion, /\(id: s1\)/);
  for (const c of borrados) assert.ok(!c.descripcion.includes('databases'), 'no debe traer la ruta completa');
});

test('ultimoSegmento devuelve el identificador y tolera nombres vacíos', () => {
  assert.equal(ultimoSegmento('projects/p/databases/(default)/backupSchedules/abc'), 'abc');
  assert.equal(ultimoSegmento('solo'), 'solo');
  assert.equal(ultimoSegmento(undefined), 'sin nombre');
});

test('flujo: revertir sin confirmación lanza antes de llamar a la API; con --dry-run no la necesita', async () => {
  const api = crearApiFalsa({ ...ACTIVADA(), soloLectura: true });
  await assert.rejects(correr(api, { revertir: true }), ErrorUso);
  assert.deepEqual(api.llamadas, []);
});

test('flujo: --dry-run de revertir advierte del PITR e imprime el id de cada borrado', async () => {
  const api = crearApiFalsa({ ...ACTIVADA(), soloLectura: true });
  const { texto } = await correr(api, { simular: true, revertir: true });
  assert.match(texto, /ADVERTENCIA: revertir apaga el PITR/);
  assert.match(texto, /últimos 7 días/);
  assert.match(texto, /se conservan hasta vencer/);
  assert.match(texto, /sin importar quién las creó/);
  assert.match(texto, /\(id: d1\)/);
  assert.match(texto, /\(id: s1\)/);
});

test('enmascarado: identificadores, cuentas de facturación y tokens', () => {
  assert.equal(enmascarar('abcdefghij'), 'ab******ij');
  assert.equal(enmascarar('abc'), '***');
  assert.equal(enmascararCuentaFacturacion('billingAccounts/0123AB-4567CD-89EFAB'), 'billingAccounts/****AB-****CD-****AB');
  const limpio = sanearTexto('fallo con Bearer ya29.a0AbCdEf-ghi y ya29.zzz.yyy');
  assert.ok(!limpio.includes('ya29'));
});

function respuesta(estado, cuerpo) {
  const texto = cuerpo === undefined ? '' : JSON.stringify(cuerpo);
  return { ok: estado >= 200 && estado < 300, status: estado, text: async () => texto, clone() { return this; } };
}

test('cliente: envía las cabeceras, reintenta 429/503 y no imprime el cuerpo del error', async () => {
  const llamadas = [];
  const respuestas = [respuesta(429, {}), respuesta(503, {}), respuesta(200, { ok: true })];
  const esperas = [];
  const cliente = crearClienteGcp({
    project: 'puntosnb',
    obtenerToken: () => 'ya29.token-de-prueba',
    fetchImpl: async (url, init) => { llamadas.push({ url, init }); return respuestas.shift(); },
    esperar: async (ms) => { esperas.push(ms); },
  });
  assert.deepEqual(await cliente.solicitar('GET', 'https://x/y'), { ok: true });
  assert.deepEqual(esperas, [1000, 2000]);
  assert.equal(llamadas[0].init.headers['X-Goog-User-Project'], 'puntosnb');
  assert.match(llamadas[0].init.headers.Authorization, /^Bearer /);

  const malo = crearClienteGcp({
    project: 'puntosnb',
    obtenerToken: () => 'ya29.token-de-prueba',
    fetchImpl: async () => respuesta(403, { error: { status: 'PERMISSION_DENIED', message: 'secreto 0123AB-4567CD-89EFAB' } }),
    esperar: async () => {},
  });
  await assert.rejects(malo.solicitar('GET', 'https://x/y'), (e) => {
    assert.ok(e instanceof ErrorGcp);
    assert.equal(e.estado, 403);
    assert.equal(e.codigo, 'PERMISSION_DENIED');
    assert.ok(!e.message.includes('secreto'));
    assert.ok(!e.message.includes('ya29'));
    return true;
  });
});

test('cliente: un 503 en GET se reintenta hasta agotar los intentos y luego lanza', async () => {
  let llamadas = 0;
  const esperas = [];
  const cliente = crearClienteGcp({
    project: 'puntosnb',
    obtenerToken: () => 't',
    fetchImpl: async () => { llamadas++; return respuesta(503, { error: { status: 'UNAVAILABLE' } }); },
    esperar: async (ms) => { esperas.push(ms); },
  });
  await assert.rejects(cliente.solicitar('GET', 'https://x/y'), (e) => {
    assert.ok(e instanceof ErrorGcp);
    assert.equal(e.estado, 503);
    assert.equal(e.codigo, 'UNAVAILABLE');
    return true;
  });
  assert.equal(llamadas, 5);
  assert.deepEqual(esperas, [1000, 2000, 4000, 8000]);
});

test('cliente: un 503 en POST o DELETE NO se reintenta; en PATCH sí', async () => {
  for (const metodo of ['POST', 'DELETE']) {
    let llamadas = 0;
    const cliente = crearClienteGcp({
      project: 'puntosnb',
      obtenerToken: () => 't',
      fetchImpl: async () => { llamadas++; return respuesta(503, {}); },
      esperar: async () => { throw new Error('no debe esperar: no hay reintento'); },
    });
    await assert.rejects(cliente.solicitar(metodo, 'https://x/y', metodo === 'POST' ? {} : undefined), ErrorGcp);
    assert.equal(llamadas, 1, `${metodo} no debe reintentarse`);
  }
  const respuestas = [respuesta(503, {}), respuesta(200, { ok: true })];
  const patch = crearClienteGcp({
    project: 'puntosnb',
    obtenerToken: () => 't',
    fetchImpl: async () => respuestas.shift(),
    esperar: async () => {},
  });
  assert.deepEqual(await patch.solicitar('PATCH', 'https://x/y', {}), { ok: true });
});

test('cliente: no pide el token hasta la primera llamada', async () => {
  let pidio = false;
  crearClienteGcp({ project: 'puntosnb', obtenerToken: () => { pidio = true; return 't'; } });
  assert.equal(pidio, false);
});

test('esperarOperacion: sondea hasta que termine y propaga el error de la operación', async () => {
  const pendientes = [{ name: 'op/1', done: false }, { name: 'op/1', done: true }];
  const cliente = { solicitar: async () => pendientes.shift() };
  const fin = await esperarOperacion(cliente, 'https://x', { name: 'op/1', done: false }, { esperar: async () => {} });
  assert.equal(fin.done, true);

  const conError = { solicitar: async () => ({ name: 'op/2', done: true, error: { code: 7, message: 'datos' } }) };
  await assert.rejects(
    esperarOperacion(conError, 'https://x', { name: 'op/2', done: false }, { esperar: async () => {} }),
    (e) => e instanceof ErrorGcp && !e.message.includes('datos')
  );
});

// ---------------------------------------------------------------------------------------------
// Flujo principal con un cliente falso que simula la API de Firestore en memoria.
// ---------------------------------------------------------------------------------------------

const RAIZ_API = 'https://firestore.googleapis.com/v1';

/**
 * Cliente falso con una «base» en memoria. Registra cada llamada. Con `soloLectura`, LANZA ante
 * cualquier método distinto de GET: demuestra que un modo no escribe.
 */
function crearApiFalsa({
  pitr = false, proteccion = false, programaciones = [], soloLectura = false,
  ignorarPatch = false, retencionRezagada = false,
} = {}) {
  const proyecto = 'puntosnb';
  const urlBase = `${RAIZ_API}/projects/${proyecto}/databases/(default)`;
  const estado = { pitr, proteccion, programaciones: structuredClone(programaciones) };
  const llamadas = [];
  let n = 0;
  return {
    estado,
    llamadas,
    solicitar: async (metodo, url, cuerpo) => {
      llamadas.push(metodo);
      if (soloLectura && metodo !== 'GET') {
        throw new Error(`escritura inesperada en modo de solo lectura: ${metodo}`);
      }
      if (metodo === 'GET' && url === urlBase) {
        return {
          pointInTimeRecoveryEnablement: estado.pitr ? PITR_ACTIVO : PITR_INACTIVO,
          deleteProtectionState: estado.proteccion ? PROTECCION_ACTIVA : PROTECCION_INACTIVA,
          versionRetentionPeriod: estado.pitr && !retencionRezagada ? '604800s' : '3600s',
          earliestVersionTime: '2026-10-02T04:00:00Z',
          locationId: 'nam5',
        };
      }
      if (metodo === 'GET' && url === `${urlBase}/backupSchedules`) {
        return { backupSchedules: structuredClone(estado.programaciones) };
      }
      if (metodo === 'PATCH' && url.startsWith(`${urlBase}?updateMask=`)) {
        if (ignorarPatch) return { name: 'operations/1', done: true };
        if ('pointInTimeRecoveryEnablement' in cuerpo) {
          estado.pitr = cuerpo.pointInTimeRecoveryEnablement === PITR_ACTIVO;
        }
        if ('deleteProtectionState' in cuerpo) {
          estado.proteccion = cuerpo.deleteProtectionState === PROTECCION_ACTIVA;
        }
        return { name: 'operations/1', done: true };
      }
      if (metodo === 'POST' && url === `${urlBase}/backupSchedules`) {
        estado.programaciones.push({ name: `${urlBase}/backupSchedules/n${n++}`, ...cuerpo });
        return {};
      }
      if (metodo === 'DELETE' && url.startsWith(`${RAIZ_API}/`)) {
        const name = url.slice(RAIZ_API.length + 1);
        estado.programaciones = estado.programaciones.filter((p) => p.name !== name);
        return null;
      }
      throw new Error(`llamada no prevista: ${metodo} ${url}`);
    },
  };
}

const ACTIVADA = () => ({
  pitr: true,
  proteccion: true,
  programaciones: [
    { ...DIARIA, name: 'projects/puntosnb/databases/(default)/backupSchedules/d1' },
    { ...SEMANAL, name: 'projects/puntosnb/databases/(default)/backupSchedules/s1' },
  ],
});

/** Ejecuta `principal` capturando lo que escribe. */
async function correr(api, opciones) {
  const salida = [];
  const codigo = await principal({
    cliente: api,
    opciones: { project: 'puntosnb', ...opciones },
    escribir: (t) => salida.push(t),
  });
  return { codigo, texto: salida.join('\n') };
}

test('flujo: --dry-run (aplicar) solo usa GET y no lanza', async () => {
  const api = crearApiFalsa({ soloLectura: true });
  const { codigo, texto } = await correr(api, { simular: true });
  assert.equal(codigo, 0);
  assert.match(texto, /Simulación: no se escribió nada/);
  assert.ok(api.llamadas.length > 0 && api.llamadas.every((m) => m === 'GET'));
});

test('flujo: --dry-run (revertir) solo usa GET y no lanza', async () => {
  const api = crearApiFalsa({ ...ACTIVADA(), soloLectura: true });
  const { codigo, texto } = await correr(api, { simular: true, revertir: true });
  assert.equal(codigo, 0);
  assert.match(texto, /Borrar la programación/);
  assert.ok(api.llamadas.every((m) => m === 'GET'));
});

test('flujo: --verificar solo usa GET; sale con 1 si falla y con 0 si pasa', async () => {
  const mal = crearApiFalsa({ soloLectura: true });
  assert.equal((await correr(mal, { verificar: true })).codigo, 1);
  assert.ok(mal.llamadas.every((m) => m === 'GET'));

  const bien = crearApiFalsa({ ...ACTIVADA(), soloLectura: true });
  assert.equal((await correr(bien, { verificar: true })).codigo, 0);
  assert.ok(bien.llamadas.every((m) => m === 'GET'));
});

test('flujo: el modo de escritura sí llama a PATCH y POST, y deja la base configurada', async () => {
  const api = crearApiFalsa();
  const { codigo } = await correr(api, {});
  assert.equal(codigo, 0);
  assert.ok(api.llamadas.includes('PATCH'));
  assert.equal(api.llamadas.filter((m) => m === 'POST').length, 2);
  assert.ok(evaluarVerificacion({
    base: { pitr: api.estado.pitr, proteccion: api.estado.proteccion, versionRetentionPeriod: '604800s' },
    programaciones: api.estado.programaciones,
  }).every((x) => x.pasa));
});

test('flujo: con un conflicto, --dry-run muestra los cambios y no escribe; sale con 2', async () => {
  const ajena = { name: 'projects/puntosnb/databases/(default)/backupSchedules/x', retention: '86400s', dailyRecurrence: {} };
  const api = crearApiFalsa({ programaciones: [ajena], soloLectura: true });
  const { codigo, texto } = await correr(api, { simular: true });
  assert.equal(codigo, 2);
  assert.match(texto, /Conflictos/);
  assert.match(texto, /pointInTimeRecoveryEnablement/);
  assert.match(texto, /Crear la programación semanal/);
  assert.ok(api.llamadas.every((m) => m === 'GET'));
});

test('flujo: con un conflicto, la base queda protegida, se crea la otra programación y sale con 2', async () => {
  const ajena = { name: 'projects/puntosnb/databases/(default)/backupSchedules/x', retention: '86400s', dailyRecurrence: {} };
  const api = crearApiFalsa({ programaciones: [ajena] });
  const { codigo, texto } = await correr(api, {});
  assert.equal(codigo, 2);
  assert.equal(api.estado.pitr, true);
  assert.equal(api.estado.proteccion, true);
  assert.deepEqual(api.llamadas.filter((m) => m === 'POST'), ['POST']);
  assert.ok(api.estado.programaciones.some((p) => p.weeklyRecurrence?.day === 'SUNDAY'));
  assert.ok(api.estado.programaciones.some((p) => p.name.endsWith('/x')), 'la ajena sigue intacta');
  assert.match(texto, /1 conflicto\(s\) sin resolver/);
});

test('flujo: tras aplicar, si el estado final no pasa los cuatro primeros puntos, sale con 1', async () => {
  const api = crearApiFalsa({ ignorarPatch: true });
  const { codigo, texto } = await correr(api, {});
  assert.equal(codigo, 1);
  assert.match(texto, /Verificación del estado resultante/);
  assert.match(texto, /FALLA\s+PITR activo/);
  assert.match(texto, /FALLA\s+Protección contra borrado activa/);
});

test('flujo: la retención de versiones sin reflejar se informa pero NO cambia el código de salida', async () => {
  const api = crearApiFalsa({ retencionRezagada: true });
  const { codigo, texto } = await correr(api, {});
  assert.equal(codigo, 0);
  assert.match(texto, /FALLA\s+Retención de versiones/);
  assert.match(texto, /puede tardar en reflejarse/);
  assert.match(texto, /PASA\s+PITR activo/);
});

test('flujo: aplicar completo sale con 0 y todos los puntos pasan', async () => {
  const { codigo, texto } = await correr(crearApiFalsa(), {});
  assert.equal(codigo, 0);
  assert.ok(!/FALLA/.test(texto));
});

test('verificar: cada punto trae su clave', () => {
  assert.deepEqual(
    evaluarVerificacion(encendido()).map((x) => x.clave),
    ['pitr', 'proteccion', 'diaria', 'semanal', 'retencion']
  );
});

test('clavesEnConflicto señala solo la clase ocupada por una programación ajena', () => {
  const estado = encendido();
  estado.programaciones = [{ name: 'a', retention: '86400s', dailyRecurrence: {} }, { ...SEMANAL }];
  assert.deepEqual(clavesEnConflicto(estado), ['diaria']);
  assert.deepEqual(clavesEnConflicto(encendido()), []);
  assert.deepEqual(clavesEnConflicto(apagado()), []);
});

test('flujo: revertir de verdad llama a PATCH y DELETE', async () => {
  const api = crearApiFalsa(ACTIVADA());
  const { codigo } = await correr(api, { revertir: true, confirmarRevertir: true });
  assert.equal(codigo, 0);
  assert.ok(api.llamadas.includes('PATCH'));
  assert.equal(api.llamadas.filter((m) => m === 'DELETE').length, 2);
  assert.equal(api.estado.pitr, false);
  assert.deepEqual(api.estado.programaciones, []);
});
