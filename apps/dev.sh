#!/usr/bin/env bash
# Local test: API on :8000 (dev login), web export + proxy on :3000. Stop with Ctrl+C.
# Reads TRELLO_KEY / TRELLO_TOKEN from ../api_key.md if present. Needs: uv, npm, python3.
set -euo pipefail
cd "$(dirname "$0")"
[ -f api/seed/users.local.yaml ] || cp api/seed/users.example.yaml api/seed/users.local.yaml
(cd web && npm run build >/dev/null)
export ENV=dev DATABASE_URL=sqlite:///./dev.db AUTH_DEV_EMAIL=${AUTH_DEV_EMAIL:-lukas@example.invalid}
export BOOTSTRAP_ADMIN_EMAILS=$AUTH_DEV_EMAIL TRELLO_BOARD=${TRELLO_BOARD:-Lzg85PcJ}
if [ -f ../api_key.md ]; then
  export "$(grep '^TRELLO_KEY=' ../api_key.md)" "$(grep '^TRELLO_TOKEN=' ../api_key.md)"
fi
cd api
uv run alembic upgrade head >/dev/null
uv run python -m app.cli seed-schedule >/dev/null
trap 'kill 0' EXIT
uv run uvicorn --factory app.main:app_factory --port 8000 &
python3 ../dev_proxy.py 3000 &
echo "Öffne http://localhost:3000  (eingeloggt als $AUTH_DEV_EMAIL)"
wait
