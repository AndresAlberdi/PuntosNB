# Lo que queda por hacer, y quién puede hacerlo

Estado al 20-sep-2026 (tarde), después de las fases 0 a 4 del plan de hardening y de la
tanda de calidad y dependencias.

## 0. Permisos de la cuenta de despliegue — hecho

Concedidos el 20-sep-2026 con autorización de Andrés, en los dos proyectos: consulta del estado
de las APIs, administración de índices de Firestore, funciones, Cloud Run, Artifact Registry y
Cloud Build. Con ellos **el pipeline despliega a pruebas por su cuenta**, y quedó verde de punta a
punta.

## 1. Fusionar la cadena a `main` — hecho

Hecho el 20-sep-2026, con su aprobación registrada en el PR y el pipeline en verde. `main`
contiene ahora el código del producto, las fases 0 a 3 y el estándar DevSecOps. Los PR #17, #18 y
#19 se cerraron sin fusionar: verificado por contenido que no aportaban nada, y fusionarlos
habría **deshecho** trabajo (reintroducían `package-lock.json`, reglas anteriores al cierre de la
Fase 2 y los archivos que la limpieza retiró).

## 2. App Check: activar la exigencia — **solo usted**

Hoy está en modo informe, que era lo correcto hasta ahora. Falta que el tráfico verificado suba,
y recién entonces exigirlo.

Antes de este trabajo el porcentaje era **0 % en los dos entornos**, y no por falta de tiempo:
la clave de reCAPTCHA que usaban ambos solo admitía `hipatiabo.com`. Eso ya está corregido —
pruebas tiene su propia clave y producción admite sus dominios—, así que el contador empieza a
correr de verdad ahora.

La tarea programada «App Check Hipatia» le informará a las 9:00 y 21:00. Cuando le avise que se
cumplió el criterio (más del 95 % verificado durante dos días):

1. Consola de Firebase → **App Check → APIs**, en `puntosnb`: *Aplicar forzosamente* en
   **Cloud Firestore** y en **Authentication**.
2. Espere un día de uso real.
3. Lo mismo en `hipatia-puntos`.
4. Avíseme y redespliego las funciones con `EXIGIR_APP_CHECK=true`.

Detalle completo en `CHECKLIST_APPCHECK.md`.

## 2b. Protección de `main`: exigir una aprobación — **solo usted**

`main` exige un PR, pero **cero aprobaciones**. Es la alerta #18 de code scanning (Scorecard,
severidad alta). Intenté aplicarlo yo y la salvaguarda de Claude Code lo bloqueó como «CI
Bypass»: un agente reescribiendo las reglas de protección se ve igual si las endurece que si las
relaja, así que es correcto que lo haga una persona. Son dos cambios en la interfaz de GitHub:

