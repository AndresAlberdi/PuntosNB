#!/bin/bash
set -e

ENV=${1:-prod}

if [ "$ENV" = "staging" ] || [ "$ENV" = "puntosnb" ]; then
  PROJECT_ID="puntosnb"
  BUILD_CMD="npm run build:staging"
  echo "=== MODO DE DESPLIEGUE: PRUEBAS / STAGING (puntosnb) ==="
else
  PROJECT_ID="hipatia-puntos"
  BUILD_CMD="npm run build:prod"
  echo "=== MODO DE DESPLIEGUE: PRODUCCIÓN (hipatia-puntos) ==="
fi

echo "=== [1/4] Ejecutando pruebas unitarias locales ==="
npm run test

echo "=== [2/4] Ejecutando análisis de vulnerabilidades con Snyk ==="
if npx snyk test; then
  echo "✔ Análisis de Snyk completado sin vulnerabilidades críticas."
else
  echo "⚠ Advertencia: Snyk detectó vulnerabilidades."
fi

echo "=== [3/4] Compilando y publicando en Firebase ($PROJECT_ID) ==="
$BUILD_CMD
npx -y firebase-tools@latest deploy --project "$PROJECT_ID" --only firestore:rules,hosting

echo "=== [4/4] Confirmando y subiendo cambios a GitHub ==="
git add .
if git diff-index --quiet HEAD --; then
  echo "No hay cambios pendientes por commitear."
else
  git commit -m "chore: despliegue ($PROJECT_ID) y actualizaciones de entorno"
fi

echo "Intentando realizar push a GitHub..."
if git push origin main; then
  echo "✔ Cambios publicados con éxito en GitHub."
else
  echo "⚠ No se pudo hacer push a GitHub."
fi

echo "=== ¡Despliegue finalizado con éxito en $PROJECT_ID! ==="
