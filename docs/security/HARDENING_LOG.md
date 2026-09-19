# Bitácora de hardening — Hipatia Puntos

Registro persistente entre sesiones. Plan de referencia: `docs/security/HARDENING_PLAN.md`.
Convención: una entrada por sesión, con fecha, fase, decisiones tomadas, evidencia y pendientes.

## Estado por fase

| Fase | Estado | Rama | Última actualización |
|---|---|---|---|
| 0 — Línea base y contención | **cerrada** | `hardening/fase-0-linea-base` | 19-sep-2026 |
| 1 — Backend de confianza | no iniciada | — | — |
| 2 — Cierre de reglas y App Check | no iniciada | — | — |
| 3 — Superficie web y limpieza | no iniciada | — | — |
| 4 — Cadena de suministro y CI/CD | no iniciada | — | — |
| 5 — Operación y resiliencia | no iniciada | — | — |

---

## 19-sep-2026 · Sesión 1 · Fase 0

### Traslado del repositorio

El repositorio se copió íntegro (incluidos `.git`, archivos ignorados `.env`, `.firebase/` y
`node_modules/`) desde `~/.gemini/antigravity/scratch/PuntosNB-app/` a `~/Hipatia/`, que pasa a ser
la ubicación oficial de trabajo. Verificado con `git fsck` (sin errores) y `git status` (árbol limpio).
El remoto `origin` se mantiene: `git@github.com:andresalberdi/PuntosNB.git`.

Los documentos de trabajo que ya estaban en `~/Hipatia/` (plan de hardening, prompt, análisis
técnico-comercial, modelo de rentabilidad y `Claude outputs/`) no forman parte del repositorio y se
excluyeron localmente en `.git/info/exclude` para que no se versionen por accidente.

### Inventario (Fase 0, paso 1)

- **Árbol de trabajo:** limpio, sin cambios sin versionar.
- **Ramas locales:** `main`, `feature/influencers`, `chore/hardening-base`.
- **Rama activa al copiar:** `feature/influencers`.
- **Remoto:** `origin/main` en `4ff237c` («chore(seguridad): base de hardening — licencia, Dependabot
  y CodeQL»), más 13 ramas de Dependabot abiertas. No hay etiquetas.
- **`chore/hardening-base` == `origin/main`** (0 commits de diferencia): ya está fusionada en el remoto.
- **`main` local:** 1 commit por detrás de `origin/main`.

#### Hallazgo O-01 — el código real del producto no está en GitHub

`feature/influencers` está **35 commits por delante de `main`** y **no existe en el remoto**:
7.495 líneas añadidas y 2.055 eliminadas en 38 archivos, entre ellos
`src/pages/InfluencerDashboard.tsx`, `src/pages/ContadorDashboard.tsx`,
`src/components/AdminInfluencers.tsx`, `src/components/AdminCodigosComercio.tsx`,
`src/contexts/LoadingContext.tsx`, `src/utils/{influencers,recaptcha,imageOptimizer}.ts` y las pruebas
unitarias de prepago y usuarios.

Consecuencias:

1. Ese trabajo solo existía en una copia local dentro de un directorio de *scratch*; hasta este
   traslado, un borrado del directorio lo habría perdido por completo.
2. El plan de hardening auditó **ese** estado (cita `InfluencerDashboard.tsx` y `AdminInfluencers.tsx`,
   que no están en `main`). Por tanto la línea base del hardening es `feature/influencers`, no `main`.
3. La regla del plan «una rama por fase desde `main`» no es aplicable tal cual hasta resolver la
   divergencia.

**Decisión provisional:** la rama `hardening/fase-0-linea-base` se creó desde `feature/influencers`
para no trabajar sobre una base que no refleja lo desplegado. La publicación en GitHub queda
pendiente de autorización (escritura en GitHub).

### Herramientas verificadas en el entorno

`node v24.20.0`, `npm 12.0.2`, `pnpm 11.25.0`, `firebase-tools 15.27.0`, `gcloud 583.0.0`,
`gitleaks 8.30.1`, `gh 2.97.0`.

### Credenciales

La cuenta activa de `firebase-tools` (`esaalberdi@gmail.com`) **no** tiene acceso a los proyectos del
producto. La cuenta `alberdi.andres@gmail.com` sí ve `hipatia-puntos` y `puntosnb`. Para no mutar el
estado compartido de la CLI (`firebase login:use` afecta a otras sesiones abiertas), todos los comandos
se ejecutan con la opción `--account alberdi.andres@gmail.com`. No se requiere una nueva autenticación.

### Resolución de O-01

