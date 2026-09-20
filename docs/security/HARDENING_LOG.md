# Bitácora de hardening — Hipatia Puntos

Registro persistente entre sesiones. Plan de referencia: `docs/security/HARDENING_PLAN.md`.
Convención: una entrada por sesión, con fecha, fase, decisiones tomadas, evidencia y pendientes.

## Estado por fase

| Fase | Estado | Rama | Última actualización |
|---|---|---|---|
| 0 — Línea base y contención | **cerrada** | `hardening/fase-0-linea-base` | 19-sep-2026 |
| 1 — Backend de confianza | **cerrada**: desplegada y probada en los dos entornos | `hardening/fase-1-backend-confianza` | 19-sep-2026 |
| 2 — Cierre de reglas y App Check | **desplegada en los dos entornos**; falta el *enforcement* | `hardening/fase-2-reglas-appcheck` | 19-sep-2026 |
| 3 — Superficie web y limpieza | **desplegada en los dos entornos** | `hardening/fase-3-superficie-web` | 19-sep-2026 |
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
- **H-25 (media) — corregido el 19-sep-2026 tras un error de medición.** La primera versión de esta
  entrada decía que el saldo de premios se había acreditado «sin ningún cobro registrado» porque
  `cobros_prepago` estaba vacío. **Era falso**: el script forense buscaba el campo `montoBs`, que no
  existe —el correcto es `montoPremios`—, y la corrección del script se aplicó antes de medir
  producción pero después de medir pruebas, de modo que el informe se escribió con la salida vieja.
  Con el dato correcto, `puntosnb` tiene tres cobros reales de fines de agosto y el cuadro es este:

  | Comercio | Cobrado en premios | Saldo declarado | Canjes | Consumo que correspondía | Descuadre |
  |---|---|---|---|---|---|
  | Hamburguesas NB | 150 Bs | 150 Bs | 4 | 5 Bs | el saldo **nunca bajó** |
  | Epico | 200 Bs | 190 Bs | 2 | 3 Bs | faltan 10 Bs, y solo 3 se explican por canjes |

  Lo que muestran los números es H-26 visto desde los datos —el descuento por canje no llegó a
  aplicarse nunca— y, en Epico, 10 Bs menos de lo cobrado que los canjes no explican. Es compatible
  con la escritura de saldo que hacía el navegador (`saldo leído + monto`, sobre un dato que podía
  estar desactualizado): dos pestañas o dos cobros seguidos pierden una actualización. La cobranza
  atómica de la Fase 1 cierra esa puerta; **queda pendiente decidir con Andrés si esos 10 Bs se
  reponen** a Epico.
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


---

## 19-sep-2026 · Sesión 1 · Fase 1 — Backend de confianza

Rama `hardening/fase-1-backend-confianza`, abierta desde la de Fase 0 porque esta se apoya en sus
reglas y todavía no está fusionada.

### Andamiaje

`functions/` en TypeScript estricto, Node 22, ESLint propio y vitest contra emuladores. Región
**us-central1**, verificada contra la ubicación de las dos bases: `hipatia-puntos` está en nam5
(multirregión de EE. UU.) y `puntosnb` en us-central1; us-central1 sirve a ambas sin salto de región.
`enforceAppCheck` se controla con la variable `EXIGIR_APP_CHECK`, apagada hasta cerrar la Fase 2.

Dependencias nuevas, todas oficiales de Google o de uso masivo: `firebase-functions` 7.4,
`firebase-admin` 14.4 (también como dependencia de desarrollo en la raíz, para los scripts
administrativos) y `zod` 4.6 para validar la entrada de cada función.

### Identidad del vendedor (H-04, H-22)

- `loginVendedor` compara el PIN contra un hash **scrypt con sal por usuario** guardado en
  `vendedores_secretos`, colección con reglas `if false`. Devuelve un custom token con los claims
  `rol` y `comercioId`.
- Bloqueo progresivo por cuenta y por IP: cinco intentos dentro de quince minutos bloquean quince
  minutos y revocan las sesiones vivas de esa cuenta. La IP se guarda como HMAC, no en claro, para
  no convertir la bitácora de intentos en un registro de direcciones de personas.
