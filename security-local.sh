#!/usr/bin/env bash
# ==============================================================================
# security-local.sh — Equivalente local de _reusable-security.yml
# ==============================================================================
# Versión: 2.4 | Fecha: 2026-09-12
# Documentos relacionados: 00-gobernanza/01-politica-cicd-devsecops.md (secciones 3.1, 6 y 8),
#   02-pipelines/workflows/_reusable-security.yml, 02-pipelines/config/{gitleaks.toml,semgrep.yml,trivy.yaml}
#
# Uso:
#   ./security-local.sh [--umbral HIGH|MEDIUM|LOW] [--instalar] [--ruta DIR]
#                       [--solo herr1,herr2] [--sin-historial] [--informe DIR]
#
# Ejecuta con herramientas OSS los mismos controles de la fase
# `seguridad-estatica` del pipeline: secretos (gitleaks), SAST (semgrep),
# SCA (osv-scanner, npm/pnpm audit, pip-audit), IaC y Dockerfile (trivy, checkov).
# Usa los mismos archivos de configuración que CI (.github/gitleaks.toml,
# .github/semgrep.yml, .github/trivy.yaml) si existen, para que "en mi máquina pasaba" no ocurra.
#
# Monorepos: los escáneres de composición analizan la raíz Y cada
# `componentes[].ruta` del manifiesto, que es donde viven los lockfiles
# (services/uv.lock, dashboard/pnpm-lock.yaml). Un escáner que no encontró
# fuentes, o que falló, figura en el resumen como NO EJECUTADO y el resultado
# se marca como de cobertura parcial: un análisis vacío no es un análisis limpio.
#
# Excepciones (D5): igual que el job `preparar` de _reusable-security.yml, este
# script lee `seguridad.excepciones[]` de .devsecops.yml, descarta las vencidas
# y GENERA los archivos/listas de ignorado por herramienta: .trivyignore.yaml
# (trivy), .gitleaksignore (gitleaks), --skip-check (checkov), --exclude-rule
# (semgrep) y --ignore-vuln (pip-audit). Los archivos generados NUNCA se
# versionan (se añaden a .gitignore) ni se editan a mano. Las de npm-audit se
# aplican al consolidar, por ID; nunca con `pnpm audit --ignore`, que escribe
# auditConfig en pnpm-workspace.yaml. Un aviso que el repositorio ocultó con
# auditConfig se detecta y bloquea como `auditConfig-oculto`.
# La consolidación exceptúa un hallazgo solo con el ID que acepta CI y
# comparado como lo compara la herramienta: gitleaks, por la huella completa
# y nunca por la regla; npm audit, por el GHSA del aviso (ver add()).
# Una excepción que nombra el hallazgo de otra forma se informa sin efecto.
# Una excepción con `componente` vale solo para ese componente, como en CI, que
# ejecuta el reusable una vez por componente: no va a los archivos de ignorado
# (valen para todo el repositorio) y la aplica la consolidación, por la ruta
# del hallazgo, solo si ningún otro componente cuyo job lo vería en CI lo ve.
#
# Resultado: informe en .security-reports/<fecha>/ (resumen.md, resumen.json y
# la salida cruda de cada herramienta) y enlace .security-reports/ultimo.
#
# Códigos de salida:
#   0  sin hallazgos por encima del umbral (o todos exceptuados)
#   1  hay hallazgos ≥ umbral no exceptuados (BLOQUEA)
#   2  uso incorrecto
#   3  error de ejecución (dependencia faltante indispensable, ruta inválida)
# ==============================================================================
set -Eeuo pipefail

readonly SCRIPT_VERSION="2.4"
readonly MANIFIESTO=".devsecops.yml"
readonly INFORMES_BASE_DEFECTO=".security-reports"
# Versiones fijadas para --instalar (mismas que usa el pipeline; actualícelas
# junto con _reusable-security.yml para conservar la paridad local/CI).
readonly GITLEAKS_VERSION="8.30.1"
readonly TRIVY_VERSION="0.70.0"
readonly OSV_SCANNER_VERSION="2.5.1"
readonly SEMGREP_VERSION="1.174.0"
readonly CHECKOV_VERSION="3.3.15"    # la de la imagen de checkov-action que fija el workflow
readonly PIP_AUDIT_VERSION="2.10.1"   # la misma que instala _reusable-security.yml
# Manifiestos de dependencias que se entregan a osv-scanner con -L.
readonly LOCKFILES=(package-lock.json pnpm-lock.yaml yarn.lock uv.lock poetry.lock Pipfile.lock pdm.lock requirements.txt)
readonly BIN_DIR="${HOME}/.local/bin"

UMBRAL="HIGH"
INSTALAR=0
RUTA="."
SOLO=""
SIN_HISTORIAL=0
INFORMES_BASE="$INFORMES_BASE_DEFECTO"
INFORME_DIR=""
declare -a FALTANTES=()
declare -a EJECUTADAS=()
HAY_IAC=0   # hay archivos que activan el job iac de CI (checkov)
# Directorios analizados (raíz + componentes del manifiesto) y, entre ellos,
# los que tienen dependencias de cada ecosistema.
declare -a DIRECTORIOS=() DIRS_NODE=() DIRS_PYTHON=()
# Registros en el directorio de informe (se crean en main):
#   fuentes.tsv        herramienta, ruta, lockfile y JSON de cada fuente analizada
#   no-ejecutadas.tsv  herramienta, ruta y motivo de cada escáner que no analizó nada
FUENTES_TSV=""
NO_EJECUTADAS_TSV=""
# Excepciones vigentes generadas desde el manifiesto (mismos artefactos que el
# job `preparar` de _reusable-security.yml).
CHECKOV_SKIP=""      # IDs CKV_* separados por comas (checkov --skip-check)
SEMGREP_EXCLUDE=""   # "--exclude-rule id ..." (semgrep)
PIP_IGNORE=""        # "--ignore-vuln ID ..." (pip-audit)

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
log_seccion() { printf '\n%s--- %s ---%s\n' "$C_NEGRITA" "$*" "$C_RESET"; }
die() { local c="$1"; shift; log_error "$*"; exit "$c"; }

mostrar_ayuda() {
  cat <<EOF
security-local.sh v${SCRIPT_VERSION} — seguridad estática local (paridad con _reusable-security.yml)

Uso:
  ./security-local.sh [opciones]

Opciones:
  --umbral <HIGH|MEDIUM|LOW>  Severidad mínima que bloquea (código 1). Por defecto HIGH.
                              La política no permite relajar por debajo de HIGH; CRITICAL se rechaza.
                              Si el manifiesto declara bloquear_en con MEDIUM, ese umbral prevalece.
  --instalar                  Instala las herramientas faltantes con VERSIONES FIJADAS
                              (gitleaks v${GITLEAKS_VERSION}, trivy v${TRIVY_VERSION}, osv-scanner v${OSV_SCANNER_VERSION},
                              semgrep ${SEMGREP_VERSION}, checkov ${CHECKOV_VERSION}); binarios en ${BIN_DIR}.
                              Sin esta opción solo se informa el comando de instalación.
  --ruta <DIR>                Directorio a analizar (por defecto el actual).
  --solo <lista>              Ejecuta solo estas herramientas, separadas por coma:
                              gitleaks,semgrep,osv-scanner,trivy,checkov,npm-audit,pip-audit
                              (npm-audit usa npm o pnpm según el lockfile de cada componente).
  --sin-historial            gitleaks analiza solo el árbol de trabajo (no el historial git).
  --informe <DIR>             Directorio base de informes (por defecto ${INFORMES_BASE_DEFECTO}/).
  -h, --help                  Muestra esta ayuda.

Excepciones: la única fuente es ${MANIFIESTO} (seguridad.excepciones[]: id,
  herramienta, vence). Una excepción vencida vuelve a bloquear. Desde el
  manifiesto se GENERAN .trivyignore.yaml, .gitleaksignore y las listas de
  ignorado de checkov/semgrep/pip-audit (los mismos artefactos que el job
  'preparar' de _reusable-security.yml); esos archivos no se versionan ni se
  editan a mano (política, sección 8).

Composición (SCA): se analizan la raíz y cada componentes[].ruta de
  ${MANIFIESTO}. Un escáner sin fuentes o que falla figura como NO EJECUTADO y
  el resultado se informa como de cobertura parcial; nunca como aprobado.

Códigos de salida: 0 limpio | 1 hallazgos ≥ umbral | 2 uso | 3 error de ejecución
EOF
}

