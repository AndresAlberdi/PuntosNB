/**
 * Transformación de imágenes **en el navegador, antes de subirlas**.
 *
 * Cada imagen que se guarda como data URL dentro de un documento de Firestore se paga tres veces:
 * al almacenarla, al leerla y al transferirla, y se lee entera cada vez que alguien abre la
 * pantalla que la muestra. Por eso conviene que salga del navegador ya reducida.
 *
 * La función escoge el formato más liviano que soporte el navegador —WebP si está disponible,
 * JPEG si no— y baja calidad y tamaño hasta entrar en el presupuesto de bytes del uso concreto.
 */

export type UsoImagen = 'logo' | 'producto' | 'premio' | 'avatar' | 'comprobante';

interface Presupuesto {
  /** Lado mayor, en píxeles. */
  dimension: number;
  /** Tamaño máximo del resultado, en bytes del data URL. */
  bytes: number;
  descripcion: string;
}

/**
 * Presupuestos por uso. Salen de para qué se mira cada imagen: un logotipo se ve en una esquina,
 * un comprobante de depósito tiene que dejar leer un número.
 */
export const PRESUPUESTOS: Record<UsoImagen, Presupuesto> = {
  logo: { dimension: 256, bytes: 25_000, descripcion: 'logotipo del comercio' },
  producto: { dimension: 400, bytes: 40_000, descripcion: 'fotografía de producto' },
  premio: { dimension: 400, bytes: 40_000, descripcion: 'fotografía de premio' },
  avatar: { dimension: 200, bytes: 20_000, descripcion: 'avatar' },
  comprobante: { dimension: 900, bytes: 90_000, descripcion: 'comprobante de depósito' },
};

/** Tamaño máximo del archivo de origen: por encima, ni se intenta decodificar. */
const MAXIMO_ORIGEN_BYTES = 15 * 1024 * 1024;

const TIPOS_ACEPTADOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif'];

/** Bytes reales de un data URL (la parte base64 ocupa 4/3 de los bytes que representa). */
export const bytesDeDataUrl = (dataUrl: string): number => {
  const coma = dataUrl.indexOf(',');
  if (coma < 0) return dataUrl.length;
  const base64 = dataUrl.slice(coma + 1);
  const relleno = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - relleno;
};

/** ¿El navegador sabe escribir WebP? Se comprueba una sola vez. */
let soportaWebp: boolean | null = null;
const navegadorSoportaWebp = (): boolean => {
  if (soportaWebp !== null) return soportaWebp;
  try {
    const prueba = document.createElement('canvas');
    prueba.width = 1;
    prueba.height = 1;
    soportaWebp = prueba.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    soportaWebp = false;
  }
  return soportaWebp;
};

const leerComoImagen = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onerror = () => rechazar(new Error('No se pudo leer el archivo.'));
    lector.onload = (evento) => {
      const img = new Image();
      img.onerror = () => rechazar(new Error('El archivo no parece ser una imagen válida.'));
      img.onload = () => resolver(img);
      img.src = evento.target?.result as string;
    };
    lector.readAsDataURL(file);
  });

const dibujar = (img: HTMLImageElement, dimension: number, formato: string, calidad: number): string => {
  const escala = Math.min(1, dimension / Math.max(img.width, img.height));
  const ancho = Math.max(1, Math.round(img.width * escala));
  const alto = Math.max(1, Math.round(img.height * escala));

  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;

  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar la imagen en este navegador.');

  // Fondo blanco: las imágenes con transparencia se ven mal al pasar a JPEG.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(img, 0, 0, ancho, alto);

  return lienzo.toDataURL(formato, calidad);
};

export interface ResultadoOptimizacion {
  dataUrl: string;
  bytes: number;
  bytesOriginales: number;
  formato: string;
  dentroDelPresupuesto: boolean;
}

/**
 * Reduce la imagen hasta entrar en el presupuesto del uso indicado.
 *
 * Primero baja la calidad; si aun así no alcanza, reduce el tamaño. Devuelve siempre el mejor
 * resultado obtenido, e informa si quedó por encima del presupuesto para que la pantalla decida.
 */
export async function optimizarImagen(file: File, uso: UsoImagen): Promise<ResultadoOptimizacion> {
  if (!file.type.startsWith('image/') && !TIPOS_ACEPTADOS.includes(file.type)) {
    throw new Error('El archivo debe ser una imagen (JPG, PNG o WebP).');
  }
  if (file.size > MAXIMO_ORIGEN_BYTES) {
    throw new Error(`La imagen pesa ${(file.size / 1048576).toFixed(1)} MB. Elige una de menos de 15 MB.`);
  }

  const presupuesto = PRESUPUESTOS[uso];
  const formato = navegadorSoportaWebp() ? 'image/webp' : 'image/jpeg';
  const img = await leerComoImagen(file);

  let mejor = '';
  for (const dimension of [presupuesto.dimension, Math.round(presupuesto.dimension * 0.75), Math.round(presupuesto.dimension * 0.5)]) {
    for (const calidad of [0.82, 0.7, 0.6, 0.5, 0.42]) {
      const intento = dibujar(img, dimension, formato, calidad);
      mejor = intento;
      if (bytesDeDataUrl(intento) <= presupuesto.bytes) {
        return {
          dataUrl: intento,
          bytes: bytesDeDataUrl(intento),
          bytesOriginales: file.size,
          formato,
          dentroDelPresupuesto: true,
        };
      }
    }
  }

  return {
    dataUrl: mejor,
    bytes: bytesDeDataUrl(mejor),
    bytesOriginales: file.size,
    formato,
    dentroDelPresupuesto: false,
  };
}

/** Texto corto para mostrar lo que se ahorró. */
export const resumenOptimizacion = (r: ResultadoOptimizacion): string => {
  const antes = r.bytesOriginales / 1024;
  const despues = r.bytes / 1024;
  const ahorro = antes > 0 ? Math.max(0, Math.round((1 - despues / antes) * 100)) : 0;
  return `${antes.toFixed(0)} KB → ${despues.toFixed(0)} KB (${ahorro} % menos, ${r.formato.replace('image/', '').toUpperCase()})`;
};
