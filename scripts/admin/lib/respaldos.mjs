/**
 * Lógica pura (sin red, sin disco) de la configuración de respaldos de Firestore: qué debe
 * existir, qué hay, y qué diferencia hay entre ambos.
 *
 * Se separa del script para poder probar con estados simulados en memoria la decisión de qué
 * cambiar, que es la parte que escribe sobre infraestructura real, sin tocar la nube.
 *
 * Forma del «estado» que reciben las funciones (es lo que el script lee de la API):
 *   {
 *     base: { pitr: boolean, proteccion: boolean, earliestVersionTime: string | null, versionRetentionPeriod: string | null },
 *     programaciones: [{ name, retention, dailyRecurrence?, weeklyRecurrence? }]
 *   }
 */

export const PITR_ACTIVO = 'POINT_IN_TIME_RECOVERY_ENABLED';
export const RETENCION_VERSIONES_PITR = '604800s';
export const PITR_INACTIVO = 'POINT_IN_TIME_RECOVERY_DISABLED';
export const PROTECCION_ACTIVA = 'DELETE_PROTECTION_ENABLED';
export const PROTECCION_INACTIVA = 'DELETE_PROTECTION_DISABLED';

/**
 * Las dos programaciones que administra este script: el máximo que admite Firestore (una diaria
 * y una semanal). La retención se compara en segundos.
 */
export const PROGRAMACIONES = [
  {
    clave: 'diaria',
    etiqueta: 'diaria, retención 7 días (604800 s)',
    retentionSegundos: 604800,
    recurrencia: { dailyRecurrence: {} },
  },
  {
    clave: 'semanal',
    etiqueta: 'semanal (domingo), retención 8 semanas (4838400 s)',
    retentionSegundos: 4838400,
    recurrencia: { weeklyRecurrence: { day: 'SUNDAY' } },
  },
];

/** Convierte `"604800s"` (o `"604800.000s"`) en segundos; `NaN` si no tiene ese formato. */
export function segundos(retention) {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(String(retention ?? ''));
  return m ? Number(m[1]) : NaN;
}

/** `true` si la programación es del mismo tipo de recurrencia (con el mismo día, si es semanal). */
function mismaRecurrencia(programacion, definicion) {
  if (definicion.clave === 'diaria') return programacion.dailyRecurrence !== undefined;
  return (
    programacion.weeklyRecurrence !== undefined &&
    programacion.weeklyRecurrence.day === definicion.recurrencia.weeklyRecurrence.day
  );
}

/** `true` si la programación es de la misma clase que `definicion`, sea cual sea su retención. */
function mismaClase(programacion, definicion) {
  if (definicion.clave === 'diaria') return programacion.dailyRecurrence !== undefined;
  return programacion.weeklyRecurrence !== undefined;
}

/** `true` si la programación coincide EXACTAMENTE (recurrencia y retención): es de este script. */
export function esDeEsteScript(programacion, definicion) {
  return (
    mismaRecurrencia(programacion, definicion) &&
    segundos(programacion.retention) === definicion.retentionSegundos
  );
}

/** Último segmento del `name` de una programación (su identificador), para mostrarlo sin la ruta. */
export function ultimoSegmento(name) {
  const partes = String(name ?? '').split('/').filter(Boolean);
  return partes.length ? partes[partes.length - 1] : 'sin nombre';
}

/**
 * Decide qué hay que cambiar para llegar al estado deseado, sin ejecutar nada.
 *
 * Modo `aplicar`:
 *   - PITR y protección contra borrado: se activan si no lo están.
 *   - Cada programación: se crea si no existe; si hay copias idénticas de más, se borran las
 *     sobrantes y se conserva la primera. Si ya existe una de la misma clase pero con otra
 *     retención o día, NO se toca ni se crea otra (Firestore admite una sola diaria y una sola
 *     semanal): se informa como conflicto para que lo resuelva una persona.
 * Modo `revertir`:
 *   - Se borran TODAS las programaciones que coinciden en recurrencia, día y retención con las
 *     de este script, sin importar quién las creó (una programación de Firestore no tiene
 *     etiquetas ni descripción donde marcar la autoría). Las que no coinciden no se tocan. Se
 *     desactivan PITR y la protección si estaban activas.
 *
 * @param {object} estado ver el encabezado del archivo
 * @param {'aplicar'|'revertir'} modo
 * @returns {{ cambios: object[], conflictos: string[] }}
 */
