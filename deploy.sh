#!/usr/bin/env bash
# ==============================================================================
# deploy.sh v2 — Despliegue manual gobernado por el estándar DevSecOps
# ==============================================================================
# Versión: 2.0 | Fecha: 2026-08-24
# Documentos relacionados: 00-gobernanza/01-politica-cicd-devsecops.md,
#   00-gobernanza/02-flujo-git-y-versionado.md, 01-seguridad/05-checklist-pase-a-produccion.md,
#   02-pipelines/README.md, 03-scripts/security-local.sh
#
# Uso:
#   ./deploy.sh <staging|prod> [--componente nombre] [--sin-tests] [--sin-seguridad]
#                              [--dry-run] [--forzar] [--version X.Y.Z]
#
# El pipeline de CI tiene ocho fases: preparar, calidad, seguridad-estatica,
# construir, desplegar-staging, dast-y-humo, desplegar-produccion y
# post-despliegue. Este script reproduce localmente las que aplican a un
# despliegue manual, con esta correspondencia de sus pasos internos:
#   [1/7] verificación previa  → preparar
#   [2/7] calidad              → calidad
#   [3/7] seguridad estática   → seguridad-estatica
#   [4/7] construcción         → construir
#   [5/7] despliegue           → desplegar-staging | desplegar-produccion
#   [6/7] verificación de salud→ post-despliegue (health check)
#   [7/7] registro             → sin equivalente en CI (rama + PR de registro)
# dast-y-humo (ZAP) solo corre en CI. Úselo para proyectos en transición,
# emergencias o entornos sin CI configurado.
#
# Diferencias principales respecto del deploy.sh v1:
#   - Lee el manifiesto .devsecops.yml (multicomponente, multinube). Si no
#     existe, autodetecta el stack como lo hacía la v1.
#   - La fase de seguridad BLOQUEA en CRITICAL/HIGH (la v1 solo advertía).
#   - Producción exige rama main limpia y sincronizada, confirmación escrita
#     ("DESPLEGAR") y, opcionalmente, crea el tag vX.Y.Z.
#   - Las imágenes se despliegan por digest (sha256), nunca por etiqueta mutable,
#     y se publican SIEMPRE en el registro del proyecto de staging (producción
#     despliega por digest la misma imagen, igual que los workflows).
#   - Verificación de salud contra HEALTH_PATH (/healthz) con reintentos y
#     registro en .deploy-log/.
#   - Nunca hace push a main: los cambios de registro van en una rama
#     chore/deploy-<ambiente>-<fecha> y un PR (compatible con el hook
#     no-commit-to-branch y con el ruleset de main).
#
# Códigos de salida:
#   0  éxito
#   1  error general
#   2  uso incorrecto de la línea de comandos
#   3  precondición no cumplida (git, herramientas, manifiesto)
#   4  seguridad estática bloqueó el despliegue
#   5  fallaron pruebas o lint
#   6  falló la construcción
#   7  falló el despliegue
#   8  falló la verificación de salud posterior al despliegue
#   9  el usuario canceló la confirmación de producción
# ==============================================================================
set -Eeuo pipefail

# ------------------------------------------------------------------------------
# Constantes y estado global
# ------------------------------------------------------------------------------
readonly SCRIPT_VERSION="2.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly MANIFIESTO=".devsecops.yml"
readonly DEPLOY_LOG_DIR=".deploy-log"
readonly TOTAL_FASES=7
# Versión exacta de firebase-tools a usar con npx cuando no hay una instalación
# global (fijada para evitar regresiones, p. ej. la de 15.22.2, jun-2026);
# ajuste FIREBASE_TOOLS_VERSION en el entorno si necesita otra.
FIREBASE_TOOLS_VERSION="${FIREBASE_TOOLS_VERSION:-15.28.1}"
# Health check unificado del estándar: HEALTH_PATH (/healthz), 10 intentos,
# 15 segundos entre intentos (mismos valores que post-despliegue en CI).
HEALTH_PATH="${HEALTH_PATH:-/healthz}"
HEALTH_REINTENTOS="${HEALTH_REINTENTOS:-10}"
HEALTH_ESPERA="${HEALTH_ESPERA:-15}"

AMBIENTE=""            # staging | prod (nombre corto usado en la CLI)
AMBIENTE_MANIFIESTO="" # staging | production (clave del manifiesto y APP_ENV)
ETIQUETA_COMMIT=""     # (en pruebas) | (en producción)
FILTRO_COMPONENTE=""
SIN_TESTS=0
SIN_SEGURIDAD=0
DRY_RUN=0
FORZAR=0
VERSION_TAG=""
PROYECTO=""
MODO="A"
COBERTURA_MIN="70"
SHA_CORTO=""
SHA_LARGO=""
USUARIO="${USER:-$(id -un 2>/dev/null || echo desconocido)}"
RESULTADO="INICIADO"
FASE_ACTUAL="0"
declare -a COMPONENTES=()   # líneas TSV: nombre ruta stack proveedor proyecto url servicio region cluster repositorio stack_id compartimento reg_proyecto reg_region reg_repositorio
declare -a URLS_SALUD=()
declare -A IMAGENES=()      # nombre_componente -> referencia de imagen por digest

# ------------------------------------------------------------------------------
# Salida con color solo cuando la salida estándar es una terminal
# ------------------------------------------------------------------------------
if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  C_ROJO=$'\033[31m'; C_VERDE=$'\033[32m'; C_AMARILLO=$'\033[33m'
  C_AZUL=$'\033[34m'; C_NEGRITA=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_ROJO=""; C_VERDE=""; C_AMARILLO=""; C_AZUL=""; C_NEGRITA=""; C_RESET=""
fi

log_info()  { printf '%s[INFO]%s %s\n' "$C_AZUL" "$C_RESET" "$*"; }
log_ok()    { printf '%s[OK]%s   %s\n' "$C_VERDE" "$C_RESET" "$*"; }
log_warn()  { printf '%s[AVISO]%s %s\n' "$C_AMARILLO" "$C_RESET" "$*" >&2; }
log_error() { printf '%s[ERROR]%s %s\n' "$C_ROJO" "$C_RESET" "$*" >&2; }
log_fase()  { FASE_ACTUAL="$1"; printf '\n%s=== [%s/%s] %s ===%s\n' "$C_NEGRITA" "$1" "$TOTAL_FASES" "$2" "$C_RESET"; }

# die <codigo> <mensaje>
die() {
  local codigo="$1"; shift
  log_error "$*"
  RESULTADO="FALLIDO(fase ${FASE_ACTUAL}, código ${codigo})"
  exit "$codigo"
}

# ejecutar <comando...>: ejecuta o, en --dry-run, solo muestra el comando.
ejecutar() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '%s[DRY-RUN]%s %s\n' "$C_AMARILLO" "$C_RESET" "$*"
    return 0
  fi
  "$@"
}

# ejecutar_en <directorio> <comando...>: como ejecutar, pero dentro de un subshell en la ruta dada.
ejecutar_en() {
  local dir="$1"; shift
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '%s[DRY-RUN]%s (en %s) %s\n' "$C_AMARILLO" "$C_RESET" "$dir" "$*"
    return 0
  fi
  ( cd "$dir" && "$@" )
}

requiere_comando() {
  local cmd="$1" motivo="${2:-}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    die 3 "Falta la herramienta '$cmd'${motivo:+ ($motivo)}. Instálela antes de continuar."
  fi
}