analizar_argumentos() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --umbral)   [[ $# -ge 2 ]] || die 2 "--umbral requiere un valor"; UMBRAL="${2^^}"; shift ;;
      --instalar) INSTALAR=1 ;;
      --ruta)     [[ $# -ge 2 ]] || die 2 "--ruta requiere un directorio"; RUTA="$2"; shift ;;
      --solo)     [[ $# -ge 2 ]] || die 2 "--solo requiere una lista"; SOLO="$2"; shift ;;
      --sin-historial) SIN_HISTORIAL=1 ;;
      --informe)  [[ $# -ge 2 ]] || die 2 "--informe requiere un directorio"; INFORMES_BASE="$2"; shift ;;
      -h|--help)  mostrar_ayuda; exit 0 ;;
      *) log_error "Argumento no reconocido: $1"; mostrar_ayuda; exit 2 ;;
    esac
    shift
  done
  case "$UMBRAL" in
    HIGH|MEDIUM|LOW) ;;
    CRITICAL) die 2 "La política exige bloquear al menos en HIGH; --umbral CRITICAL no está permitido." ;;
    *) die 2 "Umbral inválido: $UMBRAL (use HIGH, MEDIUM o LOW)" ;;
  esac
  [[ -d "$RUTA" ]] || die 3 "La ruta no existe: $RUTA"
}

herramienta_activa() {
  # herramienta_activa <nombre>: true si no hay --solo o si el nombre está en la lista.
  [[ -z "$SOLO" ]] && return 0
  [[ ",${SOLO}," == *",$1,"* ]]
}

# ------------------------------------------------------------------------------
# Detección de stack (mismos criterios que la fase preparar del pipeline)
# ------------------------------------------------------------------------------
# slug <ruta>: nombre de archivo estable para los informes de un componente.
slug() {
  local s="${1#./}"
  [[ -z "$s" || "$s" == "." ]] && s="raiz"
  printf '%s' "${s//\//-}"
}

# no_ejecutada <herramienta> <ruta> <motivo>: el escáner no analizó nada en esa
# ruta. Queda en el resumen como no ejecutado; nunca como aprobado.
no_ejecutada() {
  herramienta_activa "$1" || return 0
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$NO_EJECUTADAS_TSV"
  log_warn "$1 NO EJECUTADO en $2: $3"
}

# registrar_fuente <herramienta> <ruta> <lockfile> <json>: evidencia de qué
# analizó cada escáner de composición (sección "Fuentes" del resumen).
registrar_fuente() {
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$(basename "$4")" >> "$FUENTES_TSV"
}

# listar_directorios: la raíz y cada componentes[].ruta del manifiesto, con su
# stack declarado ("ruta<TAB>stack"). Mismo criterio que el pipeline, que
# ejecuta _reusable-security.yml una vez por componente.
listar_directorios() {
  printf '.\t\n'
  [[ -f "$MANIFIESTO" ]] || return 0
  command -v python3 >/dev/null 2>&1 || { log_warn "python3 no disponible: no se leen los componentes de $MANIFIESTO; se analiza solo la raíz"; return 0; }
  python3 - "$MANIFIESTO" <<'PY' || log_warn "No se pudieron leer los componentes de $MANIFIESTO; se analiza solo la raíz"
import os, sys
try:
    import yaml
except ImportError:
    print("[AVISO] PyYAML no instalado: no se leen los componentes del manifiesto; se analiza solo la raíz", file=sys.stderr)
    sys.exit(0)
with open(sys.argv[1], encoding="utf-8") as f:
    m = yaml.safe_load(f) or {}
for c in m.get("componentes") or []:
    c = c or {}
    ruta = os.path.normpath(str(c.get("ruta") or "."))
    if os.path.isabs(ruta) or ruta == ".." or ruta.startswith("../"):
        print(f"[AVISO] Componente {c.get('nombre')}: ruta fuera del repositorio, se ignora ({ruta})", file=sys.stderr)
        continue
    if not os.path.isdir(ruta):
        print(f"[AVISO] Componente {c.get('nombre')}: la ruta {ruta} no existe", file=sys.stderr)
        continue
    print(f"{ruta}\t{c.get('stack') or ''}")
PY
}

detectar_stack() {
  log_seccion "Detección de stack en $(pwd)"
  local ruta stack
  local -A vistos=()
  while IFS=$'\t' read -r ruta stack; do
    [[ -n "$ruta" ]] || continue
    if [[ -z "${vistos[$ruta]:-}" ]]; then
      vistos[$ruta]=1
      DIRECTORIOS+=("$ruta")
      [[ -f "$ruta/package.json" ]] && DIRS_NODE+=("$ruta")
      if [[ -f "$ruta/pyproject.toml" || -f "$ruta/requirements.txt" || -f "$ruta/uv.lock" ]]; then
        DIRS_PYTHON+=("$ruta")
      fi
    fi
    # Un componente que declara un stack y no tiene nada que auditar no es un
    # componente limpio: es uno que no se analizó.
    case "$stack" in
      node)   [[ -f "$ruta/package.json" ]] \
                || no_ejecutada npm-audit "$ruta" "el componente declara stack node y no tiene package.json" ;;
      python) [[ -f "$ruta/pyproject.toml" || -f "$ruta/requirements.txt" ]] \
                || no_ejecutada pip-audit "$ruta" "el componente declara stack python y no tiene pyproject.toml ni requirements.txt" ;;
      terraform) [[ -n "$(find "$ruta" -name '*.tf' -not -path '*/node_modules/*' -print -quit)" ]] \
                || no_ejecutada checkov "$ruta" "el componente declara stack terraform y no tiene archivos .tf" ;;
    esac
  done < <(listar_directorios)
  # Mismo criterio que el paso «Detectar stack» del job preparar, que activa el
  # job iac: .tf, Dockerfile* o manifiestos en k8s/ a cualquier profundidad
  # (antes, solo en la raíz de cada componente, más cualquier .yaml de la raíz).
  # La raíz siempre está entre los directorios, así que basta con recorrerla.
  # -print -quit y no `| grep -q .`: con pipefail, grep sale en la primera
  # línea, find recibe SIGPIPE si le queda salida y el `if` da falso.
  if [[ -n "$(find . -not -path '*/node_modules/*' -not -path './.claude/worktrees/*' -not -path "./${INFORMES_BASE#./}/*" \
               \( -name '*.tf' -o -name 'Dockerfile*' -o -path '*/k8s/*.y*ml' \) -print -quit)" ]]; then
    HAY_IAC=1
  fi
  log_info "directorios: ${DIRECTORIOS[*]}"
  log_info "node: ${DIRS_NODE[*]:-—} | python: ${DIRS_PYTHON[*]:-—} | iac=$HAY_IAC"
}

# ------------------------------------------------------------------------------
# Excepciones vigentes: genera desde .devsecops.yml los MISMOS artefactos que el
# job `preparar` de _reusable-security.yml: .trivyignore.yaml, .gitleaksignore
# y las listas para checkov (--skip-check), semgrep (--exclude-rule) y
# pip-audit (--ignore-vuln). Los archivos generados NO se versionan.
# ------------------------------------------------------------------------------
generar_excepciones() {
  log_seccion "Excepciones vigentes desde $MANIFIESTO"
  if ! command -v python3 >/dev/null 2>&1; then
    log_warn "python3 no disponible: no se generan los archivos de excepciones (se aplican igualmente en la consolidación)"
    return 0
  fi
  local salida
  if ! salida="$(python3 - <<'PY'
import datetime as dt, pathlib, sys
try:
    import yaml
except ImportError:
    print("[AVISO] PyYAML no instalado: no se leen excepciones del manifiesto", file=sys.stderr)
    yaml = None
hoy = dt.date.today()
m = {}
if yaml and pathlib.Path(".devsecops.yml").is_file():
    with open(".devsecops.yml", encoding="utf-8") as f:
        m = yaml.safe_load(f) or {}
vigentes, trivy_vuln, trivy_misc, gitleaks = [], [], [], []
checkov, semgrep, pip = [], [], []
for e in (m.get("seguridad", {}) or {}).get("excepciones", []) or []:
    vence = e.get("vence")
    try:
        if not isinstance(vence, dt.date):
            vence = dt.date.fromisoformat(str(vence))
    except Exception:
        print(f"[AVISO] Excepción con fecha inválida descartada: {e.get('id')}", file=sys.stderr)
        continue
    if vence < hoy:
        print(f"[AVISO] Excepción vencida descartada: {e.get('id')} ({e.get('herramienta')}, venció {vence})", file=sys.stderr)
        continue
    vigentes.append(e)
    # Con `componente` no va a los archivos de ignorado: valen para todo el
    # repositorio y la exceptuarían también en los demás componentes. La aplica
    # la consolidación, por la ruta del hallazgo.
    if e.get("componente"):
        continue
    h, i = e.get("herramienta", ""), str(e.get("id", ""))
    if h == "trivy":
        destino = trivy_vuln if i.upper().startswith(("CVE-", "GHSA-")) else trivy_misc
        destino.append(f'  - id: {i}\n    statement: "{e.get("justificacion", "")} (aprobó {e.get("aprobado_por", "")})"\n    expired_at: {vence}')
    elif h == "checkov":
        checkov.append(i)
    elif h == "semgrep":
        semgrep.append(f"--exclude-rule {i}")
    elif h == "pip-audit":
        pip.append(f"--ignore-vuln {i}")
    elif h == "gitleaks":
        # El comentario va en su PROPIA línea: gitleaks compara la línea
        # completa contra la huella (ver _reusable-security.yml).
        gitleaks.append(f"# vence {vence}: {e.get('justificacion', '')}")
        gitleaks.append(i)
pathlib.Path(".trivyignore.yaml").write_text(
    "# Generado por security-local.sh desde .devsecops.yml. NO editar ni versionar.\n"
    + "vulnerabilities:\n" + ("\n".join(trivy_vuln) + "\n" if trivy_vuln else "  []\n")
    + "misconfigurations:\n" + ("\n".join(trivy_misc) + "\n" if trivy_misc else "  []\n"), encoding="utf-8")
pathlib.Path(".gitleaksignore").write_text(
    "# Generado desde .devsecops.yml (fingerprints commit:archivo:regla:linea). NO versionar.\n"
    + "".join(l + "\n" for l in gitleaks), encoding="utf-8")
print("CHECKOV_SKIP\t" + ",".join(checkov))
print("SEMGREP_EXCLUDE\t" + " ".join(semgrep))
print("PIP_IGNORE\t" + " ".join(pip))
print(f"[INFO] Excepciones vigentes aplicables: {len(vigentes)}", file=sys.stderr)
PY
  )"; then
    log_warn "No se pudieron generar los archivos de excepciones; se continúa sin ellos"
    return 0
  fi
  local clave valor
  while IFS=$'\t' read -r clave valor; do
    case "$clave" in
      CHECKOV_SKIP)    CHECKOV_SKIP="$valor" ;;
      SEMGREP_EXCLUDE) SEMGREP_EXCLUDE="$valor" ;;
      PIP_IGNORE)      PIP_IGNORE="$valor" ;;
    esac
  done <<< "$salida"
  # Los archivos generados nunca se versionan.
  asegurar_gitignore ".trivyignore.yaml"
  asegurar_gitignore ".gitleaksignore"
  asegurar_gitignore ".trivy-cache/"
  log_ok "Generados .trivyignore.yaml y .gitleaksignore (checkov: '${CHECKOV_SKIP:-—}'; semgrep: '${SEMGREP_EXCLUDE:-—}'; pip-audit: '${PIP_IGNORE:-—}')"
}

