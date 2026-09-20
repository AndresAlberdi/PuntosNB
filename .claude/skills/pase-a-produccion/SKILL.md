---
name: pase-a-produccion
description: "Prepara un pase a producción sin ejecutarlo: recorre el checklist 05 del estándar, produce el acta con evidencia, verifica los requisitos del modo (visibilidad, licencias, Environments, ruleset) y deja listo el comando del tag vX.Y.Z para que lo cree una persona. Usar antes de cada release, cuando se pida \"preparar el pase\", \"crear el release\" o \"desplegar a producción\"."
---

# Pase a producción (preparación; la ejecución es humana)

Claude Code recorre el checklist, reúne evidencia y redacta el acta. **Claude Code tiene PROHIBIDO ejecutar producción sin confirmación humana: no crea el tag, no ejecuta `deploy.sh prod`, no ejecuta `gh workflow run` del `ci-*` con `confirmar=DESPLEGAR`, no aprueba Environments, no usa `--forzar`.** Si la persona pide que lo haga, responda con los comandos preparados y la explicación de por qué debe ejecutarlos ella (política, sección 5). Español formal, sin voseo.

## 0. Contexto

1. Lea `/home/andres-alberdi/SeguridadGeneral/01-seguridad/05-checklist-pase-a-produccion.md` (es la lista canónica; si difiere de este skill, prevalece el documento) y `/home/andres-alberdi/SeguridadGeneral/00-gobernanza/03-ambientes-modos-y-aprobaciones.md`.
2. Lea `.devsecops.yml` (modo, componentes, URLs de producción, excepciones) y `CLAUDE.md`.
3. Determine la versión propuesta con Conventional Commits desde el último tag: `git describe --tags --abbrev=0` y `git log <último-tag>..main --oneline`. `feat` → minor, `fix` → patch, `BREAKING CHANGE`/`!` → major. Proponga `vX.Y.Z` y explique por qué.

## 1. Estado del código

- [ ] `git fetch origin && git status`: rama `main` limpia y sincronizada con `origin/main`; el commit candidato es `origin/main` HEAD.
- [ ] Último run de CI en `main` (`gh run list --branch main --limit 5`) con `calidad`, `seguridad-estatica`, `construir`, `desplegar-staging` y `dast-y-humo` en verde. Anote el ID del run y el digest/artefacto producido.
- [ ] Staging responde: `curl -sS -o /dev/null -w '%{http_code}' <STAGING_URL>` → 2xx/3xx. Smoke manual de los flujos críticos hecho por la persona (pregunte y registre quién y cuándo).
- [ ] No hay PRs abiertos etiquetados como bloqueantes ni issues `incidente` sin cerrar.

## 2. Seguridad

- [ ] `./security-local.sh` reciente (≤ 24 h) sin CRITICAL/HIGH no exceptuados; ruta del informe.
- [ ] Excepciones vigentes en `.devsecops.yml`: listar `id`, `vence`; ninguna vencida; las que vencen en ≤ 30 días se marcan para renovación o cierre.
- [ ] Alertas de Dependabot / Code Scanning abiertas de severidad alta: `gh api repos/{owner}/{repo}/dependabot/alerts?state=open&severity=high,critical` (si el plan lo permite; en B0 usar el informe OSV).
- [ ] Reglas de Firestore/Storage y políticas IAM: sin cambios desde el último release, o revisadas por el agente `seguridad` (adjuntar informe).
- [ ] Imagen (si aplica): escaneada, firmada (cosign) y con SBOM en el artefacto del run.

## 3. Requisitos del modo (verificación técnica)

Ejecute y registre la salida:

```bash
gh repo view --json visibility,isPrivate,owner
gh api repos/{owner}/{repo}/rulesets --jq '.[].name'
gh api repos/{owner}/{repo}/environments --jq '.environments[].name'      # A/B
gh api repos/{owner}/{repo}/environments/production --jq '.protection_rules'  # revisores
gh secret list && gh variable list
```