Andrés autorizó publicar la rama. `feature/influencers` está en GitHub y el PR
[#17](https://github.com/AndresAlberdi/PuntosNB/pull/17) propone su fusión a `main`. La fusión la
decide él; ningún agente aprueba ni fusiona por iniciativa propia.

---

## Línea base del estado desplegado (Fase 0, paso 2)

Las reglas desplegadas se descargaron con la API de Firebase Rules usando la cuenta
`alberdi.andres@gmail.com` y se guardaron en `docs/security/baseline/`.

| Proyecto | Ruleset | Desplegado | Diferencia con `firestore.rules` |
|---|---|---|---|
| `puntosnb` | `3c8ae899…` | 29-ago-2026 | **Ninguna**: idéntico al repositorio. |
| `hipatia-puntos` | `3dab545e…` | 25-ago-2026 | Versión anterior: sin `contador`, sin `cobros_prepago`, sin `codigos_comercio` y sin la cláusula de coincidencia por correo. |

### Hallazgo O-02 — lo que se llama «producción» está vacío; el piloto real corre en `puntosnb`

La revisión forense de solo lectura (`scripts/admin/forense-lectura.mjs`) arroja:

| | `hipatia-puntos` («producción») | `puntosnb` («pruebas») |
|---|---|---|
| Comercios | 0 | 4 (Epico, Pizza NB, Hamburguesas NB, BRUCRAFT) |
| Clientes | 4 | 21 |
| Vendedores | 0 | 5 |
| Transacciones | 0 | 36 |
| Sesiones QR | 0 | 56 |
| Superadmins | 3 | 3 |

Los sitios confirman la separación: `hipatia-puntos.web.app` apunta al proyecto `hipatia-puntos` y
`puntosnb.web.app` al proyecto `puntosnb`. **EPICO y PIZZA NB operan sobre `puntosnb`.**

Consecuencia para el plan: el parche de contención, el respaldo, el PITR y las alertas deben
aplicarse **primero a `puntosnb`**, que es donde están los datos reales, aunque el plan lo nombre
como entorno de pruebas. Se registra como **H-21 (severidad alta): el entorno con datos reales no
tiene respaldo, PITR ni tratamiento de producción.**

### Resolución de H-04 — el vendedor no opera hoy por PIN

Contradicción resuelta: no hay reglas más permisivas desplegadas. Una consulta anónima a
`users` (`rol == 'vendedor'`) devuelve **HTTP 403 en los dos proyectos**, de modo que la búsqueda
del vendedor que `Login.tsx` hace *antes* de autenticar siempre falla. Los datos lo confirman:
**ningún vendedor tiene el campo `pin`** y tres de los cinco de `puntosnb` existen como cuentas de
Firebase Auth. Los vendedores entran, entonces, con correo y contraseña de Firebase Auth; el flujo
de PIN es código muerto que solo se activa si la contraseña tecleada tiene exactamente 6 dígitos,
en cuyo caso el ingreso falla.

Los PIN **no** están expuestos porque no existen. Se mantiene la rotación prevista en la Fase 1 para
el flujo nuevo, pero no hay una fuga que contener hoy.

Derivado: **H-22 (media)** — `SuperAdminDashboard` crea vendedores con un uid sintético
(`vend_<timestamp>`) que no existe en Firebase Auth y con el PIN en claro en `users`. Todo vendedor
creado con esa pantalla queda imposibilitado de entrar. Se corrige en la Fase 1 con `loginVendedor`.

### Otros hallazgos del forense (nuevos, sobre `puntosnb`)

- **H-23 (media):** cinco correos de cliente tienen documentos `users` duplicados (dos o tres cada
  uno), efecto de la auto-recuperación por correo que se elimina en esta fase. Sus saldos quedan
  fragmentados entre UID. Requiere una migración de consolidación, propuesta para la Fase 1.
- **H-24 (media):** tres de 36 transacciones no tienen un vendedor válido de su comercio.
- **H-25 (alta):** `Hamburguesas NB` (saldo 150 Bs) y `Epico` (saldo 190 Bs) tienen saldo de premios
  **sin ningún cobro registrado** en `cobros_prepago`, que está vacío. El saldo se acreditó por fuera
  del flujo de cobranza. Encaja con H-07 y se cierra al mover la acreditación a Cloud Functions.
- Los saldos de puntos sí cuadran: 17 saldos contra 36 transacciones, **cero descuadres**.
- 24 de 56 sesiones QR llevan más de 24 horas en `PENDIENTE` (sin TTL; previsto en la Fase 2).

### Escaneo de secretos e inventario de dependencias (Fase 0, paso 8)

`gitleaks detect` sobre los 99 commits del historial: **6 hallazgos, todos valores públicos por
diseño** (claves web de Firebase en `.env.production`, `.env.staging` y `src/firebase.ts`, y la clave
de sitio de reCAPTCHA). No hay cuentas de servicio, tokens ni PIN en el historial. Queda pendiente
restringir la clave de API en GCP (H-20, Fase 5).

`npm audit`: 7 vulnerabilidades (4 altas, 3 moderadas) en dependencias de desarrollo transitivas
(`undici`, `nanoid`, `browserslist`), todas con corrección disponible. Se resuelven en la Fase 4 con
la migración a pnpm y la auditoría bloqueante.

---

## Informe de la Fase 0

**1. Estado:** cerrada. Respaldo hecho y parche desplegado y verificado en los dos entornos.

**2. Hallazgos cubiertos**

| Hallazgo | Cambio | Prueba que lo demuestra |
|---|---|---|
| H-01 autoescalada de rol | `users`: lista blanca de campos propios; `rol`, `comercioId`, `estado` y `pin` fuera del alcance del cliente; `admin_comercio` acotado a vendedores de su comercio | `firestore.rules.test.ts` → «un cliente NO puede convertirse en superadmin», «…asignarse un comercio», «…desbloquearse a sí mismo», «…ponerse un PIN de vendedor», «un admin_comercio NO puede cambiar el rol de su vendedor» |
| H-02 toma de cuenta por correo | Se elimina la cláusula `resource.data.email == request.auth.token.email` en lectura y escritura; se elimina la auto-recuperación de `AuthContext` | «un usuario con el mismo correo NO puede leer/escribir el documento ajeno» |
| H-03 autoaprovisionamiento por dominio | El alta propia solo admite `rol: 'cliente'` sin `comercioId`; se elimina el bloque de aprovisionamiento por dominio de `AuthContext` | «un usuario nuevo NO puede crearse como admin_comercio / vendedor / superadmin»; «SÍ puede crearse a sí mismo como cliente» |
| H-07 campos de facturación | `comercios`: el comercio solo edita `reglas`, `premios`, `productos`, `logoUrl`, `paletteId`; el contador solo `saldoPremiosBs`, `mesesPagados`, `modalidadPago` | «un admin_comercio NO puede acreditarse saldo / pasarse a premium / marcarse meses pagados / desbloquear su comercio»; «un contador NO puede cambiar el plan ni la mensualidad» |
| H-09 superadmin decidido por el cliente | Se retira `SUPER_ADMIN_EMAILS` del bundle y toda asignación de rol desde `Login.tsx`; se crea `scripts/admin/set-superadmin.mjs` (Admin SDK + ADC, idempotente, `--dry-run`) | `env.test.ts` → «no expone ninguna lista de superadministradores en el cliente»; `grep` sobre `dist/`: 0 coincidencias |
| H-15 pruebas que pasan sin probar | Se eliminan los `ctx.skip()`; `npm run test:rules` levanta el emulador con `firebase emulators:exec` | 31 casos ejecutados, 0 omitidos |
| H-04 vendedor sin identidad | Resuelto como diagnóstico (ver arriba); la corrección es de la Fase 1 | «rechaza leer usuarios sin autenticación (flujo de PIN del vendedor)» |

**3. Cambios**

- `ddb4d6f` — plan y bitácora en `docs/security/`.
- `bc53f23` — reglas de contención, limpieza de `AuthContext`/`Login`/`utils/env`, scripts de
  administración, pruebas de reglas y configuración de `test:rules`.
- Sin migraciones de datos. Reversión: `git revert bc53f23` y redesplegar las reglas anteriores, que
  están guardadas en `docs/security/baseline/`.

**4. Evidencia de verificación**

| Comprobación | Resultado |
|---|---|
| `tsc -b` | limpio |
| `eslint .` | 99 problemas (92 errores), todos preexistentes; antes de la fase eran 101 (94 errores). La Fase 0 no introdujo ninguno y corrigió dos. La deuda de `any` se limpia en la Fase 3. |
| `npm test` | 9 archivos, 40 pruebas, todas pasan |
| `npm run test:rules` | 31 pruebas, todas pasan, **0 omitidas** |
| `npm run build:prod` | correcto |
| `npm run build:staging` | correcto |
| Correos de superadmin en `dist/` | 0 |
| `gitleaks detect` | 6 hallazgos, todos configuración pública |
| `npm audit` | 7 vulnerabilidades (4 altas) preexistentes, Fase 4 |

**5. Requiere intervención de Andrés**

1. **Autorizar el respaldo de `puntosnb`** (exportación de Firestore a un bucket de Cloud Storage).
   Es una escritura en GCP: crea el bucket y el volcado. Se ejecuta antes de tocar las reglas.
2. **Autorizar el despliegue del parche de contención**, primero a `puntosnb` (donde están los datos
   reales, O-02) y después a `hipatia-puntos`.
3. **Decidir la fusión del PR #17** a `main`.

**6. Riesgo residual y siguiente fase**

Quedan abiertos, por diseño de fases: el libro mayor escribible por el cliente (H-05, H-06), la
sesión de vendedor sin identidad (H-04), los canjes de códigos sin validación (H-08) y App Check sin
enforcement (H-10). Ninguno permite hoy tomar el control de la plataforma; sí permiten fraude de
puntos dentro de un comercio. La Fase 1 (backend de confianza) los cierra.

### Respaldo previo (Fase 0, paso 3) — hecho

Autorizado por Andrés el 19-sep-2026. Exportación completa de Firestore de `puntosnb`:

- Bucket: `gs://puntosnb-respaldos-firestore` (us-central1, acceso uniforme), creado para esto.
- Volcado: `gs://puntosnb-respaldos-firestore/fase0-20260919-1913/` — 239 KB, metadatos de
  exportación y tres archivos de salida, todas las colecciones.
- Ambos proyectos ya están en plan Blaze (facturación habilitada), de modo que el punto 3 de la
  sección 5 del plan queda cubierto salvo por la alerta de presupuesto, que sigue pendiente.

### Verificación de la relación entre los dos proyectos

A pedido de Andrés se contrastó la afirmación «`puntosnb` es la versión de pruebas de
`hipatia-puntos`». Es correcta como arquitectura, y los datos añaden un matiz que importa para el
plan: en producción no ha ocurrido nunca una operación real.

| | `hipatia-puntos` (producción) | `puntosnb` (pruebas) |
|---|---|---|
| Cuentas en Firebase Auth | 8 | 33 |
| Último inicio de sesión | 22-jul-2026 | 25-ago-2026 |
| Comercios | 0 | 4 |
| Transacciones | 0 | 36 (la última, 29-ago-2026) |
| Sesiones QR | 0 | 56 |
| Bases de datos Firestore | solo `(default)`, nam5 | solo `(default)`, us-central1 |

No hay una segunda base de datos donde pudieran estar los datos de producción. El orden de trabajo
es el habitual —`puntosnb` primero, `hipatia-puntos` después—, con la salvedad de que el entorno de
pruebas es, hoy, el único que contiene datos que duele perder: de ahí el respaldo y H-21.

### Despliegue del parche a `puntosnb` — hecho

Autorizado por Andrés el 19-sep-2026. `firebase deploy --only firestore:rules --project puntosnb`.
Ruleset `19f63a5e…` y, tras el ajuste de H-26, el ruleset vigente. Verificado descargando las reglas
en vivo y comparándolas con `firestore.rules`: **idénticas**. La lectura anónima sigue devolviendo 403.

### Despliegue del parche a `hipatia-puntos` — hecho

Autorizado por Andrés el 19-sep-2026, minutos después del de pruebas. Verificado igual: las reglas
en vivo son idénticas a `firestore.rules`. Producción corría hasta ahora una versión de reglas de
agosto sin `contador`, `cobros_prepago` ni `codigos_comercio`; los dos entornos quedan por fin
alineados.

Compatibilidad con el *bundle* viejo que sigue servido en `hipatia-puntos.web.app` (del 25-ago): el
alta de cliente por Google escribe exactamente los campos de la lista blanca, y la asignación de
superadmin desde el cliente no llega a dispararse porque las tres cuentas ya tienen el rol. Los
intentos de auto-recuperación quedan denegados, que es justo lo que se busca.

#### Hallazgo H-26 (alta) — el canje en comercios PREPAGO está roto desde antes del hardening

`VendedorDashboard` descuenta `comercios.saldoPremiosBs` dentro de la transacción de canje cuando el
comercio es PREPAGO. Se revisaron **las doce versiones de reglas desplegadas en `puntosnb`** desde
junio: ninguna permitió nunca al rol `vendedor` escribir en `comercios`. Como la escritura va dentro
de una transacción, el canje completo falla. Los ocho canjes registrados son todos anteriores a que
esos comercios pasaran a PREPAGO, y los registró siempre un `vendedor`.

Decisión tomada: el parche conserva para `admin_comercio` el descuento que ya tenía, pero **solo
hacia abajo** (`saldoPremiosBs` puede bajar, nunca subir), de modo que el hardening no agrava el
problema y la autoacreditación —el riesgo real de H-07— sigue cerrada. La corrección de fondo
(recalcular el consumo en el servidor, bloquear el canje sin saldo y llevar `consumidoPremiosBs`)
es de la Fase 1, tal como ya estaba previsto en el plan.

### Pendientes inmediatos

- Despliegue del parche a `hipatia-puntos` (producción), con autorización.
- Alerta de presupuesto en ambos proyectos (el plan Blaze ya está activo en los dos).
- Al abrir la Fase 1: corregir H-22 (alta de vendedores que no pueden entrar) y planificar la
  consolidación de los `users` duplicados (H-23).
