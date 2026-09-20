import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// App Check: acredita que las llamadas vienen de esta aplicación y no de un script suelto.
// Se inicializa en los dos entornos, no solo en producción (H-10). En desarrollo se usa el token
// de depuración, que solo funciona contra los emuladores o contra un token registrado en consola.
const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

if (typeof window !== 'undefined') {
  if (import.meta.env.DEV) {
    // @ts-expect-error: bandera que el SDK de App Check lee del objeto global.
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  if (siteKey) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (e) {
      // No se silencia: si App Check no arranca, conviene saberlo antes de exigirlo.
      console.error('App Check no pudo inicializarse:', e);
    }
  } else if (!import.meta.env.DEV) {
    console.error('Falta VITE_RECAPTCHA_SITE_KEY: la aplicación queda sin App Check.');
  }
}

// Initialize Auth
export const auth = getAuth(app);

// Initialize Firestore
export const db = getFirestore(app);

// Backend de confianza (Cloud Functions). La región debe coincidir con la del despliegue.
export const functions = getFunctions(app, "us-central1");

export default app;
