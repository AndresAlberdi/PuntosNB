# Bitácora de hardening — Hipatia Puntos

Registro persistente entre sesiones. Plan de referencia: `docs/security/HARDENING_PLAN.md`.
Convención: una entrada por sesión, con fecha, fase, decisiones tomadas, evidencia y pendientes.

## Estado por fase

| Fase | Estado | Rama | Última actualización |
|---|---|---|---|
| 0 — Línea base y contención | en curso | `hardening/fase-0-linea-base` | 19-sep-2026 |
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

### Pendientes inmediatos

- Autorización para leer las reglas desplegadas en `puntosnb` (pruebas) y `hipatia-puntos` (producción).
- Decisión sobre la divergencia `feature/influencers` ↔ `main` en GitHub (O-01).