mostrar_ayuda() {
  cat <<EOF
deploy.sh v${SCRIPT_VERSION} — despliegue manual gobernado por el estándar DevSecOps

Uso:
  ./deploy.sh <staging|prod> [opciones]

Ambientes:
  staging      Ambiente de pruebas (también acepta "pruebas").
  prod         Producción (también acepta "produccion"). Exige rama main limpia,
               sincronizada con origin/main y confirmación escribiendo DESPLEGAR.

Opciones:
  --componente <nombre>  Despliega solo el componente indicado del manifiesto.
  --sin-tests            Omite la fase de calidad (solo staging; en prod exige --forzar).
  --sin-seguridad        Omite la fase de seguridad estática (solo staging; en prod exige --forzar).
  --dry-run              Muestra los comandos sin ejecutarlos (no modifica nada).
  --forzar               Omite verificaciones de rama/limpieza y la confirmación interactiva.
                         Pensado para CI; deja advertencias explícitas en el registro.
  --version X.Y.Z        Solo prod: crea y empuja el tag vX.Y.Z tras el despliegue.
  -h, --help             Muestra esta ayuda.

Fases (mapeadas a las ocho del pipeline de CI: preparar, calidad,
seguridad-estatica, construir, desplegar-staging, dast-y-humo,
desplegar-produccion, post-despliegue; dast-y-humo solo corre en CI):
  [1/7] verificación previa (preparar)      [2/7] calidad (calidad)
  [3/7] seguridad estática (seguridad-estatica; bloquea CRITICAL/HIGH)
  [4/7] construcción (construir)            [5/7] despliegue (desplegar-staging|produccion)
  [6/7] verificación de salud (post-despliegue)
  [7/7] registro (rama chore/deploy-* + PR, tag, .deploy-log/; sin equivalente en CI)

Manifiesto (.devsecops.yml; esquema en .github/devsecops.schema.json,
convenciones en 00-gobernanza/00-convenciones.md del estándar):
  Si existe, se despliegan sus componentes (firebase | cloudrun | ecs | oci | ninguno).
  Claves por ambiente reconocidas: proyecto, url, servicio, region, cluster,
  repositorio (Artifact Registry/ECR), stack_id y compartimento (OCI).
  Si no existe, se autodetecta un único componente en el directorio actual:
    package.json -> node | requirements.txt/pyproject.toml -> python | Dockerfile -> docker
    firebase.json -> firebase | *.tf -> terraform

Variables de entorno opcionales:
  FIREBASE_TOOLS_VERSION (por defecto ${FIREBASE_TOOLS_VERSION}), HEALTH_PATH (${HEALTH_PATH}),
  HEALTH_REINTENTOS (${HEALTH_REINTENTOS}), HEALTH_ESPERA segundos (${HEALTH_ESPERA}), NO_COLOR,
  y las variables del estándar (GCP_REGION, AWS_REGION, ECR_REPOSITORY, ECS_CLUSTER,
  ECS_SERVICE, CLOUD_RUN_SERVICE, ARTIFACT_REGISTRY_REPO, OCI_STACK_ID,
  OCI_COMPARTMENT_OCID, STAGING_URL, PROD_URL) como respaldo del manifiesto.

Códigos de salida: 0 ok | 2 uso | 3 precondición | 4 seguridad | 5 calidad | 6 build
                   7 despliegue | 8 salud | 9 cancelado por el usuario
EOF
}

# ------------------------------------------------------------------------------
# Registro en .deploy-log/ (ignorado por git)
# ------------------------------------------------------------------------------
asegurar_gitignore() {
  # Añade una entrada a .gitignore si no existe (idempotente).
  local entrada="$1"
  [[ -d .git ]] || return 0
  if [[ -f .gitignore ]] && grep -qxF "$entrada" .gitignore; then
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "(dry-run) se añadiría '$entrada' a .gitignore"
    return 0
  fi
  printf '%s\n' "$entrada" >> .gitignore
  log_info "Se añadió '$entrada' a .gitignore"
}

registrar_deploy_log() {
  # Se ejecuta siempre al salir (trap EXIT), con el resultado final.
  local fecha
  fecha="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  [[ -n "$AMBIENTE" ]] || return 0
  [[ "$DRY_RUN" -eq 1 ]] && return 0
  mkdir -p "$DEPLOY_LOG_DIR"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$fecha" "$USUARIO" "$AMBIENTE" "${PROYECTO:-?}" "${FILTRO_COMPONENTE:-todos}" \
    "${SHA_CORTO:-?}" "${VERSION_TAG:-}" "$RESULTADO" >> "${DEPLOY_LOG_DIR}/despliegues.tsv"
}

al_salir() {
  local codigo=$?
  if [[ $codigo -eq 0 && "$RESULTADO" == "INICIADO" ]]; then
    RESULTADO="EXITOSO"
  elif [[ $codigo -ne 0 && "$RESULTADO" == "INICIADO" ]]; then
    RESULTADO="FALLIDO(fase ${FASE_ACTUAL}, código ${codigo})"
  fi
  registrar_deploy_log
  if [[ $codigo -ne 0 ]]; then
    log_error "Despliegue terminado con código $codigo. Consulte ${DEPLOY_LOG_DIR}/despliegues.tsv"
  fi
}
trap al_salir EXIT

# ------------------------------------------------------------------------------
# Análisis de argumentos
# ------------------------------------------------------------------------------
analizar_argumentos() {
  [[ $# -ge 1 ]] || { mostrar_ayuda; exit 2; }
  while [[ $# -gt 0 ]]; do
    case "$1" in
      staging|pruebas)
        AMBIENTE="staging"; AMBIENTE_MANIFIESTO="staging"; ETIQUETA_COMMIT="(en pruebas)" ;;
      prod|produccion|production)
        AMBIENTE="prod"; AMBIENTE_MANIFIESTO="production"; ETIQUETA_COMMIT="(en producción)" ;;
      --componente)
        [[ $# -ge 2 ]] || { log_error "--componente requiere un nombre"; exit 2; }
        FILTRO_COMPONENTE="$2"; shift ;;
      --sin-tests)     SIN_TESTS=1 ;;
      --sin-seguridad) SIN_SEGURIDAD=1 ;;
      --dry-run)       DRY_RUN=1 ;;
      --forzar)        FORZAR=1 ;;
      --version)
        [[ $# -ge 2 ]] || { log_error "--version requiere X.Y.Z"; exit 2; }
        VERSION_TAG="$2"; shift ;;
      -h|--help)       mostrar_ayuda; exit 0 ;;
      *)
        log_error "Argumento no reconocido: $1"; mostrar_ayuda; exit 2 ;;
    esac
    shift
  done
  [[ -n "$AMBIENTE" ]] || { log_error "Debe indicar el ambiente: staging o prod"; exit 2; }
  if [[ -n "$VERSION_TAG" ]]; then
    [[ "$AMBIENTE" == "prod" ]] || { log_error "--version solo aplica a prod"; exit 2; }
    [[ "$VERSION_TAG" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] \
      || { log_error "--version debe tener formato semántico X.Y.Z (sin la 'v')"; exit 2; }
  fi
  if [[ "$AMBIENTE" == "prod" && "$FORZAR" -eq 0 ]] && [[ "$SIN_TESTS" -eq 1 || "$SIN_SEGURIDAD" -eq 1 ]]; then
    log_error "En producción no se pueden omitir pruebas ni seguridad sin --forzar (y queda registrado)."
    exit 2
  fi
}

