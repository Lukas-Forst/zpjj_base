#!/usr/bin/env bash
# Lokaler Test: Worker + Oberfläche auf http://localhost:${PORT:-3000} (Dev-Login). Stop mit Ctrl+C.
# Liest TRELLO_KEY / TRELLO_TOKEN aus ../api_key.md, falls vorhanden. Braucht: npm.
# Lokale D1 liegt in worker/.wrangler (PERSIST_DIR überschreibt den Pfad).
set -euo pipefail
cd "$(dirname "$0")"
PORT=${PORT:-3000}
EMAIL=${AUTH_DEV_EMAIL:-lukas@example.invalid}
PERSIST=${PERSIST_DIR:-$PWD/worker/.wrangler/state}
(cd web && npm run build >/dev/null)
cd worker
W="npx wrangler"
$W d1 migrations apply zpjj-base --local --persist-to "$PERSIST" >/dev/null
SEED=$(mktemp --suffix=.sql)   # enthält echte Adressen: sofort löschen (exec unten umgeht einen EXIT-Trap)
rc=0
{ npm run -s seed > "$SEED" && $W d1 execute zpjj-base --local --persist-to "$PERSIST" --file "$SEED" >/dev/null; } || rc=$?
rm -f "$SEED"
[ "$rc" -eq 0 ] || exit "$rc"
VARS=(--var ENV:dev --var "AUTH_DEV_EMAIL:$EMAIL" --var "BOOTSTRAP_ADMIN_EMAILS:$EMAIL" --var "TRELLO_BOARD:${TRELLO_BOARD:-Lzg85PcJ}")
if [ -f ../../api_key.md ]; then
  for k in TRELLO_KEY TRELLO_TOKEN; do
    v=$(grep "^$k=" ../../api_key.md | head -1 | cut -d= -f2- || true)
    [ -n "$v" ] && VARS+=(--var "$k:$v")
  done
fi
echo "Öffne http://localhost:$PORT  (eingeloggt als $EMAIL)"
exec $W dev --local --port "$PORT" --persist-to "$PERSIST" "${VARS[@]}"