# ------------------------------------------------------------------------------
# Inventario de herramientas
# ------------------------------------------------------------------------------
comando_instalacion() {
  # Devuelve el comando de instalación sugerido, siempre con versión fijada
  # (nunca "latest" ni repositorios añadidos sin versión).
  local herramienta="$1"
  case "$herramienta" in
    gitleaks)    echo "./security-local.sh --instalar  (binario v${GITLEAKS_VERSION} de github.com/gitleaks/gitleaks/releases)" ;;
    trivy)       echo "./security-local.sh --instalar  (binario v${TRIVY_VERSION} de github.com/aquasecurity/trivy/releases)" ;;
    osv-scanner) echo "./security-local.sh --instalar  (binario v${OSV_SCANNER_VERSION} de github.com/google/osv-scanner/releases)" ;;
    semgrep)     echo "python3 -m pip install --user 'semgrep==${SEMGREP_VERSION}'" ;;
    checkov)     echo "python3 -m pip install --user 'checkov==${CHECKOV_VERSION}'" ;;
    pip-audit)   echo "uv tool install 'pip-audit==${PIP_AUDIT_VERSION}'  (o python3 -m pip install --user 'pip-audit==${PIP_AUDIT_VERSION}')" ;;
    npm)         echo "instale Node.js 22 LTS (incluye npm): https://nodejs.org" ;;
    pnpm)        echo "corepack enable pnpm  (Node.js 22 LTS incluye Corepack)" ;;
    uv)          echo "instale uv: https://docs.astral.sh/uv/getting-started/installation/" ;;
    *) echo "consulte la documentación de $herramienta" ;;
  esac
}

# descargar_binario <url> <nombre> [miembro_tar]: descarga a ${BIN_DIR} un
# binario suelto o lo extrae de un tar.gz, y lo deja ejecutable.
descargar_binario() {
  local url="$1" nombre="$2" miembro="${3:-}"
  mkdir -p "$BIN_DIR"
  if [[ -n "$miembro" ]]; then
    curl -fsSL "$url" | tar -xz -C "$BIN_DIR" "$miembro" || return 1
  else
    curl -fsSL -o "${BIN_DIR}/${nombre}" "$url" || return 1
  fi
  chmod +x "${BIN_DIR}/${nombre}"
  case ":$PATH:" in *":${BIN_DIR}:"*) ;; *) export PATH="${BIN_DIR}:${PATH}" ;; esac
}

instalar_herramienta() {
  # Instalación con versión fijada (paridad con CI). Binarios oficiales de las
  # releases de GitHub para gitleaks/trivy/osv-scanner; pip con == para el resto.
  local herramienta="$1" so arch a so_trivy rc=0
  so="$(uname -s | tr '[:upper:]' '[:lower:]')"   # linux | darwin
  arch="$(uname -m)"                              # x86_64 | aarch64 | arm64
  log_info "Instalando $herramienta (versión fijada)..."
  case "$herramienta" in
    gitleaks)
      case "$arch" in x86_64|amd64) a="x64" ;; aarch64|arm64) a="arm64" ;; *) log_warn "Arquitectura no soportada: $arch"; return 1 ;; esac
      descargar_binario "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${so}_${a}.tar.gz" gitleaks gitleaks || rc=1 ;;
    trivy)
      case "$so" in linux) so_trivy="Linux" ;; darwin) so_trivy="macOS" ;; *) log_warn "Sistema no soportado: $so"; return 1 ;; esac
      case "$arch" in x86_64|amd64) a="64bit" ;; aarch64|arm64) a="ARM64" ;; *) log_warn "Arquitectura no soportada: $arch"; return 1 ;; esac
      descargar_binario "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_${so_trivy}-${a}.tar.gz" trivy trivy || rc=1 ;;
    osv-scanner)
      case "$arch" in x86_64|amd64) a="amd64" ;; aarch64|arm64) a="arm64" ;; *) log_warn "Arquitectura no soportada: $arch"; return 1 ;; esac
      descargar_binario "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_${so}_${a}" osv-scanner || rc=1 ;;
    semgrep)   python3 -m pip install --quiet --user "semgrep==${SEMGREP_VERSION}" || rc=1 ;;
    checkov)   python3 -m pip install --quiet --user "checkov==${CHECKOV_VERSION}" || rc=1 ;;
    pip-audit)
      # Con uv se instala aislado en ${BIN_DIR}; pip --user falla en los
      # sistemas con Python gestionado por el SO (PEP 668).
      if command -v uv >/dev/null 2>&1; then
        uv tool install --quiet "pip-audit==${PIP_AUDIT_VERSION}" || rc=1
      else
        python3 -m pip install --quiet --user "pip-audit==${PIP_AUDIT_VERSION}" || rc=1
      fi
      case ":$PATH:" in *":${BIN_DIR}:"*) ;; *) export PATH="${BIN_DIR}:${PATH}" ;; esac ;;
    *)
      log_warn "No hay instalación automática para $herramienta: $(comando_instalacion "$herramienta")"
      return 1 ;;
  esac
  [[ $rc -eq 0 ]] || { log_warn "La instalación de $herramienta falló"; return 1; }
  hash -r
  command -v "$herramienta" >/dev/null 2>&1
}

disponible() {
  # disponible <herramienta>: true si está en PATH; si no, la registra como faltante
  # (o la instala con --instalar).
  local herramienta="$1"
  if command -v "$herramienta" >/dev/null 2>&1; then
    return 0
  fi
  if [[ "$INSTALAR" -eq 1 ]] && instalar_herramienta "$herramienta"; then
    return 0
  fi
  [[ " ${FALTANTES[*]:-} " == *" $herramienta "* ]] || FALTANTES+=("$herramienta")
  return 1
}

# ------------------------------------------------------------------------------
# Ejecución de cada herramienta (siempre con salida JSON al directorio de informe)
# ------------------------------------------------------------------------------
# registrar_ejecucion <herramienta> <json> [ruta]: una herramienta cuenta como
# ejecutada solo si produjo su archivo de resultados; si no (sin red, error de
# reglas, registro caído) queda como NO ejecutada en esa ruta. Siempre devuelve
# 0: bajo `set -e` un escáner fallido no debe cortar los siguientes.
registrar_ejecucion() {
  local herramienta="$1" archivo="$2" ruta="${3:-.}"
  if [[ -s "$archivo" ]]; then
    [[ " ${EJECUTADAS[*]:-} " == *" $herramienta "* ]] || EJECUTADAS+=("$herramienta")
    log_ok "$herramienta completado${3:+ ($ruta)}"
  else
    no_ejecutada "$herramienta" "$ruta" "no produjo resultados; revise $(basename "${archivo%.json}").log (¿sin red para descargar reglas/BD?)"
  fi
  return 0
}