# ------------------------------------------------------------------------------
# Lectura del manifiesto .devsecops.yml
# ------------------------------------------------------------------------------
# Emite por stdout:
#   __meta<TAB>proyecto<TAB>modo<TAB>cobertura_minima
#   __comp<TAB>nombre<TAB>ruta<TAB>stack<TAB>proveedor<TAB>proyecto<TAB>url<TAB>servicio<TAB>region<TAB>cluster<TAB>repositorio<TAB>stack_id<TAB>compartimento<TAB>reg_proyecto<TAB>reg_region<TAB>reg_repositorio
# Los tres últimos campos son SIEMPRE los del ambiente staging: el registro de
# imágenes es único (el del proyecto de staging) y producción despliega por
# digest la misma imagen, igual que los workflows.
# Los valores vacíos se emiten como "-" para que la lectura por TAB sea estable.
leer_manifiesto_python() {
  python3 - "$MANIFIESTO" "$AMBIENTE_MANIFIESTO" <<'PY'
import sys
try:
    import yaml
except ImportError:
    sys.exit(90)
ruta, ambiente = sys.argv[1], sys.argv[2]
with open(ruta, encoding="utf-8") as f:
    m = yaml.safe_load(f) or {}
if int(m.get("version", 1)) != 1:
    sys.exit(91)
def v(x):
    s = "" if x is None else str(x).strip()
    return s.replace("\t", " ") if s else "-"
print("\t".join(["__meta", v(m.get("proyecto")), v(m.get("modo", "A")), v(m.get("cobertura_minima", 70))]))
for c in m.get("componentes") or []:
    ambs = c.get("ambientes") or {}
    a = ambs.get(ambiente) or {}
    stg = ambs.get("staging") or {}
    print("\t".join(["__comp", v(c.get("nombre")), v(c.get("ruta", "./")), v(c.get("stack")),
                     v(c.get("proveedor", "ninguno")), v(a.get("proyecto")), v(a.get("url")),
                     v(a.get("servicio")), v(a.get("region")), v(a.get("cluster")),
                     v(a.get("repositorio")), v(a.get("stack_id")), v(a.get("compartimento")),
                     v(stg.get("proyecto")), v(stg.get("region")), v(stg.get("repositorio"))]))
PY
}

leer_manifiesto_yq() {
  # Respaldo con yq de mikefarah (sintaxis distinta al yq de Python).
  yq -r '["__meta", (.proyecto // "-"), (.modo // "A"), (.cobertura_minima // 70)] | @tsv' "$MANIFIESTO"
  yq -r --arg amb "$AMBIENTE_MANIFIESTO" '
    .componentes[] | . as $c | ($c.ambientes[$amb] // {}) as $a | ($c.ambientes.staging // {}) as $s |
    ["__comp", ($c.nombre // "-"), ($c.ruta // "./"), ($c.stack // "-"), ($c.proveedor // "ninguno"),
     ($a.proyecto // "-"), ($a.url // "-"), ($a.servicio // "-"), ($a.region // "-"),
     ($a.cluster // "-"), ($a.repositorio // "-"), ($a.stack_id // "-"), ($a.compartimento // "-"),
     ($s.proyecto // "-"), ($s.region // "-"), ($s.repositorio // "-")] | @tsv' "$MANIFIESTO"
}

cargar_manifiesto() {
  local salida="" rc=0
  if command -v python3 >/dev/null 2>&1; then
    salida="$(leer_manifiesto_python)" || rc=$?
    case "$rc" in
      0) ;;
      90) log_warn "python3 sin PyYAML; se intenta con yq"; salida=""; rc=1 ;;
      91) die 3 "El manifiesto declara una versión no soportada (se espera version: 1)" ;;
      *) die 3 "No se pudo leer $MANIFIESTO (código $rc)" ;;
    esac
  else
    rc=1
  fi
  if [[ $rc -ne 0 ]]; then
    # Sin tubería: con pipefail, `yq --version | grep -q` da falso si yq sigue
    # escribiendo después de que grep salga (SIGPIPE).
    if command -v yq >/dev/null 2>&1 && grep -qi mikefarah <<< "$(yq --version 2>&1)"; then
      salida="$(leer_manifiesto_yq)" || die 3 "No se pudo leer $MANIFIESTO con yq"
    else
      die 3 "Se requiere python3 con PyYAML (pip install pyyaml) o yq (mikefarah) para leer $MANIFIESTO"
    fi
  fi
  local linea tipo
  while IFS= read -r linea; do
    [[ -n "$linea" ]] || continue
    tipo="${linea%%$'\t'*}"
    case "$tipo" in
      __meta)
        IFS=$'\t' read -r _ PROYECTO MODO COBERTURA_MIN <<< "$linea" ;;
      __comp)
        COMPONENTES+=("${linea#__comp$'\t'}") ;;
    esac
  done <<< "$salida"
  [[ "$PROYECTO" != "-" ]] || PROYECTO="$(basename "$PWD")"
  [[ ${#COMPONENTES[@]} -gt 0 ]] || die 3 "El manifiesto no declara componentes"
  log_ok "Manifiesto leído: proyecto=$PROYECTO modo=$MODO componentes=${#COMPONENTES[@]}"
}

# Sin manifiesto: un solo componente autodetectado (comportamiento de la v1).
autodetectar_componente() {
  local stack="static" proveedor="ninguno" proyecto url
  PROYECTO="$(basename "$PWD")"
  if   [[ -f package.json ]]; then stack="node"
  elif [[ -f requirements.txt || -f pyproject.toml ]]; then stack="python"
  elif [[ -f Dockerfile ]]; then stack="docker"
  elif compgen -G "*.tf" >/dev/null; then stack="terraform"
  fi
  if   [[ -f firebase.json ]]; then proveedor="firebase"
  elif compgen -G "*.tf" >/dev/null; then proveedor="oci"
  elif [[ -f Dockerfile ]]; then
    # Un Dockerfile sin más contexto no permite decidir la nube: se construye
    # y se deja el despliegue en manos del manifiesto (igual que la v1).
    proveedor="ninguno"
    log_warn "Dockerfile sin manifiesto: se construirá la imagen pero no se desplegará. Cree $MANIFIESTO con proveedor cloudrun|ecs|oci."
  fi
  # Convención heredada de la v1: <proyecto>-staging / <proyecto>-prod
  if [[ "$AMBIENTE" == "prod" ]]; then
    proyecto="${PROYECTO}-prod"; url="${PROD_URL:-}"
  else
    proyecto="${PROYECTO}-staging"; url="${STAGING_URL:-}"
  fi
  COMPONENTES+=("$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' \
    "$PROYECTO" "./" "$stack" "$proveedor" "$proyecto" "${url:--}" \
    "${CLOUD_RUN_SERVICE:-${ECS_SERVICE:--}}" "${GCP_REGION:-${AWS_REGION:--}}" \
    "${ECS_CLUSTER:--}" "${ECR_REPOSITORY:--}" "${OCI_STACK_ID:--}" "${OCI_COMPARTMENT_OCID:--}" \
    "${PROYECTO}-staging" "${GCP_REGION:-${AWS_REGION:--}}" "${ARTIFACT_REGISTRY_REPO:-${ECR_REPOSITORY:--}}")")
  log_warn "No existe $MANIFIESTO: modo autodetección (stack=$stack, proveedor=$proveedor, proyecto=$proyecto)."
  log_warn "Recomendado: ejecute bootstrap-repo.sh para generar el manifiesto."
}

# Variables de un componente (a partir de una línea TSV) en variables C_*.
cargar_componente() {
  IFS=$'\t' read -r C_NOMBRE C_RUTA C_STACK C_PROVEEDOR C_PROYECTO C_URL C_SERVICIO C_REGION \
    C_CLUSTER C_REPOSITORIO C_STACK_ID C_COMPARTIMENTO C_REG_PROYECTO C_REG_REGION C_REG_REPOSITORIO <<< "$1"
  # Normaliza "-" a vacío y aplica respaldos desde variables de entorno del estándar.
  local var
  for var in C_PROYECTO C_URL C_SERVICIO C_REGION C_CLUSTER C_REPOSITORIO C_STACK_ID C_COMPARTIMENTO \
             C_REG_PROYECTO C_REG_REGION C_REG_REPOSITORIO; do
    [[ "${!var}" == "-" ]] && printf -v "$var" '%s' ""
  done
  case "$C_PROVEEDOR" in
    cloudrun)
      C_REGION="${C_REGION:-${GCP_REGION:-us-central1}}"
      C_SERVICIO="${C_SERVICIO:-${CLOUD_RUN_SERVICE:-$C_NOMBRE}}"
      C_REPOSITORIO="${C_REPOSITORIO:-${ARTIFACT_REGISTRY_REPO:-$PROYECTO}}" ;;
    ecs)
      C_REGION="${C_REGION:-${AWS_REGION:-us-east-1}}"
      C_SERVICIO="${C_SERVICIO:-${ECS_SERVICE:-$C_NOMBRE}}"
      C_CLUSTER="${C_CLUSTER:-${ECS_CLUSTER:-}}"
      C_REPOSITORIO="${C_REPOSITORIO:-${ECR_REPOSITORY:-$C_NOMBRE}}" ;;
    oci)
      C_STACK_ID="${C_STACK_ID:-${OCI_STACK_ID:-}}"
      C_COMPARTIMENTO="${C_COMPARTIMENTO:-${OCI_COMPARTMENT_OCID:-}}" ;;
  esac
  # Registro de imágenes: SIEMPRE el del ambiente de staging (mismo criterio que
  # los workflows). Si el manifiesto no declara staging, se usa el del ambiente.
  C_REG_PROYECTO="${C_REG_PROYECTO:-$C_PROYECTO}"
  C_REG_REGION="${C_REG_REGION:-$C_REGION}"
  C_REG_REPOSITORIO="${C_REG_REPOSITORIO:-$C_REPOSITORIO}"
  if [[ -z "$C_URL" ]]; then
    [[ "$AMBIENTE" == "prod" ]] && C_URL="${PROD_URL:-}" || C_URL="${STAGING_URL:-}"
  fi
  [[ -d "$C_RUTA" ]] || die 3 "La ruta del componente '$C_NOMBRE' no existe: $C_RUTA"
}

