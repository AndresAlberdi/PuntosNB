import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let testEnv: RulesTestEnvironment | undefined;

describe('Reglas de Seguridad Firestore', () => {
  beforeAll(async () => {
    const rulesPath = resolve(__dirname, '../../../firestore.rules');
    
    let rulesStr = '';
    try {
      rulesStr = readFileSync(rulesPath, 'utf8');
    } catch(e) {
      console.warn("No se pudo cargar el archivo original de reglas para pruebas.");
    }

    try {
      testEnv = await initializeTestEnvironment({
        projectId: 'hipatia-puntos',
        firestore: {
          host: '127.0.0.1',
          port: 8080,
          rules: rulesStr || `
            rules_version = '2';
            service cloud.firestore {
              match /databases/{database}/documents {
                match /{document=**} {
                  allow read, write: if false;
                }
              }
            }
          `,
        },
      });
    } catch (e) {
      console.warn("No se pudo conectar al emulador de Firestore en 127.0.0.1:8080.");
    }
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();
    }
  });

  it('No debería permitir acceso a usuarios no autenticados', async (ctx) => {
    if (!testEnv) {
      ctx.skip();
      return;
    }
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    await expect(
      unauthedDb.collection('users').doc('user1').get()
    ).rejects.toThrow();
  });

  it('Un cliente autenticado debería poder leer su propio documento', async (ctx) => {
    if (!testEnv) {
      ctx.skip();
      return;
    }
    const authedDb = testEnv.authenticatedContext('cliente1', { email: 'cliente@test.com' }).firestore();
    await expect(
      authedDb.collection('users').doc('cliente1').get()
    ).resolves.not.toThrow();
  });

  it('Un cliente NO debería poder leer el documento de otro usuario', async (ctx) => {
    if (!testEnv) {
      ctx.skip();
      return;
    }
    const authedDb = testEnv.authenticatedContext('cliente1', { email: 'cliente@test.com' }).firestore();
    await expect(
      authedDb.collection('users').doc('cliente2').get()
    ).rejects.toThrow();
  });

  it('Un cliente debería poder registrar una transacción propia de acumulación', async (ctx) => {
    if (!testEnv) {
      ctx.skip();
      return;
    }
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('cliente1').set({ rol: 'cliente' });
    });

    const authedDb = testEnv.authenticatedContext('cliente1', { email: 'cliente@test.com' }).firestore();
    await expect(
      authedDb.collection('transacciones').add({
        clienteId: 'cliente1',
        tipo: 'ACUMULACION',
        puntos: 10
      })
    ).resolves.not.toThrow();
  });

  it('Un cliente NO debería poder registrar una transacción ajena', async (ctx) => {
    if (!testEnv) {
      ctx.skip();
      return;
    }
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('cliente1').set({ rol: 'cliente' });
    });

    const authedDb = testEnv.authenticatedContext('cliente1', { email: 'cliente@test.com' }).firestore();
    await expect(
      authedDb.collection('transacciones').add({
        clienteId: 'cliente2',
        tipo: 'ACUMULACION',
        puntos: 10
      })
    ).rejects.toThrow();
  });

  it('Un cliente debería poder crear y actualizar su propio saldo de puntos', async (ctx) => {
    if (!testEnv) {
      ctx.skip();
      return;
    }
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('cliente1').set({ rol: 'cliente' });
    });

    const authedDb = testEnv.authenticatedContext('cliente1', { email: 'cliente@test.com' }).firestore();
    const docRef = authedDb.collection('puntos_saldos').doc('cliente1_comercioA');
    
    // Crear propio saldo
    await expect(
      docRef.set({
        clienteId: 'cliente1',
        comercioId: 'comercioA',
        saldoTotal: 10
      })
    ).resolves.not.toThrow();

    // Actualizar propio saldo
    await expect(
      docRef.update({
        saldoTotal: 20
      })
    ).resolves.not.toThrow();
  });

  it('Un cliente NO debería poder modificar el saldo de puntos de otro usuario', async (ctx) => {
    if (!testEnv) {
      ctx.skip();
      return;
    }
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('cliente1').set({ rol: 'cliente' });
      await db.collection('puntos_saldos').doc('cliente2_comercioA').set({
        clienteId: 'cliente2',
        comercioId: 'comercioA',
        saldoTotal: 50
      });
    });

    const authedDb = testEnv.authenticatedContext('cliente1', { email: 'cliente@test.com' }).firestore();
    const docRef = authedDb.collection('puntos_saldos').doc('cliente2_comercioA');

    await expect(
      docRef.update({
        saldoTotal: 100
      })
    ).rejects.toThrow();
  });

  it('Un cliente debería poder leer un saldo de puntos inexistente', async (ctx) => {
    if (!testEnv) {
      ctx.skip();
      return;
    }
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('cliente1').set({ rol: 'cliente' });
    });

    const authedDb = testEnv.authenticatedContext('cliente1', { email: 'cliente@test.com' }).firestore();
    await expect(
      authedDb.collection('puntos_saldos').doc('cliente1_comercioA').get()
    ).resolves.not.toThrow();
  });
});
