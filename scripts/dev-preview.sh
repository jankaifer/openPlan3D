#!/usr/bin/env bash
# Start a preview dev server seeded from the prod `openplan3d` database.
# Usage: bash scripts/dev-preview.sh [PORT]
#
# - Boots a throwaway Postgres instance under /tmp (the claude-ui user has no
#   CREATEDB right on the system cluster), seeded read-only from prod via
#   pg_dump — the preview NEVER points at the prod DB.
# - Applies drizzle/*.sql migrations to the preview DB only.
# - Runs `vite dev` on 0.0.0.0 at the given port (default: lowest free port
#   in 8000–8100), reachable at http://frame1.hobitin.eu:PORT/.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$(ls -d /nix/store/*-nodejs-22*/bin | head -1):$PATH"

PORT="${1:-}"
if [ -z "$PORT" ]; then
  for p in $(seq 8000 8100); do
    if ! ss -tln "( sport = :$p )" | grep -q ":$p"; then PORT=$p; break; fi
  done
fi
[ -n "$PORT" ] || { echo "no free port in 8000–8100" >&2; exit 1; }

PGDIR=/tmp/openplan3d-preview-pg
SOCKDIR="$PGDIR/sock"
PREVIEW_DB=openplan3d_preview

if [ ! -d "$PGDIR/data" ]; then
  mkdir -p "$PGDIR" "$SOCKDIR"
  initdb -D "$PGDIR/data" -U "$USER" -A trust >/dev/null
fi
if ! pg_ctl -D "$PGDIR/data" status >/dev/null 2>&1; then
  pg_ctl -D "$PGDIR/data" -l "$PGDIR/log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$SOCKDIR'" start >/dev/null
fi

echo "Seeding $PREVIEW_DB from prod openplan3d…"
# The dump references prod's owner role; create it so ALTER OWNER lines apply.
psql -h "$SOCKDIR" postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='openplan3d'" | grep -q 1 \
  || psql -q -h "$SOCKDIR" postgres -c "CREATE ROLE openplan3d LOGIN"
dropdb -h "$SOCKDIR" --if-exists "$PREVIEW_DB"
createdb -h "$SOCKDIR" "$PREVIEW_DB"
pg_dump openplan3d | psql -q -h "$SOCKDIR" "$PREVIEW_DB" >/dev/null

echo "Applying migrations to $PREVIEW_DB…"
for f in drizzle/*.sql; do
  # New tables from unreleased migrations apply; statements the prod dump
  # already contains fail harmlessly (ON_ERROR_STOP off).
  psql -q -h "$SOCKDIR" "$PREVIEW_DB" -v ON_ERROR_STOP=0 -f "$f" 2>/dev/null || true
done

echo "Preview: http://frame1.hobitin.eu:$PORT/"
# postgres.js resolves unix sockets via PGHOST (same pattern as the prod service).
DATABASE_URL="postgres:///$PREVIEW_DB" PGHOST="$SOCKDIR" exec npx vite dev --host --port "$PORT" --strictPort