# validar_json <archivo> <clave>...: conserva el informe solo si es un objeto
# JSON con alguna de las claves esperadas. Un `{"error": ...}` del registro no
# es un resultado: se renombra a .invalido para que no cuente como ejecución.
validar_json() {
  local archivo="$1"; shift
  [[ -s "$archivo" ]] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  if ! python3 - "$archivo" "$@" 2>/dev/null <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        d = json.load(f)
except Exception:
    sys.exit(1)
sys.exit(0 if isinstance(d, dict) and any(k in d for k in sys.argv[2:]) else 1)
PY
  then
    mv "$archivo" "${archivo}.invalido"
  fi
  return 0
}

correr_gitleaks() {
  herramienta_activa gitleaks || return 0
  log_seccion "gitleaks (secretos)"
  disponible gitleaks || { log_warn "gitleaks no disponible: $(comando_instalacion gitleaks)"; return 0; }
  local -a args=(detect --source . --report-format json --report-path "$INFORME_DIR/gitleaks.json" --exit-code 0 --redact)
  [[ -f .github/gitleaks.toml ]] && args+=(--config .github/gitleaks.toml)
  { [[ "$SIN_HISTORIAL" -eq 1 ]] || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; } && args+=(--no-git)
  gitleaks "${args[@]}" >"$INFORME_DIR/gitleaks.log" 2>&1 || log_warn "gitleaks terminó con error; revise $INFORME_DIR/gitleaks.log"
  # gitleaks no escribe el informe cuando no hay hallazgos; se normaliza a lista vacía.
  [[ -s "$INFORME_DIR/gitleaks.json" ]] || { grep -q "no leaks found" "$INFORME_DIR/gitleaks.log" 2>/dev/null && echo "[]" > "$INFORME_DIR/gitleaks.json"; }
  registrar_ejecucion gitleaks "$INFORME_DIR/gitleaks.json"
}

correr_semgrep() {
  herramienta_activa semgrep || return 0
  log_seccion "semgrep (SAST)"
  disponible semgrep || { log_warn "semgrep no disponible: $(comando_instalacion semgrep)"; return 0; }
  # Mismos rulesets que el workflow reusable; las reglas propias del proyecto en .github/semgrep.yml.
  local -a args=(scan --config p/ci --config p/owasp-top-ten --config p/secrets --json --metrics=off --quiet -o "$INFORME_DIR/semgrep.json")
  [[ -f .github/semgrep.yml ]] && args+=(--config .github/semgrep.yml)
  # Excepciones vigentes del manifiesto: "--exclude-rule id ..."
  if [[ -n "$SEMGREP_EXCLUDE" ]]; then
    local -a excl=()
    read -r -a excl <<< "$SEMGREP_EXCLUDE"
    args+=("${excl[@]}")
  fi
  semgrep "${args[@]}" . >"$INFORME_DIR/semgrep.log" 2>&1 || true   # devuelve 1 si hay hallazgos; se evalúan después
  registrar_ejecucion semgrep "$INFORME_DIR/semgrep.json"
}

