import { describe, it, expect } from 'vitest';
import type { CobroPrepago } from '../../types';

describe('Lógica de Cobranzas Prepago y Doble Digitación', () => {
  const calcularDetalleCobro = (
    montoTotal: number,
    mesesSeleccionados: string[],
    mensualidadComercioBs: number,
    costoPorPremioBs: number
  ) => {
    const costoMeses = mesesSeleccionados.length * mensualidadComercioBs;
    if (montoTotal < costoMeses) {
      throw new Error(`El monto total (Bs. ${montoTotal}) no cubre los meses seleccionados (Bs. ${costoMeses})`);
    }

    const saldoPremios = montoTotal - costoMeses;
    const cantidadPremios = Math.floor(saldoPremios / costoPorPremioBs);

    return {
      montoMensualidad: costoMeses,
      montoPremios: saldoPremios,
      cantidadPremios,
    };
  };

  const puedeEliminarOModificarCobro = (cobro: CobroPrepago): { permitido: boolean; razon?: string } => {
    if (cobro.estado === 'VERIFICADO') {
      return { permitido: false, razon: 'El cobro ya ha sido verificado y conciliado por el SuperAdmin' };
    }
    if ((cobro.consumidoPremiosBs || 0) > 0) {
      return { permitido: false, razon: 'El comercio ya ha consumido premios asociados a este depósito' };
    }
    return { permitido: true };
  };

  const getMesesConsecutivosDisponibles = (mesesPagadosActuales: string[], fechaActual: Date = new Date()): string[] => {
    const anioActual = fechaActual.getFullYear();
    const mesActual = fechaActual.getMonth() + 1;
    const mesActualStr = `${anioActual}-${mesActual.toString().padStart(2, '0')}`;

    // Determinar inicio: el mes actual o el siguiente al último mes pagado si este es futuro
    let inicioAnio = anioActual;
    let inicioMes = mesActual;

    if (mesesPagadosActuales && mesesPagadosActuales.length > 0) {
      const sortedMeses = [...mesesPagadosActuales].sort();
      const ultimoMesPagado = sortedMeses[sortedMeses.length - 1];
      if (ultimoMesPagado >= mesActualStr) {
        const [uAnio, uMes] = ultimoMesPagado.split('-').map(Number);
        if (uMes === 12) {
          inicioAnio = uAnio + 1;
          inicioMes = 1;
        } else {
          inicioAnio = uAnio;
          inicioMes = uMes + 1;
        }
      }
    }

    const mesesDisponibles: string[] = [];
    let curAnio = inicioAnio;
    let curMes = inicioMes;

    for (let i = 0; i < 12; i++) {
      mesesDisponibles.push(`${curAnio}-${curMes.toString().padStart(2, '0')}`);
      if (curMes === 12) {
        curAnio++;
        curMes = 1;
      } else {
        curMes++;
      }
    }

    return mesesDisponibles;
  };

  it('Debe calcular correctamente la partición entre mensualidad y premios', () => {
    const res = calcularDetalleCobro(100.0, ['2026-08', '2026-09'], 25.0, 1.25);
    expect(res.montoMensualidad).toBe(50.0);
    expect(res.montoPremios).toBe(50.0);
    expect(res.cantidadPremios).toBe(40);
  });

  it('Debe arrojar error si el depósito no cubre las mensualidades seleccionadas', () => {
    expect(() => {
      calcularDetalleCobro(40.0, ['2026-08', '2026-09'], 25.0, 1.25);
    }).toThrow('no cubre los meses seleccionados');
  });

  it('Debe permitir modificar/eliminar cobro solo antes de conciliación y sin consumo', () => {
    const cobroPendiente: CobroPrepago = {
      id: 'c1',
      comercioId: 'com1',
      nombreComercio: 'Alpha',
      nitRut: '111222',
      recibeFactura: true,
      contadorId: 'cont1',
      contadorAlias: 'Contador',
      fechaHora: Date.now(),
      montoTotal: 100,
      mesesPagados: ['2026-08'],
      montoMensualidad: 25,
      montoPremios: 75,
      cantidadPremiosEquivalentes: 60,
      codigoDeposito: 'DEP-01',
      comprobanteUrl: '',
      estado: 'PENDIENTE_VERIFICACION',
      consumidoPremiosBs: 0
    };

    expect(puedeEliminarOModificarCobro(cobroPendiente).permitido).toBe(true);

    const cobroVerificado: CobroPrepago = { ...cobroPendiente, estado: 'VERIFICADO' };
    expect(puedeEliminarOModificarCobro(cobroVerificado).permitido).toBe(false);

    const cobroConsumido: CobroPrepago = { ...cobroPendiente, consumidoPremiosBs: 2.50 };
    expect(puedeEliminarOModificarCobro(cobroConsumido).permitido).toBe(false);
  });

  it('Debe ofrecer meses consecutivos partiendo desde el mes actual en adelante', () => {
    const fechaTest = new Date(2026, 7, 10); // Agosto 2026
    const meses = getMesesConsecutivosDisponibles([], fechaTest);
    expect(meses[0]).toBe('2026-08');
    expect(meses[1]).toBe('2026-09');
    expect(meses[2]).toBe('2026-10');

    // Si ya pagó agosto y septiembre
    const mesesSiguientes = getMesesConsecutivosDisponibles(['2026-08', '2026-09'], fechaTest);
    expect(mesesSiguientes[0]).toBe('2026-10');
    expect(mesesSiguientes[1]).toBe('2026-11');
  });
});