componente_seleccionado() {
  [[ -z "$FILTRO_COMPONENTE" || "$FILTRO_COMPONENTE" == "$C_NOMBRE" ]]
}

# ------------------------------------------------------------------------------
# [1/7] Verificación previa
# ------------------------------------------------------------------------------
fase_verificacion_previa() {
  log_fase 1 "Verificación previa"
  requiere_comando git
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die 3 "El directorio actual no es un repositorio git"
  SHA_LARGO="$(git rev-parse HEAD)"
  SHA_CORTO="$(git rev-parse --short HEAD)"
  asegurar_gitignore "${DEPLOY_LOG_DIR}/"
  asegurar_gitignore ".security-reports/"

  local rama
  rama="$(git rev-parse --abbrev-ref HEAD)"
  log_info "Proyecto: $PROYECTO | Ambiente: $AMBIENTE (APP_ENV=$AMBIENTE_MANIFIESTO) | Rama: $rama | Commit: $SHA_CORTO"

  if git remote get-url origin >/dev/null 2>&1; then
    log_info "Sincronizando con origin (git fetch)..."
    git fetch origin --quiet --tags || log_warn "No se pudo hacer git fetch (¿sin red?). Se continúa con el estado local."
  else
    log_warn "No hay remoto 'origin'; no se podrá hacer push ni verificar sincronización."
  fi

  local sucio=0 detras=0 adelante=0
  [[ -z "$(git status --porcelain)" ]] || sucio=1
  if git rev-parse --verify --quiet origin/main >/dev/null; then
    detras="$(git rev-list --count "HEAD..origin/main")"
    adelante="$(git rev-list --count "origin/main..HEAD")"
  fi

  if [[ "$AMBIENTE" == "prod" ]]; then
    # Producción solo desde main, limpia y sincronizada. El porqué: lo que se
    # despliega debe ser exactamente lo que está revisado y registrado en main.
    local problemas=()
    [[ "$rama" == "main" ]] || problemas+=("la rama actual es '$rama', no 'main'")
    [[ "$sucio" -eq 0 ]]    || problemas+=("hay cambios sin confirmar (commit)")
    [[ "$detras" -eq 0 ]]   || problemas+=("HEAD está $detras commit(s) detrás de origin/main")
    [[ "$adelante" -eq 0 ]] || problemas+=("HEAD está $adelante commit(s) adelante de origin/main (sin push)")
    if [[ ${#problemas[@]} -gt 0 ]]; then
      local p
      for p in "${problemas[@]}"; do log_error "Precondición de producción: $p"; done
      if [[ "$FORZAR" -eq 1 ]]; then
        log_warn "--forzar activo: se continúa PESE a las precondiciones anteriores. Quedará registrado."
        RESULTADO_NOTA="forzado"
      else
        die 3 "Producción bloqueada. Corrija lo anterior o use --forzar (solo para emergencias justificadas)."
      fi
    fi
    if [[ -n "$VERSION_TAG" ]] && git rev-parse --verify --quiet "refs/tags/v${VERSION_TAG}" >/dev/null; then
      die 3 "El tag v${VERSION_TAG} ya existe. Los tags de release son inmutables; elija otra versión."
    fi
  else
    [[ "$rama" == "main" ]] || log_warn "Está desplegando staging desde la rama '$rama' (el pipeline lo hace desde main)."
    [[ "$sucio" -eq 0 ]]    || log_warn "Hay cambios sin confirmar (commit); se desplegará el árbol de trabajo actual."
  fi

  # Herramientas necesarias según proveedores presentes.
  local linea
  for linea in "${COMPONENTES[@]}"; do
    cargar_componente "$linea"
    componente_seleccionado || continue
    case "$C_STACK" in
      node)   requiere_comando npm "stack node" ;;
      python) requiere_comando python3 "stack python" ;;
    esac
    case "$C_PROVEEDOR" in
      firebase) command -v firebase >/dev/null 2>&1 || requiere_comando npx "para firebase-tools" ;;
      cloudrun) requiere_comando gcloud "proveedor cloudrun"; requiere_comando docker "proveedor cloudrun" ;;
      ecs)      requiere_comando aws "proveedor ecs"; requiere_comando docker "proveedor ecs"
                [[ -n "$C_CLUSTER" ]] || die 3 "Componente '$C_NOMBRE' (ecs): falta 'cluster' en el manifiesto o ECS_CLUSTER" ;;
      oci)      if compgen -G "${C_RUTA%/}/*.tf" >/dev/null; then requiere_comando terraform "proveedor oci"; else requiere_comando oci "proveedor oci (Resource Manager)"; fi ;;
      ninguno)  ;;
      *) die 3 "Proveedor no reconocido en '$C_NOMBRE': $C_PROVEEDOR (use firebase|cloudrun|ecs|oci|ninguno)" ;;
    esac
    [[ -n "$C_PROYECTO" || "$C_PROVEEDOR" == "ninguno" ]] || die 3 "Componente '$C_NOMBRE': falta 'proyecto' para el ambiente $AMBIENTE_MANIFIESTO"
  done
  if [[ -n "$FILTRO_COMPONENTE" ]]; then
    local encontrado=0
    for linea in "${COMPONENTES[@]}"; do
      cargar_componente "$linea"; componente_seleccionado && encontrado=1
    done
    [[ "$encontrado" -eq 1 ]] || die 3 "El componente '$FILTRO_COMPONENTE' no existe en el manifiesto"
  fi

  # Confirmación humana para producción. Claude Code u otro agente no debe
  # superar este punto sin que una persona escriba la palabra.
  if [[ "$AMBIENTE" == "prod" && "$DRY_RUN" -eq 0 ]]; then
    if [[ "$FORZAR" -eq 1 ]]; then
      if [[ -n "${CI:-}" ]]; then
        log_warn "Confirmación omitida por --forzar en CI (CI=${CI})."
      else
        log_warn "Confirmación omitida por --forzar FUERA de CI. Esta acción queda registrada."
      fi
    else
      [[ -t 0 ]] || die 9 "Producción requiere confirmación interactiva (escriba DESPLEGAR). Sin terminal, use --forzar solo desde CI."
      printf '\n%sVa a desplegar a PRODUCCIÓN el proyecto %s (commit %s).%s\n' "$C_NEGRITA" "$PROYECTO" "$SHA_CORTO" "$C_RESET"
      printf 'Escriba DESPLEGAR para continuar (cualquier otra cosa cancela): '
      local respuesta
      read -r respuesta
      [[ "$respuesta" == "DESPLEGAR" ]] || die 9 "Despliegue a producción cancelado por el usuario."
    fi
  fi
  log_ok "Verificación previa completada"
}

