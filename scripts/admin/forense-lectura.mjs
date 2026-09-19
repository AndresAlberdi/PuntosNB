#!/usr/bin/env node
/**
 * Revisión forense de SOLO LECTURA (Fase 0 del plan de hardening).
 *
 * No escribe nada: únicamente lee Firestore y Firebase Auth con el Admin SDK y
 * credenciales por defecto de la aplicación (ADC). Enmascara todo dato personal:
 * nunca imprime correos completos, teléfonos ni PIN.
 *
 * Uso:
 *   node scripts/admin/forense-lectura.mjs --project puntosnb
 *   node scripts/admin/forense-lectura.mjs --project hipatia-puntos --json informe.json
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, def) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const projectId = opt('project');
const salidaJson = opt('json');
if (!projectId) {
  console.error('Falta --project <id>. Ejemplo: --project puntosnb');
  process.exit(1);
}

const ROLES_PRIVILEGIADOS = ['superadmin', 'contador', 'admin_comercio', 'influencer'];

/** Enmascara un correo: a****s@g****.com */
const mask = (v) => {
  if (typeof v !== 'string' || !v) return '(vacío)';
  const [u, d] = v.split('@');
  const m = (s) => (s.length <= 2 ? s[0] + '*' : s[0] + '*'.repeat(Math.max(1, s.length - 2)) + s.at(-1));
  return d ? `${m(u)}@${m(d.split('.')[0])}.${d.split('.').slice(1).join('.')}` : m(v);
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const redondear = (v) => Math.round(v * 100) / 100;

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const auth = getAuth();

const leer = async (col) => {
  const snap = await db.collection(col).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

const informe = { proyecto: projectId, generado: new Date().toISOString(), secciones: {} };
const seccion = (titulo, datos) => {
  informe.secciones[titulo] = datos;
  console.log(`\n=== ${titulo} ===`);
};

const [users, comercios, cobros, transacciones, saldos, sesiones] = await Promise.all([
  leer('users'), leer('comercios'), leer('cobros_prepago'),
  leer('transacciones'), leer('puntos_saldos'), leer('sesiones_qr'),
]);

// --- 1. Inventario de roles --------------------------------------------------
const porRol = {};
for (const u of users) porRol[u.rol ?? '(sin rol)'] = (porRol[u.rol ?? '(sin rol)'] ?? 0) + 1;
seccion('1. Usuarios por rol', porRol);
console.table(porRol);

// --- 2. Cuentas privilegiadas ------------------------------------------------
const privilegiados = users
  .filter((u) => ROLES_PRIVILEGIADOS.includes(u.rol))
  .map((u) => ({
    uid: u.id.slice(0, 8) + '…',
    rol: u.rol,
    correo: mask(u.email ?? u.usuario),
    comercioId: u.comercioId ? u.comercioId.slice(0, 8) + '…' : '—',
    estado: u.estado ?? 'activo',
    creado: u.createdAt ? new Date(u.createdAt).toISOString().slice(0, 10) : '—',
  }));
seccion('2. Cuentas con rol privilegiado', privilegiados);
console.table(privilegiados);

// --- 3. Duplicados por correo ------------------------------------------------
const porCorreo = {};
for (const u of users) {
  const clave = (u.email ?? u.usuario ?? '').toLowerCase().trim();
  if (!clave) continue;
  (porCorreo[clave] ??= []).push(u);
}
const duplicados = Object.entries(porCorreo)
  .filter(([, v]) => v.length > 1)
  .map(([k, v]) => ({ correo: mask(k), documentos: v.length, roles: [...new Set(v.map((x) => x.rol))].join(', ') }));
seccion('3. Documentos users duplicados por correo', duplicados);
console.table(duplicados.length ? duplicados : [{ resultado: 'ninguno' }]);

// --- 4. Vendedores: PIN en claro e identidad en Auth --------------------------
const vendedores = users.filter((u) => u.rol === 'vendedor');
const estadoAuth = await Promise.all(
  vendedores.map(async (v) => {
    let enAuth = 'no';
    try { await auth.getUser(v.id); enAuth = 'sí'; } catch { enAuth = 'no'; }
    return {
      uid: v.id.slice(0, 8) + '…',
      correo: mask(v.email ?? v.usuario),
      comercioId: v.comercioId ? v.comercioId.slice(0, 8) + '…' : '—',
      pinEnClaro: v.pin ? `sí (${String(v.pin).length} dígitos)` : 'no',
      cuentaEnFirebaseAuth: enAuth,
      estado: v.estado ?? 'activo',
    };
  })
);
seccion('4. Vendedores (H-04): PIN en claro e identidad verificable', estadoAuth);
console.table(estadoAuth.length ? estadoAuth : [{ resultado: 'sin vendedores' }]);

// --- 5. Prepago: saldo declarado vs montoPremios cobrado ----------------------
const cobrosPorComercio = {};
for (const c of cobros) cobrosPorComercio[c.comercioId] = num(cobrosPorComercio[c.comercioId]) + num(c.montoPremios);
const canjesPorComercio = {};
for (const t of transacciones) if (t.tipo === 'CANJE') canjesPorComercio[t.comercioId] = (canjesPorComercio[t.comercioId] ?? 0) + 1;
const prepago = comercios.map((c) => {
  const acreditado = num(cobrosPorComercio[c.id]);
  const canjes = canjesPorComercio[c.id] ?? 0;
  const consumoEstimado = redondear(canjes * num(c.costoPorPremioBs));
  return {
    comercio: c.nombre ?? c.id,
    modalidad: c.modalidadPago ?? 'PILOTO',
    saldoPremiosBs: redondear(num(c.saldoPremiosBs)),
    cobrosPremiosBs: redondear(acreditado),
    canjes,
    consumoEstimadoBs: consumoEstimado,
    descuadreBs: redondear(num(c.saldoPremiosBs) - (acreditado - consumoEstimado)),
  };
});
seccion('5. Prepago: saldo declarado vs cobros registrados', prepago);
console.table(prepago.length ? prepago : [{ resultado: 'sin comercios' }]);

// --- 6. Saldos de puntos vs libro de transacciones ----------------------------
const esperado = {};
for (const t of transacciones) {
  const clave = `${t.clienteId}_${t.comercioId}`;
  esperado[clave] = (esperado[clave] ?? 0) + num(t.puntos);
}
const descuadres = [];
for (const s of saldos) {
  const clave = `${s.clienteId}_${s.comercioId}`;
  const calc = esperado[clave] ?? 0;
  if (redondear(calc) !== redondear(num(s.saldoTotal))) {
    descuadres.push({
      saldoId: s.id.slice(0, 14) + '…',
      saldoRegistrado: num(s.saldoTotal),
      sumaTransacciones: redondear(calc),
      diferencia: redondear(num(s.saldoTotal) - calc),
    });
  }
}
seccion('6. Saldos de puntos que no cuadran con las transacciones', {
  saldosRevisados: saldos.length, transaccionesRevisadas: transacciones.length, descuadres: descuadres.length, detalle: descuadres,
});
console.log(`Saldos: ${saldos.length} · Transacciones: ${transacciones.length} · Descuadres: ${descuadres.length}`);
console.table(descuadres.slice(0, 20));

// --- 7. Transacciones sin vendedor válido -------------------------------------
const porUid = new Map(users.map((u) => [u.id, u]));
const txSospechosas = transacciones.filter((t) => {
  if (t.tipo !== 'ACUMULACION' && t.tipo !== 'CANJE') return false;
  if (!t.vendedorId) return true;
  const v = porUid.get(t.vendedorId);
  return !v || (v.comercioId && t.comercioId && v.comercioId !== t.comercioId);
}).map((t) => ({ tx: t.id.slice(0, 10) + '…', tipo: t.tipo, fecha: t.fechaHora ? new Date(t.fechaHora).toISOString().slice(0, 10) : '—', puntos: num(t.puntos), motivo: !t.vendedorId ? 'sin vendedorId' : 'vendedor inexistente o de otro comercio' }));
seccion('7. Transacciones sin vendedor válido de su comercio', txSospechosas);
console.log(`Sospechosas: ${txSospechosas.length} de ${transacciones.length}`);
console.table(txSospechosas.slice(0, 20));

// --- 8. Sesiones QR -----------------------------------------------------------
const porEstado = {};
for (const s of sesiones) porEstado[s.estado ?? '(sin estado)'] = (porEstado[s.estado ?? '(sin estado)'] ?? 0) + 1;
const antiguas = sesiones.filter((s) => s.estado === 'PENDIENTE' && num(s.createdAt) < Date.now() - 24 * 3600 * 1000).length;
seccion('8. Sesiones QR', { total: sesiones.length, porEstado, pendientesConMasDe24h: antiguas });
console.table({ total: sesiones.length, ...porEstado, pendientesConMasDe24h: antiguas });

if (salidaJson) {
  writeFileSync(salidaJson, JSON.stringify(informe, null, 2));
  console.log(`\nInforme JSON escrito en ${salidaJson}`);
}
console.log('\nRevisión de solo lectura terminada. No se escribió ningún dato.');
process.exit(0);
