import { describe, it, expect } from 'vitest';
import { destinoCanonico, DOMINIO_CANONICO } from '../../utils/dominio';

describe('Redirección al dominio propio', () => {
  it('redirige la dirección de Firebase conservando ruta, parámetros y fragmento', () => {
    const destino = destinoCanonico(new URL('https://hipatia-puntos.web.app/cliente/comercio?ref=qr#premios'));
    expect(destino).toBe(`https://${DOMINIO_CANONICO}/cliente/comercio?ref=qr#premios`);
  });

  it('redirige también el dominio firebaseapp.com', () => {
    expect(destinoCanonico(new URL('https://hipatia-puntos.firebaseapp.com/login')))
      .toBe(`https://${DOMINIO_CANONICO}/login`);
  });

  it('no toca el dominio propio', () => {
    expect(destinoCanonico(new URL(`https://${DOMINIO_CANONICO}/login`))).toBeNull();
  });

  it('no toca el entorno de pruebas ni el desarrollo local', () => {
    expect(destinoCanonico(new URL('https://puntosnb.web.app/login'))).toBeNull();
    expect(destinoCanonico(new URL('http://localhost:5173/login'))).toBeNull();
  });
});