# ------------------------------------------------------------------------------
# [2/7] Calidad: lint y pruebas por componente
# ------------------------------------------------------------------------------
npm_tiene_script() {
  # npm_tiene_script <ruta> <script>
  local ruta="$1" script="$2"
  python3 - "$ruta/package.json" "$script" <<'PY' 2>/dev/null
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        sys.exit(0 if sys.argv[2] in (json.load(f).get("scripts") or {}) else 1)
except Exception:
    sys.exit(1)
PY
}

fase_calidad() {
  log_fase 2 "Calidad (lint y pruebas)"
  if [[ "$SIN_TESTS" -eq 1 ]]; then
    log_warn "Fase de calidad omitida por --sin-tests"
    return 0
  fi
  # Mismo nombre que la variable del pipeline; los runners de pruebas que
  # calculan cobertura pueden leerla (vitest/jest/pytest-cov vía configuración).
  export COVERAGE_MIN="$COBERTURA_MIN"
  log_info "Umbral de cobertura (COVERAGE_MIN): $COVERAGE_MIN"
  local linea
  for linea in "${COMPONENTES[@]}"; do
    cargar_componente "$linea"
    componente_seleccionado || continue
    log_info "Componente '$C_NOMBRE' ($C_STACK) en $C_RUTA"
    case "$C_STACK" in
      node)
        if [[ ! -d "$C_RUTA/node_modules" ]]; then
          log_info "node_modules ausente: instalando con npm ci"
          ejecutar_en "$C_RUTA" npm ci --no-audit --no-fund || die 5 "npm ci falló en '$C_NOMBRE'"
        fi
        if npm_tiene_script "$C_RUTA" lint; then
          ejecutar_en "$C_RUTA" npm run lint || die 5 "Lint falló en '$C_NOMBRE'"
        else
          log_warn "Sin script 'lint' en $C_RUTA/package.json"
        fi
        if npm_tiene_script "$C_RUTA" test; then
          # CI=true evita que vitest/jest queden en modo interactivo (watch).
          ejecutar_en "$C_RUTA" env CI=true npm test -- --run 2>/dev/null \
            || ejecutar_en "$C_RUTA" env CI=true npm test \
            || die 5 "Pruebas fallidas en '$C_NOMBRE'"
        else
          log_warn "Sin script 'test' en $C_RUTA/package.json: no hay pruebas automatizadas"
        fi ;;
      python)
        if command -v ruff >/dev/null 2>&1; then
          ejecutar_en "$C_RUTA" ruff check . || die 5 "ruff check falló en '$C_NOMBRE'"
        else
          log_warn "ruff no instalado (pip install ruff); se omite lint"
        fi
        if ( cd "$C_RUTA" && python3 -c "import pytest" >/dev/null 2>&1 ); then
          ejecutar_en "$C_RUTA" python3 -m pytest -q || die 5 "pytest falló en '$C_NOMBRE'"
        else
          log_warn "pytest no disponible en el entorno de '$C_NOMBRE'; se omiten pruebas"
        fi ;;
      terraform)
        if command -v terraform >/dev/null 2>&1; then
          ejecutar_en "$C_RUTA" terraform fmt -check -recursive || die 5 "terraform fmt -check falló en '$C_NOMBRE'"
        fi ;;
      docker|static)
        log_info "Stack '$C_STACK': sin pruebas de código propias en esta fase" ;;
      *)
        die 3 "Stack no reconocido en '$C_NOMBRE': $C_STACK" ;;
    esac
  done
  log_ok "Calidad completada"
}

# ------------------------------------------------------------------------------
# [3/7] Seguridad estática (delegada a security-local.sh)
# ------------------------------------------------------------------------------
fase_seguridad() {
  log_fase 3 "Seguridad estática"
  if [[ "$SIN_SEGURIDAD" -eq 1 ]]; then
    log_warn "Fase de seguridad omitida por --sin-seguridad"
    return 0
  fi
  local script=""
  for candidato in "${SCRIPT_DIR}/security-local.sh" "./security-local.sh"; do
    [[ -x "$candidato" ]] && { script="$candidato"; break; }
  done
  [[ -n "$script" ]] || die 3 "No se encontró security-local.sh (junto a deploy.sh o en la raíz). Ejecute bootstrap-repo.sh."

  # CAMBIO RESPECTO DE LA v1: la versión anterior ejecutaba `snyk test` y
  # `npm audit` y solo imprimía una advertencia ("exit 1" comentado). Eso
  # convertía el control en decorativo: un hallazgo CRITICAL llegaba a
  # producción igual. La política v2 (sección 6) establece que CRITICAL y HIGH
  # bloquean en todo ambiente, y las excepciones se gestionan únicamente en
  # .devsecops.yml (con vencimiento). security-local.sh aplica ese criterio y
  # devuelve 1 cuando hay hallazgos no exceptuados por encima del umbral.
  local rc=0
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '%s[DRY-RUN]%s %s --umbral HIGH\n' "$C_AMARILLO" "$C_RESET" "$script"
  else
    "$script" --umbral HIGH || rc=$?
  fi
  case "$rc" in
    0) log_ok "Seguridad estática sin hallazgos bloqueantes" ;;
    1) die 4 "Seguridad estática BLOQUEA el despliegue: hay hallazgos CRITICAL/HIGH no exceptuados. Revise .security-reports/ultimo/resumen.md" ;;
    3) die 4 "Seguridad estática no pudo ejecutarse (faltan herramientas: ./security-local.sh --instalar). Un análisis vacío no aprueba un despliegue." ;;
    *) die 4 "security-local.sh terminó con código $rc (error de ejecución, no de hallazgos)" ;;
  esac
}

# ------------------------------------------------------------------------------
# [4/7] Construcción por ambiente
# ------------------------------------------------------------------------------
referencia_imagen() {
  # referencia_imagen: calcula el nombre de imagen (con etiqueta = sha) para el
  # componente actual. El registro es SIEMPRE el del proyecto de staging
  # (C_REG_*): producción despliega por digest la misma imagen ya publicada,
  # igual que hacen los workflows (una sola construcción por commit).
  case "$C_PROVEEDOR" in
    cloudrun) printf '%s-docker.pkg.dev/%s/%s/%s:%s' "$C_REG_REGION" "$C_REG_PROYECTO" "$C_REG_REPOSITORIO" "$C_SERVICIO" "$SHA_CORTO" ;;
    ecs)
      # En AWS el registro ECR pertenece a la cuenta activa; el estándar publica
      # en la cuenta de staging y producción la consume por digest (cross-account).
      local cuenta
      cuenta="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo 000000000000)"
      printf '%s.dkr.ecr.%s.amazonaws.com/%s:%s' "$cuenta" "$C_REG_REGION" "$C_REG_REPOSITORIO" "$SHA_CORTO" ;;
    *) printf '%s/%s:%s' "$PROYECTO" "$C_NOMBRE" "$SHA_CORTO" ;;
  esac
}

