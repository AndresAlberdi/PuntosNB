/**
 * Pruebas del calendario del negocio (`America/La_Paz`). Son puras: no necesitan emuladores.
 *
 * Todos los instantes se escriben en ISO con `Z`, que es el mismo instante en cualquier máquina:
 * así la prueba no depende del huso del proceso (se corre con `TZ=UTC`, `TZ=America/La_Paz` y
 * `TZ=Pacific/Kiritimati` y debe dar lo mismo).
 */
import { describe, it, expect } from 'vitest';
import { claveDelMes, desfaseZonaMs, finDeMes, finDelDia, finDelPeriodoPagado, sumarMeses } from './fechaBolivia';
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
  // `operativoHasta` es el ÚLTIMO instante incluido del período, no el primero excluido. Por eso
  // la interfaz lo compara con `>=` y no con `>`: con `>` había un milisegundo —el último del
  // mes— en el que el servidor dejaba operar y la pantalla decía que no.
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

describe('terminación: finDelPeriodoPagado no se cuelga con datos sucios', () => {
  // `sumarMeses` no es monótona para toda entrada: 'NaN-NaN' es un punto fijo y '10000-01'
  // retrocede a '1000-01'. Con un bucle sin tope, cualquiera de las dos lo cuelga para siempre
  // dentro de una transacción, es decir, en una compuerta de autorización. Hoy no es alcanzable
  // —`registrarCobroPrepago` valida con zod y Firestore limita el documento a 1 MiB—, pero la
  // versión anterior terminaba siempre y esa propiedad no se pierde sin más.
  const mesCorriente = claveDelMes(new Date());

  it('una clave que es punto fijo de sumarMeses no lo detiene', () => {
    const inicio = Date.now();
    const r = finDelPeriodoPagado([mesCorriente, 'NaN-NaN'], new Date());
    expect(Date.now() - inicio).toBeLessThan(1000);
    expect(r).toBe(finDeMes(mesCorriente)); // la clave sucia se descarta, no alarga el período
  });

  it('una clave que hace retroceder a sumarMeses no lo detiene', () => {
    const inicio = Date.now();
    const r = finDelPeriodoPagado([mesCorriente, '10000-01'], new Date());
    expect(Date.now() - inicio).toBeLessThan(1000);
    expect(r).toBe(finDeMes(mesCorriente));
  });

  // 50 000 meses son unos 4 166 años: la clave sigue teniendo cuatro dígitos de año y es
  // canónica. Más allá del año 9999 las claves dejan de serlo y el filtro las descarta, que es
  // el comportamiento correcto: la cadena se corta en vez de producir instantes absurdos.
  it('un arreglo enorme de meses consecutivos termina y devuelve el último', () => {
    const muchos = [mesCorriente];
    for (let i = 1; i < 50_000; i++) muchos.push(sumarMeses(mesCorriente, i));
    const inicio = Date.now();
    const r = finDelPeriodoPagado(muchos, new Date());
    expect(Date.now() - inicio).toBeLessThan(10_000);
    expect(r).toBe(finDeMes(sumarMeses(mesCorriente, 49_999)));
  });

  it('una clave con año de cinco dígitos se descarta y corta la cadena', () => {
    const r = finDelPeriodoPagado([mesCorriente, sumarMeses(mesCorriente, 1), '10000-01'], new Date());
    expect(r).toBe(finDeMes(sumarMeses(mesCorriente, 1)));
  });

  it('los meses con formato inválido se descartan y no habilitan nada', () => {
    expect(finDelPeriodoPagado(['', 'xx', '2026-13', '2026-00', '2026-9'], new Date())).toBe(0);
  });
});

describe('finDelDia: el plazo vence al final del día en Bolivia', () => {
  it('un instante del mediodía boliviano vence a las 03:59:59.999Z del día siguiente', () => {
    // 2026-10-15 12:00 en Bolivia = 16:00Z. El fin del día es 2026-10-16 03:59:59.999Z.
    expect(new Date(finDelDia(new Date('2026-10-15T16:00:00Z'))).toISOString())
      .toBe('2026-10-16T03:59:59.999Z');
  });

  it('un instante que en UTC ya es el día siguiente pero en Bolivia no, vence el mismo día', () => {
    // 2026-10-16 01:00Z = 2026-10-15 21:00 en Bolivia: sigue siendo el 15.
    expect(new Date(finDelDia(new Date('2026-10-16T01:00:00Z'))).toISOString())
      .toBe('2026-10-16T03:59:59.999Z');
  });

  it('no depende del huso del proceso', () => {
    const t = new Date('2026-10-15T16:00:00Z');
    expect(finDelDia(t)).toBe(Date.parse('2026-10-16T03:59:59.999Z'));
  });

  it('cruza el fin de mes y el fin de año', () => {
    expect(new Date(finDelDia(new Date('2026-10-31T16:00:00Z'))).toISOString())
      .toBe('2026-11-01T03:59:59.999Z');
    expect(new Date(finDelDia(new Date('2026-12-31T16:00:00Z'))).toISOString())
      .toBe('2027-01-01T03:59:59.999Z');
  });
});
