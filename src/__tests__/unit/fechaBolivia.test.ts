/**
 * Pruebas del calendario del negocio (`America/La_Paz`) en la copia del navegador, y de las
 * decisiones de la interfaz que dependen de él. Los instantes se escriben en ISO con `Z`, que es
 * el mismo instante en cualquier máquina: la prueba no depende del huso (`npm run test:tz`).
 */
import { describe, it, expect } from 'vitest';
import type { Comercio } from '../../types';
import {
  claveDelMes,
  desfaseZonaMs,
  finDeMes,
  finDelPeriodoPagado,
  sumarMeses,
} from '../../utils/fechaBolivia';
import { checkComercioPrepagoStatus, mesesConsecutivosAPagar } from '../../utils/reports';

const iso = (texto: string): Date => new Date(texto);

const prepago = (mesesPagados: string[]): Comercio => ({
  id: 'c1',
  nombre: 'Comercio',
  nit_rut: '1',
  reglas: [],
  premios: [],
  createdAt: 0,
  modalidadPago: 'PREPAGO',
  mesesPagados,
  saldoPremiosBs: 10,
});

describe('claveDelMes', () => {
  it('19:59 de Bolivia del 30-sep sigue siendo septiembre', () => {
    expect(claveDelMes(iso('2026-09-30T23:59:59Z'))).toBe('2026-09');
  });

  it('el 1-oct 00:00 UTC es todavía el 30-sep en Bolivia', () => {
    expect(claveDelMes(iso('2026-10-01T00:00:00Z'))).toBe('2026-09');
  });

  it('el último milisegundo de septiembre en Bolivia', () => {
    expect(claveDelMes(iso('2026-10-01T03:59:59.999Z'))).toBe('2026-09');
  });

  it('el primer instante de octubre en Bolivia', () => {
    expect(claveDelMes(iso('2026-10-01T04:00:00Z'))).toBe('2026-10');
  });
});

describe('desfaseZonaMs', () => {
  it('Bolivia está siempre en UTC−4', () => {
    expect(desfaseZonaMs(iso('2026-01-15T12:00:00Z'))).toBe(-14_400_000);
    expect(desfaseZonaMs(iso('2026-07-15T12:00:00Z'))).toBe(-14_400_000);
  });
});

describe('finDeMes y sumarMeses', () => {
  it('fin de septiembre, de diciembre (cruce de año) y de febrero bisiesto', () => {
    expect(finDeMes('2026-09')).toBe(Date.parse('2026-10-01T03:59:59.999Z'));
    expect(finDeMes('2026-12')).toBe(Date.parse('2027-01-01T03:59:59.999Z'));
    expect(finDeMes('2028-02')).toBe(Date.parse('2028-03-01T03:59:59.999Z'));
  });

  it('suma y resta meses sobre la clave', () => {
    expect(sumarMeses('2026-12', 1)).toBe('2027-01');
    expect(sumarMeses('2026-12', 3)).toBe('2027-03');
    expect(sumarMeses('2026-12', -1)).toBe('2026-11');
    expect(sumarMeses('2026-01', -1)).toBe('2025-12');
    expect(sumarMeses('2026-09', 0)).toBe('2026-09');
  });
});

describe('finDelPeriodoPagado', () => {
  const ahora = iso('2026-09-15T12:00:00Z');

  it('devuelve 0 sin meses pagados o con el mes corriente impago', () => {
    expect(finDelPeriodoPagado([], ahora)).toBe(0);
    expect(finDelPeriodoPagado(['2026-10'], ahora)).toBe(0);
  });

  it('termina con el último mes de la racha consecutiva y se detiene en un hueco', () => {
    expect(finDelPeriodoPagado(['2026-09'], ahora)).toBe(finDeMes('2026-09'));
    expect(finDelPeriodoPagado(['2026-09', '2026-10', '2026-11'], ahora)).toBe(finDeMes('2026-11'));
    expect(finDelPeriodoPagado(['2026-09', '2026-11'], ahora)).toBe(finDeMes('2026-09'));
  });
});

describe('checkComercioPrepagoStatus en el borde del mes', () => {
  const borde = iso('2026-10-01T00:00:00Z'); // 30-sep 20:00 en Bolivia

  it('con datos privados y septiembre pagado puede operar', () => {
    const estado = checkComercioPrepagoStatus(prepago(['2026-09']), borde);
    expect(estado.puedeOperar).toBe(true);
    expect(estado.mesActualKey).toBe('2026-09');
  });

  it('con octubre impago deja de operar desde las 00:00 de Bolivia del 1-oct', () => {
    expect(checkComercioPrepagoStatus(prepago(['2026-09']), iso('2026-10-01T04:00:00Z')).puedeOperar).toBe(false);
  });

  it('la rama con datos privados y la de señales públicas coinciden en el borde', () => {
    const instantes = [
      '2026-09-30T23:59:59Z',
      '2026-10-01T00:00:00Z',
      '2026-10-01T03:59:59.998Z',
      '2026-10-01T04:00:00Z',
    ];
    const configuraciones = [[], ['2026-09'], ['2026-10'], ['2026-09', '2026-10'], ['2026-09', '2026-11']];
    for (const instante of instantes) {
      for (const meses of configuraciones) {
        const t = iso(instante);
        const conPrivados = checkComercioPrepagoStatus(prepago(meses), t);
        const soloPublico: Comercio = {
          id: 'c1',
          nombre: 'Comercio',
          nit_rut: '1',
          reglas: [],
          premios: [],
          createdAt: 0,
          modalidadPago: 'PREPAGO',
          operativoHasta: finDelPeriodoPagado(meses, t),
          puedeCanjearPremios: true,
        };
        expect(checkComercioPrepagoStatus(soloPublico, t).puedeOperar).toBe(conPrivados.puedeOperar);
      }
    }
  });

  it('con la señal pública calculada por el servidor, el vendedor puede operar en el borde', () => {
    const soloPublico: Comercio = {
      id: 'c1',
      nombre: 'Comercio',
      nit_rut: '1',
      reglas: [],
      premios: [],
      createdAt: 0,
      modalidadPago: 'PREPAGO',
      operativoHasta: finDeMes('2026-09'),
      puedeCanjearPremios: true,
    };
    expect(checkComercioPrepagoStatus(soloPublico, borde).puedeOperar).toBe(true);
  });
});

describe('mesesConsecutivosAPagar', () => {
  const borde = iso('2026-10-01T00:00:00Z'); // 30-sep 20:00 en Bolivia

  it('con septiembre pagado en el borde, el primer mes ofrecido es octubre y no noviembre', () => {
    expect(mesesConsecutivosAPagar(['2026-09'], 2, borde)).toEqual(['2026-10', '2026-11']);
  });

  it('sin nada pagado arranca en el mes corriente del negocio', () => {
    expect(mesesConsecutivosAPagar([], 1, borde)).toEqual(['2026-09']);
  });

  it('cruza de año', () => {
    expect(mesesConsecutivosAPagar(['2026-12'], 2, iso('2026-12-15T12:00:00Z'))).toEqual(['2027-01', '2027-02']);
  });
});