correr_osv() {
  herramienta_activa osv-scanner || return 0
  log_seccion "osv-scanner (SCA multi-ecosistema)"
  disponible osv-scanner || { log_warn "osv-scanner no disponible: $(comando_instalacion osv-scanner)"; return 0; }
  # Lockfiles explícitos (-L) de la raíz y de cada componente, en lugar de
  # `--recursive .`: el recorrido recursivo respeta .gitignore y, dentro de un
  # worktree anidado en un directorio que el repositorio padre ignora (p. ej.
  # .claude/worktrees/), descarta el árbol entero y termina en "No package
  # sources found" sin analizar nada.
  local -a args=() fuentes=()
  local d f
  for d in "${DIRECTORIOS[@]}"; do
    for f in "${LOCKFILES[@]}"; do
      if [[ -f "$d/$f" ]]; then
        args+=(-L "$d/$f"); fuentes+=("$d/$f")
      fi
    done
  done
  if [[ ${#fuentes[@]} -eq 0 ]]; then
    no_ejecutada osv-scanner "." "sin lockfiles en la raíz ni en los componentes (${LOCKFILES[*]})"
    return 0
  fi
  local json="$INFORME_DIR/osv.json"
  osv-scanner scan source "${args[@]}" --format json --output-file "$json" >"$INFORME_DIR/osv.log" 2>&1 || true
  validar_json "$json" results
  registrar_ejecucion osv-scanner "$json"
  if [[ -s "$json" ]]; then
    for f in "${fuentes[@]}"; do registrar_fuente osv-scanner "$(dirname "$f")" "$f" "$json"; done
  fi
}

correr_trivy() {
  herramienta_activa trivy || return 0
  log_seccion "trivy (dependencias, IaC, Dockerfile, secretos en archivos)"
  disponible trivy || { log_warn "trivy no disponible: $(comando_instalacion trivy)"; return 0; }
  # --exit-code 0: .github/trivy.yaml fija `exit-code: 1`, y con él Trivy sale
  # con 1 ante cualquier hallazgo; el aviso de abajo decía «terminó con error»
  # cuando todo había funcionado. El umbral lo aplica la consolidación, y un
  # error real sigue saliendo distinto de 0 (medido con Trivy 0.70.0).
  # --include-dev-deps: igual que en CI; por flag, por si la copia de
  # trivy.yaml del repositorio es la 2.0.
  local -a args=(fs --scanners "vuln,misconfig,secret" --exit-code 0 --include-dev-deps
                 --format json --output "$INFORME_DIR/trivy.json" --quiet)
  [[ -f .github/trivy.yaml ]] && args+=(--config .github/trivy.yaml)
  # .trivyignore.yaml se GENERA desde .devsecops.yml (mismo archivo que declara
  # ignorefile en .github/trivy.yaml); se pasa explícito por si no hay config.
  [[ -f .trivyignore.yaml ]] && args+=(--ignorefile .trivyignore.yaml)
  trivy "${args[@]}" . >"$INFORME_DIR/trivy.log" 2>&1 || log_warn "trivy terminó con error; revise $INFORME_DIR/trivy.log"
  registrar_ejecucion trivy "$INFORME_DIR/trivy.json"
}

correr_checkov() {
  herramienta_activa checkov || return 0
  [[ "$HAY_IAC" -eq 1 ]] || return 0
  log_seccion "checkov (IaC y Dockerfile)"
  disponible checkov || { log_warn "checkov no disponible: $(comando_instalacion checkov)"; return 0; }
  # checkov escribe results_json.json dentro del directorio indicado.
  # --framework: los mismos que el job iac de CI; sin él checkov corre todos
  # (openapi, secrets…) y, como aquí sus hallazgos bloquean, daría bloqueos que
  # CI no tiene. --soft-fail solo evita que el código de salida corte el
  # script: el bloqueo lo decide la consolidación, con cualquier umbral.
  local -a args=(-d . --framework "terraform,dockerfile,kubernetes,github_actions"
                 --output json --output-file-path "$INFORME_DIR/checkov" --quiet --soft-fail
                 --skip-path node_modules --skip-path .venv --skip-path "$INFORMES_BASE"
                 --skip-path .claude/worktrees)
  # Excepciones vigentes del manifiesto (IDs CKV_* separados por comas)
  [[ -n "$CHECKOV_SKIP" ]] && args+=(--skip-check "$CHECKOV_SKIP")
  checkov "${args[@]}" >"$INFORME_DIR/checkov.log" 2>&1 || true
  [[ -f "$INFORME_DIR/checkov/results_json.json" ]] && mv "$INFORME_DIR/checkov/results_json.json" "$INFORME_DIR/checkov.json"
  rm -rf "$INFORME_DIR/checkov"
  registrar_ejecucion checkov "$INFORME_DIR/checkov.json"
}

# Auditoría nativa del ecosistema node, por componente: npm audit sobre
# package-lock.json o pnpm audit sobre pnpm-lock.yaml. Ambas leen el lockfile y
# consultan el registro: no instalan nada ni ejecutan scripts de ciclo de vida.
# Nunca se sugiere `npm install` para fabricar un lockfile que falta.
# Solo dependencias de producción, como el job `sca` de _reusable-security.yml
# (npm audit --omit=dev, pnpm audit --prod); las de desarrollo las cubren trivy
# (--include-dev-deps) y osv-scanner, igual que en CI.
correr_npm_audit() {
  herramienta_activa npm-audit || return 0
  [[ ${#DIRS_NODE[@]} -gt 0 ]] || return 0
  log_seccion "npm audit / pnpm audit (SCA node, por componente)"
  local d json fuente
  for d in "${DIRS_NODE[@]}"; do
    json="$INFORME_DIR/npm-audit-$(slug "$d").json"
    if [[ -f "$d/package-lock.json" ]]; then
      disponible npm || { log_warn "npm no disponible: $(comando_instalacion npm)"; continue; }
      fuente="$d/package-lock.json"
      (cd "$d" && npm audit --json --omit=dev --audit-level=none) >"$json" 2>"${json%.json}.log" || true
    elif [[ -f "$d/pnpm-lock.yaml" ]]; then
      disponible pnpm || { log_warn "pnpm no disponible: $(comando_instalacion pnpm)"; continue; }
      fuente="$d/pnpm-lock.yaml"
      # Dentro del componente y no con --dir: Corepack elige la versión de pnpm
      # por el `packageManager` del package.json del directorio actual. Desde la
      # raíz arrancaría la global y pnpm abortaría por versión distinta.
      (cd "$d" && pnpm audit --prod --json) >"$json" 2>"${json%.json}.log" || true
    else
      no_ejecutada npm-audit "$d" "package.json sin package-lock.json ni pnpm-lock.yaml (yarn y bun no se auditan localmente)"
      continue
    fi
    # npm >= 7 publica "vulnerabilities"; pnpm y npm 6, "advisories".
    validar_json "$json" vulnerabilities advisories
    registrar_ejecucion npm-audit "$json" "$d"
    if [[ -s "$json" ]]; then registrar_fuente npm-audit "$d" "$fuente" "$json"; fi
  done
}

# pip-audit por componente. Con uv.lock se exporta el árbol fijado (con hashes,
# sin volver a resolver) y pip-audit lo audita sin invocar pip; con
# requirements.txt se audita ese archivo; con solo pyproject.toml, el proyecto
# (pip-audit resuelve sus dependencias, como el `pip install .` del pipeline).
correr_pip_audit() {
  herramienta_activa pip-audit || return 0
  [[ ${#DIRS_PYTHON[@]} -gt 0 ]] || return 0
  log_seccion "pip-audit (SCA python, por componente)"
  disponible pip-audit || { log_warn "pip-audit no disponible: $(comando_instalacion pip-audit)"; return 0; }
  # Excepciones vigentes del manifiesto: "--ignore-vuln ID ..."
  local -a ign=()
  [[ -n "$PIP_IGNORE" ]] && read -r -a ign <<< "$PIP_IGNORE"
  local d s json log req fuente
  for d in "${DIRS_PYTHON[@]}"; do
    s="$(slug "$d")"
    json="$INFORME_DIR/pip-audit-$s.json"; log="${json%.json}.log"
    local -a args=(-f json -o "$json" --progress-spinner off "${ign[@]}")
    if [[ -f "$d/uv.lock" ]]; then
      disponible uv || { log_warn "uv no disponible: $(comando_instalacion uv)"; continue; }
      fuente="$d/uv.lock"
      req="$INFORME_DIR/pip-audit-$s.requirements.txt"
      if ! uv export --project "$d" --frozen --all-extras --all-groups --no-emit-workspace \
             --format requirements-txt --quiet -o "$req" >"$log" 2>&1; then
        no_ejecutada pip-audit "$d" "uv export falló sobre uv.lock; revise $(basename "$log")"
        continue
      fi
      args+=(-r "$req" --require-hashes --disable-pip)
    elif [[ -f "$d/requirements.txt" ]]; then
      fuente="$d/requirements.txt"
      args+=(-r "$d/requirements.txt")
    else
      fuente="$d/pyproject.toml"
      args+=("$d")
    fi
    pip-audit "${args[@]}" >>"$log" 2>&1 || true
    validar_json "$json" dependencies
    registrar_ejecucion pip-audit "$json" "$d"
    if [[ -s "$json" ]]; then registrar_fuente pip-audit "$d" "$fuente" "$json"; fi
  done
}

# ------------------------------------------------------------------------------
# Consolidación: normaliza los JSON, aplica excepciones y decide el resultado
# ------------------------------------------------------------------------------
consolidar() {
  command -v python3 >/dev/null 2>&1 || die 3 "Se requiere python3 para consolidar los informes"
  python3 - "$INFORME_DIR" "$UMBRAL" "$MANIFIESTO" "$(IFS=,; echo "${EJECUTADAS[*]:-}")" "$(IFS=,; echo "${FALTANTES[*]:-}")" <<'PY'
import datetime as dt
import json
import os
import sys

informe_dir, umbral_cli, manifiesto, ejecutadas, faltantes = sys.argv[1:6]
NIVEL = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1, "INFO": 0}
hoy = dt.date.today()
# Avisos que pnpm ocultó por auditConfig. No se exceptúa por su propio ID: la
# excepción legítima es la del GHSA/CVE concreto, una vez quitado de auditConfig.
AUDITCONFIG_OCULTO = "auditConfig-oculto"
# Severidades de npm y pnpm audit; cualquier otra se trata como critical (CI hace lo mismo).
SEV_NPM = ("critical", "high", "moderate", "low", "info")


def leer_tsv(nombre, campos):
    ruta = os.path.join(informe_dir, nombre)
    if not os.path.isfile(ruta):
        return []
    with open(ruta, encoding="utf-8") as f:
        return [dict(zip(campos, l.rstrip("\n").split("\t"))) for l in f if l.strip()]


# Qué analizó cada escáner de composición y cuáles no analizaron nada.
fuentes = leer_tsv("fuentes.tsv", ("herramienta", "ruta", "fuente", "archivo"))
no_ejecutadas = leer_tsv("no-ejecutadas.tsv", ("herramienta", "ruta", "motivo"))


def cargar(nombre):
    ruta = os.path.join(informe_dir, nombre)
    if not os.path.isfile(ruta) or os.path.getsize(ruta) == 0:
        return None
    try:
        with open(ruta, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:  # noqa: BLE001
        print(f"[AVISO] No se pudo leer {nombre}: {e}", file=sys.stderr)
        return None


def sev_desde_cvss(valor):
    try:
        s = float(valor)
    except (TypeError, ValueError):
        return None
    if s >= 9.0:
        return "CRITICAL"
    if s >= 7.0:
        return "HIGH"
    if s >= 4.0:
        return "MEDIUM"
    return "LOW"


hallazgos = []  # dict(herramienta, id, severidad, ubicacion, titulo)
_vistos = set()


def add(herr, ident, sev, ubic, titulo, limite=160, claves=None, mayus=False, ruta=".", alcance="arbol",
        siempre=False):
    # siempre: bloquea con cualquier umbral, porque en CI bloquea sin mirar la
    # severidad (checkov con soft_fail: false).
    # claves: los IDs con los que CI acepta la excepción de este hallazgo, que
    # no siempre son el que se muestra (gitleaks: la huella, no la regla). Por
    # defecto, el propio ID; () si CI no admite excepción. mayus: CI compara sin
    # distinguir mayúsculas (solo los pasos de npm y pnpm audit; las herramientas, no).
    # ruta y alcance: qué jobs de CI verían el hallazgo (ver ven_en_ci).
    clave = (herr, str(ident).upper(), str(ubic))
    if clave in _vistos:  # el mismo CVE puede llegar por varios alias (PYSEC/GHSA)
        return
    _vistos.add(clave)
    sev = (sev or "MEDIUM").upper()
    if sev == "MODERATE":
        sev = "MEDIUM"
    if sev == "UNKNOWN":
        sev = "MEDIUM"
    if sev not in NIVEL:
        sev = "MEDIUM"
    hallazgos.append({"herramienta": herr, "id": str(ident), "severidad": sev,
                      "ubicacion": str(ubic), "titulo": str(titulo)[:limite],
                      "_claves": [str(c) for c in ((ident,) if claves is None else claves) if c],
                      "_mayus": mayus, "_ruta": os.path.normpath(str(ruta or ".")), "_alcance": alcance,
                      "_siempre": siempre})


# gitleaks: no tiene severidad; un secreto en el repositorio es siempre CRITICAL.
# Su excepción es la huella (Fingerprint) completa, nunca la regla: en CI va a
# .gitleaksignore, que gitleaks compara con la huella exacta (medido con 8.30.1:
# el RuleID no exceptúa nada). Por la regla se exceptuarían todos los secretos
# de ese tipo. En CI analiza el repositorio entero en el job de cada componente.
d = cargar("gitleaks.json")
if isinstance(d, list):
    for x in d:
        add("gitleaks", x.get("RuleID", "secreto"), "CRITICAL",
            f"{x.get('File')}:{x.get('StartLine')}", x.get("Description", "Secreto detectado"),
            claves=(x.get("Fingerprint"),), ruta=x.get("File"), alcance="repo")

# semgrep: ERROR -> HIGH, WARNING -> MEDIUM, INFO -> LOW
d = cargar("semgrep.json")
if isinstance(d, dict):
    mapa = {"ERROR": "HIGH", "WARNING": "MEDIUM", "INFO": "LOW"}
    for r in d.get("results", []):
        extra = r.get("extra", {})
        add("semgrep", r.get("check_id"), mapa.get(str(extra.get("severity", "")).upper(), "MEDIUM"),
            f"{r.get('path')}:{r.get('start', {}).get('line')}", extra.get("message", ""), ruta=r.get("path"))

# osv-scanner: severidad de database_specific, si no del CVSS máximo del grupo.
d = cargar("osv.json")
if isinstance(d, dict):
    for res in d.get("results", []):
        origen = res.get("source", {}).get("path", "")
        if os.path.isabs(origen):  # osv-scanner informa rutas absolutas
            origen = os.path.relpath(origen)
        for p in res.get("packages", []):
            pk = p.get("package", {})
            grupos = {}
            for g in p.get("groups", []):
                for i in g.get("ids", []):
                    grupos[i] = g.get("max_severity")
            for v in p.get("vulnerabilities", []):
                sev = (v.get("database_specific") or {}).get("severity")
                if not sev:
                    sev = sev_desde_cvss(grupos.get(v.get("id")))
                aliases = [a for a in v.get("aliases", []) if a.startswith("CVE-")]
                ident = aliases[0] if aliases else v.get("id")
                # En CI osv-scanner es informativo: no bloquea ni lee excepciones.
                add("osv-scanner", ident, sev or "MEDIUM",
                    f"{origen}:{pk.get('name')}@{pk.get('version')}", v.get("summary", ""),
                    mayus=True, ruta=origen)

# trivy fs: vulnerabilidades, misconfiguraciones y secretos. Trivy compara el
# ID exacto, distinguiendo mayúsculas, y solo en su sección de .trivyignore.yaml
# (medido con 0.70.0). El generador de CI manda a `vulnerabilities` solo los
# IDs CVE-/GHSA-; cualquier otro va a `misconfigurations` y no exceptúa una
# vulnerabilidad. Los secretos no los analiza el trivy de CI (los ve gitleaks).
def alias_trivy():
    """Namespace -> IDs de la regla (id, long_id y aliases de sus metadatos).
    Trivy exceptúa una misconfiguración por cualquiera de ellos (`DS002`,
    `AVD-DS-0002`, `least-privilege-user`…), pero su JSON no los publica (medido
    con 0.70.0: ni AVDID ni aliases); el Namespace es el `package` de la regla.
    Se leen del paquete de reglas de la caché que usó trivy: TRIVY_CACHE_DIR, si
    no `cache.dir` de .github/trivy.yaml, si no la caché por defecto."""
    base = os.environ.get("TRIVY_CACHE_DIR")
    try:
        import yaml  # type: ignore
        if not base and os.path.isfile(".github/trivy.yaml"):
            with open(".github/trivy.yaml", encoding="utf-8") as f:
                base = ((yaml.safe_load(f) or {}).get("cache") or {}).get("dir")
    except Exception:  # noqa: BLE001
        return None, "PyYAML no disponible o .github/trivy.yaml ilegible"
    base = base or os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "trivy")
    raiz = os.path.join(base, "policy", "content", "policies")
    if not os.path.isdir(raiz):
        return None, f"no está en {raiz}"
    mapa = {}
    for carpeta, _, archivos in os.walk(raiz):
        for a in archivos:
            if not a.endswith(".rego") or a.endswith("_test.rego"):
                continue
            with open(os.path.join(carpeta, a), encoding="utf-8") as f:
                texto = f.read()
            cabecera, paquete = [], None
            for l in texto.splitlines():
                if l.startswith("#"):
                    cabecera.append(l[2:] if l.startswith("# ") else l[1:])
                elif l.startswith("package "):
                    paquete = l.split()[1]
                    break
                elif l.strip():
                    break
            if not paquete or not cabecera or cabecera[0].strip() != "METADATA":
                continue
            try:
                c = (yaml.safe_load("\n".join(cabecera[1:])) or {}).get("custom") or {}
            except yaml.YAMLError:
                continue
            mapa[paquete] = [str(x) for x in (c.get("id"), c.get("long_id"), *(c.get("aliases") or [])) if x]
    return mapa, None


_alias_trivy = []  # (mapa, motivo), calculado una vez y solo si hay misconfiguraciones


def claves_misconfig(m):
    if not _alias_trivy:
        _alias_trivy.append(alias_trivy())
        if _alias_trivy[0][0] is None:
            print(f"[AVISO] Paquete de reglas de trivy no encontrado ({_alias_trivy[0][1]}): una misconfiguración "
                  "solo se exceptúa por su ID o AVD-<ID>; en CI también por DS002, el long_id y demás alias.",
                  file=sys.stderr)
    mapa = _alias_trivy[0][0]
    i, ns = str(m.get("ID") or ""), str(m.get("Namespace") or "")
    claves = [i, m.get("AVDID")]
    if mapa and ns in mapa:
        claves += mapa[ns]
    elif ns.startswith("builtin."):
        # Sin el paquete: AVD-<ID> es alias de las 563 reglas incluidas en el
        # paquete 2 (medido); de una regla propia no se sabe, así que no se supone.
        claves.append(f"AVD-{i}")
    return claves


d = cargar("trivy.json")
if isinstance(d, dict):
    for res in d.get("Results", []):
        destino = res.get("Target", "")
        for v in res.get("Vulnerabilities") or []:
            vid = str(v.get("VulnerabilityID") or "")
            add("trivy", vid, v.get("Severity"),
                f"{destino}:{v.get('PkgName')}@{v.get('InstalledVersion')}", v.get("Title", ""),
                claves=(vid,) if vid.upper().startswith(("CVE-", "GHSA-")) else (), ruta=destino)
        for m in res.get("Misconfigurations") or []:
            add("trivy", m.get("ID"), m.get("Severity"), destino, m.get("Title", ""),
                claves=claves_misconfig(m), ruta=destino)
        for s in res.get("Secrets") or []:
            add("trivy", s.get("RuleID"), s.get("Severity", "CRITICAL"),
                f"{destino}:{s.get('StartLine')}", s.get("Title", ""), ruta=destino)

# checkov: sin plataforma comercial no publica severidad; se muestra como MEDIUM,
# pero bloquea con cualquier umbral: el job iac de CI lo corre con soft_fail:
# false, y cualquier control fallido lo hace fallar.
d = cargar("checkov.json")
if d is not None:
    bloques = d if isinstance(d, list) else [d]
    for b in bloques:
        for f in (b.get("results") or {}).get("failed_checks", []):
            # file_path es relativo a -d y empieza con "/" (medido con checkov 3.3.13).
            # --skip-check acepta el check_id o el bc_check_id, exactos (medido con 3.3.13).
            add("checkov", f.get("check_id"), f.get("severity") or "MEDIUM",
                f"{f.get('file_path')}:{(f.get('file_line_range') or ['?'])[0]}", f.get("check", f.get("check_name", "")),
                claves=(f.get("check_id"), f.get("bc_check_id")), ruta=str(f.get("file_path") or "").lstrip("/"),
                siempre=True)

# npm audit / pnpm audit, un informe por componente.
for fu in (x for x in fuentes if x["herramienta"] == "npm-audit"):
    d = cargar(fu["archivo"])
    if not isinstance(d, dict):
        continue
    # Un hallazgo por aviso, como los pasos de npm audit y pnpm audit de CI, que
    # deciden por la severidad del aviso y comparan las excepciones sin
    # distinguir mayúsculas. Severidad desconocida o ausente: critical, como en CI.
    es_pnpm = fu["fuente"].endswith("pnpm-lock.yaml")
    def sev_npm(s):
        s = str(s or "").lower()
        return (s, "") if s in SEV_NPM else ("critical", f" [severidad desconocida '{s}': se trata como critical]")
    # npm >= 7: cada aviso es un objeto en `via` del paquete afectado; los `via`
    # de texto son dependencias vulnerables, con su propio aviso en su entrada.
    # El JSON no trae CVE: en CI la excepción va por el GHSA de `url`.
    for nombre, v in (d.get("vulnerabilities") or {}).items():
        for via in (v or {}).get("via") or []:
            if not isinstance(via, dict):
                continue
            ident = str(via.get("url") or "").rstrip("/").rsplit("/", 1)[-1] or str(via.get("source") or nombre)
            sev, nota = sev_npm(via.get("severity"))
            add("npm-audit", ident, sev, f"{fu['fuente']}:{via.get('name') or nombre}@{via.get('range')}",
                f"{via.get('title', '')} ({'fix disponible' if v.get('fixAvailable') else 'sin fix'}){nota}",
                limite=160 + len(nota), claves=(ident,), mayus=True, ruta=fu["ruta"], alcance="dir")
    # pnpm y npm 6
    listados = {}
    for a in (d.get("advisories") or {}).values():
        ident = a.get("github_advisory_id") or str(a.get("url", "")).rsplit("/", 1)[-1] or a.get("id")
        versiones = sorted({str(fd.get("version")) for fd in a.get("findings") or []})
        sev, nota = sev_npm(a.get("severity"))
        add("npm-audit", ident, sev,
            f"{fu['fuente']}:{a.get('module_name')}@{','.join(versiones) or '?'}",
            f"{a.get('title', '')} (corregido en {a.get('patched_versions') or 'ninguna'}){nota}",
            limite=160 + len(nota), ruta=fu["ruta"], alcance="dir",
            # pnpm: el GHSA o cualquiera de sus CVE, como el paso de CI. npm 6 no
            # corre en CI: el npm de CI publica el mismo aviso solo con su GHSA.
            claves=(ident, *(a.get("cves") or ())) if es_pnpm else (ident,), mayus=True)
        listados[sev] = listados.get(sev, 0) + 1
    # auditConfig.ignoreGhsas / ignoreCves del repositorio: pnpm quita el aviso
    # de `advisories` pero metadata.vulnerabilities lo sigue contando (un
    # contador por aviso, no por ruta ni por versión; medido con pnpm 11.25.0).
    # Es una excepción fuera de .devsecops.yml (D5): mismo control que el paso
    # de pnpm audit de _reusable-security.yml. Solo pnpm: el metadata de npm 6
    # cuenta por ruta y daría falsos positivos.
    if es_pnpm:
        meta = (d.get("metadata") or {}).get("vulnerabilities") or {}
        ocultos = {}
        for s in SEV_NPM:
            try:
                n = int(meta.get(s) or 0) - listados.get(s, 0)
            except (TypeError, ValueError):
                continue
            if n > 0:
                ocultos[s] = n
        if ocultos:
            add("npm-audit", AUDITCONFIG_OCULTO, next(iter(ocultos)), f"{fu['fuente']}:auditConfig",
                "pnpm ocultó " + ", ".join(f"{n} {s}" for s, n in ocultos.items())
                + " por configuración del repositorio (auditConfig.ignoreGhsas o ignoreCves, en"
                " pnpm-workspace.yaml o package.json). Las excepciones van en .devsecops.yml (D5):"
                " quítelas de ahí y regístrelas en seguridad.excepciones[] con herramienta: npm-audit.",
                limite=500, claves=(), ruta=fu["ruta"], alcance="dir")

# pip-audit: sin severidad publicada -> HIGH (criterio conservador; documentado en el informe)
for fu in (x for x in fuentes if x["herramienta"] == "pip-audit"):
    d = cargar(fu["archivo"])
    if not isinstance(d, dict):
        continue
    for dep in d.get("dependencies", []):
        for v in dep.get("vulns", []):
            aliases = [a for a in v.get("aliases", []) if a.startswith("CVE-")]
            # pip-audit --ignore-vuln acepta el ID del aviso o cualquiera de sus
            # alias, exactos (medido con 2.10.1: en minúsculas no exceptúa).
            add("pip-audit", aliases[0] if aliases else v.get("id"), "HIGH",
                f"{fu['fuente']}:{dep.get('name')}@{dep.get('version')}",
                f"sin severidad publicada; fix: {', '.join(v.get('fix_versions') or []) or 'ninguno'}",
                claves=(v.get("id"), *(v.get("aliases") or [])), ruta=fu["ruta"], alcance="dir")

# Excepciones vigentes del manifiesto
excepciones = []
componentes = []  # (nombre, ruta): en CI, un job de _reusable-security.yml por componente
umbral = umbral_cli
if os.path.isfile(manifiesto):
    try:
        import yaml  # type: ignore
        with open(manifiesto, encoding="utf-8") as f:
            m = yaml.safe_load(f) or {}
        seg = m.get("seguridad") or {}
        bloquear = [str(x).upper() for x in (seg.get("bloquear_en") or [])]
        if "MEDIUM" in bloquear and NIVEL[umbral] > NIVEL["MEDIUM"]:
            umbral = "MEDIUM"
        if "LOW" in bloquear:
            umbral = "LOW"
        for e in seg.get("excepciones") or []:
            excepciones.append(e)
        for c in m.get("componentes") or []:
            c = c or {}
            componentes.append((c.get("nombre"), os.path.normpath(str(c.get("ruta") or "."))))
    except ImportError:
        print("[AVISO] PyYAML no instalado: no se leen excepciones del manifiesto (pip install pyyaml)", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"[AVISO] No se pudo leer {manifiesto}: {e}", file=sys.stderr)

vigentes, vencidas = [], []
declarados = {n for n, _ in componentes}
for e in excepciones:
    ident = str(e.get("id", "")).strip()
    vence = e.get("vence")
    try:
        fecha = vence if isinstance(vence, dt.date) else dt.date.fromisoformat(str(vence))
    except Exception:  # noqa: BLE001
        vencidas.append((ident, "fecha 'vence' inválida"))
        continue
    if fecha < hoy:
        vencidas.append((ident, f"venció el {fecha}"))
        continue
    if e.get("componente") and e["componente"] not in declarados:
        # En CI la validación del manifiesto falla; aquí, al menos, no se aplica.
        vencidas.append((ident, f"componente '{e['componente']}' no declarado en componentes[].nombre"))
        continue
    vigentes.append(e)


def ven_en_ci(h):
    """Componentes cuyo job de CI ve el hallazgo. gitleaks analiza el
    repositorio entero en cada job; npm/pnpm audit y pip-audit, solo el lockfile
    de su `ruta`; semgrep, trivy, checkov y osv-scanner, el árbol bajo ella."""
    r = h["_ruta"]
    if h["_alcance"] == "repo":
        ven = [n for n, _ in componentes]
    elif h["_alcance"] == "dir":
        ven = [n for n, c in componentes if c == r]
    else:
        ven = [n for n, c in componentes if c == "." or r == c or r.startswith(c + "/")]
    return ven or [None]  # fuera de todo componente: solo valen las excepciones sin `componente`


def coincide(e, h):
    """La excepción nombra el hallazgo con un ID que CI acepta, comparado como
    lo compara la herramienta de CI (ver `claves` y `mayus` en add)."""
    i = str(e.get("id", "")).strip()
    if h["_mayus"]:
        return i.upper() in {c.upper() for c in h["_claves"]}
    return i in h["_claves"]


def aplica(e, h):
    # `herramienta` es obligatoria en el esquema: sin ella CI no aplica nada.
    if e.get("herramienta") != h["herramienta"] or not coincide(e, h):
        return False
    # CI solo la aplica en el job de su componente: si otro job ve el hallazgo, bloquea allí.
    return not e.get("componente") or all(n == e["componente"] for n in h["componentes"])


sin_efecto = {}  # id(e) -> (ID, motivo): nombra el hallazgo, pero no como lo compara CI
for h in hallazgos:
    h["componentes"] = ven_en_ci(h)
    h["exceptuado"] = any(aplica(e, h) for e in vigentes)
    if h["exceptuado"]:
        continue
    for e in vigentes:
        i = str(e.get("id", "")).strip()
        if (e.get("herramienta") == h["herramienta"] and not coincide(e, h)
                and i.upper() in {h["id"].upper(), *(c.upper() for c in h["_claves"])}):
            acepta = ", ".join(h["_claves"][:2]) or "ninguno: en CI este hallazgo no admite excepción del manifiesto"
            sin_efecto.setdefault(id(e), (i, f"{h['herramienta']} no la compara así en CI ({h['ubicacion']}); "
                                              f"ID que acepta: {acepta}"))
for h in hallazgos:
    h["bloquea"] = not h["exceptuado"] and (NIVEL[h["severidad"]] >= NIVEL[umbral] or h["_siempre"])
    del h["_ruta"], h["_alcance"], h["_claves"], h["_mayus"], h["_siempre"]
vencidas += sin_efecto.values()

bloqueantes = [h for h in hallazgos if h["bloquea"]]
conteo = {s: 0 for s in NIVEL}
for h in hallazgos:
    if not h["exceptuado"]:
        conteo[h["severidad"]] += 1

resumen = {
    "fecha": dt.datetime.now().isoformat(timespec="seconds"),
    "umbral": umbral,
    "herramientas_ejecutadas": [x for x in ejecutadas.split(",") if x],
    "herramientas_faltantes": [x for x in faltantes.split(",") if x],
    # Un escáner sin fuentes o fallido no aprobó nada: no cuenta como ejecutado.
    "herramientas_no_ejecutadas": no_ejecutadas,
    "fuentes_sca": fuentes,
    "cobertura": "parcial" if (no_ejecutadas or [x for x in faltantes.split(",") if x]) else "completa",
    "conteo_no_exceptuados": conteo,
    "exceptuados": sum(1 for h in hallazgos if h["exceptuado"]),
    "excepciones_vencidas": vencidas,
    "bloquea": bool(bloqueantes),
    "hallazgos": hallazgos,
}
with open(os.path.join(informe_dir, "resumen.json"), "w", encoding="utf-8") as f:
    json.dump(resumen, f, ensure_ascii=False, indent=2)

orden = sorted(hallazgos, key=lambda h: (-NIVEL[h["severidad"]], h["herramienta"], h["id"]))
parcial = resumen["cobertura"] == "parcial"
if bloqueantes:
    resultado = "BLOQUEA"
elif not resumen["herramientas_ejecutadas"]:
    resultado = "SIN ANÁLISIS (ninguna herramienta produjo resultados)"
else:
    resultado = "APROBADO CON COBERTURA PARCIAL" if parcial else "APROBADO"
no_ej_txt = "; ".join(f"{x['herramienta']} en {x['ruta']} ({x['motivo']})" for x in no_ejecutadas)
lineas = [f"# Informe de seguridad estática local — {resumen['fecha']}", "",
          f"Umbral de bloqueo: **{umbral}** | Resultado: **{resultado}**", "",
          f"Herramientas ejecutadas: {', '.join(resumen['herramientas_ejecutadas']) or 'ninguna'}  ",
          f"Herramientas faltantes: {', '.join(resumen['herramientas_faltantes']) or 'ninguna'}  ",
          f"Herramientas no ejecutadas (sin fuentes o con error; no cuentan como aprobadas): {no_ej_txt or 'ninguna'}", ""]
lineas += ["## Fuentes de composición analizadas", "", "| Herramienta | Componente | Fuente |", "|---|---|---|"]
lineas += [f"| {x['herramienta']} | {x['ruta']} | {x['fuente']} |" for x in fuentes] or ["| — | — | Ninguna: el análisis de composición está vacío |"]
lineas += ["", "| Severidad | No exceptuados |", "|---|---|"]
lineas += [f"| {s} | {conteo[s]} |" for s in ("CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO")]
lineas += ["", f"Hallazgos exceptuados por el manifiesto: {resumen['exceptuados']}"]
if vencidas:
    lineas += ["", "**Excepciones vencidas o inválidas (vuelven a bloquear):**"] + [f"- {i}: {m}" for i, m in vencidas]
lineas += ["", "## Hallazgos", "", "| Sev. | Herramienta | ID | Ubicación | Detalle | Exc. |", "|---|---|---|---|---|---|"]
for h in orden[:500]:
    lineas.append(f"| {h['severidad']} | {h['herramienta']} | {h['id']} | {h['ubicacion']} | "
                  f"{h['titulo'].replace('|', '/')} | {'sí' if h['exceptuado'] else ''} |")
if not orden:
    lineas.append("| — | — | — | — | Sin hallazgos | |")
lineas += ["", "## Notas de interpretación", "",
           "- gitleaks no clasifica por severidad: todo secreto se trata como CRITICAL.",
           "- pip-audit no publica severidad: se trata como HIGH (conservador). Verifique el CVE y, si corresponde, registre una excepción con vencimiento.",
           "- checkov sin plataforma comercial no publica severidad: se muestra como MEDIUM, pero cualquier control "
           "fallido bloquea, con cualquier umbral, como en CI (job iac, soft_fail: false).",
           f"- `{AUDITCONFIG_OCULTO}` (npm-audit): el repositorio ocultó avisos con `auditConfig.ignoreGhsas`/`ignoreCves` "
           "de pnpm; `metadata.vulnerabilities` los cuenta aunque falten del informe. Toma la severidad más alta oculta "
           "y no se exceptúa por su ID: quite la entrada de `auditConfig` y registre el GHSA/CVE en `.devsecops.yml` "
           "con `herramienta: npm-audit`. Nunca `pnpm audit --ignore`, que escribe esa misma configuración.",
           "- npm o pnpm audit con una severidad fuera de info/low/moderate/high/critical: se trata como CRITICAL, como en CI.",
           "- Una excepción con `componente` exceptúa el hallazgo solo si ningún otro componente lo ve en CI, donde "
           "cada componente tiene su job: gitleaks analiza el repositorio entero en todos; semgrep, trivy, checkov y "
           "osv-scanner, el árbol bajo su `ruta`; npm/pnpm audit y pip-audit, solo el lockfile de su `ruta`.",
           "- Una excepción exceptúa solo con el ID que acepta CI, comparado como lo compara la herramienta "
           "(distinguiendo mayúsculas, salvo npm y pnpm audit): gitleaks, la huella completa (nunca la regla); semgrep, "
           "el `check_id` completo; checkov, el `check_id` o el `bc_check_id`; trivy, el ID en su sección "
           "(una vulnerabilidad solo con CVE-/GHSA-; una misconfiguración, también un alias de su regla, "
           "leído del paquete de reglas de la caché de trivy); pip-audit, el ID o un alias; pnpm audit, el GHSA o un CVE; "
           "npm audit, el GHSA (su JSON no trae CVE).",
           "- npm audit se informa por aviso, con su propia severidad: un paquete que solo es vulnerable por una "
           "dependencia no suma un hallazgo propio, y exceptuar el aviso de la dependencia basta, como en CI.",
           "- Las excepciones se gestionan solo en `.devsecops.yml` (`seguridad.excepciones`, con `vence`)."]
with open(os.path.join(informe_dir, "resumen.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(lineas) + "\n")

print()
print(f"Resumen (umbral {umbral}): " + "  ".join(f"{s}={conteo[s]}" for s in ("CRITICAL", "HIGH", "MEDIUM", "LOW")) +
      f"  exceptuados={resumen['exceptuados']}")
for h in bloqueantes[:25]:
    print(f"  [{h['severidad']}] {h['herramienta']} {h['id']} — {h['ubicacion']}")
    if h["id"] == AUDITCONFIG_OCULTO:
        print(f"      {h['titulo']}")
if len(bloqueantes) > 25:
    print(f"  ... y {len(bloqueantes) - 25} más (ver resumen.md)")
for i, m in vencidas:
    print(f"  [EXCEPCIÓN SIN EFECTO] {i}: {m}")
for x in no_ejecutadas:
    print(f"  [NO EJECUTADA] {x['herramienta']} en {x['ruta']}: {x['motivo']}")
print(f"Resultado: {resultado}")
sys.exit(1 if bloqueantes else 0)
PY
}

# ------------------------------------------------------------------------------
# Principal
# ------------------------------------------------------------------------------
asegurar_gitignore() {
  local entrada="$1"
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  if [[ -f .gitignore ]] && grep -qxF "$entrada" .gitignore; then return 0; fi
  printf '%s\n' "$entrada" >> .gitignore
  log_info "Se añadió '$entrada' a .gitignore"
}

main() {
  analizar_argumentos "$@"
  cd "$RUTA"
  printf '%ssecurity-local.sh v%s — %s (umbral %s)%s\n' "$C_NEGRITA" "$SCRIPT_VERSION" "$(date '+%Y-%m-%d %H:%M:%S')" "$UMBRAL" "$C_RESET"

  INFORME_DIR="${INFORMES_BASE}/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$INFORME_DIR"
  FUENTES_TSV="$INFORME_DIR/fuentes.tsv"; NO_EJECUTADAS_TSV="$INFORME_DIR/no-ejecutadas.tsv"
  : > "$FUENTES_TSV"; : > "$NO_EJECUTADAS_TSV"
  [[ "$INFORMES_BASE" == "$INFORMES_BASE_DEFECTO" ]] && asegurar_gitignore "${INFORMES_BASE_DEFECTO}/"

  detectar_stack
  generar_excepciones
  correr_gitleaks
  correr_semgrep
  correr_osv
  correr_trivy
  correr_checkov
  correr_npm_audit
  correr_pip_audit

  # Enlace estable al último informe (deploy.sh y los agentes lo consultan).
  ln -sfn "$(basename "$INFORME_DIR")" "${INFORMES_BASE}/ultimo"

  if [[ ${#FALTANTES[@]} -gt 0 ]]; then
    log_seccion "Herramientas faltantes (no instaladas automáticamente; use --instalar)"
    local h
    for h in "${FALTANTES[@]}"; do
      printf '  %-12s %s\n' "$h" "$(comando_instalacion "$h")"
    done
    log_warn "La cobertura local es parcial; el pipeline de CI ejecuta el conjunto completo."
  fi
  if [[ -s "$NO_EJECUTADAS_TSV" ]]; then
    log_seccion "Escáneres no ejecutados (sin fuentes o con error: no cuentan como aprobados)"
    local herr ruta_ne motivo
    while IFS=$'\t' read -r herr ruta_ne motivo; do
      printf '  %-12s %-20s %s\n' "$herr" "$ruta_ne" "$motivo"
    done < "$NO_EJECUTADAS_TSV"
  fi
  if [[ ${#EJECUTADAS[@]} -eq 0 ]]; then
    log_error "No se ejecutó ninguna herramienta. Instale al menos gitleaks y semgrep (o use --instalar)."
    # Se devuelve 3 (error de ejecución) y no 0: un análisis vacío no puede aprobar un despliegue.
    consolidar >/dev/null 2>&1 || true
    exit 3
  fi

  log_seccion "Consolidación"
  local rc=0
  consolidar || rc=$?
  log_info "Informe: ${INFORME_DIR}/resumen.md (enlace: ${INFORMES_BASE}/ultimo)"
  if [[ $rc -eq 0 ]]; then
    log_ok "Sin hallazgos por encima del umbral $UMBRAL"
    if [[ ${#FALTANTES[@]} -gt 0 || -s "$NO_EJECUTADAS_TSV" ]]; then
      log_warn "Cobertura PARCIAL: lo que no se ejecutó no está aprobado (ver arriba y resumen.md)."
    fi
  else
    log_error "Hay hallazgos que bloquean (≥ umbral). Corrija o registre una excepción justificada y con vencimiento en $MANIFIESTO."
  fi
  exit "$rc"
}

main "$@"
