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
});