1. [Ruleset `proteger-main`](https://github.com/AndresAlberdi/PuntosNB/settings/rules/23717532)
   → *Require a pull request before merging* → **Required approvals: 1** → *Save changes*.
2. [Ruleset `main-protegida`](https://github.com/AndresAlberdi/PuntosNB/settings/rules/22152416)
   → *Delete ruleset*. Es un residuo: solo impide borrado y *force-push*, y `proteger-main` ya
   cubre ambas cosas sobre la misma rama. Verificado que eliminarlo no quita ninguna protección.

**Qué cambia en la práctica.** Casi nada para usted, porque la salvaguarda de Claude Code ya exige
hoy su aprobación en mis PR. Lo que se gana es que GitHub también la exija, y eso protege contra
cualquier otra vía: otro colaborador, un token filtrado. Los PR de Dependabot los sigo aprobando
yo, porque no son míos. Un detalle: como está activo *descartar aprobaciones al actualizar la
rama*, siempre pondré el PR al día **antes** de pedirle el clic, para que no tenga que repetirlo.

## 2c. Vulnerabilidades medias con fecha de compromiso: 20 de octubre de 2026

Seis vulnerabilidades de severidad **media**, todas transitivas de `firebase-tools`, es decir de
desarrollo. Ninguna figura en las dependencias de producción, así que no llegan al artefacto que
se despliega. No bloquean la compuerta (`BLOQUEAR_EN=CRITICAL,HIGH`), pero el estándar pide
corregirlas o fecharlas a 30 días.

| Paquete | Aviso | Corregida en |
|---|---|---|
| `uuid` | GHSA-w5hq-g745-h8pq | 12.0.1 |
| `@opentelemetry/core` | GHSA-8988-4f7v-96qf | 2.8.0 |
| `csv-parse` | GHSA-8cw4-87c7-c6xx | 7.0.2 |
| `qs` | GHSA-4mjr-xmp4-gh2g, GHSA-x5fp-wj9c-mxmx | 6.16.0 |
| `stream-json` | GHSA-528h-pc64-c93x | 3.5.0 |

El PR #44 de Dependabot sube `firebase-tools` y probablemente resuelva varias. Se revisa al
fusionarlo.

## 2d. Diez PR nuevos de Dependabot (#35–#44)

Aparecieron al declarar `/functions` en Dependabot: esas dependencias del backend llevaban meses
sin vigilancia. La mayoría son menores, pero dos piden criterio y no fusión automática:

- **#39 sube TypeScript a 7.0.2 solo en `functions/`**, mientras la raíz está en 6.0.3. Compilar
  el backend con otro TypeScript que el resto es buscar problemas sutiles: o van juntos, o ninguno.
- **#35 sube Vitest de 4 a 5** en el backend: versión mayor del corredor de pruebas.

## 3. Decisiones suyas, sin urgencia

- **Los premios entregados que nunca se descontaron**: quedan 3 Bs en Epico y 5 en Hamburguesas NB
  de canjes que se entregaron cuando el descuento estaba roto (H-26). Puede dejarlo así, a favor
  del comercio, o regularizarlo con `scripts/admin/ajustar-saldo-premios.mjs`.
- ~~**La deuda de calidad del código de interfaz**~~ — **hecho** el 20-sep-2026 en #32: los 40
  avisos bajaron a cero y las cinco reglas volvieron a `error`.
- **La cobertura en 50 %**: es el piso real de hoy. Sube sola a medida que la interfaz gane
  pruebas; el número se cambia en `.devsecops.yml`.

## 4. Lo que ya quedó hecho y no necesita nada más

| | Estado |
|---|---|
| Secretos de GitHub (`GCP_WIF_PROVIDER`, `GCP_SA_DEPLOY_STAGING`, `GCP_SA_DEPLOY_PROD`) | cargados; el de producción vive en el Environment, no en el repositorio |
| Variables del pipeline | cargadas, incluida `FIREBASE_DEPLOY_ONLY` con `functions` |
| Federación de identidades con GCP | configurada en los dos proyectos; sin llaves de cuenta de servicio |
| Environments `staging` y `production` | creados; producción exige su aprobación y solo despliega desde ramas protegidas |
| Ruleset de `main` | activo: historial lineal, `compuerta-pr` obligatoria, sin borrado ni forzado. **Falta exigir una aprobación** (punto 2b) |
| Dominio propio | `puntos.hipatiabo.com` habilitado en la clave de API; las direcciones viejas redirigen ahí |
| Presupuestos de 10 USD con avisos | creados en las dos cuentas de facturación |
| Etiqueta `v1.3.0` | creada y publicada; la versión se ve en pantalla en los dos entornos |

## 5. Cómo se despliega a partir de ahora

- **A pruebas:** se fusiona a `main` y el pipeline despliega solo.
- **A producción:** se crea una etiqueta `vX.Y.Z` y el pipeline se detiene a esperar **su
  aprobación** en el Environment `production`. Yo puedo preparar la etiqueta y el acta del pase
  (hay una skill, `pase-a-produccion`, que recorre el checklist), pero la aprobación es suya.
- **Localmente:** `./deploy.sh staging` sigue disponible para una urgencia. Contra producción no:
  mi configuración me lo prohíbe expresamente.
