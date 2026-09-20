<!--
PULL_REQUEST_TEMPLATE.md — Plantilla de Pull Request con checklist de seguridad
Versión: 2.0 | Fecha: 2026-08-24 | Destino: .github/PULL_REQUEST_TEMPLATE.md
Complete todas las secciones. Los ítems marcados (obligatorio) bloquean la
revisión si no están verificados. Elimine las secciones que no apliquen
indicando "N/A" y el motivo.
-->

## Resumen

<!-- Qué cambia y por qué. Enlace al issue/ticket. -->

Cierra #

## Tipo de cambio

- [ ] `feat` Nueva funcionalidad
- [ ] `fix` Corrección de error
- [ ] `security` Corrección de seguridad (indicar severidad y si hay CVE)
- [ ] `refactor` / `perf` Sin cambio funcional
- [ ] `chore` / `ci` / `docs` Mantenimiento
- [ ] Cambio incompatible (`!` en el título; requiere versión major)

## Cómo se probó

<!-- Comandos ejecutados, pruebas añadidas, capturas si aplica. -->

- [ ] Pruebas unitarias/integración añadidas o actualizadas
- [ ] Cobertura igual o superior al umbral (`COVERAGE_MIN`)
- [ ] Probado en staging (URL / run de CI): 

## Checklist de seguridad (obligatorio)

### Secretos e identidad
- [ ] No se añadieron secretos, tokens, JSON de service accounts ni claves (`pre-commit` con Gitleaks pasó en local)
- [ ] Credenciales nuevas van en GitHub Secrets / Secret Manager, nunca en código ni en `vars`
- [ ] Ningún permiso IAM nuevo excede el mínimo necesario (principio de menor privilegio)

### Entrada y salida de datos
- [ ] Toda entrada externa se valida y se sanea (tipos, longitud, listas permitidas)
- [ ] No hay concatenación de SQL/NoSQL/comandos con datos del usuario
- [ ] Sin `eval`, `innerHTML` con datos dinámicos ni `shell=True`
- [ ] Los errores no exponen stack traces ni información interna al cliente

### Acceso a datos (Firebase / API)
- [ ] Reglas de Firestore/Storage revisadas; sin `allow read, write: if true`
- [ ] Pruebas de reglas (`npm run test:rules`) actualizadas si cambiaron las reglas
- [ ] Endpoints nuevos exigen autenticación y autorización explícitas

### Dependencias y cadena de suministro
- [ ] Dependencias nuevas justificadas (mantenidas, licencia compatible, sin CRITICAL/HIGH en `npm audit` / `pnpm audit` / `pip-audit`)
- [ ] Acciones de GitHub nuevas fijadas por SHA con comentario `# vX`
- [ ] Imágenes base de Docker fijadas por digest (obligatorio; el tag solo como comentario)

### Infraestructura y despliegue
- [ ] Cambios de IaC pasaron Checkov / Trivy config sin hallazgos bloqueantes
- [ ] Variables de entorno nuevas documentadas y añadidas a `vars`/`secrets` de staging y producción
- [ ] Migraciones de datos son reversibles o tienen plan de rollback documentado

### Cabeceras y configuración web (si aplica)
- [ ] CSP, HSTS, X-Content-Type-Options y Permissions-Policy siguen presentes (ZAP baseline pasa)
- [ ] CORS restringido a orígenes conocidos

## Impacto y rollback

<!-- ¿Qué pasa si falla en producción? ¿Cómo se revierte? -->

- Plan de rollback: `git revert` + nuevo tag / revisión anterior (ver `01-seguridad/06-rollback-e-incidentes.md`)
- [ ] Este cambio puede desplegarse de forma independiente

## Excepciones de seguridad solicitadas

<!-- Si necesita ignorar una regla (CVE, alerta ZAP, check de Checkov):
ID, justificación técnica, fecha de vencimiento y aprobador de seguridad.
Ver 02-pipelines/README.md → "Cómo añadir una excepción". -->

| ID | Herramienta | Justificación | Vence | Aprobado por |
|----|-------------|---------------|-------|--------------|
|    |             |               |       |              |

## Notas para el revisor

<!-- Puntos de atención, decisiones de diseño, deuda técnica asumida. -->
