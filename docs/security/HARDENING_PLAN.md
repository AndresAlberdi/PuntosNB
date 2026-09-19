# Hipatia Puntos (PuntosNB-app) — Plan de hardening

Versión 1.0 · 19-sep-2026 · Base auditada: repositorio `PuntosNB-app` v1.2.1 (React 19 + TypeScript + Vite + Firebase: Firestore, Auth, Hosting, App Check; sin Cloud Functions).

Alcance de la auditoría: lectura estática de `firestore.rules`, `firebase.json`, `.firebaserc`, `deploy.sh`, `package.json`, `src/firebase.ts`, `src/secondaryApp.ts`, `src/contexts/AuthContext.tsx`, `src/pages/*`, `src/utils/*` y `src/__tests__/security/*`. No se inspeccionó el estado desplegado en las consolas de Firebase/GCP ni el historial de Git; lo que dependa de eso figura como "por verificar" y está asignado a la Fase 0.

---

## 1. Diagnóstico ejecutivo

El problema de fondo es arquitectónico y no de parches: **toda la lógica de negocio corre en el navegador y las reglas de Firestore confían en lo que el cliente escribe**. En una plataforma cuyo activo son saldos (puntos del cliente, `saldoPremiosBs` del comercio, cobros de prepago), eso equivale a que el cajero del banco sea el propio cliente. Hoy, según el repositorio, un usuario autenticado cualquiera (basta una cuenta Google) puede convertirse en superadmin con una sola escritura, y a partir de ahí leer y modificar todo.

El hardening tiene por tanto un eje principal —**mover la frontera de confianza al servidor**— y cuatro ejes complementarios: identidad y roles, superficie web, cadena de suministro/despliegue, y operación (respaldo, monitoreo, respuesta).

Principios de diseño que gobiernan todo el plan:

1. **Denegar por defecto.** Ninguna colección es escribible por el cliente salvo lista blanca explícita de campos.
2. **El libro mayor es del servidor.** `transacciones`, `puntos_saldos`, `sesiones_qr`, canjes y cobros solo se escriben con Admin SDK desde Cloud Functions; el cliente solo lee lo suyo.
3. **El rol es un claim firmado, no un campo editable.** `rol` y `comercioId` viajan en el ID token (custom claims) y solo los asigna el backend.
4. **Todo actor tiene identidad verificable.** Desaparece la sesión de vendedor en `localStorage`; el vendedor obtiene un custom token tras validar su PIN en el servidor.
5. **Registro inmutable y reversiones compensatorias**, coherente con lo que ya prometen los Términos y Condiciones.
6. **Nada llega a producción sin pasar por pruebas de reglas con emulador y un pipeline reproducible.**

---

## 2. Hallazgos (verificados en el código)

Severidad: C = crítica (compromiso total o fraude directo), A = alta, M = media, B = baja.

