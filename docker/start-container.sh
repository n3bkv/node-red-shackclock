#!/bin/sh
set -eu
VERSION="1.1.6"
MARKER="/data/.shackclock-version"
CURRENT=""
echo "[ShackClock] Node-RED ShackClock v$VERSION"

SETTINGS_FILE="/data/shackclock-settings.json"
if [ ! -f "$SETTINGS_FILE" ]; then
  PREVIOUS_SETTINGS="$(find /data -maxdepth 1 -type f -name '*-settings.json' ! -name 'shackclock-settings.json' 2>/dev/null | head -n 1 || true)"
  if [ -n "$PREVIOUS_SETTINGS" ] && [ -f "$PREVIOUS_SETTINGS" ]; then
    echo "[ShackClock] importing existing settings from $(basename "$PREVIOUS_SETTINGS")"
    cp "$PREVIOUS_SETTINGS" "$SETTINGS_FILE"
  fi
fi
[ -f "$MARKER" ] && CURRENT="$(cat "$MARKER" 2>/dev/null || true)"
if [ "$CURRENT" != "$VERSION" ]; then
  echo "[ShackClock] installing packaged Node-RED flows/settings for v$VERSION"
  cp /opt/shackclock/defaults/flows.json /data/flows.json
  cp /opt/shackclock/defaults/settings.js /data/settings.js
  printf '%s\n' "$VERSION" > "$MARKER"
fi
MIGRATION_MARKER="/data/.shackclock-v0.12-city-defaults"
if [ ! -f "$MIGRATION_MARKER" ]; then
  node /opt/shackclock/helpers/migrate-v012-settings.js || true
  : > "$MIGRATION_MARKER"
fi
ISS_MIGRATION_MARKER="/data/.shackclock-v0.12.1-iss-source"
if [ ! -f "$ISS_MIGRATION_MARKER" ]; then
  node /opt/shackclock/helpers/migrate-v0121-settings.js || true
  : > "$ISS_MIGRATION_MARKER"
fi
DXSUMMIT_MIGRATION_MARKER="/data/.shackclock-v1.1.1-dxsummit-http"
if [ ! -f "$DXSUMMIT_MIGRATION_MARKER" ]; then
  node /opt/shackclock/helpers/migrate-v111-dxsummit-http.js || true
  : > "$DXSUMMIT_MIGRATION_MARKER"
fi
node /opt/shackclock/helpers/dxcluster.js &
DXPID=$!
node /opt/shackclock/helpers/isstracker.js &
ISSPID=$!
node /opt/shackclock/helpers/airtraffic.js &
AIRPID=$!
node /opt/shackclock/helpers/carriertracker.js &
CARRIERPID=$!
node /opt/shackclock/helpers/amsats.js &
AMSATPID=$!
node /opt/shackclock/helpers/pskreporter-mqtt.js &
PSKPID=$!
cleanup(){ kill "$DXPID" "$ISSPID" "$AIRPID" "$CARRIERPID" "$AMSATPID" "$PSKPID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
exec /usr/src/node-red/entrypoint.sh "$@"