- Mensaje único —«Usuario o PIN incorrectos»— para usuario inexistente, PIN equivocado y cuenta sin
  PIN: el motivo real solo queda en el registro del servidor.
- `crearVendedor` da de alta una cuenta real en Firebase Auth (sin método de acceso propio), de modo
  que el vendedor pueda entrar y se le puedan revocar las sesiones. Corrige H-22.
- `rotarPinVendedor` y `bloquearVendedor` completan el ciclo; ambos acotados al comercio de quien
  los invoca. Rotar el PIN revoca las sesiones abiertas con el anterior.
- Rechaza PIN obvios (seis dígitos iguales o secuencias corridas).

**Migración de PIN:** no hizo falta. El forense de la Fase 0 confirmó que **ningún vendedor tiene el
campo `pin`** en ninguno de los dos proyectos, de modo que no hay secretos en claro que migrar ni
rotación que comunicar a EPICO o PIZZA NB. El punto 4 de la sección 5 del plan (comunicar la
rotación) queda sin objeto; los vendedores actuales siguen entrando con correo y contraseña de
Firebase Auth hasta que se les cree un PIN con el flujo nuevo.

### Libro mayor en el servidor (H-05, H-06, H-08, H-11, H-12)

| Función | Qué controla |
|---|---|
| `crearSesionAcumulacion` | Recalcula los puntos desde las reglas del comercio; código con `crypto.randomInt` reservado dentro de una transacción; vencimiento de 5 minutos; verifica el estado de prepago. |
| `reclamarAcumulacion` | Un solo uso, vencimiento, bono `POR_REGISTRO` una vez por cliente y comercio, asiento y saldo en una transacción. |
| `crearSesionCanje` / `confirmarCanje` | Saldo de puntos, `premioId` persistido y **bloqueo del canje si el comercio PREPAGO no tiene saldo en bolivianos**; lleva `consumidoPremiosBs`. |
| `canjearCodigo` | Resuelve si el código es de influencer o de comercio; vigencia, campaña aceptada, tope de la bolsa y un canje por cliente. |
| `registrarCobroPrepago` | Recalcula el monto desde la mensualidad configurada; cobro y acreditación en una sola transacción; clave de idempotencia. |
| `asignarRol`, `cambiarEstadoUsuario`, `guardarComercio` | Única vía para fijar rol, comercio y campos de facturación; graban los custom claims y revocan sesiones al degradar o bloquear. |

Desviación del plan, deliberada: en lugar de `canjearCodigoInfluencer` y `canjearCodigoComercio` se
expone **una sola** función `canjearCodigo`. El cliente ya no necesita averiguar de qué tipo es el
código —lo resuelve el servidor—, y así deja de enumerar qué códigos existen antes de canjearlos.
Las dos validaciones siguen separadas dentro de la función.

Toda operación sensible escribe en `auditoria`. Las cuatro colecciones nuevas del servidor
—`vendedores_secretos`, `auditoria`, `intentos_login_ip`, `operaciones_idempotentes`— quedan con
reglas `if false` y **excluidas del comodín del superadministrador**: ni desde el navegador de un
superadmin se puede leer el hash de un PIN.

### Cliente

`VendedorDashboard`, `ClienteDashboard`, `ContadorDashboard` y `SuperAdminDashboard` invocan las
funciones en lugar de escribir en Firestore. `AuthContext` perdió la sesión de vendedor en
`localStorage` y ahora refresca el token cuando el servidor marca `claimsUpdatedAt`.
`scripts/admin/backfill-claims.mjs` proyecta los roles existentes al token reutilizando el mismo
código compilado que usan las funciones, para que no haya dos implementaciones que diverjan.
Simulación sobre `puntosnb`: **25 cuentas recibirían claims**; 12 documentos `users` no tienen
cuenta en Firebase Auth (los duplicados de H-23 y los vendedores sintéticos de H-22).

### Verificación