| Modo | Debe cumplirse | Si no se cumple |
|---|---|---|
| A (público) | Repositorio público; CodeQL y secret scanning activos; Environment `production` con al menos un revisor humano; ruleset de `main` con el check obligatorio `compuerta-pr` | Detener: no hay aprobación humana registrable |
| B (privado Team + GHAS) | Repositorio en organización con plan Team; `GHAS_ENABLED=true`; Code Security y Secret Protection activos (`gh api repos/{owner}/{repo} --jq .security_and_analysis`); Environment `production` con revisor | Detener y proponer B0 mientras se completa la licencia |
| B0 (privado Free) | Ruleset de `main` activo; `vars.MODO=B0` (el push del tag NO despliega); `ci-<stack>.yml` con `workflow_dispatch` (inputs `tag` y `confirmar=DESPLEGAR`) y `github.actor` en `vars.APROBADORES_PROD`; si `TAG_FIRMADO_REQUERIDO=true`, firma de tags configurada (`git config user.signingkey`) | Detener: sin la confirmación del dispatch no hay control compensatorio |

Registre también: secretos de producción presentes por nombre (`GCP_SA_DEPLOY_PROD` / `AWS_ROLE_ARN_PROD` / `OCI_*`), `PROD_URL` definida.

## 4. Plan de rollback

Antes de proponer el tag, deje escrito el identificador actual de producción y el comando de vuelta atrás según `/home/andres-alberdi/SeguridadGeneral/01-seguridad/06-rollback-e-incidentes.md`:

- Firebase Hosting: el pipeline copia `live` al canal `previa` antes de cada despliegue → rollback: `firebase hosting:clone <prod>:previa <prod>:live` (no existe ningún subcomando de rollback en firebase-tools).
- Cloud Run: revisión activa (`gcloud run services describe <svc> --format='value(status.latestReadyRevisionName)'`) → `gcloud run services update-traffic <svc> --to-revisions <rev>=100`.
- ECS: task definition activa → `aws ecs update-service --cluster <c> --service <s> --task-definition <td-anterior>`.
- OCI: último job de apply exitoso / estado de Terraform → plan inverso o job anterior.

Solo comandos de consulta (`describe`, `list`) se ejecutan ahora; los de rollback se dejan preparados.

## 5. Acta (entregar en la respuesta y guardar en `docs/produccion/acta-vX.Y.Z.md`)

```
# Acta de pase a producción — <proyecto> — vX.Y.Z — <fecha>
Commit: <sha> | Run CI: <id/enlace> | Digest/artefacto: <...> | Modo: <A|B|B0>
Preparado por: Claude Code (skill pase-a-produccion) | Aprueba: <propietario> (pendiente)

## Cambios incluidos (desde <tag anterior>)
- feat: ...
- fix: ...

## Checklist
| # | Control | Estado | Evidencia |
|---|---|---|---|
| 1 | main limpia y sincronizada | cumple | git status / sha |
| ... | | | |

## Riesgos aceptados (excepciones vigentes)
| id | herramienta | vence | justificación resumida |

## Plan de rollback
<identificador actual y comando exacto>

## Pendientes antes de aprobar
1. ...
```

Cada fila del checklist debe tener evidencia verificable (salida de comando, ruta, enlace). Lo que no pudo verificarse se marca "no verificado", nunca "cumple".

## 6. Preparar el tag (sin ejecutarlo)

Entregue a la persona, en este orden, y deténgase:

```bash
git checkout main && git pull --ff-only
git tag -s vX.Y.Z -m "Release vX.Y.Z — <proyecto>"     # -s: firmado (obligatorio si TAG_FIRMADO_REQUERIDO=true; recomendado en B0)
git push origin vX.Y.Z
# Modo A/B: el push del tag ejecuta desplegar-produccion del ci-<stack>.yml;
#           aprobar el Environment 'production' en ese run.
# Modo B0: el push del tag NO despliega. Ejecutar el workflow_dispatch del ci-<stack>.yml:
#   gh workflow run ci-<stack>.yml -f tag=vX.Y.Z -f confirmar=DESPLEGAR
#   (el actor debe estar en vars.APROBADORES_PROD)
```

Indique si `user.signingkey` no está configurada y cómo configurarla (GPG o SSH) antes de crear el tag. Si el acta tiene ítems en "no cumple", diga explícitamente que el pase **no debe proceder** hasta resolverlos, aunque la persona tenga el comando a mano. Claude Code no ejecuta ninguno de estos comandos: los entrega.
