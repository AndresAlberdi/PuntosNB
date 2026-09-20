/**
 * Política de contraseñas para las cuentas administrativas.
 *
 * Las cuentas de administrador, contador, influencer y superadministrador manejan dinero y datos
 * de terceros: doce caracteres es el mínimo razonable, y conviene aceptar frases largas en lugar
 * de exigir símbolos que la gente termina apuntando en un papel.
 */

export const LONGITUD_MINIMA = 12;

/** Las peores contraseñas posibles, en español y en inglés. */
const PROHIBIDAS = [
  'contrasena', 'contraseña', 'password', '123456', 'qwerty', 'hipatia', 'admin', 'bolivia',
];

export interface EvaluacionContrasena {
  valida: boolean;
  problema?: string;
}

export function evaluarContrasena(contrasena: string, datosPropios: string[] = []): EvaluacionContrasena {
  const valor = contrasena.trim();

  if (valor.length < LONGITUD_MINIMA) {
    return { valida: false, problema: `La contraseña debe tener al menos ${LONGITUD_MINIMA} caracteres.` };
  }
  if (/^(.)\1+$/.test(valor)) {
    return { valida: false, problema: 'La contraseña no puede ser un solo carácter repetido.' };
  }

  const normalizada = valor.toLowerCase();
  if (PROHIBIDAS.some((p) => normalizada.includes(p))) {
    return { valida: false, problema: 'La contraseña contiene una palabra demasiado común. Elige otra.' };
  }

  // Ni el correo ni el nombre del comercio sirven como contraseña.
  for (const dato of datosPropios) {
    const limpio = dato?.toLowerCase().split('@')[0]?.trim();
    if (limpio && limpio.length >= 4 && normalizada.includes(limpio)) {
      return { valida: false, problema: 'La contraseña no puede contener tu usuario ni tu correo.' };
    }
  }

  // Variedad: al menos tres de cuatro clases, o una frase larga.
  const clases = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((r) => r.test(valor)).length;
  if (clases < 3 && valor.length < 16) {
    return {
      valida: false,
      problema: 'Combina mayúsculas, minúsculas, números o símbolos, o usa una frase de al menos 16 caracteres.',
    };
  }

  return { valida: true };
}
