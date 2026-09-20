import { describe, it, expect } from 'vitest';
import { evaluarContrasena, LONGITUD_MINIMA } from '../../utils/password';

describe('Política de contraseñas administrativas', () => {
  it('exige al menos doce caracteres', () => {
    expect(LONGITUD_MINIMA).toBe(12);
    expect(evaluarContrasena('Corta1!').valida).toBe(false);
    expect(evaluarContrasena('Corta1!').problema).toContain('12 caracteres');
  });

  it('acepta una contraseña larga y variada', () => {
    expect(evaluarContrasena('Epico-2026-Ventas').valida).toBe(true);
  });

  it('acepta una frase larga aunque tenga pocas clases de caracteres', () => {
    expect(evaluarContrasena('caballo correcto grapa pila').valida).toBe(true);
  });

  it('rechaza una frase larga sin variedad si es corta de más', () => {
    expect(evaluarContrasena('abcdefghijklm').valida).toBe(false);
  });

  it('rechaza palabras demasiado comunes', () => {
    for (const mala of ['Password12345', 'hipatia123456', 'Contrasena123']) {
      expect(evaluarContrasena(mala).valida, mala).toBe(false);
    }
  });

  it('rechaza un solo carácter repetido', () => {
    expect(evaluarContrasena('aaaaaaaaaaaaaa').valida).toBe(false);
  });

  it('no permite usar el propio usuario o correo', () => {
    const r = evaluarContrasena('ventas-epico-2026', ['ventas@epico.com']);
    expect(r.valida).toBe(false);
    expect(r.problema).toContain('tu usuario');
  });
});
