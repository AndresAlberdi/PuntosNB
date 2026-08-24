import { isStaging } from './env';

const SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || '';

let scriptLoaded = false;

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
    const grecaptcha = (window as any).grecaptcha;
    if (grecaptcha?.enterprise?.ready) {
      grecaptcha.enterprise.ready(async () => {
        try {
          const token = await grecaptcha.enterprise.execute(SITE_KEY, { action });
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