fase_construccion() {
  log_fase 4 "Construcción (APP_ENV=$AMBIENTE_MANIFIESTO)"
  local linea
  for linea in "${COMPONENTES[@]}"; do
    cargar_componente "$linea"
    componente_seleccionado || continue
    log_info "Componente '$C_NOMBRE' ($C_STACK → $C_PROVEEDOR)"
    # Build de código (node): build:<ambiente> si existe, si no build genérico.
    if [[ "$C_STACK" == "node" ]]; then
      local script_build="build:${AMBIENTE}"
      [[ "$AMBIENTE" == "prod" ]] && npm_tiene_script "$C_RUTA" "build:production" && script_build="build:production"
      if npm_tiene_script "$C_RUTA" "$script_build"; then
        ejecutar_en "$C_RUTA" env APP_ENV="$AMBIENTE_MANIFIESTO" npm run "$script_build" || die 6 "Build falló en '$C_NOMBRE'"
      elif npm_tiene_script "$C_RUTA" build; then
        ejecutar_en "$C_RUTA" env APP_ENV="$AMBIENTE_MANIFIESTO" npm run build || die 6 "Build falló en '$C_NOMBRE'"
      else
        log_warn "Sin script de build en '$C_NOMBRE'"
      fi
    fi
    # Imagen de contenedor cuando el proveedor la necesita.
    if [[ "$C_PROVEEDOR" == "cloudrun" || "$C_PROVEEDOR" == "ecs" ]] || [[ "$C_STACK" == "docker" ]]; then
      [[ -f "$C_RUTA/Dockerfile" ]] || die 6 "Componente '$C_NOMBRE' requiere Dockerfile en $C_RUTA"
      local imagen
      imagen="$(referencia_imagen)"
      ejecutar docker build --pull \
        --build-arg "APP_ENV=$AMBIENTE_MANIFIESTO" \
        --label "org.opencontainers.image.revision=$SHA_LARGO" \
        --label "org.opencontainers.image.source=$(git remote get-url origin 2>/dev/null || echo local)" \
        -t "$imagen" "$C_RUTA" || die 6 "docker build falló en '$C_NOMBRE'"
      IMAGENES["$C_NOMBRE"]="$imagen"
      if command -v trivy >/dev/null 2>&1 && [[ "$DRY_RUN" -eq 0 ]]; then
        # Mismo criterio que la fase construir del pipeline: CRITICAL/HIGH con corrección disponible bloquean.
        log_info "Escaneando imagen con trivy (CRITICAL/HIGH, solo con fix disponible)"
        trivy image --quiet --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 "$imagen" \
          || die 6 "La imagen de '$C_NOMBRE' tiene vulnerabilidades CRITICAL/HIGH con corrección disponible"
      else
        log_warn "trivy no disponible: la imagen no fue escaneada localmente (el pipeline sí lo hará)"
      fi
    fi
    # Terraform: init + validate + plan (el apply ocurre en la fase 5).
    if [[ "$C_STACK" == "terraform" ]] && compgen -G "${C_RUTA%/}/*.tf" >/dev/null; then
      ejecutar_en "$C_RUTA" terraform init -input=false -upgrade=false || die 6 "terraform init falló en '$C_NOMBRE'"
      ejecutar_en "$C_RUTA" terraform validate || die 6 "terraform validate falló en '$C_NOMBRE'"
      # Variables por ambiente: <ruta>/<staging|production>.tfvars si existe (no se
      # inyectan -var sueltas para no depender de nombres de variables del módulo).
      local -a tf_args=(plan -input=false -out="tfplan-${AMBIENTE}")
      if [[ -f "${C_RUTA%/}/${AMBIENTE_MANIFIESTO}.tfvars" ]]; then
        tf_args+=(-var-file="${AMBIENTE_MANIFIESTO}.tfvars")
      else
        log_warn "No existe ${C_RUTA%/}/${AMBIENTE_MANIFIESTO}.tfvars; terraform plan usará los valores por defecto del módulo"
      fi
      ejecutar_en "$C_RUTA" terraform "${tf_args[@]}" || die 6 "terraform plan falló en '$C_NOMBRE'"
    fi
  done
  log_ok "Construcción completada"
}

# ------------------------------------------------------------------------------
# [5/7] Despliegue por proveedor
# ------------------------------------------------------------------------------
firebase_cmd() {
  if command -v firebase >/dev/null 2>&1; then
    firebase "$@"
  else
    npx --yes "firebase-tools@${FIREBASE_TOOLS_VERSION}" "$@"
  fi
}

digest_de_imagen() {
  # Tras el push, docker registra el RepoDigest; se despliega por digest para
  # que el servicio apunte a un artefacto inmutable.
  local imagen="$1" digest
  digest="$(docker inspect --format='{{index .RepoDigests 0}}' "$imagen" 2>/dev/null || true)"
  [[ -n "$digest" ]] || die 7 "No se pudo obtener el digest de $imagen tras el push"
  printf '%s' "$digest"
}

desplegar_firebase() {
  local objetivos="hosting"
  if [[ -f "$C_RUTA/firestore.rules" ]] && grep -q '"firestore"' "$C_RUTA/firebase.json" 2>/dev/null; then
    objetivos="hosting,firestore:rules"
  fi
  # Antes de tocar `live` se guarda la versión actual en el canal `previa`
  # (procedimiento único de rollback del estándar; no existe ningún subcomando
  # de rollback en firebase-tools). Rollback:
  #   firebase hosting:clone <proyecto>:previa <proyecto>:live
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '%s[DRY-RUN]%s firebase hosting:channel:create previa --project %s (si no existe)\n' "$C_AMARILLO" "$C_RESET" "$C_PROYECTO"
    printf '%s[DRY-RUN]%s firebase hosting:clone %s:live %s:previa\n' "$C_AMARILLO" "$C_RESET" "$C_PROYECTO" "$C_PROYECTO"
    printf '%s[DRY-RUN]%s firebase deploy --only %s --project %s --non-interactive\n' "$C_AMARILLO" "$C_RESET" "$objetivos" "$C_PROYECTO"
    return 0
  fi
  ( cd "$C_RUTA" && firebase_cmd hosting:channel:create previa --project "$C_PROYECTO" ) >/dev/null 2>&1 || true
  if ! ( cd "$C_RUTA" && firebase_cmd hosting:clone "${C_PROYECTO}:live" "${C_PROYECTO}:previa" ); then
    log_warn "No se pudo copiar live → previa (¿primer despliegue?); no habrá canal de rollback para esta versión."
  fi
  log_info "firebase deploy --only $objetivos --project $C_PROYECTO"
  ( cd "$C_RUTA" && firebase_cmd deploy --only "$objetivos" --project "$C_PROYECTO" --non-interactive ) \
    || die 7 "firebase deploy falló en '$C_NOMBRE'"
}

