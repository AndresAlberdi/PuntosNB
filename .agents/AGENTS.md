# Reglas del Proyecto PuntosNB / Hipatia

## Flujo Obligatorio de Despliegue e Iteraciones

### 1. Entorno de Pruebas (Staging - proyecto `puntosnb`)
- **Modificaciones Locales**: Toda modificación se debe realizar y validar localmente en primera instancia.
- **Batería de Pruebas**: Ejecutar pruebas unitarias y tests locales (`npm run test`).
- **Análisis de Vulnerabilidades**: Correr escaneo de seguridad con `Snyk`, `npm audit` y revisar Dependabot.
- **Publicación y GitHub**: Desplegar al área de pruebas en Firebase (`puntosnb`) y realizar el commit/push a GitHub con el mensaje indicando `(en pruebas)`.
- **Verificación**: Verificar que GitHub / Dependabot no entregue errores.

### 2. Pase a Producción (Production - proyecto `hipatia-puntos`)
- **Autorización**: Se realiza únicamente tras la verificación y pruebas por parte de usuarios reales en el área de pruebas.
- **Protocolo de Producción**: Ejecutar los mismos pasos del punto 1 (tests unitarios locales, escaneo Snyk/npm audit, compilación de producción), publicando en el proyecto de producción en Firebase y realizando el commit/push a GitHub con la marca `(en producción)`.

## 3. Reglas Críticas de Firestore y Persistencia
- **Reglas de Seguridad (`firestore.rules`)**: Al crear nuevas colecciones o modelos (como `codigos_comercio`, `asignaciones_influencer`, etc.), SIEMPRE se deben declarar sus reglas explícitas de acceso (`allow read`, `allow create`, `allow update`, `allow delete`) en `firestore.rules`.
- **Prohibido enviar campos `undefined` a Firestore**: Firestore lanza un error fatal si un objeto contiene propiedades con valor `undefined` (`Unsupported field value: undefined`). Todos los campos opcionales en documentos (ej: `influencerId`, `reglaAplicadaId`, etc.) deben asignarse condicionalmente con spread:
  ```typescript
  ...(influencerId ? { influencerId } : {})
  ```
  y NUNCA como `influencerId: undefined`.
