# Lo que queda por hacer, y quién puede hacerlo

Estado al 20-sep-2026, después de las fases 0 a 4 del plan de hardening.

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

## 3. Decisiones suyas, sin urgencia

- **Los premios entregados que nunca se descontaron**: quedan 3 Bs en Epico y 5 en Hamburguesas NB
  de canjes que se entregaron cuando el descuento estaba roto (H-26). Puede dejarlo así, a favor
  del comercio, o regularizarlo con `scripts/admin/ajustar-saldo-premios.mjs`.
- **La deuda de calidad del código de interfaz**: 40 avisos de ESLint (19 `any` y 12 reglas de
  react-hooks) anteriores al pipeline. Quedaron como aviso, no como bloqueo, para no frenar
  correcciones de seguridad. Conviene bajarlos en una tanda propia.
- **La cobertura en 50 %**: es el piso real de hoy. Sube sola a medida que la interfaz gane
  pruebas; el número se cambia en `.devsecops.yml`.

## 4. Lo que ya quedó hecho y no necesita nada más

| | Estado |
|---|---|
| Secretos de GitHub (`GCP_WIF_PROVIDER`, `GCP_SA_DEPLOY_STAGING`, `GCP_SA_DEPLOY_PROD`) | cargados; el de producción vive en el Environment, no en el repositorio |
| Variables del pipeline | cargadas, incluida `FIREBASE_DEPLOY_ONLY` con `functions` |
| Federación de identidades con GCP | configurada en los dos proyectos; sin llaves de cuenta de servicio |
| Environments `staging` y `production` | creados; producción exige su aprobación y solo despliega desde ramas protegidas |
| Ruleset de `main` | activo: historial lineal, `compuerta-pr` obligatoria, sin borrado ni forzado |
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
