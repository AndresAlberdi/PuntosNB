/**
 * Pruebas del calendario del negocio (`America/La_Paz`). Son puras: no necesitan emuladores.
 *
 * Todos los instantes se escriben en ISO con `Z`, que es el mismo instante en cualquier máquina:
 * así la prueba no depende del huso del proceso (se corre con `TZ=UTC`, `TZ=America/La_Paz` y
 * `TZ=Pacific/Kiritimati` y debe dar lo mismo).
 */
import { describe, it, expect } from 'vitest';
import { claveDelMes, desfaseZonaMs, finDeMes, finDelPeriodoPagado, sumarMeses } from './fechaBolivia';
import { estadoPrepago, type Comercio } from './negocio';
import { operativoHasta } from './comercio';

const iso = (texto: string): Date => new Date(texto);

describe('claveDelMes', () => {
  it('19:59 de Bolivia del 30-sep sigue siendo septiembre', () => {
    expect(claveDelMes(iso('2026-09-30T23:59:59Z'))).toBe('2026-09');
  });

  it('el 1-oct 00:00 UTC es todavía el 30-sep en Bolivia (la prueba del error reportado)', () => {
    expect(claveDelMes(iso('2026-10-01T00:00:00Z'))).toBe('2026-09');
  });

  it('el último milisegundo de septiembre en Bolivia', () => {
    expect(claveDelMes(iso('2026-10-01T03:59:59.999Z'))).toBe('2026-09');
  });

  it('el primer instante de octubre en Bolivia', () => {
    expect(claveDelMes(iso('2026-10-01T04:00:00Z'))).toBe('2026-10');
  });

  it('el primer instante del año en Bolivia', () => {
    expect(claveDelMes(iso('2027-01-01T03:59:59.999Z'))).toBe('2026-12');
    expect(claveDelMes(iso('2027-01-01T04:00:00Z'))).toBe('2027-01');
  });
});

describe('desfaseZonaMs', () => {
  it('Bolivia está siempre en UTC−4: no hay horario de verano ni cambio de datos de zona', () => {
    expect(desfaseZonaMs(iso('2026-01-15T12:00:00Z'))).toBe(-14_400_000);
    expect(desfaseZonaMs(iso('2026-07-15T12:00:00Z'))).toBe(-14_400_000);
  });
});

describe('finDeMes', () => {
  it('septiembre termina el 1-oct a las 03:59:59.999 UTC', () => {
    expect(finDeMes('2026-09')).toBe(Date.parse('2026-10-01T03:59:59.999Z'));
  });

  it('diciembre cruza de año', () => {
    expect(finDeMes('2026-12')).toBe(Date.parse('2027-01-01T03:59:59.999Z'));
  });

  it('febrero bisiesto', () => {
    expect(finDeMes('2028-02')).toBe(Date.parse('2028-03-01T03:59:59.999Z'));
  });
});

describe('sumarMeses', () => {
  it('suma y resta sobre la clave, cruzando años', () => {
    expect(sumarMeses('2026-12', 1)).toBe('2027-01');
    expect(sumarMeses('2026-12', 3)).toBe('2027-03');
    expect(sumarMeses('2026-12', -1)).toBe('2026-11');
    expect(sumarMeses('2026-01', -1)).toBe('2025-12');
  });

  it('sumar cero no cambia la clave', () => {
    expect(sumarMeses('2026-09', 0)).toBe('2026-09');
  });
});

describe('finDelPeriodoPagado', () => {
  const ahora = iso('2026-09-15T12:00:00Z');

  it('sin meses pagados es 0', () => {
    expect(finDelPeriodoPagado([], ahora)).toBe(0);
  });

  it('con el mes corriente impago es 0', () => {
    expect(finDelPeriodoPagado(['2026-10'], ahora)).toBe(0);
  });

  it('solo el mes corriente: termina con el corriente', () => {
    expect(finDelPeriodoPagado(['2026-09'], ahora)).toBe(finDeMes('2026-09'));
  });

  it('una racha de tres meses termina con el tercero', () => {
    expect(finDelPeriodoPagado(['2026-09', '2026-10', '2026-11'], ahora)).toBe(finDeMes('2026-11'));
  });

  it('con un hueco se detiene antes del hueco', () => {
    expect(finDelPeriodoPagado(['2026-09', '2026-11'], ahora)).toBe(finDeMes('2026-09'));
  });
});

const prepago = (mesesPagados: string[]): Comercio => ({
  modalidadPago: 'PREPAGO',
  mesesPagados,
  saldoPremiosBs: 10,
});

describe('estadoPrepago en el borde del mes', () => {
  it('el 30-sep a las 20:00 de Bolivia, con septiembre pagado, puede operar (la regresión reportada)', () => {
    const ahora = iso('2026-10-01T00:00:00Z');
    expect(estadoPrepago(prepago(['2026-09']), ahora).puedeOperar).toBe(true);
    expect(operativoHasta(prepago(['2026-09']), ahora)).toBeGreaterThan(ahora.getTime());
  });

  it('desde las 00:00 de Bolivia del 1-oct, con octubre impago, no puede operar', () => {
    expect(estadoPrepago(prepago(['2026-09']), iso('2026-10-01T04:00:00Z')).puedeOperar).toBe(false);
  });
});

describe('invariante: puedeOperar equivale a operativoHasta >= ahora', () => {
  const instantes = [
    '2026-10-01T00:00:00Z',
    '2026-10-01T03:59:59.999Z',
    '2026-10-01T04:00:00Z',
    '2026-09-30T23:59:59Z',
  ];
  const configuraciones = [[], ['2026-09'], ['2026-10'], ['2026-09', '2026-10'], ['2026-09', '2026-11']];

  for (const instante of instantes) {
    for (const meses of configuraciones) {
      it(`${instante} con mesesPagados=${JSON.stringify(meses)}`, () => {
        const t = iso(instante);
        const c = prepago(meses);
        expect(estadoPrepago(c, t).puedeOperar).toBe((operativoHasta(c, t) as number) >= t.getTime());
      });
    }
  }
});

describe('último milisegundo del mes', () => {
  // Único punto donde la equivalencia estricta `> ahora` no coincide con `estadoPrepago`: en el
  // instante exacto `operativoHasta` el mes todavía es el corriente (puede operar), pero la
  // comparación estricta `hasta > ahora` ya da falso. La interfaz usa `>`; la diferencia es de
  // 1 ms. Si se decide cerrarla, debe ser un cambio de diseño explícito (ver informe del PR).
  it('en el instante exacto del fin de mes el servidor aún permite operar', () => {
    const t = iso('2026-10-01T03:59:59.999Z');
    const c = prepago(['2026-09']);
    expect(estadoPrepago(c, t).puedeOperar).toBe(true);
    expect(operativoHasta(c, t)).toBe(t.getTime());
  });
});

describe('PILOTO', () => {
  it('no tiene fin de período y siempre puede operar', () => {
    const piloto: Comercio = { modalidadPago: 'PILOTO' };
    for (const instante of ['2026-10-01T00:00:00Z', '2026-10-01T04:00:00Z', '2027-01-01T03:59:59.999Z']) {
      expect(operativoHasta(piloto, iso(instante))).toBeNull();
      expect(estadoPrepago(piloto, iso(instante)).puedeOperar).toBe(true);
    }
  });
});
