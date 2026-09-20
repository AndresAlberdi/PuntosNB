import { isStaging } from './env';

const SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || '';

let scriptLoaded = false;

/**
 * Forma minima del objeto global que inyecta reCAPTCHA Enterprise.
 *
 * Se declara aqui, en vez de tipar `window` como `any`, para que el resto del archivo
 * conserve la verificacion de tipos sobre las dos funciones que realmente se usan.
 */
interface RecaptchaEnterprise {
  enterprise?: {
    ready: (callback: () => void) => void;
    execute: (siteKey: string, opciones: { action: string }) => Promise<string>;
  };
}

type VentanaConRecaptcha = Window & { grecaptcha?: RecaptchaEnterprise };

/**
 * Inyecta el script de Google Cloud reCAPTCHA Enterprise dinámicamente si estamos en producción.
 */
export const initRecaptcha = (): void => {
  if (isStaging || !SITE_KEY || scriptLoaded) return;
  if (typeof document === 'undefined') return;

  const existingScript = document.querySelector(`script[src*="recaptcha/enterprise.js"]`);
  if (existingScript) {
    scriptLoaded = true;
    return;
  }

  const script = document.createElement('script');
  script.src = `https://www.google.com/recaptcha/enterprise.js?render=${SITE_KEY}`;
  script.async = true;
  script.defer = true;
  script.onload = () => {
    scriptLoaded = true;
  };
  document.head.appendChild(script);
};

/**
 * Ejecuta una acción de reCAPTCHA Enterprise y devuelve el token generado (solo en producción).
 * En staging o si no está configurado, devuelve null de forma segura.
 */
export const executeRecaptcha = async (action: string = 'LOGIN'): Promise<string | null> => {
  if (isStaging || !SITE_KEY) return null;

  return new Promise((resolve) => {
    const enterprise = (window as VentanaConRecaptcha).grecaptcha?.enterprise;
    if (enterprise?.ready) {
      enterprise.ready(async () => {
        try {
          const token = await enterprise.execute(SITE_KEY, { action });
          resolve(token || null);
        } catch (err) {
          console.warn("reCAPTCHA enterprise execution error:", err);
          resolve(null);
        }
      });
    } else {
      resolve(null);
    }
  });
};