| Comprobación | Resultado |
|---|---|
| `tsc -b` (cliente) y `tsc` (functions) | limpios |
| `eslint` cliente | 90 problemas (81 errores), todos preexistentes; eran 94 al empezar el hardening |
| `eslint` functions | limpio, 0 avisos |
| `npm test` | 40 pruebas |
| `npm run test:rules` | 42 pruebas, 0 omitidas |
| `npm run test:functions` | 35 pruebas de integración contra los emuladores |
| `build:prod` y `build:staging` | correctos |

Las 35 pruebas de integración cubren las negativas que pide el plan: doble reclamo del mismo código,
dos reclamos simultáneos, código expirado, bono repetido, saldo insuficiente en puntos y en
bolivianos, vendedor de otro comercio, código vencido, bolsa de influencer agotada, campaña no
aceptada, fuerza bruta de PIN, mes cobrado dos veces y reintento idempotente de un cobro.

### Despliegue en `puntosnb` — hecho el 19-sep-2026

Autorizado por Andrés. Los cuatro pasos, en orden, con su verificación:

| Paso | Resultado verificado |
|---|---|
| Funciones | 14 funciones *callable* v2 en us-central1, Node 22. El despliegue lo corrió Andrés; se verificó con `functions:list`. |
| *Backfill* de claims | 25 cuentas sincronizadas. Contraste posterior cuenta por cuenta: **cero incoherencias** entre el rol del documento y el del token. Ocho cuentas de Auth no tienen documento en `users` y quedaron sin claim. |
| Reglas | Desplegadas y comprobadas descargándolas en vivo: idénticas al repositorio. |
| *Hosting* | `puntosnb.web.app` sirve el cliente nuevo: referencia `loginVendedor`, `reclamarAcumulacion` y `registrarCobroPrepago`, y ya **no contiene** `hipatia_vendedor_session`. |

Prueba de humo contra la función real: `loginVendedor` con un PIN mal formado responde
`INVALID_ARGUMENT` con el mensaje en español y sin tocar dato alguno.

Nota de método: el primer comando de despliegue se entregó en un bloque ejecutable y lo corrió
Andrés. Corresponde que lo ejecute Claude; el resto de la secuencia se ejecutó desde aquí.

### Permiso de IAM que faltaba

La primera prueba en vivo falló: `loginVendedor` devolvía error interno. El registro de la función
mostró `iam.serviceAccounts.signBlob` denegado. Emitir un custom token exige que la cuenta de
ejecución de las funciones pueda **firmar como ella misma**, y la cuenta por defecto no trae ese
permiso. Con autorización de Andrés se concedió `roles/iam.serviceAccountTokenCreator` a
`<número de proyecto>-compute@developer.gserviceaccount.com` sobre sí misma, en los dos proyectos.
Es el arreglo documentado por Firebase y su alcance no va más allá de firmar sus propios tokens.

Queda anotado como requisito de despliegue: **cualquier entorno nuevo necesita esa concesión** antes
de que funcione el ingreso por PIN.

### Prueba de extremo a extremo contra los entornos reales

`scripts/admin/prueba-e2e.mjs` crea un comercio «PRUEBA HARDENING», un vendedor y un cliente
propios, recorre los cuatro flujos invocando las funciones desplegadas igual que el navegador, y
borra todo lo que creó. **16 comprobaciones, todas en verde en los dos proyectos**, con limpieza
verificada después (21 documentos borrados en cada corrida; cero cuentas y cero documentos de
prueba remanentes).

Entre lo que demuestra sobre el entorno real: el servidor recalcula los puntos e ignora los que
manda el cliente (pidió 99.999, recibió 20); el PIN se guarda como hash scrypt; el token del
vendedor lleva su rol firmado; un PIN incorrecto responde con el mensaje genérico; el mismo código
no se reclama dos veces; el cobro recalcula el monto y el reintento no cobra de nuevo; el canje
descuenta puntos y saldo en bolivianos y se bloquea sin saldo; y cada operación deja asiento en
`auditoria`.

### Despliegue en `hipatia-puntos` — hecho el 19-sep-2026

14 funciones creadas, 7 cuentas con claims sincronizados, reglas de Fase 1 desplegadas y `hosting`
actualizado con el cliente nuevo. La prueba de extremo a extremo pasó al primer intento y el
proyecto quedó como estaba: 0 comercios, 0 transacciones, 7 documentos en `users`.