export function planificarCambios(estado, modo) {
  const cambios = [];
  const conflictos = [];
  const programaciones = estado.programaciones ?? [];
  const revertir = modo === 'revertir';

  const campos = {};
  if (revertir) {
    if (estado.base.pitr) campos.pointInTimeRecoveryEnablement = PITR_INACTIVO;
    if (estado.base.proteccion) campos.deleteProtectionState = PROTECCION_INACTIVA;
  } else {
    if (!estado.base.pitr) campos.pointInTimeRecoveryEnablement = PITR_ACTIVO;
    if (!estado.base.proteccion) campos.deleteProtectionState = PROTECCION_ACTIVA;
  }
  if (Object.keys(campos).length) {
    cambios.push({
      tipo: 'actualizarBase',
      campos,
      descripcion: `Base (default): ${Object.entries(campos).map(([k, v]) => `${k} = ${v}`).join(', ')}`,
    });
  }

  for (const definicion of PROGRAMACIONES) {
    const propias = programaciones.filter((p) => esDeEsteScript(p, definicion));

    if (revertir) {
      for (const p of propias) {
        cambios.push({
          tipo: 'borrarProgramacion',
          name: p.name,
          descripcion:
            `Borrar la programación ${definicion.etiqueta} (id: ${ultimoSegmento(p.name)})`,
        });
      }
      continue;
    }

    if (propias.length === 0) {
      const ajena = programaciones.find((p) => mismaClase(p, definicion));
      if (ajena) {
        conflictos.push(
          `Ya existe una programación ${definicion.clave} con otra retención o día ` +
          `(${ajena.retention ?? 'sin retención'}); Firestore admite una sola, así que no se ` +
          'crea la de este script. Resuélvalo a mano.'
        );
      } else {
        cambios.push({
          tipo: 'crearProgramacion',
          clave: definicion.clave,
          cuerpo: { retention: `${definicion.retentionSegundos}s`, ...definicion.recurrencia },
          descripcion: `Crear la programación ${definicion.etiqueta}`,
        });
      }
    } else {
      for (const sobrante of propias.slice(1)) {
        cambios.push({
          tipo: 'borrarProgramacion',
          name: sobrante.name,
          descripcion:
            `Borrar una copia duplicada de la programación ${definicion.etiqueta} ` +
            `(id: ${ultimoSegmento(sobrante.name)})`,
        });
      }
    }
  }

  return { cambios, conflictos };
}

/**
 * Evalúa el estado contra lo que debe cumplirse. Es la base de `--verificar`.
 * @param {object} estado ver el encabezado del archivo
 * @returns {{ punto: string, pasa: boolean }[]}
 */
export function evaluarVerificacion(estado) {
  const programaciones = estado.programaciones ?? [];
  const resultados = [
    { punto: 'PITR activo', pasa: estado.base.pitr === true },
    { punto: 'Protección contra borrado activa', pasa: estado.base.proteccion === true },
  ];
  for (const definicion of PROGRAMACIONES) {
    resultados.push({
      punto: `Programación ${definicion.clave} (${definicion.retentionSegundos} s)`,
      pasa: programaciones.some((p) => esDeEsteScript(p, definicion)),
    });
  }
  // Con PITR activo, Firestore fija la retención de versiones en 7 días; apagado, vale 1 hora
  // (3600 s). Se comprueba ESO y no `earliestVersionTime`: ese campo viene lleno aunque el PITR
  // esté apagado, porque la retención de 1 hora ya lo llena, y un punto que da PASA en el estado
  // malo no verifica nada.
  resultados.push({
    punto: `Retención de versiones de 7 días (${RETENCION_VERSIONES_PITR})`,
    pasa: estado.base.versionRetentionPeriod === RETENCION_VERSIONES_PITR,
  });
  return resultados;
}
