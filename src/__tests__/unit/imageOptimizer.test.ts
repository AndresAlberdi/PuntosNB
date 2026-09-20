import { describe, it, expect } from 'vitest';
import { bytesDeDataUrl, PRESUPUESTOS, optimizarImagen, resumenOptimizacion } from '../../utils/imageOptimizer';

describe('Presupuestos de imagen', () => {
  it('ningún uso supera los 90 KB, y los de catálogo se quedan en 40', () => {
    for (const [uso, presupuesto] of Object.entries(PRESUPUESTOS)) {
      expect(presupuesto.bytes, uso).toBeLessThanOrEqual(90_000);
      expect(presupuesto.dimension, uso).toBeLessThanOrEqual(900);
    }
    expect(PRESUPUESTOS.producto.bytes).toBe(40_000);
    expect(PRESUPUESTOS.logo.bytes).toBe(25_000);
  });

  it('los presupuestos entran en los límites que acepta el servidor', () => {
    // El data URL en base64 ocupa cuatro tercios de los bytes que representa.
    const caracteres = (bytes: number) => Math.ceil((bytes * 4) / 3) + 30;
    expect(caracteres(PRESUPUESTOS.comprobante.bytes)).toBeLessThan(140_000);
    expect(caracteres(PRESUPUESTOS.logo.bytes)).toBeLessThan(40_000);
  });
});

describe('bytesDeDataUrl', () => {
  it('mide los bytes reales, no los caracteres', () => {
    const contenido = 'hola mundo';
    const dataUrl = `data:image/webp;base64,${btoa(contenido)}`;
    expect(bytesDeDataUrl(dataUrl)).toBe(contenido.length);
  });

  it('descuenta el relleno del base64', () => {
    expect(bytesDeDataUrl(`data:image/jpeg;base64,${btoa('a')}`)).toBe(1);
    expect(bytesDeDataUrl(`data:image/jpeg;base64,${btoa('ab')}`)).toBe(2);
    expect(bytesDeDataUrl(`data:image/jpeg;base64,${btoa('abc')}`)).toBe(3);
  });
});

describe('Validación previa', () => {
  it('rechaza un archivo que no es imagen', async () => {
    const archivo = new File(['no soy una imagen'], 'documento.pdf', { type: 'application/pdf' });
    await expect(optimizarImagen(archivo, 'logo')).rejects.toThrow(/debe ser una imagen/i);
  });

  it('rechaza una imagen de más de 15 MB antes de decodificarla', async () => {
    const archivo = new File([new Uint8Array(16 * 1024 * 1024)], 'enorme.jpg', { type: 'image/jpeg' });
    await expect(optimizarImagen(archivo, 'comprobante')).rejects.toThrow(/15 MB/);
  });
});

describe('resumenOptimizacion', () => {
  it('expresa el ahorro en porcentaje', () => {
    const texto = resumenOptimizacion({
      dataUrl: 'data:image/webp;base64,xx',
      bytes: 20_480,
      bytesOriginales: 204_800,
      formato: 'image/webp',
      dentroDelPresupuesto: true,
    });
    expect(texto).toContain('90 % menos');
    expect(texto).toContain('WEBP');
  });
});
