#!/bin/bash
set -e

echo "=== [1/4] Ejecutando pruebas unitarias locales ==="
# Nota: Debes añadir el script "test": "vitest run" en tu package.json
# para que esta línea funcione correctamente, ya que vitest está instalado.
npm run test

echo "=== [2/4] Ejecutando análisis de vulnerabilidades con Snyk ==="
if npx snyk test; then
  echo "✔ Análisis de Snyk completado sin vulnerabilidades críticas."
else
  echo "⚠ Advertencia: Snyk detectó vulnerabilidades. Por favor revíselas antes de publicar en producción."
  # Do not halt if there are warnings, but let the user know. 
  # If you want to block on security issues, keep 'set -e' active.
fi

echo "=== [3/4] Compilando y publicando reglas de seguridad y archivos web en Firebase ==="
npm run build
npx -y firebase-tools@latest deploy --only firestore:rules,hosting

echo "=== [4/4] Confirmando y subiendo cambios a GitHub ==="
git add .
if git diff-index --quiet HEAD --; then
  echo "No hay cambios pendientes por commitear."
else
  git commit -m "chore: despliegue y actualizaciones de seguridad a hipatia-puntos"
fi

echo "Intentando realizar push a GitHub..."
# Se utiliza main en lugar de master ya que es la rama activa de PuntosNB-app
if git push origin main; then
  echo "✔ Cambios publicados con éxito en GitHub."
else
  echo "⚠ No se pudo hacer push a GitHub (verifique si el repositorio remoto 'origin' está configurado y accesible)."
fi

echo "=== ¡Despliegue finalizado! ==="