| ID | Sev. | Hallazgo | Evidencia | Impacto |
|---|---|---|---|---|
| H-01 | C | **Autoescalada de rol.** `users/{userId}` permite `write` al propio usuario sin restricción de campos. Además `isAdminComercio()` puede escribir **cualquier** documento de `users`, sin acotar a su comercio. | `firestore.rules` → `match /users/{userId}` | Cualquier cliente se asigna `rol: 'superadmin'`; la regla comodín final le da lectura/escritura total. |
| H-02 | C | **Toma de cuenta por coincidencia de correo.** Lectura/escritura de `users` si `resource.data.email == request.auth.token.email`, sin exigir `email_verified`. `AuthContext` además clona el documento existente (con su rol) al nuevo UID. | `firestore.rules`; `AuthContext.tsx` ("auto-recuperación", paso 1) | Quien registre en Auth un correo que exista en `users` (p. ej. los correos sintéticos) hereda su rol y comercio. |
| H-03 | C | **Autoaprovisionamiento por dominio.** Si el dominio del correo coincide con `dominio`/`nombre` de un comercio —incluso por **subcadena** (`cleanDomainName.includes(nombre)`)— y el prefijo empieza con `admin`, el cliente se crea a sí mismo como `admin_comercio`. | `AuthContext.tsx` (paso 3) | `admin@epico-loquesea.com` pasa a administrar EPICO. Combinado con H-01, escala a todo el sistema. |
| H-04 | C | **Vendedor sin identidad.** PIN de 6 dígitos en texto plano en `users`; se compara en el navegador; la "sesión" es un JSON en `localStorage` (`hipatia_vendedor_session`) que cualquiera puede fabricar. El flujo opera sin `request.auth`, lo que **contradice las reglas del repositorio** (todas exigen `isAuth()`). | `Login.tsx` L159-185; `AuthContext.tsx`; `SuperAdminDashboard.tsx` L357-370 | O las reglas desplegadas son más permisivas que las del repo (y los PIN serían legibles públicamente), o el flujo del vendedor está roto en producción. Por verificar en Fase 0. Los PIN actuales deben considerarse comprometidos. |
| H-05 | C | **`sesiones_qr` abierta.** `allow read, write: if isAuth()`. | `firestore.rules` | Un cliente crea una sesión `ACUMULACION` con `puntosCalculados` arbitrario y la cobra; revierte `USADO→PENDIENTE` para reutilizarla; enumera los 900.000 códigos posibles. |
| H-06 | C | **Saldos y transacciones escribibles por el cliente** sin validación de valores. Vendedor/admin pueden crear, **modificar y borrar** transacciones y saldos de cualquier comercio (sin acotar `comercioId`). | `firestore.rules` → `transacciones`, `puntos_saldos` | Emisión de puntos arbitraria; historial alterable pese a que los T&C declaran registro inmutable. |
| H-07 | A | **Campos de facturación editables por el comercio.** `admin_comercio` escribe el documento completo de su comercio (`saldoPremiosBs`, `modalidadPago`, `plan`, `mesesPagados`, `estado`); `contador` escribe cualquier comercio. | `firestore.rules` → `comercios` | Autoacreditación de saldo, paso a premium o PILOTO sin pagar, desbloqueo propio. |
| H-08 | A | **Influencers y códigos.** Cualquier `cliente` puede actualizar cualquier `asignaciones_influencer`; los canjes de código se crean sin validar vigencia, tope ni unicidad en reglas. | `firestore.rules` | Vaciado o inflado de bolsas de puntos; canje repetido de códigos promocionales de 10 Bs. |
| H-09 | A | **Superadmin decidido por el cliente.** Lista `SUPER_ADMIN_EMAILS` incrustada en el bundle público y asignación del rol desde `Login.tsx`/`AuthContext.tsx`. | `src/utils/env.ts`; `Login.tsx` L243-262 | Expone correos personales (objetivo de phishing) y solo "funciona" gracias a H-01. |
| H-10 | A | **App Check sin garantía de cumplimiento.** Solo se inicializa en producción si hay site key; el error se silencia; staging sin App Check. No consta que la *enforcement* esté activa en consola. | `src/firebase.ts` | Las APIs de Firestore/Auth aceptan tráfico de scripts fuera de la app. |
| H-11 | M | **Códigos QR débiles.** `Math.random()`; `VendedorDashboard` no usa `generarCodigoUnicoQR` y hace `setDoc` directo (una colisión **sobrescribe** una sesión pendiente ajena); no se valida expiración al cobrar (los 15 min solo se usan para reutilizar códigos). | `VendedorDashboard.tsx` L241-258; `utils/qr.ts` | Códigos predecibles y válidos indefinidamente. |
| H-12 | M | **Cobro por canje evadible.** `Math.max(0, saldo - costo)` nunca bloquea; la verificación de prepago es solo de cliente. | `VendedorDashboard.tsx` L126-135 | Canjes ilimitados con saldo cero. |
| H-13 | M | **Hosting sin cabeceras de seguridad** (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, anti-clickjacking) ni política de caché. | `firebase.json` | Superficie XSS/clickjacking sin mitigación de segunda línea. |
| H-14 | M | **Despliegue frágil.** Se despliega desde el portátil; Snyk no bloquea; `npx -y firebase-tools@latest` sin fijar versión; tras desplegar hace `git add .` + commit + push a `main` (se despliega código no versionado y se arriesga subir secretos); sin CI. | `deploy.sh` | Riesgo de cadena de suministro y nula trazabilidad de qué se desplegó. |
| H-15 | M | **Pruebas de reglas que pasan sin probar.** Los 8 casos hacen `ctx.skip()` si el emulador no está arriba; `npm run test` no lo levanta. | `firestore.rules.test.ts` | Falsa sensación de cobertura; las reglas nunca se validan antes de desplegar. |
| H-16 | M | **Privacidad.** `contador` lee todos los `users` (incluye teléfonos y PIN); todo usuario autenticado lee los documentos completos de influencers; `comercios` completos (con datos fiscales y de cobro) legibles por cualquier autenticado. | `firestore.rules` | Exposición de PII y datos comerciales entre comercios competidores. |
| H-17 | M | **Sin resiliencia operativa:** no hay PITR ni respaldos programados, alertas de presupuesto, bitácora de auditoría ni runbook de incidentes. | Ausencia en repo/documentación | Un borrado malicioso (posible hoy vía H-01) es irrecuperable. |
| H-18 | B | **Higiene del repo.** `seedDatabase.ts` con contraseñas `123456`; scripts de parcheo en raíz (`update_superadmin.py`, `fix_colors.cjs`); `firestore-debug.log`; `SECURITY.md` es la plantilla de GitHub sin completar; `PhoneVerification.tsx` sin uso; `console.log` que vuelca correos de superadmins (`ContadorDashboard.tsx` L112); `<html lang="en">`. | Raíz del repo y `src/` | Ruido, fuga menor de información, deuda. |
| H-19 | B | **Política de credenciales.** Mínimo 6 caracteres; uso de `fetchSignInMethodsForEmail` (incompatible con la protección contra enumeración de correos); sin MFA para cuentas privilegiadas. | `Login.tsx`; `SuperAdminDashboard.tsx` L379 | Cuentas administrativas con protección de consumidor. |
| H-20 | B | **`.env.production` y `.env.staging` versionados.** La configuración web de Firebase es pública por diseño (no es un secreto), pero exige que la API key esté restringida en GCP. Por verificar; también el historial de Git con un escáner de secretos. | `.gitignore` | Abuso de cuota si la key no tiene restricciones. |

