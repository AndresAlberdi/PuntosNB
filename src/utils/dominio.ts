/**
 * Redirección al dominio propio.
 *
 * La aplicación se sirve desde varias direcciones —`hipatia-puntos.web.app`, la de Firebase y el
 * dominio propio—, pero solo una es la buena: `puntos.hipatiabo.com`. Tenerlas todas activas
 * dispersa el tráfico y obliga a mantener por triplicado los permisos que dependen del dominio
 * (clave de API, dominios de reCAPTCHA, orígenes autorizados de Auth).
 *
 * La redirección se hace en el cliente porque Firebase Hosting no permite condicionar un `redirect`
 * al nombre del servidor; conserva la ruta, los parámetros y el fragmento.
 */

/** Dominio al que debe llegar la gente. */
export const DOMINIO_CANONICO = 'puntos.hipatiabo.com';

/** Direcciones que se redirigen. No incluye `localhost` ni los canales de vista previa. */
const DOMINIOS_A_REDIRIGIR = ['hipatia-puntos.web.app', 'hipatia-puntos.firebaseapp.com'];

/** Devuelve la dirección de destino, o `null` si no hay que redirigir. */
export function destinoCanonico(url: URL): string | null {
  if (!DOMINIOS_A_REDIRIGIR.includes(url.hostname)) return null;
  const destino = new URL(url.toString());
  destino.hostname = DOMINIO_CANONICO;
  destino.protocol = 'https:';
  destino.port = '';
  return destino.toString();
}

/** Redirige si corresponde. Se llama antes de montar la aplicación. */
export function redirigirAlDominioCanonico(): void {
  if (typeof window === 'undefined') return;
  const destino = destinoCanonico(new URL(window.location.href));
  if (destino) window.location.replace(destino);
}