De paso se fijó en ambos proyectos la **política de limpieza de imágenes** de `gcf-artifacts`
(borra las de más de un día): sin ella, cada despliegue deja una imagen de contenedor que se factura.

### Alertas de presupuesto — hechas el 19-sep-2026

Presupuesto de **10 USD mensuales por proyecto**, con avisos al 50 %, 90 % y 100 %, en las dos
cuentas de facturación. Los avisos llegan al correo de los administradores de facturación. Cubre el
punto 3 de la sección 5 del plan; el plan Blaze ya estaba activo en ambos proyectos desde antes.

### Estado de H-20 (clave de API web)

Verificado: **las claves ya están restringidas** por referente HTTP y por lista de APIs.
`puntosnb` admite solo `puntosnb.web.app` y `puntosnb.firebaseapp.com`; `hipatia-puntos` admite su
sitio, su dominio de Firebase y tres puertos de `localhost` (5173, 3000 y 5000), que conviene quitar
cuando ya no se use el entorno local contra producción.

Matiz que conviene tener presente: la restricción por referente **no es una barrera de seguridad**.
La prueba de extremo a extremo de esta sesión entró sin navegador, enviando la cabecera `Referer`.
La barrera real es App Check, que se activa en la Fase 2.


---

## 19-sep-2026 · Sesión 1 · Fase 2 — Cierre de reglas y App Check

Rama `hardening/fase-2-reglas-appcheck`, desde la de Fase 1.

### Reposición a Epico (decisión de Andrés)

Antes de empezar la fase se repusieron los **10 Bs** que faltaban en el saldo de premios de Epico
(H-25). Se hizo con `scripts/admin/ajustar-saldo-premios.mjs`, que escribe el ajuste y su asiento de
auditoría en una sola transacción, con el motivo y quién lo autorizó. No se inventó un cobro: lo
ocurrido fue una pérdida de saldo, no un pago. Verificado después: Epico queda en 200 Bs, exactamente
lo cobrado en premios.

Queda una decisión pendiente, menor y comercial: ni Epico (3 Bs) ni Hamburguesas NB (5 Bs) tienen
descontados los premios que sí entregaron, porque el descuento nunca llegó a aplicarse (H-26). Puede
dejarse así —a favor del comercio— o regularizarse con el mismo script.

### Reglas basadas en claims

Las reglas dejan de leer Firestore para saber quién es quien: el rol y el comercio salen de
`request.auth.token`. Desaparecen los `get()` por evaluación —que se facturaban como lecturas— y,
sobre todo, desaparece la posibilidad de que un documento editable decida un permiso.

- **Comodín final en `false`.** Una colección nueva nace cerrada; se abre explícitamente o no se abre.
- **El libro mayor es de solo lectura para el cliente**, y solo de lo propio: cada quien ve sus
  transacciones, sus saldos y los de su comercio.
- **Listas blancas** para lo único que el cliente escribe: su perfil (nombre, teléfono, paleta,
  avatar, aceptación de términos) y el catálogo del comercio (reglas, premios, productos, logo,
  paleta).

### División del comercio

`comercios/{id}` conserva el perfil público. `comercios_privado/{id}` recibe NIT, razón social,
plan, mensualidad, costos, saldo prepagado y meses pagados, y solo lo leen el superadministrador,
el contador y el administrador de ese comercio.

Para que la interfaz siga funcionando sin ver montos, el servidor deja en el documento público dos
señales derivadas: `operativoHasta` y `puedeCanjearPremios`. `checkComercioPrepagoStatus` usa las
señales cuando no hay datos privados y el cálculo completo cuando los hay.

Los influencers pasan a tener un perfil público mínimo en `influencers_publico`: su teléfono y su
correo dejan de estar a la vista de cualquier comercio (H-16).

### Lo que faltaba mover al servidor

Funciones nuevas: `crearCodigoComercio` y `cambiarEstadoCodigoComercio` (el código promocional se
cobra del saldo en la misma transacción en que se crea), `gestionarAsignacionInfluencer` y
`gestionarCodigoInfluencer` (la bolsa de puntos es moneda: la pone el comercio, nunca el
influencer), `anularCobroPrepago` —que se niega a anular si el comercio ya gastó ese saldo— y
`conciliarCobroPrepago`, `cambiarEstadoComercio` y `actualizarPerfilInfluencer`.