Cadena de ataque de referencia (para dimensionar la urgencia): cuenta Google cualquiera → `updateDoc(users/{miUid}, {rol:'superadmin'})` (H-01) → regla comodín → lectura de todos los PIN y teléfonos, acreditación de `saldoPremiosBs`, emisión de puntos, borrado de colecciones. Costo para el atacante: una línea en la consola del navegador.

---

## 3. Arquitectura objetivo

**Backend de confianza.** Cloud Functions for Firebase 2.ª gen. (TypeScript, Node 22, *callable*), en la misma región que la base Firestore, con `enforceAppCheck: true`, validación de esquema de entrada (zod) y Admin SDK. Operaciones:

| Función | Reemplaza a | Controles en servidor |
|---|---|---|
| `loginVendedor` | Comparación de PIN en `Login.tsx` | Hash del PIN (scrypt, sal por usuario) en colección `vendedores_secretos` con reglas `if false`; bloqueo progresivo (5 intentos → 15 min) por usuario y por IP; emite **custom token** con claims `{rol:'vendedor', comercioId}`. |
| `crearSesionAcumulacion` | `setDoc(sesiones_qr)` del vendedor | Recalcula puntos desde las reglas del comercio (no confía en el cliente); código con `crypto.randomInt` y verificación de colisión en transacción; `expiresAt` = 5 min; verifica estado de prepago y plan; aplica unicidad de `POR_REGISTRO`. |
| `reclamarAcumulacion` | Transacción en `ClienteDashboard` | Un solo uso, expiración, límite de intentos fallidos por UID, asiento en `transacciones` y actualización de `puntos_saldos` atómicos. |
| `crearSesionCanje` / `confirmarCanje` | Flujo de canje | Valida saldo de puntos, guarda `premioId`, **bloquea si `saldoPremiosBs` < costo** en PREPAGO, actualiza `consumidoPremiosBs`. |
| `canjearCodigoInfluencer` / `canjearCodigoComercio` | Escrituras directas a canjes y asignaciones | Vigencia, tope, un canje por cliente, descuento de bolsa. |
| `registrarCobroPrepago` | `ContadorDashboard` | Cobro + acreditación al comercio en una sola transacción; notificación real (no `console.log`). |
| `gestionarUsuario` / `gestionarComercio` | Altas desde dashboards con `secondaryAuth` | Única vía para asignar `rol`, `comercioId`, `plan`, `modalidadPago`, `estado`; fija custom claims y revoca tokens al bloquear. |

