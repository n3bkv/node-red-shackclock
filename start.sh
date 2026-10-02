#!/usr/bin/env sh
set -eu

docker compose up -d --build

HOSTPORT="$(docker compose port shackclock 4040 2>/dev/null | tail -1 | awk -F: '{print $NF}' || true)"
[ -n "$HOSTPORT" ] || HOSTPORT=4040

printf '\nNode-RED ShackClock v1.1.3\n'
printf 'ShackClock:       http://localhost:%s/\n' "$HOSTPORT"
printf 'Node-RED admin: http://localhost:%s/admin\n' "$HOSTPORT"
printf 'Health API:     http://localhost:%s/api/health\n\n' "$HOSTPORT"
docker compose ps
