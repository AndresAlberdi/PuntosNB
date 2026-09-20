# Lista de verificación — App Check (Fase 2)

App Check acredita que quien llama a Firestore, a las funciones y a Auth es **esta aplicación** y
no un script cualquiera con la clave web. Es la barrera que la restricción por referente de la
clave de API no puede dar: esa restricción se sortea enviando una cabecera, como se comprobó en la
prueba de extremo a extremo de la Fase 1.

El código ya está listo: la aplicación inicializa App Check en los dos entornos y las funciones
aceptan exigirlo con la variable `EXIGIR_APP_CHECK`. Lo que falta solo existe en consola.

## 1. Registrar las aplicaciones (una vez por proyecto)

Para `puntosnb` y para `hipatia-puntos`:

1. Abrir la consola de Firebase → **Compilación → App Check → Aplicaciones**.
   - `puntosnb`: https://console.firebase.google.com/project/puntosnb/appcheck/apps
   - `hipatia-puntos`: https://console.firebase.google.com/project/hipatia-puntos/appcheck/apps
2. Elegir la aplicación web del proyecto y **Registrar** con proveedor **reCAPTCHA Enterprise**.
3. Pegar el **ID de la clave de sitio** de reCAPTCHA Enterprise. Es el mismo valor que ya está en
   `VITE_RECAPTCHA_SITE_KEY` de `.env.staging` y `.env.production`; si no existe una clave para el
   proyecto, crearla en https://console.cloud.google.com/security/recaptcha con tipo **Sitio web**
   y los dominios `puntosnb.web.app` / `hipatia-puntos.web.app`.
4. Dejar el **tiempo de vida del token** en 1 hora (valor por defecto).

Resultado esperado: la aplicación aparece con estado **Registrada** y proveedor
**reCAPTCHA Enterprise**.

## 2. Observar las métricas antes de exigir nada

Durante al menos 48 horas de uso normal, revisar **App Check → APIs**:

- **Cloud Firestore** y **Cloud Functions** deben mostrar un porcentaje de solicitudes
  **verificadas** creciente y cercano al total.
- Si aparecen solicitudes **no verificadas** en volumen, todavía hay tráfico de versiones viejas de
  la aplicación en navegadores que no recargaron: conviene esperar antes de exigir.

Criterio para dar el paso: **más del 95 % de solicitudes verificadas durante dos días seguidos**,
sin picos de no verificadas.

## 3. Activar la exigencia (*enforcement*)

Cuando se cumpla el criterio, en **App Check → APIs**, para cada API:

1. **Cloud Firestore** → *Aplicar forzosamente*.
2. **Cloud Functions** → *Aplicar forzosamente*.
3. **Authentication** → *Aplicar forzosamente* (opcional; se recomienda después de las dos anteriores).

Hacerlo primero en `puntosnb`, esperar un día de uso real, y recién entonces en `hipatia-puntos`.

Aviso importante: el ingreso del vendedor por PIN (`loginVendedor`) se invoca **sin sesión**. App
Check sigue funcionando en ese caso porque el token de App Check no depende de la sesión, pero es
el flujo que conviene probar primero después de activar la exigencia.

## 4. Token de depuración (solo para desarrollo)

La aplicación activa el modo de depuración cuando corre con `npm run dev`. La primera vez, el
navegador imprime en consola un token; registrarlo en **App Check → Aplicaciones → (la app) →
Administrar tokens de depuración** con un nombre que diga de quién es el equipo, y borrarlo cuando
deje de usarse. **Nunca** registrar un token de depuración con el sitio de producción abierto.

## 5. Del lado del servidor

Cuando las dos APIs estén en modo forzoso, avisar a Claude para que despliegue las funciones con
`EXIGIR_APP_CHECK=true`: a partir de ahí, una llamada sin token de App Check válido se rechaza
antes de ejecutar nada.

## 6. Mientras tanto

Sin *enforcement*, App Check informa pero no bloquea. Las demás barreras siguen en pie: las reglas
niegan por defecto, el libro mayor solo lo escribe el servidor y cada función verifica el rol
firmado en el token.