desplegar_cloudrun() {
  local imagen="${IMAGENES[$C_NOMBRE]:-}"
  [[ -n "$imagen" ]] || die 7 "No hay imagen construida para '$C_NOMBRE'"
  ejecutar gcloud auth configure-docker "${C_REG_REGION}-docker.pkg.dev" --quiet || die 7 "No se pudo configurar docker para Artifact Registry"
  ejecutar docker push "$imagen" || die 7 "docker push falló ($imagen)"
  local digest="$imagen"
  [[ "$DRY_RUN" -eq 1 ]] || digest="$(digest_de_imagen "$imagen")"
  ejecutar gcloud run deploy "$C_SERVICIO" \
    --image "$digest" \
    --region "$C_REGION" \
    --project "$C_PROYECTO" \
    --platform managed \
    --set-env-vars "APP_ENV=$AMBIENTE_MANIFIESTO" \
    --quiet || die 7 "gcloud run deploy falló en '$C_NOMBRE'"
  if [[ -z "$C_URL" && "$DRY_RUN" -eq 0 ]]; then
    C_URL="$(gcloud run services describe "$C_SERVICIO" --region "$C_REGION" --project "$C_PROYECTO" --format='value(status.url)' 2>/dev/null || true)"
  fi
}

desplegar_ecs() {
  local imagen="${IMAGENES[$C_NOMBRE]:-}"
  [[ -n "$imagen" ]] || die 7 "No hay imagen construida para '$C_NOMBRE'"
  local registro="${imagen%%/*}"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '%s[DRY-RUN]%s aws ecr get-login-password | docker login %s\n' "$C_AMARILLO" "$C_RESET" "$registro"
  else
    aws ecr get-login-password --region "$C_REGION" | docker login --username AWS --password-stdin "$registro" \
      || die 7 "docker login a ECR falló"
  fi
  ejecutar docker push "$imagen" || die 7 "docker push falló ($imagen)"
  local digest="$imagen"
  [[ "$DRY_RUN" -eq 1 ]] || digest="$(digest_de_imagen "$imagen")"

  # Nueva revisión de la task definition con la imagen por digest y
  # aws ecs update-service apuntando a ella (equivalente a
  # amazon-ecs-render-task-definition + amazon-ecs-deploy-task-definition).
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '%s[DRY-RUN]%s aws ecs register-task-definition (imagen=%s) && aws ecs update-service --cluster %s --service %s\n' \
      "$C_AMARILLO" "$C_RESET" "$digest" "$C_CLUSTER" "$C_SERVICIO"
    return 0
  fi
  local td_actual nueva_td td_arn
  td_actual="$(aws ecs describe-services --region "$C_REGION" --cluster "$C_CLUSTER" --services "$C_SERVICIO" \
    --query 'services[0].taskDefinition' --output text)" || die 7 "No se pudo describir el servicio ECS $C_SERVICIO"
  nueva_td="$(aws ecs describe-task-definition --region "$C_REGION" --task-definition "$td_actual" --query taskDefinition --output json \
    | python3 -c '
import json, sys
td = json.load(sys.stdin)
imagen, contenedor = sys.argv[1], sys.argv[2]
for c in td.get("containerDefinitions", []):
    if contenedor in ("", c.get("name")):
        c["image"] = imagen
for k in ("taskDefinitionArn", "revision", "status", "requiresAttributes", "compatibilities",
          "registeredAt", "registeredBy", "deregisteredAt"):
    td.pop(k, None)
json.dump(td, sys.stdout)
' "$digest" "${ECS_CONTAINER_NAME:-}")" || die 7 "No se pudo preparar la nueva task definition"
  td_arn="$(aws ecs register-task-definition --region "$C_REGION" --cli-input-json "$nueva_td" \
    --query 'taskDefinition.taskDefinitionArn' --output text)" || die 7 "register-task-definition falló"
  log_info "Nueva task definition: $td_arn"
  aws ecs update-service --region "$C_REGION" --cluster "$C_CLUSTER" --service "$C_SERVICIO" \
    --task-definition "$td_arn" --force-new-deployment >/dev/null || die 7 "aws ecs update-service falló"
  log_info "Esperando estabilidad del servicio (aws ecs wait services-stable)..."
  aws ecs wait services-stable --region "$C_REGION" --cluster "$C_CLUSTER" --services "$C_SERVICIO" \
    || die 7 "El servicio ECS no se estabilizó. Task definition anterior para rollback: $td_actual"
}

desplegar_oci() {
  if compgen -G "${C_RUTA%/}/*.tf" >/dev/null; then
    [[ -f "$C_RUTA/tfplan-${AMBIENTE}" || "$DRY_RUN" -eq 1 ]] || die 7 "No existe el plan tfplan-${AMBIENTE} generado en la fase 4"
    ejecutar_en "$C_RUTA" terraform apply -input=false "tfplan-${AMBIENTE}" || die 7 "terraform apply falló en '$C_NOMBRE'"
    ejecutar rm -f "${C_RUTA%/}/tfplan-${AMBIENTE}"
  elif [[ -n "$C_STACK_ID" ]]; then
    ejecutar oci resource-manager job create-apply-job \
      --stack-id "$C_STACK_ID" \
      --execution-plan-strategy AUTO_APPROVED \
      --display-name "deploy-${AMBIENTE}-${SHA_CORTO}" \
      --wait-for-state SUCCEEDED --wait-for-state FAILED \
      || die 7 "El job de OCI Resource Manager falló en '$C_NOMBRE'"
  else
    die 7 "Componente '$C_NOMBRE' (oci): no hay archivos .tf ni 'stack_id' (OCI_STACK_ID) para Resource Manager"
  fi
}

fase_despliegue() {
  log_fase 5 "Despliegue por proveedor"
  local linea
  for linea in "${COMPONENTES[@]}"; do
    cargar_componente "$linea"
    componente_seleccionado || continue
    log_info "Componente '$C_NOMBRE' → $C_PROVEEDOR ($C_PROYECTO)"
    case "$C_PROVEEDOR" in
      firebase) desplegar_firebase ;;
      cloudrun) desplegar_cloudrun ;;
      ecs)      desplegar_ecs ;;
      oci)      desplegar_oci ;;
      ninguno)  log_info "Proveedor 'ninguno': no se despliega (solo se verificó y construyó)" ;;
    esac
    [[ -n "$C_URL" ]] && URLS_SALUD+=("$C_NOMBRE|$C_URL")
  done
  log_ok "Despliegue completado"
}

# ------------------------------------------------------------------------------
# [6/7] Verificación de salud
# ------------------------------------------------------------------------------
verificar_url() {
  local url="$1" intento codigo
  for ((intento = 1; intento <= HEALTH_REINTENTOS; intento++)); do
    codigo="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -L "$url" 2>/dev/null || echo 000)"
    if [[ "$codigo" =~ ^[23][0-9][0-9]$ ]]; then
      log_ok "$url respondió $codigo (intento $intento/$HEALTH_REINTENTOS)"
      return 0
    fi
    log_warn "$url respondió $codigo (intento $intento/$HEALTH_REINTENTOS); reintento en ${HEALTH_ESPERA}s"
    sleep "$HEALTH_ESPERA"
  done
  return 1
}