Todas escriben en `auditoria/{id}` (quién, qué, antes/después, IP, App Check app id). `transacciones` pasa a ser *append-only*: las correcciones son asientos compensatorios.

**Identidad.** `rol` y `comercioId` como custom claims; las reglas usan `request.auth.token.rol`, lo que además elimina los `get()` por evaluación (menos lecturas facturadas). Superadmins dados de alta con un script administrativo local (Admin SDK + ADC), nunca desde el cliente. Se elimina la "auto-recuperación" de `AuthContext`.

**Reglas finales.** Comodín `allow read, write: if false`. Cliente: lee su `users/{uid}`, sus saldos y transacciones; actualiza en su perfil solo `nombre`, `telefono` y aceptación de términos (`diff().affectedKeys().hasOnly([...])`). `admin_comercio`: actualiza de su comercio solo campos de catálogo (nombre comercial, logo, reglas, premios). Libro mayor, sesiones, canjes, cobros y campos de facturación: solo backend. Separación de `comercios` (perfil público) y `comercios_privado` (datos fiscales y de cobro); ídem perfil público mínimo de influencers.

**Limpieza automática.** Política TTL de Firestore sobre `sesiones_qr.expiresAt`.

Nota de costo: Cloud Functions exige plan Blaze. Al volumen actual y proyectado (≈275 operaciones/comercio/mes) el consumo queda dentro de la capa gratuita (2 M de invocaciones/mes); el riesgo se controla con alerta de presupuesto. Firebase Auth no cobra por MAU hasta 50.000, de modo que el motivo original de dejar al vendedor fuera de Auth ("0 MAU") no tiene sustento económico.

---

## 4. Plan por fases

Cada fase se entrega en su propia rama y PR, primero en staging (`puntosnb`) y luego en producción (`hipatia-puntos`), con criterios de aceptación verificables.

### Fase 0 — Línea base y contención (1–2 días)

Objetivo: saber qué está realmente desplegado y cerrar las tres puertas de compromiso total sin tocar los flujos de puntos.

- Obtener las reglas desplegadas en ambos proyectos y compararlas con el repo; resolver la contradicción de H-04.
- Respaldo completo de Firestore antes de cualquier cambio.
- Revisión forense mínima: usuarios con `rol` privilegiado que no correspondan, comercios con `saldoPremiosBs` sin cobro asociado, transacciones sin sesión.
- Parche de contención en reglas: inmutabilidad de `rol`, `comercioId`, `estado`, `pin` para el propio usuario; `admin_comercio` acotado a vendedores de su comercio; eliminación de la cláusula de coincidencia por correo; campos de facturación de `comercios` fuera del alcance de `admin_comercio`; `contador` sin escritura directa sobre `comercios` salvo campos de cobro.
- Eliminar de `AuthContext`/`Login` el autoaprovisionamiento por dominio, la auto-recuperación por correo y la asignación cliente de superadmin; reemplazo por script administrativo.
- Escaneo de secretos del historial (gitleaks) y `npm audit`.
- Pruebas de reglas obligatorias: el test falla (no se omite) si no hay emulador; `test:rules` ejecuta `firebase emulators:exec`.