### App Check

La aplicación lo inicializa ahora en **los dos entornos**, no solo en producción, con token de
depuración en desarrollo, y deja de silenciar los errores de arranque (H-10). Las funciones ya
aceptan exigirlo con la variable `EXIGIR_APP_CHECK`.

Lo que falta es de consola y está en `docs/security/CHECKLIST_APPCHECK.md`: registrar las
aplicaciones con reCAPTCHA Enterprise, observar las métricas y activar la exigencia cuando más del
95 % de las solicitudes se vean verificadas durante dos días.

### TTL e índices

`firestore.indexes.json` queda versionado, con los índices compuestos que usan las consultas del
backend y con la política **TTL sobre `sesiones_qr.expiresAt`**: las sesiones vencidas se borran
solas en lugar de acumularse (hay 56 en pruebas, 24 de ellas pendientes desde hace más de un día).

### Verificación

| Comprobación | Resultado |
|---|---|
| `tsc` cliente y functions | limpios |
| `eslint` cliente | 76 problemas (69 errores) preexistentes; eran 94 al empezar el hardening |
| `eslint` functions | limpio |
| `npm test` | 40 pruebas |
| `npm run test:rules` | **345 pruebas**, matriz rol × colección × operación |
| `npm run test:functions` | **50 pruebas** de integración |
| `build:prod` y `build:staging` | correctos |

La matriz de reglas cubre once identidades (incluida la anónima y una con token sin rol) contra
quince colecciones, en lectura y escritura, más los casos de lista blanca y de frontera entre
comercios. El plan pedía sesenta casos como objetivo.

### Despliegue en `puntosnb` — hecho el 19-sep-2026

Autorizado por Andrés. Los cuatro pasos en el orden previsto, que evita dejar la interfaz sin datos
en ningún momento, y su verificación:

| Paso | Resultado verificado |
|---|---|
| Funciones | 22 funciones *callable* en us-central1. |
| *Hosting* | El cliente publicado invoca las funciones nuevas y trae App Check en el paquete. |
| Reglas e índices | Reglas en vivo idénticas al repositorio; índices desplegados; TTL sobre `sesiones_qr.expiresAt` en estado `CREATING`. |
| Migración | Los cuatro comercios quedaron divididos: **ningún campo privado permanece en el documento público**, los saldos están en `comercios_privado` y las dos señales derivadas quedaron calculadas. Tres perfiles públicos de influencer creados. |

Comprobaciones adicionales contra el entorno real:

- Lectura anónima de `comercios`, `comercios_privado` y `users`: **403** en los tres casos.
- Prueba de extremo a extremo: **16 de 16 en verde**, ahora contra los datos divididos, con limpieza
  verificada (22 documentos borrados).
- La auditoría del proyecto conserva un solo asiento: el ajuste de saldo de Epico. Los asientos que
  generó la prueba se borraron con el resto de sus datos.

### Pendiente para cerrar la fase

- Desplegar la misma secuencia en `hipatia-puntos`.
- Registrar las aplicaciones en App Check y activar el *enforcement* cuando las métricas lo
  permitan (`docs/security/CHECKLIST_APPCHECK.md`). Luego, redesplegar las funciones con
  `EXIGIR_APP_CHECK=true`.


---

## 19-sep-2026 · Sesión 1 · Imágenes y App Check

### Medición: el peso está en las fotos, no en los datos

`scripts/admin/medir-datos.mjs` sobre `puntosnb`: 0,21 MB en total, de los cuales **0,13 MB son
imágenes en base64** (dos comprobantes de 47 y 42 KB y un catálogo de productos de 45 KB). Los
datos de negocio ocupan 0,04 MB: **36 transacciones pesan 11,6 KB entre todas**. Producción, 2,1 KB.

Lo caro no es guardarlas: `ClienteDashboard` lee todos los comercios y cada lectura arrastra las
fotos del catálogo. Con cincuenta comercios serían cientos de KB por apertura, facturados como
lectura de Firestore.

