#!/bin/sh
set -e

# Bind-mounting Windows host node_modules into Linux leaves `.bin` stubs that
# call `node.exe`. Reinstall into the named volume when that happens, or when
# newly declared deps (e.g. exceljs) are missing from a stale volume.
needs_install=0
if [ ! -f node_modules/.bin/strapi ]; then
  needs_install=1
elif grep -q 'node\.exe' node_modules/.bin/strapi 2>/dev/null; then
  needs_install=1
elif [ ! -d node_modules/@strapi/strapi ]; then
  needs_install=1
elif [ ! -d node_modules/exceljs ] || [ ! -d node_modules/pdfkit ]; then
  needs_install=1
elif [ ! -d node_modules/@fast-csv/parse ]; then
  needs_install=1
fi

if [ "$needs_install" = "1" ]; then
  echo "[strapi] Installing Linux dependencies into container volume..."
  rm -rf node_modules
  npm install
fi

exec "$@"
