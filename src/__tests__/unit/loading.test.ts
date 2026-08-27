import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Comportamiento de Ruedita Móvil de Espera (>= 1 segundo)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('No debe mostrar la ruedita si la operación tarda menos de 1 segundo (<1000ms)', async () => {
    let showSpinner = false;
    let activeOps = 0;
    let timer: any = null;

    const executeFastAction = async () => {
      activeOps += 1;
      if (!timer && activeOps === 1) {
        timer = setTimeout(() => {
          if (activeOps > 0) showSpinner = true;
        }, 1000);
      }

      // Simular operación rápida de 400ms
      await new Promise(resolve => setTimeout(resolve, 400));

      activeOps -= 1;
      if (activeOps === 0 && timer) {
        clearTimeout(timer);
        timer = null;
        showSpinner = false;
      }
    };

    const actionPromise = executeFastAction();
    vi.advanceTimersByTime(400);
    await actionPromise;

    expect(showSpinner).toBe(false);
  });

  it('Debe desplegar la ruedita móvil de espera si la operación se demora más de 1 segundo (>= 1000ms)', async () => {
    let showSpinner = false;
    let activeOps = 0;
    let timer: any = null;

    const executeSlowAction = async () => {
      activeOps += 1;
      if (!timer && activeOps === 1) {
        timer = setTimeout(() => {
          if (activeOps > 0) showSpinner = true;
        }, 1000);
      }

      // Simular operación lenta de 2500ms
      await new Promise(resolve => setTimeout(resolve, 2500));

      activeOps -= 1;
      if (activeOps === 0 && timer) {
        clearTimeout(timer);
        timer = null;
        showSpinner = false;
      }
    };

    const actionPromise = executeSlowAction();

    // Tras 500ms aún no debe aparecer
    vi.advanceTimersByTime(500);
    expect(showSpinner).toBe(false);

    // Al llegar a 1000ms se activa la ruedita
    vi.advanceTimersByTime(500);
    expect(showSpinner).toBe(true);

    // Al completar la operación a los 2500ms se oculta la ruedita
    vi.advanceTimersByTime(1500);
    await actionPromise;
    expect(showSpinner).toBe(false);
  });

  it('Debe calcular correctamente la suma acumulada de puntos para múltiples productos especiales', () => {
    const mockReglas: any[] = [
      { id: 'regla_compra', tipo: 'POR_COMPRA', puntosAOtorgar: 1, activa: true },
      { id: 'regla_prod_1', tipo: 'POR_PRODUCTO', puntosAOtorgar: 15, activa: true },
      { id: 'regla_prod_2', tipo: 'POR_PRODUCTO', puntosAOtorgar: 30, activa: true },
    ];

    const productosSeleccionados = [
      { id: 'regla_prod_1', qty: 2 }, // 2 * 15 = 30 pts
      { id: 'regla_prod_2', qty: 3 }, // 3 * 30 = 90 pts
    ];

    let ptsProductos = 0;
    productosSeleccionados.forEach(prod => {
      const regla = mockReglas.find(r => r.id === prod.id);
      if (regla && regla.activa) {
        ptsProductos += prod.qty * (regla.puntosAOtorgar || 0);
      }
    });

    expect(ptsProductos).toBe(120); // 30 + 90 = 120 pts
  });
});