### Transformación en el navegador, antes de enviar

`src/utils/imageOptimizer.ts` se reescribió con presupuestos por uso —logotipo 25 KB, producto y
premio 40 KB, avatar 20 KB, comprobante 90 KB—, elige **WebP** cuando el navegador lo soporta, baja
calidad y luego tamaño hasta entrar en el presupuesto, valida el tipo y rechaza archivos de más de
15 MB antes de decodificarlos.

El servidor dejó de aceptar lo que el navegador ya no manda: comprobante hasta 140.000 caracteres,
logotipo hasta 40.000, y las reglas rechazan un logotipo sin reducir en la escritura del catálogo.

El plan para sacar las imágenes de Firestore quedó en `docs/security/PLAN_IMAGENES_STORAGE.md`,
propuesto para después de la Fase 4.

### Hallazgo O-03 — el entorno de pruebas nunca tuvo App Check

Al verificar la CSP con el emulador de hosting, la consola del navegador mostró
«Falta VITE_RECAPTCHA_SITE_KEY». La variable existía en `.env.staging` **con el valor vacío**, de
modo que App Check no llegaba a inicializarse en `puntosnb`: el tráfico verificado habría quedado
en 0 % indefinidamente y la exigencia nunca se habría podido activar.

Se completó con la clave que ya estaba registrada en App Check para ese proyecto —es un valor
público, viaja en el paquete— y se comprobó que ahora sí llega al `build`. Producción no tenía el
problema: su clave estaba bien y coincide con la registrada.

Esto explica la primera medición de métricas: 0 % verificado, con 144 solicitudes marcadas como
`MISSING_OUTDATED_CLIENT`. El error del cliente dejó de silenciarse justamente para que esto se
note, y la tarea programada que vigila las métricas tiene instrucción de avisar si a las 24 horas
sigue en cero.

### Monitoreo de App Check

Tarea programada «App Check Hipatia», a las 9:00 y 21:00. Informa el porcentaje verificado por
proyecto y servicio, los motivos de lo no verificado y la tendencia, y avisa cuando se cumpla el
criterio para exigir: **más del 95 % durante dos días**, primero en `puntosnb`, un día de uso real,
después en `hipatia-puntos`, y al final el redespliegue de las funciones con `EXIGIR_APP_CHECK=true`.

---

## 19-sep-2026 · Sesión 1 · Fase 3 — Superficie web y limpieza

### Cabeceras y caché

En `firebase.json`: HSTS con `preload`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
`Cross-Origin-Opener-Policy: same-origin-allow-popups` —que el inicio de sesión con Google
necesita— y `Permissions-Policy` con `camera=(self)`, porque el lector de códigos la usa, y todo
lo demás en vacío.

La **CSP va en modo informe**, como pide el plan, con los orígenes reales del build: Firebase,
Google Identity y reCAPTCHA Enterprise. Se retiró `upgrade-insecure-requests`, que el navegador
ignora en modo informe y solo ensuciaba la consola; vuelve cuando la política pase a bloqueo.

Caché: un año e inmutable para los archivos con huella en el nombre, `no-cache` para el índice.

Verificado sirviendo el `build` con el emulador de hosting y abriéndolo en un navegador real: la
página carga **sin una sola violación de CSP** y sin errores en consola.

### Limpieza (H-18)

Fuera `src/utils/seedDatabase.ts` —traía contraseñas `123456`—, `update_superadmin.py`,
`fix_colors.cjs`, `firestore-debug.log`, `PhoneVerification.tsx` y `src/utils/qr.ts`, que quedó sin
uso cuando el servidor pasó a generar los códigos. `lang="es"` en el índice.

El `console.log` de `ContadorDashboard` que volcaba los correos de los superadmins desapareció: el
cobro ahora deja una notificación pendiente en `notificaciones`, colección del servidor, lista para
conectar el envío real en la Fase 5.

El simulador de QR del superadministrador pasa por `crearSesionAcumulacion` —con el comercio como
parámetro, algo que solo el superadministrador puede hacer— en lugar de escribir en `sesiones_qr`,
que las reglas de la Fase 2 ya no permiten.