fase_salud() {
  log_fase 6 "Verificación de salud"
  if [[ ${#URLS_SALUD[@]} -eq 0 ]]; then
    log_warn "Ningún componente declara 'url' para $AMBIENTE_MANIFIESTO; no se verifica salud. Añádala al manifiesto."
    return 0
  fi
  requiere_comando curl
  # Ruta de salud unificada del estándar: HEALTH_PATH (/healthz), 10 intentos,
  # 15 s entre intentos (los mismos valores que post-despliegue en CI).
  local entrada nombre url url_salud fallos=0
  for entrada in "${URLS_SALUD[@]}"; do
    nombre="${entrada%%|*}"; url="${entrada#*|}"
    url_salud="${url%/}${HEALTH_PATH}"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      printf '%s[DRY-RUN]%s curl %s (componente %s, %s intentos x %ss)\n' "$C_AMARILLO" "$C_RESET" "$url_salud" "$nombre" "$HEALTH_REINTENTOS" "$HEALTH_ESPERA"
      continue
    fi
    verificar_url "$url_salud" || { log_error "Componente '$nombre' no responde correctamente en $url_salud"; fallos=$((fallos + 1)); }
  done
  if [[ "$fallos" -gt 0 ]]; then
    log_error "Rollback sugerido (ver 01-seguridad/06-rollback-e-incidentes.md):"
    log_error "  firebase: firebase hosting:clone <proyecto>:previa <proyecto>:live"
    log_error "  cloudrun: gcloud run services update-traffic <servicio> --to-revisions <revision-anterior>=100"
    log_error "  ecs:      aws ecs update-service --task-definition <td-anterior>"
    die 8 "La verificación de salud falló en $fallos componente(s)"
  fi
  log_ok "Verificación de salud completada"
}

# ------------------------------------------------------------------------------
# [7/7] Registro: rama chore/deploy-*, PR y tag (nunca push directo a main)
# ------------------------------------------------------------------------------
fase_registro() {
  log_fase 7 "Registro en control de versiones"

  local rama fecha rama_registro
  rama="$(git rev-parse --abbrev-ref HEAD)"
  fecha="$(date +%Y%m%d-%H%M%S)"
  rama_registro="chore/deploy-${AMBIENTE}-${fecha}"

  # Solo archivos ya rastreados: un despliegue no debe introducir archivos
  # nuevos (y menos secretos o artefactos) sin revisión humana.
  local no_rastreados
  # Sin `| head`: con pipefail y cientos de no rastreados, git recibía SIGPIPE,
  # la asignación salía con 141 y set -e cortaba el script después de desplegar
  # (medido: con 300 archivos, 19 de 20 veces). Se listan los 20 primeros.
  no_rastreados="$(git ls-files --others --exclude-standard)"
  if [[ -n "$no_rastreados" ]]; then
    log_warn "Hay archivos no rastreados que NO se agregarán al commit (revíselos manualmente):"
    sed -n '1,20s/^/  /p' <<< "$no_rastreados" >&2
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '%s[DRY-RUN]%s git switch -c %s && git add -u && git commit -m "chore(deploy): despliegue %s %s %s" && git push -u origin %s && gh pr create\n' \
      "$C_AMARILLO" "$C_RESET" "$rama_registro" "$ETIQUETA_COMMIT" "$PROYECTO" "$SHA_CORTO" "$rama_registro"
    [[ -n "$VERSION_TAG" ]] && printf '%s[DRY-RUN]%s git tag v%s && git push origin v%s\n' "$C_AMARILLO" "$C_RESET" "$VERSION_TAG" "$VERSION_TAG"
    return 0
  fi

  git add -u
  if git diff --cached --quiet; then
    log_info "No hay cambios generados por el despliegue; no se crea commit."
  else
    # Nunca se hace push a main (el ruleset lo impide y el hook local
    # no-commit-to-branch lo bloquea): el commit de registro nace en una rama
    # propia y llega a main solo por PR.
    git switch -c "$rama_registro" || die 1 "No se pudo crear la rama $rama_registro"
    if ! git commit -q -m "chore(deploy): despliegue ${ETIQUETA_COMMIT} ${PROYECTO} ${SHA_CORTO}" \
        -m "Ambiente: ${AMBIENTE_MANIFIESTO}. Ejecutado por ${USUARIO} con deploy.sh v${SCRIPT_VERSION}."; then
      git switch "$rama" >/dev/null 2>&1 || true
      die 1 "No se pudo crear el commit de registro"
    fi
    log_ok "Commit de registro creado en ${rama_registro}: $(git rev-parse --short HEAD)"
    if git remote get-url origin >/dev/null 2>&1; then
      if git push -u origin "$rama_registro"; then
        if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
          gh pr create --base main --head "$rama_registro" \
            --title "chore(deploy): despliegue ${ETIQUETA_COMMIT} ${PROYECTO} ${SHA_CORTO}" \
            --body "Registro del despliegue a ${AMBIENTE_MANIFIESTO} ejecutado por ${USUARIO} con deploy.sh v${SCRIPT_VERSION}." \
            && log_ok "PR de registro abierto (rama ${rama_registro})" \
            || log_warn "No se pudo abrir el PR; hágalo con: gh pr create --base main --head ${rama_registro}"
        else
          log_info "gh no está autenticado. Abra el PR con: gh pr create --base main --head ${rama_registro}"
        fi
      else
        log_warn "No se pudo publicar la rama ${rama_registro}; publíquela y abra el PR manualmente."
      fi
    else
      log_warn "Sin remoto 'origin': el commit de registro queda en la rama local ${rama_registro}."
    fi
    git switch "$rama" >/dev/null 2>&1 || log_warn "No se pudo volver a la rama ${rama}; está en ${rama_registro}."
  fi

  if [[ -n "$VERSION_TAG" ]]; then
    local tag="v${VERSION_TAG}"
    # La firma de tags es manual y solo se exige si TAG_FIRMADO_REQUERIDO=true
    # (recomendada en Modo B0). Se firma si hay clave configurada.
    if git config --get user.signingkey >/dev/null 2>&1; then
      git tag -s "$tag" -m "Release ${tag} — ${PROYECTO} (${SHA_CORTO})" || die 1 "No se pudo crear el tag firmado $tag"
      log_ok "Tag firmado creado: $tag"
    else
      git tag -a "$tag" -m "Release ${tag} — ${PROYECTO} (${SHA_CORTO})" || die 1 "No se pudo crear el tag $tag"
      if [[ "$MODO" == "B0" ]]; then
        log_warn "Tag anotado sin firma. En Modo B0 se recomienda firmar los tags (y es obligatorio si TAG_FIRMADO_REQUERIDO=true); configure user.signingkey (gpg o ssh)."
      else
        log_warn "Tag anotado sin firma (configure user.signingkey para firmarlo)."
      fi
    fi
    git push origin "$tag" || die 1 "No se pudo hacer push del tag $tag"
    log_ok "Tag $tag publicado. release.yml (si existe) generará el Release con el changelog; el SBOM queda como artifact del run de CI."
  elif [[ "$AMBIENTE" == "prod" ]]; then
    log_warn "Producción sin --version: no se creó tag. El estándar exige un tag vX.Y.Z por release; créelo con release.yml o vuelva a ejecutar con --version."
  fi
  log_ok "Registro completado"
}

# ------------------------------------------------------------------------------
# Principal
# ------------------------------------------------------------------------------
main() {
  analizar_argumentos "$@"
  printf '%sdeploy.sh v%s — %s%s\n' "$C_NEGRITA" "$SCRIPT_VERSION" "$(date '+%Y-%m-%d %H:%M:%S')" "$C_RESET"
  [[ "$DRY_RUN" -eq 1 ]] && log_warn "Modo dry-run: no se ejecutará ningún comando con efectos."

  if [[ -f "$MANIFIESTO" ]]; then
    cargar_manifiesto
  else
    autodetectar_componente
  fi

  fase_verificacion_previa
  fase_calidad
  fase_seguridad
  fase_construccion
  fase_despliegue
  fase_salud
  fase_registro

  RESULTADO="EXITOSO${RESULTADO_NOTA:+($RESULTADO_NOTA)}"
  printf '\n%s=== Despliegue de %s en %s finalizado con éxito (commit %s) ===%s\n' \
    "$C_VERDE" "$PROYECTO" "$AMBIENTE" "$SHA_CORTO" "$C_RESET"
}

RESULTADO_NOTA=""
main "$@"