Aceptación: prueba negativa automatizada demuestra que un cliente no puede cambiar su rol ni el de otro; que un correo no verificado no accede a documentos ajenos; que `admin_comercio` no modifica `saldoPremiosBs`. Informe de diferencias repo vs. desplegado entregado.

### Fase 1 — Backend de confianza (8–12 días)

- Andamiaje `functions/` (TS, ESLint, pruebas con emulador), región alineada con Firestore.
- Custom claims + migración (*backfill*) de usuarios existentes; señal de refresco de token en el cliente.
- `loginVendedor` con custom token; migración de PIN a hash y **rotación obligatoria de todos los PIN**.
- Funciones del libro mayor (tabla de la sección 3) y adaptación de `VendedorDashboard`, `ClienteDashboard`, `ContadorDashboard`, `AdminInfluencers`, `AdminCodigosComercio` y altas de `SuperAdminDashboard` para invocarlas.
- Bitácora `auditoria`.

Aceptación: ningún flujo de negocio escribe directamente en `transacciones`, `puntos_saldos`, `sesiones_qr`, canjes ni cobros; pruebas de integración cubren doble cobro, código expirado, colisión, saldo insuficiente de puntos y de `saldoPremiosBs`, y fuerza bruta de PIN.

### Fase 2 — Cierre de reglas y App Check (3–4 días)

- Reglas finales basadas en claims, comodín en `false`, listas blancas de campos, separación público/privado.
- Matriz de pruebas de reglas rol × colección × operación (positivas y negativas), objetivo ≥ 60 casos.
- App Check en staging y producción; *enforcement* en Firestore, Functions y Auth una vez que las métricas muestren tráfico verificado mayoritario; token de depuración solo para emulador/CI.
- TTL sobre `sesiones_qr.expiresAt`.

Aceptación: con un ID token válido de cliente y el SDK REST, toda escritura al libro mayor devuelve `PERMISSION_DENIED`; sin token de App Check, las callable rechazan.

### Fase 3 — Superficie web y limpieza (2–3 días)