### Credenciales (H-19)

`src/utils/password.ts`: mínimo de **doce caracteres** para cuentas administrativas, rechazo de
palabras comunes, del propio correo y del carácter repetido, y aceptación de frases largas aunque
tengan pocas clases de caracteres. Lo usan el alta de cuentas y el cambio de contraseña.

Se retiró `fetchSignInMethodsForEmail`, incompatible con la protección contra enumeración de
correos: el mensaje de error ahora sugiere Google sin confirmar si la cuenta existe.

`SECURITY.md` dejó de ser la plantilla de GitHub: tiene canal de reporte, alcance, plazos de
respuesta y una descripción honesta del modelo de seguridad vigente.

### Verificación

| Comprobación | Resultado |
|---|---|
| `tsc` cliente y functions | limpios |
| `eslint` cliente | 63 problemas (56 errores); eran 94 al empezar el hardening |
| `npm test` | 54 pruebas (7 de imágenes y 7 de contraseñas, nuevas) |
| `npm run test:rules` | 347 pruebas |
| `npm run test:functions` | 50 pruebas |
| `build:prod` y `build:staging` | correctos |
| Cabeceras servidas | verificadas con el emulador de hosting, ruta por ruta |
| CSP en un navegador real | cero violaciones en la pantalla de acceso |

### Despliegue de las fases 2 y 3 — hecho el 19-sep-2026

`puntosnb` recibió la Fase 3 sin novedades. Producción fue otra historia y dejó dos lecciones.

#### La cuota de CPU de Cloud Run

`hipatia-puntos` tiene un límite de **20 CPU en us-central1**. Veintidós funciones reservando diez
instancias de una CPU cada una piden 220: el despliegue falló con
«Quota exceeded for total allowable CPU per project per region», y los reintentos acumularon
**81 revisiones que reservaban 431 CPU entre todas**.

Se corrigió en dos frentes:

1. Cada función pasa a **un cuarto de CPU y dos instancias** —sobra para leer y hacer una
   transacción corta—, salvo `loginVendedor`, que deriva el hash scrypt del PIN y conserva una CPU
   entera. El techo bajo además acota lo que puede costar un bucle descontrolado.
2. Con autorización de Andrés se borraron las revisiones obsoletas y, cuando eso no alcanzó —la
   revisión que seguía sirviendo era la vieja, de diez instancias—, las dieciocho funciones que no
   levantaban, que el mismo despliegue recreó con el tamaño nuevo.

#### El permiso de invocación se pierde al recrear una función

Tras recrearlas, la prueba de extremo a extremo fallaba con 403. Las funciones recreadas quedaron
**sin el `roles/run.invoker` para `allUsers`** que Firebase les pone al crearlas. Es la
configuración normal de una función *callable*: la autenticación la verifica la propia función con
el token de Firebase; sin ese permiso, ni siquiera llega a ejecutarse. Se restituyó en las 22.

**Queda anotado como parte del procedimiento:** si alguna vez hay que borrar y recrear funciones,
hay que volver a conceder ese permiso, o el cliente recibe 403 sin explicación.

#### Resultado

| | `puntosnb` | `hipatia-puntos` |
|---|---|---|
| Funciones | 22, sanas | 22, sanas |
| Reglas | Fase 3, idénticas al repositorio | Fase 3 |
| Cliente | publicado, con cabeceras y App Check | publicado |
| Migración de datos | hecha | hecha (no había datos que dividir) |
| Prueba de extremo a extremo | 16/16 | **16/16** |

### Versión en pantalla

A pedido de Andrés, y en línea con lo que la Fase 4 del plan ya preveía, la versión que se muestra
sale de la **etiqueta de git** (`git describe --tags --always`), con el hash corto del commit
mientras no haya etiquetas, en lugar del número de `package.json` que nadie actualizaba. Se ve en
los dos entornos: en pruebas como hasta ahora, en producción discreta junto al nombre.

Falta crear la primera etiqueta, `v1.3.0`, y con la Fase 4 el despliegue a producción pasará a
hacerse solo desde una etiqueta, con aprobación.
