---
name: aplicar-estandar-devsecops
description: "Aplica el estándar DevSecOps v2 a un repositorio (nuevo o desactualizado): ejecuta bootstrap-repo.sh, verifica el stack real, adapta el workflow y el manifiesto .devsecops.yml, valida con actionlint y entrega la lista de secretos y variables pendientes. Usar cuando se cree un repositorio, se migre uno desde la política v1 (CI_CD_POLICIES.md, deploy.sh v1, AGENTS.md) o se pida \"aplicar/actualizar el estándar\"."
---

# Aplicar el estándar DevSecOps a un repositorio

Procedimiento para Claude Code. Trabaje en una rama `chore/estandar-devsecops`; no toque `main` directamente. Al terminar, la persona revisa el PR: usted no lo fusiona. Todo en español formal, sin voseo.

## 0. Contexto que debe reunir antes de ejecutar nada

1. Ruta local del estándar: `/home/andres-alberdi/SeguridadGeneral` (confírmela con `ls /home/andres-alberdi/SeguridadGeneral/03-scripts/bootstrap-repo.sh`; si no existe, pregunte la ruta).
2. Lea `/home/andres-alberdi/SeguridadGeneral/00-gobernanza/01-politica-cicd-devsecops.md` (secciones 4 y 12: fases y mapeo v1 → v2) y `/home/andres-alberdi/SeguridadGeneral/02-pipelines/README.md`.
3. Determine el **stack real** inspeccionando el repositorio, no preguntando:
   - `package.json` + `firebase.json` → `node-firebase`
   - `requirements.txt`/`pyproject.toml` + `Dockerfile` (+ referencias a Cloud Run) → `python-cloudrun`
   - `Dockerfile` + task definition / referencias a ECS/ECR → `aws-ecs`
   - `*.tf` con provider `oci` o referencias a Resource Manager → `oci-terraform`
   - Varios de los anteriores en subdirectorios → `multicloud`
4. Determine el **modo**: `gh repo view --json visibility,owner` → público = A; privado en organización con GHAS (`vars.GHAS_ENABLED` o licencia confirmada por el propietario) = B; privado sin licencias = B0. Si no puede confirmar B, use B0 y anótelo como pendiente.
5. Detecte restos de la política v1: `CI_CD_POLICIES.md`, `ci-cd-pipeline.yml`, `deploy.sh` v1 (busque `[1/4]` y `snyk test`), `AGENTS.md`, rama `staging`. Anote qué hay para la migración.

## 1. Ejecutar el bootstrap

```bash
/home/andres-alberdi/SeguridadGeneral/03-scripts/bootstrap-repo.sh --stack <stack> --modo <A|B|B0> --ruta-estandar /home/andres-alberdi/SeguridadGeneral
```

- Responda las preguntas con datos reales del proyecto (nombre, proyectos de staging/prod, URLs); si no los conoce, use los valores por defecto y márquelos como "a confirmar" en el informe.
- Si el repositorio ya tenía `deploy.sh`, `CLAUDE.md` o `.devsecops.yml`, el script los conserva. Compare con la versión del estándar (`diff`) y decida con la persona si reemplazar (`--sobrescribir`) o fusionar a mano.
- No ejecute el script con `--sin-gh` salvo que la persona no quiera cambios remotos; si `gh` no está autenticado, indíquelo.

## 2. Revisar y adaptar lo generado

1. **`.devsecops.yml`**: verifique `ruta` de cada componente, `stack`, `proveedor`, `proyecto`, `url`, `servicio`/`region`/`cluster`/`repositorio` según proveedor. Valide el YAML: `python3 -c "import yaml,sys; yaml.safe_load(open('.devsecops.yml'))"`.
2. **Workflow del stack** (`.github/workflows/ci-<stack>.yml`): ajuste los nombres de scripts (`npm run lint`, `npm test`, `pytest`), las rutas de componentes (monorepo) y las variables (`vars.GCP_PROJECT_ID_STAGING`, etc.). Conserve los nombres de jobs, `permissions`, `concurrency`, `timeout-minutes` y los pines por SHA. No añada `continue-on-error` a controles.
3. **`CLAUDE.md`**: complete la tabla de comandos con los reales; conserve las reglas obligatorias íntegras. Si existía `AGENTS.md`, migre sus reglas específicas del proyecto (por ejemplo, la identidad administradora de Firestore, la ubicación de las pruebas) a la sección "Descripción" o "Convenciones" de `CLAUDE.md` y proponga eliminar `AGENTS.md` en el mismo PR.
4. **Migración v1 → v2** (si aplica): proponga eliminar `ci-cd-pipeline.yml` y `CI_CD_POLICIES.md` (reemplazados), sustituir `deploy.sh` v1 por el v2, y documentar en el PR que la rama `staging` queda deprecada (el merge a `main` despliega staging). No borre la rama remota: eso lo decide la persona.
5. **`.gitignore`**: confirme `.deploy-log/`, `.security-reports/`, `.env`, `.env.*`, claves y `tfplan*`.
6. **Permisos de Claude Code**: si no existe `.claude/settings.json`, proponga uno con `permissions.deny` para `Read(./.env)`, `Read(./.env.*)`, `Bash(./deploy.sh prod*)`, `Bash(git push --force*)`.

## 3. Verificar

```bash
actionlint .github/workflows/*.yml
shellcheck -S warning deploy.sh security-local.sh
bash -n deploy.sh security-local.sh
./security-local.sh            # informe en .security-reports/ultimo/resumen.md
./deploy.sh staging --dry-run  # debe llegar a la fase 7 sin errores de manifiesto
```

Si `actionlint` no está instalado, indíquelo y proponga el comando (`brew install actionlint` o binario de GitHub); no entregue sin validar o sin dejar constancia de que no se validó. Corrija todo lo que reporte `actionlint`; los hallazgos de `security-local.sh` se listan en el informe (no bloquean la aplicación del estándar, pero sí el primer despliegue).

## 4. Preparar el PR

- Commit(s) Conventional: `ci: aplicar estándar DevSecOps v2 (<stack>, modo <X>)`, `docs: CLAUDE.md del estándar`, `chore: retirar política v1`.
- Abra el PR con `gh pr create` usando `.github/PULL_REQUEST_TEMPLATE.md`. En el cuerpo incluya el informe de la sección 5.
- No fusione; no cree tags; no cambie la visibilidad del repositorio.

## 5. Informe final (obligatorio, en la respuesta y en el PR)

```
# Aplicación del estándar DevSecOps — <repositorio> — <fecha>
Stack: <stack> | Modo: <A|B|B0> (confirmado / supuesto) | Rama: chore/estandar-devsecops | PR: <enlace>

## Archivos creados / modificados / conservados
...

## Verificación
actionlint: <ok | n errores corregidos> · shellcheck: <ok> · security-local.sh: <CRITICAL=n HIGH=n> · deploy.sh --dry-run: <ok>

## Secretos que debe crear el propietario (por nombre; generar con setup-oidc-*.sh)
- GCP_WIF_PROVIDER, GCP_SA_DEPLOY_STAGING, GCP_SA_DEPLOY_PROD   (o AWS_ROLE_ARN_*, o OCI_*)

## Variables configuradas / pendientes
...

## Configuración remota
Ruleset main: <creado | ya existía | pendiente (motivo)> · Environments: <pendiente: staging, production con revisores>

## Pendientes y decisiones para el propietario
1. Confirmar modo y visibilidad.
2. Aprobar la eliminación de la política v1 / rama staging.
3. ...
```