- Cabeceras en `firebase.json`: CSP estricta (orígenes de Firebase, Google Identity y reCAPTCHA Enterprise; primero en `Report-Only`), HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` con `camera=(self)` (el lector QR la necesita), `frame-ancestors 'none'`; caché inmutable para `assets/` y `no-cache` para `index.html`.
- Validación de tamaño/tipo de imágenes; plan de migración de base64 en Firestore a Cloud Storage con reglas propias (también reduce el costo cuadrático ya identificado).
- Retiro de `seedDatabase.ts`, scripts de parcheo, logs y componente sin uso; `SECURITY.md` real; `lang="es"`; eliminación de `console.log` con datos.
- Política de contraseñas ≥ 12 para roles administrativos; reemplazo de `fetchSignInMethodsForEmail`.

Aceptación: calificación A en securityheaders/Mozilla Observatory; build sin código muerto señalado; `eslint` y `tsc` limpios.

### Fase 4 — Cadena de suministro y CI/CD (3–4 días)

- Migración a pnpm con lockfile congelado e `ignore-scripts`, en línea con el estándar ya adoptado en el entorno de desarrollo; versión fija de `firebase-tools` como devDependency.
- Pipeline (siguiendo el estándar DevSecOps v2 de la organización si el repo lo adopta): lint, typecheck, pruebas unitarias, pruebas de reglas con emulador, auditoría de dependencias **bloqueante** en severidad alta/crítica, gitleaks, build, despliegue a staging automático y a producción con aprobación manual sobre tag.
- Autenticación del pipeline a GCP por Workload Identity Federation (sin llaves JSON de cuenta de servicio de larga duración).
- `deploy.sh` reducido a envoltorio local para staging; se elimina el `git add . && commit && push` posterior al despliegue.

Aceptación: un PR con una regla permisiva o una dependencia vulnerable crítica no puede fusionarse; producción solo se despliega desde un tag con aprobación.

### Fase 5 — Operación y resiliencia (2–3 días)

- PITR y respaldos programados (diario 7 días, semanal 8 semanas); prueba de restauración documentada.
- Alertas: presupuesto, picos de `PERMISSION_DENIED`, bloqueos de PIN, errores de Functions, creación de usuarios privilegiados.
- Endurecimiento de Auth: protección contra enumeración de correos, dominios autorizados mínimos, MFA para superadmin/contador.
- Restricción de la API key web (referentes HTTP y APIs permitidas).
- Runbook de incidentes (revocar tokens, congelar comercio, restaurar), política de retención y minimización de PII (teléfonos), revisión trimestral de accesos IAM.

Aceptación: simulacro de restauración exitoso; alerta de prueba recibida; checklist de consola firmado.

Esfuerzo total estimado: 19–28 días de desarrollo, que **sustituyen** (no se suman a) la mayor parte de la estabilización de 35–55 días del análisis técnico-comercial, porque las funciones de servidor resuelven a la vez los defectos de monetización (bloqueo por saldo, `consumidoPremiosBs`, `premioId`, `POR_REGISTRO` repetible, cobranza atómica).

---

## 5. Intervenciones que requieren a Andrés

Todo lo demás lo ejecuta Claude Code. Estas son las únicas acciones que necesitan una consola, una credencial o una autorización personal:

| # | Cuándo | Intervención | Motivo |
|---|---|---|---|
| 1 | Inicio Fase 0 | Autenticar en la terminal cuando Claude Code lo solicite (`firebase login` y credenciales por defecto de `gcloud`). | Leer reglas desplegadas, exportar respaldo, ejecutar scripts administrativos. |
| 2 | Fin Fase 0 | Autorizar el despliegue del parche de contención a producción. | Cambio en producción. |
| 3 | Antes de Fase 1 | Pasar `puntosnb` y `hipatia-puntos` a plan Blaze y fijar alerta de presupuesto. | Requisito de Cloud Functions; implica medio de pago. |
| 4 | Fase 1 | Decidir fecha y comunicar a los comercios la rotación de PIN de vendedores. | Impacto operativo en EPICO y PIZZA NB. |
| 5 | Fase 2 | En consola de Firebase: registrar las apps en App Check (reCAPTCHA Enterprise) y activar *enforcement* cuando Claude Code reporte métricas sanas. | Solo disponible en consola. |
| 6 | Fase 4 | En GitHub: protección de rama `main`, *Environment* `production` con aprobador, y autorización de Workload Identity Federation. | Permisos de propietario. |
| 7 | Fase 5 | En consolas de Firebase/GCP: restricción de API key, protección contra enumeración, MFA de cuentas privilegiadas (requiere Identity Platform). | Configuración de cuenta. |
| 8 | Cada pase | Aprobar cada despliegue a producción. | Control de cambios. |

## 6. Decisiones abiertas

1. **Plan Blaze (recomendado) vs. permanecer en Spark.** Sin Functions solo es posible una mitigación parcial: vendedores como cuentas de Firebase Auth con correo sintético y reglas con validación cruzada (`getAfter`) entre sesión, saldo y transacción. Reduce el fraude pero no permite hash de PIN, limitación de intentos, recálculo de puntos en servidor ni cobranza atómica. No se recomienda para un producto que va a cobrar.
2. **Longitud del código manual.** Mantener 6 dígitos (usabilidad en caja) con expiración corta y límite de intentos, o pasar a 8. Recomendación: 6 dígitos + 5 min + bloqueo tras 5 fallos.
3. **Módulo de influencers.** Si comercialmente sigue indefinido, endurecerlo al mínimo (solo lectura + funciones) y posponer la liquidación.
