/**
 * Calendario del negocio: Bolivia, `America/La_Paz` (UTC−4, sin horario de verano).
 *
 * Las Cloud Functions corren en UTC y el navegador del usuario en la zona que tenga el
 * aparato. Partir un instante en año y mes con los métodos locales de `Date` da, por tanto,
 * una respuesta distinta en cada lado: el 30-sep a las 20:00 de Bolivia el servidor ya
 * creía estar en octubre y declaraba impago a un comercio con el mes pagado.
 *
 * Este módulo es la única forma admitida de pasar de un instante a un campo de calendario
 * del negocio. Las marcas de tiempo absolutas (`createdAt`, `fechaHora`, vencimientos por
 * duración) NO pasan por aquí: no tienen zona.
 *
 * ADVERTENCIA: este archivo existe por duplicado, byte a byte, en
 *   - `functions/src/comun/fechaBolivia.ts`
 *   - `src/utils/fechaBolivia.ts`
 * porque `functions/` salió del espacio de trabajo de pnpm (commit 336361a) y los dos
 * lados ya no comparten módulos. Si cambia uno, cambie el otro: la prueba
 * `src/__tests__/consistency/fechaBolivia.test.ts` falla si difieren.
 */
export const ZONA_NEGOCIO = 'America/La_Paz';

const CAMPOS = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_NEGOCIO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface CamposCalendario {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

/** Descompone un instante en los campos de calendario de la zona del negocio. */
function camposEnZona(instante: Date): CamposCalendario {
  const campos: CamposCalendario = { anio: 0, mes: 1, dia: 1, hora: 0, minuto: 0, segundo: 0 };
  for (const parte of CAMPOS.formatToParts(instante)) {
    const valor = Number(parte.value);
    switch (parte.type) {
      case 'year': campos.anio = valor; break;
      case 'month': campos.mes = valor; break;
      case 'day': campos.dia = valor; break;
      case 'hour': campos.hora = valor; break;
      case 'minute': campos.minuto = valor; break;
      case 'second': campos.segundo = valor; break;
      default: break;
    }
  }
  return campos;
}

/**
 * Desfase de la zona del negocio respecto de UTC, en milisegundos, para ese instante.
 * Para Bolivia son −14 400 000 ms (−4 h) desde 1932; se mide en vez de fijarse para que un
 * cambio futuro de la zona no pase inadvertido. La prueba lo afirma explícitamente.
 */
export function desfaseZonaMs(instante: Date): number {
  const c = camposEnZona(instante);
  const comoSiFueraUtc = Date.UTC(c.anio, c.mes - 1, c.dia, c.hora, c.minuto, c.segundo);
  return comoSiFueraUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/** Mes del negocio al que pertenece el instante, en el formato `YYYY-MM` de `mesesPagados`. */
export function claveDelMes(instante: Date = new Date()): string {
  const c = camposEnZona(instante);
  return `${c.anio}-${String(c.mes).padStart(2, '0')}`;
}

/** Aritmética de meses sobre la clave `YYYY-MM`. No depende de ninguna zona. */
export function sumarMeses(clave: string, meses: number): string {
  const anio = Number(clave.slice(0, 4));
  const mes = Number(clave.slice(5, 7));
  const total = anio * 12 + (mes - 1) + meses;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Último milisegundo del mes `YYYY-MM` en la zona del negocio, como instante absoluto. */
export function finDeMes(clave: string): number {
  const siguiente = sumarMeses(clave, 1);
  const anio = Number(siguiente.slice(0, 4));
  const mes = Number(siguiente.slice(5, 7));
  const tentativo = Date.UTC(anio, mes - 1, 1, 0, 0, 0, 0);
  return tentativo - desfaseZonaMs(new Date(tentativo)) - 1;
}

/**
 * Fin del período prepagado: 0 si el mes corriente no figura pagado, y si no, el último
 * instante del último mes consecutivo pagado a partir del corriente.
 */
export function finDelPeriodoPagado(mesesPagados: readonly string[], ahora: Date = new Date()): number {
  const pagados = new Set(mesesPagados);
  let clave = claveDelMes(ahora);
  if (!pagados.has(clave)) return 0;
  for (;;) {
    const siguiente = sumarMeses(clave, 1);
    if (!pagados.has(siguiente)) break;
    clave = siguiente;
  }
  return finDeMes(clave);
}
