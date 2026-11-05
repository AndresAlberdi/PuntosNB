/** Pruebas puras de los eventos de seguridad: no necesitan emuladores. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from 'firebase-functions/v2';
import {
  EVENTOS,
  construirEntrada,
  redactar,
  registrarEvento,
  serializarError,
  type CamposEvento,
} from './eventos';

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.firma_de_prueba-123';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('redactar', () => {
  it('reemplaza correos', () => {
    expect(redactar('falló para ana.perez+x@correo.com.bo hoy')).toBe('falló para <correo> hoy');
  });

  it('reemplaza correos con letras Unicode', () => {
    expect(redactar('escribió ñandú.pérez@correo.com.bo hoy')).toBe('escribió <correo> hoy');
  });

  it('reemplaza teléfonos con prefijo internacional', () => {
    expect(redactar('llamó +59171234567 ayer')).toBe('llamó <telefono> ayer');
  });

  it.each([
    '+591 71234567',
    '+591-712-34567',
    '(+591) 71234567',
    '+1 (555) 123-4567',
    '71234567',
  ])('reemplaza el teléfono «%s»', (telefono) => {
    const resultado = redactar(`llamó al ${telefono} ayer`);
    expect(resultado).toContain('<telefono>');
    expect(resultado).not.toMatch(/\d{3}/);
    expect(resultado.startsWith('llamó al')).toBe(true);
    expect(resultado.endsWith('ayer')).toBe(true);
  });

  it('el teléfono no rompe las direcciones IP ya redactadas', () => {
    expect(redactar('desde 200.87.10.4 llamó +591 71234567')).toBe('desde <ip> llamó <telefono>');
  });

  it('reemplaza JWT y Bearer', () => {
    expect(redactar(`token ${JWT} fin`)).toBe('token <token> fin');
    expect(redactar('Authorization: Bearer abc.def-ghi_123')).toBe('Authorization: <token>');
  });

  it('reemplaza direcciones IPv4 e IPv6', () => {
    expect(redactar('desde 200.87.10.4 y 2800:cb0:1234:5678:9abc:def0:1234:5678')).toBe('desde <ip> y <ip>');
    expect(redactar('cliente ::ffff:10.0.0.1 y ::1')).toBe('cliente <ip> y <ip>');
  });

  it('no altera un texto sin datos personales', () => {
    expect(redactar('rol cliente intentó una operación de superadmin')).toBe(
      'rol cliente intentó una operación de superadmin',
    );
  });
});

describe('serializarError', () => {
  it('conserva el mensaje de un Error común (JSON.stringify lo pierde)', () => {
    const resultado = serializarError(new TypeError('falló la consulta'));
    expect(JSON.stringify(new Error('x'))).toBe('{}');
    expect(resultado).toEqual({ tipo: 'TypeError', codigo: null, mensaje: 'falló la consulta' });
  });

  it('no incluye httpResponse, cabeceras ni cuerpo aunque el error los traiga', () => {
    const errorAuth = Object.assign(new Error('There is no user record for ana@correo.com'), {
      name: 'FirebaseAuthError',
      code: 'auth/user-not-found',
      httpResponse: {
        headers: { authorization: `Bearer ${JWT}`, 'x-forwarded-for': '200.87.10.4' },
        data: { error: { message: 'USER_NOT_FOUND' } },
      },
    });
    const resultado = serializarError(errorAuth);
    expect(resultado).toEqual({
      tipo: 'FirebaseAuthError',
      codigo: 'auth/user-not-found',
      mensaje: 'There is no user record for <correo>',
    });
    const texto = JSON.stringify(resultado);
    for (const prohibido of ['httpResponse', 'headers', 'authorization', 'USER_NOT_FOUND', '200.87', 'eyJ']) {
      expect(texto).not.toContain(prohibido);
    }
  });

  it('lee el código de errorInfo y corta el mensaje a 300 caracteres', () => {
    const error = Object.assign(new Error('x'.repeat(500)), { errorInfo: { code: 'auth/id-token-expired' } });
    const resultado = serializarError(error);
    expect(resultado.codigo).toBe('auth/id-token-expired');
    expect(resultado.mensaje).toHaveLength(300);
  });

  it('tolera valores que no son Error', () => {
    expect(serializarError('texto a +59171234567')).toEqual({
      tipo: 'string',
      codigo: null,
      mensaje: 'texto a <telefono>',
    });
    expect(serializarError(undefined)).toEqual({ tipo: 'undefined', codigo: null, mensaje: '' });
  });

  it('un valor nulo, numérico o booleano lanzado no deja el mensaje vacío', () => {
    expect(serializarError(null)).toEqual({ tipo: 'null', codigo: null, mensaje: 'null' });
    expect(serializarError(42)).toEqual({ tipo: 'number', codigo: null, mensaje: '42' });
    expect(serializarError(false)).toEqual({ tipo: 'boolean', codigo: null, mensaje: 'false' });
  });

  it('un valor primitivo lanzado también se redacta', () => {
    expect(serializarError(59171234567)).toEqual({ tipo: 'number', codigo: null, mensaje: '<telefono>' });
  });

  it('conserva un code numérico (errores gRPC de Firestore) como texto', () => {
    const errorGrpc = Object.assign(new Error('10 ABORTED: demasiada contención'), { code: 10 });
    expect(serializarError(errorGrpc)).toEqual({
      tipo: 'Error',
      codigo: '10',
      mensaje: '10 ABORTED: demasiada contención',
    });
    const conInfo = Object.assign(new Error('x'), { errorInfo: { code: 7 } });
    expect(serializarError(conInfo).codigo).toBe('7');
  });
});

describe('construirEntrada', () => {
  it('siempre lleva el evento y la versión 1', () => {
    for (const evento of EVENTOS) {
      const entrada = construirEntrada(evento, {});
      expect(entrada.evento).toBe(evento);
      expect(entrada.v).toBe(1);
      expect(entrada.funcion).toBe(process.env.FUNCTION_TARGET ?? null);
    }
  });

  it('toma el nombre de la función de FUNCTION_TARGET', () => {
    vi.stubEnv('FUNCTION_TARGET', 'loginVendedor');
    expect(construirEntrada('seguridad.bloqueo_pin', {}).funcion).toBe('loginVendedor');
  });

  it('funcion es null cuando FUNCTION_TARGET no está definido', () => {
    vi.stubEnv('FUNCTION_TARGET', undefined);
    expect(process.env.FUNCTION_TARGET).toBeUndefined();
    expect(construirEntrada('seguridad.bloqueo_pin', {}).funcion).toBeNull();
  });

  it('conserva los campos permitidos', () => {
    const entrada = construirEntrada('seguridad.rol_privilegiado_asignado', {
      uid: 'u1',
      actorUid: 'u2',
      rolAnterior: null,
      rolNuevo: 'superadmin',
      comercioId: 'c1',
      alcance: 'cuenta',
    });
    expect(entrada).toMatchObject({
      uid: 'u1',
      actorUid: 'u2',
      rolAnterior: null,
      rolNuevo: 'superadmin',
      comercioId: 'c1',
      alcance: 'cuenta',
    });
  });

  it('descarta claves fuera de la lista blanca', () => {
    const intruso = {
      uid: 'u1',
      email: 'ana@correo.com',
      telefono: '+59171234567',
      ip: '200.87.10.4',
      ipHash: 'abc123',
      token: JWT,
      authorization: `Bearer ${JWT}`,
    } as unknown as CamposEvento;
    const entrada = construirEntrada('seguridad.permiso_denegado', intruso);
    expect(Object.keys(entrada).sort()).toEqual(['evento', 'funcion', 'uid', 'v']);
    const texto = JSON.stringify(entrada);
    for (const prohibido of ['ana@correo.com', '59171234567', '200.87.10.4', 'abc123', 'eyJ']) {
      expect(texto).not.toContain(prohibido);
    }
  });

  it('no deja pasar correo, teléfono, IP ni token metidos en detalle o en campos permitidos', () => {
    const entrada = construirEntrada('seguridad.permiso_denegado', {
      detalle: `ana@correo.com +59171234567 200.87.10.4 ${JWT} Bearer secreto123`,
      motivo: 'intento de ana@correo.com desde 200.87.10.4',
      error: {
        tipo: 'Error',
        codigo: null,
        mensaje: `token ${JWT}`,
        httpResponse: { headers: { cookie: 'sid=1' } },
      } as never,
    });
    const texto = JSON.stringify(entrada);
    for (const prohibido of [
      'ana@correo.com', '59171234567', '200.87.10.4', 'eyJ', 'secreto123', 'httpResponse', 'cookie',
    ]) {
      expect(texto).not.toContain(prohibido);
    }
    expect(entrada.detalle).toBe('<correo> <telefono> <ip> <token> <token>');
  });

  it('conserva íntegros los identificadores aunque contengan «eyJ» o parezcan un token', () => {
    const entrada = construirEntrada('seguridad.permiso_denegado', {
      uid: 'Kq3eyJ8sdfXa91LmNopQrS2tUvW1',
      actorUid: 'eyJabc-DEF_123',
      comercioId: 'abc_def-123',
      rol: 'admin_comercio',
      rolNuevo: 'superadmin',
      rolAnterior: 'cliente',
      motivo: 'pin_incorrecto',
    });
    expect(entrada).toMatchObject({
      uid: 'Kq3eyJ8sdfXa91LmNopQrS2tUvW1',
      actorUid: 'eyJabc-DEF_123',
      comercioId: 'abc_def-123',
      rol: 'admin_comercio',
      rolNuevo: 'superadmin',
      rolAnterior: 'cliente',
      motivo: 'pin_incorrecto',
    });
  });

  it('un identificador con forma rara (texto del cliente) sí se redacta', () => {
    const entrada = construirEntrada('seguridad.permiso_denegado', {
      uid: 'ana@correo.com',
      comercioId: `x ${JWT}`,
    });
    expect(entrada.uid).toBe('<correo>');
    expect(entrada.comercioId).toBe('x <token>');
  });

  it('corta detalle a 300 caracteres', () => {
    const entrada = construirEntrada('seguridad.permiso_denegado', { detalle: 'a'.repeat(1000) });
    expect(entrada.detalle).toHaveLength(300);
  });

  it('redacta antes de cortar, para no dejar un correo a medias', () => {
    const detalle = `${'a'.repeat(290)} ana.perez@correo.com`;
    const entrada = construirEntrada('seguridad.permiso_denegado', { detalle });
    expect(entrada.detalle).not.toContain('@');
    expect(entrada.detalle).not.toContain('correo.com');
  });

  it('no deja un correo cortado a medias en el límite de 1000 caracteres', () => {
    // Tres tokens largos que, al redactarse, se achican a `<token>`: el fragmento del límite
    // quedaría dentro de los 300 finales.
    const tokens = `${`eyJ${'a'.repeat(297)} `.repeat(3)}`;
    const previo = `${tokens}${'ok '.repeat(28)}`;
    const texto = `${previo}ana.perez@correo.com y más`;
    expect(texto.indexOf('@')).toBeLessThan(1000);
    expect(texto.indexOf('.com')).toBeGreaterThan(1000);
    const entrada = construirEntrada('seguridad.permiso_denegado', { detalle: texto });
    const detalle = entrada.detalle as string;
    expect(detalle).not.toContain('@');
    expect(detalle).not.toContain('ana');
    expect(detalle.trimEnd().endsWith('ok')).toBe(true);
  });

  it('ignora un alcance no previsto', () => {
    const entrada = construirEntrada('seguridad.bloqueo_pin', { alcance: 'otro' } as never);
    expect(entrada).not.toHaveProperty('alcance');
  });

  it('ignora un alcance inválido sin perder las demás claves válidas', () => {
    const entrada = construirEntrada('seguridad.bloqueo_pin', {
      uid: 'u1',
      motivo: 'pin_incorrecto',
      alcance: 'otro',
    } as never);
    expect(entrada).not.toHaveProperty('alcance');
    expect(entrada).toMatchObject({ uid: 'u1', motivo: 'pin_incorrecto' });
  });
});

describe('registrarEvento', () => {
  it('usa la severidad indicada y pasa (evento, entrada) al logger', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    registrarEvento('seguridad.sesiones_revocadas', { uid: 'u1' }, 'INFO');
    registrarEvento('seguridad.bloqueo_pin', { alcance: 'ip' }, 'WARNING');
    registrarEvento('error.interno', { error: serializarError(new Error('boom')) }, 'ERROR');

    expect(info).toHaveBeenCalledWith('seguridad.sesiones_revocadas', expect.objectContaining({ evento: 'seguridad.sesiones_revocadas', uid: 'u1', v: 1 }));
    expect(warn).toHaveBeenCalledWith('seguridad.bloqueo_pin', expect.objectContaining({ alcance: 'ip' }));
    expect(error).toHaveBeenCalledWith('error.interno', expect.objectContaining({ error: { tipo: 'Error', codigo: null, mensaje: 'boom' } }));
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('costo acotado de la redacción', () => {
  // La expresión de CORREO era cuadrática (64 000 caracteres de `a.` tardaban 5 a 7 s). Ahora es
  // lineal sin depender del tope de 1000: se prueba `redactar` directamente. El tope de 500 ms es
  // holgado para una CI cargada, y aun así dista varios órdenes de magnitud del caso cuadrático.
  it.each([
    ['«a.» repetido', 'a.'.repeat(32_000)],
    ['«a» repetido', 'a'.repeat(64_000)],
    ['dominio largo tras una arroba', `a@${'a.'.repeat(32_000)}`],
    ['dígitos y espacios', '1 '.repeat(32_000)],
  ])('redactar no es cuadrática con un texto enorme (%s)', (_nombre, texto) => {
    const inicio = Date.now();
    redactar(texto);
    expect(Date.now() - inicio).toBeLessThan(500);
  });

  it.each([
    ['hexadecimal continuo', 'a'.repeat(200_000)],
    ['correo largo sin arroba', 'a.'.repeat(100_000)],
  ])('un texto enorme (%s) no bloquea el hilo', (_nombre, texto) => {
    const inicio = Date.now();
    const entrada = construirEntrada('seguridad.permiso_denegado', { detalle: texto });
    expect(Date.now() - inicio).toBeLessThan(500);
    expect((entrada.detalle as string).length).toBeLessThanOrEqual(300);
  });

  it('serializarError también acota un mensaje enorme', () => {
    const inicio = Date.now();
    const r = serializarError(new Error('a'.repeat(200_000)));
    expect(Date.now() - inicio).toBeLessThan(500);
    expect(r.mensaje.length).toBeLessThanOrEqual(300);
  });
});
