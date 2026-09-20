#!/usr/bin/env python3
"""
Evalúa el informe de OWASP ZAP contra `.github/zap-rules.tsv`.

POR QUÉ EXISTE. `zap-rules.tsv` documenta un contrato claro: FAIL falla el job,
WARN reporta sin fallar, IGNORE calla. La acción de ZAP no lo cumple: con
`fail_action: true` falla ante cualquier alerta, incluidas las WARN, y con
`false` no falla nunca. Es decir, el archivo de reglas solo servía para
silenciar (IGNORE) o para no cambiar nada.

La consecuencia práctica era un job en rojo con cero fallos: nueve avisos
informativos —cabeceras de caché, Sec-Fetch-Dest, `style-src unsafe-inline`, que
está documentado y aceptado en docs/csp.md— bloqueaban la fusión. La salida
fácil habría sido marcarlos IGNORE, pero eso los borra del informe: dejan de
verse, y un aviso que deja de verse deja de revisarse.

Con este script la acción ya no decide: se queda en `fail_action: false` y el
veredicto lo da el contraste entre las alertas y las reglas. Los avisos siguen
apareciendo en el informe y en el registro; solo bloquean los IDs marcados FAIL.

Uso:  evaluar-zap.py <report_json.json> [zap-rules.tsv]
Sale con 1 si hay al menos una alerta marcada FAIL.
"""

import json
import pathlib
import sys


def ids_que_bloquean(ruta: str) -> set[str]:
    """IDs marcados FAIL en el archivo de reglas (TSV: ID<TAB>ACCION<TAB>nota)."""
    if not ruta or not pathlib.Path(ruta).is_file():
        print(f"::warning::No se encontró {ruta!r}; ninguna alerta bloqueará.")
        return set()

    bloquean = set()
    for linea in pathlib.Path(ruta).read_text(encoding="utf-8").splitlines():
        if linea.startswith("#") or not linea.strip():
            continue
        partes = linea.split("\t")
        if len(partes) >= 2 and partes[1].strip() == "FAIL":
            bloquean.add(partes[0].strip())
    return bloquean


def main() -> int:
    informe = sys.argv[1]
    reglas = sys.argv[2] if len(sys.argv) > 2 else ""

    bloquean = ids_que_bloquean(reglas)
    datos = json.loads(pathlib.Path(informe).read_text(encoding="utf-8"))

    alertas = [a for sitio in datos.get("site", []) for a in sitio.get("alerts", [])]
    criticas = [a for a in alertas if str(a.get("pluginid")) in bloquean]
    avisos = [a for a in alertas if str(a.get("pluginid")) not in bloquean]

    print(
        f"ZAP: {len(alertas)} alerta(s) · {len(criticas)} bloqueante(s) · {len(avisos)} aviso(s)"
    )
    print(f"Reglas FAIL activas: {len(bloquean)}")

    for a in sorted(avisos, key=lambda x: str(x.get("pluginid"))):
        print(
            f"  aviso   [{a.get('pluginid')}] {a.get('name')} (riesgo: {a.get('riskdesc')})"
        )
    for a in sorted(criticas, key=lambda x: str(x.get("pluginid"))):
        print(
            f"::error::ZAP [{a.get('pluginid')}] {a.get('name')} — marcada FAIL en las reglas"
        )

    return 1 if criticas else 0


if __name__ == "__main__":
    sys.exit(main())
