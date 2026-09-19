#!/usr/bin/env node
/**
 * Asigna (o revoca) el rol de superadministrador desde el servidor.
 *
 * Sustituye a la asignación que hacía el cliente con la lista `SUPER_ADMIN_EMAILS`
 * incrustada en el bundle (hallazgo H-09). Usa el Admin SDK con credenciales por
 * defecto de la aplicación (ADC): no lee ni escribe ninguna credencial en disco.
 *
 * Es idempotente: si el usuario ya tiene el rol, no escribe nada.
 *
 * Uso:
 *   node scripts/admin/set-superadmin.mjs --project puntosnb --email persona@dominio.com --dry-run
 *   node scripts/admin/set-superadmin.mjs --project puntosnb --email persona@dominio.com
 *   node scripts/admin/set-superadmin.mjs --project puntosnb --email persona@dominio.com --revocar
 *
 * A partir de la Fase 1 este script fijará además el custom claim `rol`.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const bandera = (n) => args.includes(`--${n}`);

const projectId = opt('project');
const email = opt('email')?.toLowerCase().trim();
const dryRun = bandera('dry-run');
const revocar = bandera('revocar');
const rolDestino = revocar ? 'cliente' : 'superadmin';

if (!projectId || !email) {
  console.error('Uso: --project <id> --email <correo> [--revocar] [--dry-run]');
  process.exit(1);
}

const mask = (v) => {
  const [u, d] = v.split('@');
  const m = (s) => (s.length <= 2 ? s[0] + '*' : s[0] + '*'.repeat(s.length - 2) + s.at(-1));
  return `${m(u)}@${d}`;
};

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const auth = getAuth();

console.log(`Proyecto: ${projectId} · Cuenta: ${mask(email)} · Rol destino: ${rolDestino}${dryRun ? ' · SIMULACIÓN' : ''}`);

let usuarioAuth;
try {
  usuarioAuth = await auth.getUserByEmail(email);
} catch {
  console.error(`No existe una cuenta de Firebase Auth con ese correo en ${projectId}.`);
  console.error('La persona debe iniciar sesión al menos una vez antes de recibir el rol.');
  process.exit(2);
}

const ref = db.collection('users').doc(usuarioAuth.uid);
const snap = await ref.get();

if (!snap.exists) {
  console.error(`La cuenta existe en Auth (uid ${usuarioAuth.uid.slice(0, 8)}…) pero no tiene documento en users.`);
  console.error('Debe iniciar sesión una vez en la aplicación para que se cree su perfil.');
  process.exit(3);
}

const rolActual = snap.data()?.rol ?? '(sin rol)';
if (rolActual === rolDestino) {
  console.log(`Sin cambios: la cuenta ya tiene el rol "${rolDestino}".`);
  process.exit(0);
}

console.log(`Cambio previsto: "${rolActual}" → "${rolDestino}" (uid ${usuarioAuth.uid.slice(0, 8)}…)`);

if (dryRun) {
  console.log('Simulación: no se escribió nada.');
  process.exit(0);
}

await ref.update({ rol: rolDestino, rolActualizadoEn: FieldValue.serverTimestamp() });
console.log(`Hecho. Rol actualizado a "${rolDestino}".`);
console.log('La persona debe cerrar y volver a abrir sesión para que la aplicación tome el cambio.');
