# Node-RED ShackClock v1.1.4

A full-screen amateur-radio ShackClock dashboard built with Node-RED, Leaflet and Docker for macOS and Raspberry Pi. It is designed for a large shack display and combines weather, space weather, amateur-radio activity, satellites, aircraft, public carrier-status information, clocks and station data in one browser-based dashboard.

## v1.1.4

v1.1.4 makes PSKReporter paths easier to see and user-configurable.

### Changed in v1.1.4

- Added **PSK path color**, **thickness**, **opacity**, and **high-visibility outline** controls to both ShackClock Settings interfaces.
- New default PSK trace style is bright cyan (`#00e5ff`), **2 px**, **80% opacity**.
- High-visibility mode is enabled by default and draws a subtle dark outline under each PSK path so traces remain visible across bright clouds, dark oceans, terrain and labels.
- PSK display settings are persisted in `/data/shackclock-settings.json` and survive Docker upgrades.
- Existing v1.1.3 installations require no migration; if the new settings are absent, v1.1.4 uses the new defaults automatically.

## v1.1.3

v1.1.3 makes PSK paths feel more live without increasing load on the PSKReporter retrieval API.

### Changed in v1.1.3

- **Global PSK/MQTT scope** redraws PSK paths from ShackClock's local MQTT cache every **60 seconds**.
- **Station PSK/query scope** keeps the existing **5-minute** refresh interval to avoid unnecessarily increasing requests to the PSKReporter retrieval API.
- Returning to the ShackClock tab/window immediately refreshes PSK paths along with ham activity.
- Return/focus refresh events are debounced for two seconds so overlapping browser events do not cause duplicate refreshes.

The MQTT collector itself remains continuous; the 60-second interval controls only how often the browser redraws the cached Global PSK paths.


## v1.1.2

v1.1.2 fixes PSKReporter handling and separates station-history queries from the live global feed.

### Fixed in v1.1.2

- Station scope continues to use the PSKReporter retrieval API and explicitly requests an uncompressed XML response.
- The station response path safely handles binary/gzip/deflate responses and always returns `application/xml`.
- Global scope now uses the public PSKReporter MQTT feed instead of sending an unsupported no-callsign query to the historical retrieval API.
- Global band/mode filters are applied at the MQTT broker whenever practical. For example, **Global + 6m + FT8** subscribes to `pskr/filter/v2/6m/FT8/#`.
- Global all-band mode uses PSKReporter's documented `v2raw_1pc` 1% sample to avoid consuming the full worldwide firehose; any selected mode is then filtered locally.
- MQTT spots are kept in a rolling local cache in the persistent `/data` volume and exposed through the existing `/api/psk` XML endpoint, so the map UI does not need a separate protocol.
- Added `/api/psk/status` for MQTT connection/topic/cache diagnostics.

The public MQTT service is anonymous. ShackClock connects to `mqtt.pskreporter.info:1883` only while PSKReporter scope is set to **Global activity**.

Useful checks:

```bash
curl -s http://localhost:4040/api/config | python3 -m json.tool
curl -s http://localhost:4040/api/psk/status | python3 -m json.tool
curl -s http://localhost:4040/api/psk | head -30
```

For a worldwide 6 m FT8 view, use:

```text
PSKREPORTER_SCOPE=global
PSKREPORTER_BAND=6m
PSKREPORTER_MODE=FT8
```

The MQTT feed is live/forward-looking: after switching to Global scope, ShackClock begins collecting matching spots from that point forward rather than back-filling the previous hour.


## v1.1.1

v1.1.1 is a DX Summit connectivity bug-fix release.

### Fixed in v1.1.1

- Replaced Node's built-in `fetch()`/Undici path for DX Summit with the native Node `http`/`https` clients.
- Forces IPv4 for DX Summit requests. This avoids a reproducible connection timeout seen with hostname-based `fetch()` from the Docker container even though DNS, TCP, and `http.get()` work normally.
- Changed the default DX Summit endpoints to the currently working HTTP URLs.
- Automatically migrates the exact v1.1.0 saved HTTPS DX Summit defaults to HTTP when an existing persistent Docker volume is upgraded.
- Follows up to five HTTP redirects and preserves support for user-configured HTTP or HTTPS DX Summit URLs.
- DX Summit network failures now report the underlying error code/message instead of only `fetch failed`.
- Existing telnet-cluster support is unchanged.

Default DX Summit settings:

```text
DX_SOURCE=dxsummit
DX_SUMMIT_URL=http://www.dxsummit.fi/api/v1/spots?content_type=csv&limit=100
DX_SUMMIT_FALLBACK_URL=http://www.dxsummit.fi/text/dx100.html
DX_SUMMIT_REFRESH_SEC=60
```


## v1.1.0

v1.1.0 adds **DX Summit as a selectable DX spot source** and consolidates the new-user configuration improvements from the previous development build into this release.

### New in v1.1.0

- New `DX_SOURCE` setting: `cluster` or `dxsummit`.
- Telnet mode continues to support W3LPL, DXSpider, AR-Cluster and compatible nodes.
- DX Summit mode polls a structured CSV/API URL first and falls back to the legacy `dx100.html` feed.
- DX Summit JSON, CSV, HTML-table and common plain-text spot formats are normalized into the same ShackClock DX spot structure.
- DX Summit polling is clamped to **60 seconds or slower**.
- The Ham Activity ticker identifies the active DX source.
- Release naming now matches the GitHub project: `node-red-shackclock-v1.1.0.zip`, Docker image `node-red-shackclock:1.1.0`, container `shackclock`, and default volume `shackclock-data`.
- Includes persistent layer choices, POTA enable/disable, PSKReporter band/mode/global filtering, Metric/Imperial weather, New Zealand timezone guidance and anonymized station defaults.

- Layer checkbox choices now persist in the browser across reloads and restarts.
- POTA can be disabled completely from Settings with `POTA_ENABLED=false`; the POTA map checkbox is now labeled **POTA MAP** to distinguish the map overlay from the activity feed.
- PSKReporter supports **station or global scope**, **band filtering**, and **mode filtering** using the documented PSKReporter `mode` and `frange` query parameters. This makes a view such as **Global + 6m + FT8** possible.
- Weather can be switched between **Imperial** (`°F`, mph, inches) and **Metric** (`°C`, km/h, mm) using `WEATHER_UNITS`.
- `Pacific/Auckland` is included in the timezone suggestions, and the UI now reminds Southern Hemisphere users to enter latitude as a negative number.
- Public defaults no longer contain a personal callsign or QTH coordinates.

### DX Summit configuration

Select **SETTINGS → DX Spot Source → DX Summit web feed**, or use:

```text
DX_SOURCE=dxsummit
DX_SUMMIT_URL=http://www.dxsummit.fi/api/v1/spots?content_type=csv&limit=100
DX_SUMMIT_FALLBACK_URL=http://www.dxsummit.fi/text/dx100.html
DX_SUMMIT_REFRESH_SEC=60
```

The URLs are configurable so the adapter can be adjusted if DX Summit changes its public endpoints or query format.

To return to a normal cluster:

```text
DX_SOURCE=cluster
DX_CLUSTER_HOST=w3lpl.net
DX_CLUSTER_PORT=7373
DX_CLUSTER_CALL=Your Call
```



## v1.0.0

v1.0.0 was the first consolidated release.

It rolls the v0.x development work into one stable baseline and removes the need to follow the historical incremental release notes from earlier builds.

Major fixes and feature additions now included in the v1.0.0 baseline:

- Dockerized all-in-one deployment for macOS and Raspberry Pi
- persistent configuration stored in the Docker data volume
- in-dashboard Settings UI for application settings
- default web port `4040`, configurable at deployment time with `SHACKCLOCK_PORT`
- Esri satellite world map
- animated RainViewer radar
- OpenWeather cloud overlay with adjustable opacity
- optional lightning GeoJSON overlay
- USGS earthquake layer
- local weather from OpenWeather or optional WeeWX/MQTT
- NOAA space-weather data
- NOAA OVATION aurora layer
- greyline/day-night overlay
- W3LPL DX Cluster integration
- latest 10 DX spots in Ham Activity
- POTA spots plus latest 10 POTA spots
- PSKReporter paths
- AMSAT-filtered active amateur satellites
- server-side amateur-satellite filtering and TLE caching
- satellite map markers rendered with a `🛰` icon
- server-side ISS tracking with position, altitude, distance, footprint and ground track
- worldwide air traffic via OpenSky
- optional nearby ADS-B sources and local dump1090/readsb support
- directional airplane markers
- full 11-carrier public fleet-status layer
- deployed vs homeport/reference carrier status
- public/coarse carrier fallback when USNI blocks automated requests
- local and UTC clocks
- up to eight configurable city clocks
- Docker image/runtime version reporting
- configurable Docker host port with `SHACKCLOCK_PORT` without changing Node-RED's internal port
- configurable persistent Docker volume name with `SHACKCLOCK_DATA_VOLUME`
- Docker-safe upgrade behavior that preserves saved settings

---

## Main dashboard features

### World map

The dashboard uses an Esri satellite basemap and supports selectable overlays for:

- weather radar
- clouds
- lightning
- earthquakes
- air traffic
- public carrier status
- greyline
- aurora
- DX spots
- POTA
- PSKReporter paths
- active amateur satellites
- ISS
- ISS ground track
- ISS footprint
- QTH
- map labels

The base satellite imagery is always present. Overlay controls only affect the optional layers placed above it.

### Weather

Current weather can come from:

- OpenWeather
- optional WeeWX/MQTT local station data

Additional weather overlays include:

- RainViewer animated radar
- OpenWeather clouds with adjustable opacity
- optional lightning GeoJSON
- NWS forecast data

### Space weather

The dashboard displays NOAA/SWPC information including:

- solar flux
- Kp
- R/S/G scales
- HF condition
- OVATION aurora data

### Ham Activity

The Ham Activity panel includes:

- DX spots from a telnet cluster or DX Summit
- latest 10 DX spots
- POTA spots
- latest 10 POTA spots
- PSKReporter paths
- active amateur-satellite count

DX rows intentionally show frequency and mode without a separate band or age column.

---

## Active amateur satellites

The **ACTIVE HAM SATS** layer uses the AMSAT Satellite Status API to decide which satellites should be shown.

A satellite is considered recently active when AMSAT reports one of these positive statuses:

- `Heard`
- `Crew Active`

The default activity window is the most recent 24 hours.

### Activity source

ShackClock queries the AMSAT Status API:

```text
https://www.amsat.org/status/api/v1/summary.php?hours=24
```

The helper prefers the summary endpoint so one request can identify positive activity across the configured window.

If the Status API becomes unavailable, ShackClock can use:

1. the last successful cached active-satellite list
2. the AMSAT active-frequency database fallback

The fallback is marked in diagnostics because catalog `Active` is not identical to `recently Heard`.

### Orbital elements

To place active satellites on the map, ShackClock obtains orbital elements from:

1. AMSAT `nasabare.txt`
2. AMSAT `dailytle.txt`
3. CelesTrak amateur group only as a final network fallback
4. the last locally cached TLE set if all network sources fail

The two AMSAT TLE sets are merged before filtering.

Orbital data is cached for six hours.

CelesTrak returning `403 Forbidden` is nonfatal if AMSAT orbital data is already available.

### Name matching

v1.0.0 includes more tolerant AMSAT/TLE name matching.

For example:

```text
AO-7_[U/v]
AO-7_[V/a]
```

are normalized to the TLE identity:

```text
AO-07
```

Mode suffixes such as:

```text
_[VHF_Digi]
_[UHF_Digi]
_[Music]
```

are removed before identity matching.

Some recently reported satellites may still remain unmatched when no usable orbital element exists in the available TLE sources. These are reported in `/api/amateur/status` rather than silently plotted at an inferred location.

### Satellite diagnostics

Check current AMSAT filtering:

```bash
curl -s http://localhost:4040/api/amateur/status | python3 -m json.tool
```

A normal result includes:

```json
{
  "ok": true,
  "helperVersion": "1.1.2",
  "hours": 24,
  "source": "AMSAT Satellite Status API summary",
  "orbitalSource": "AMSAT nasabare + AMSAT daily TLE",
  "activeReports": 18,
  "activeTleCount": 14,
  "unmatched": []
}
```

The counts are dynamic and will change as AMSAT reports change.

Check the actual filtered orbital set delivered to the browser:

```bash
curl -s http://localhost:4040/api/amateur/tle | head -30
```

Watch the helper:

```bash
docker compose logs -f | grep '\[AMSAT\]'
```

---

## ISS tracking

ISS propagation is calculated server-side from cached orbital elements.

The dashboard can display:

- current latitude and longitude
- altitude
- distance from QTH
- footprint
- ground track
- source/TLE age diagnostics

The server retains the last valid orbital data if the upstream provider becomes temporarily unavailable.

Diagnostic endpoint:

```bash
curl -s http://localhost:4040/api/iss/state | python3 -m json.tool
```

---

## Worldwide air traffic

The air-traffic layer supports three modes:

### Worldwide

Uses OpenSky global aircraft snapshots.

Recommended settings:

```text
AIR_TRAFFIC_ENABLED=true
AIR_TRAFFIC_MODE=worldwide
AIR_TRAFFIC_REFRESH_SEC=900
```

The helper caches the global snapshot so browser refreshes do not repeatedly hit OpenSky.

Worldwide aircraft are rendered efficiently in a single canvas layer using directional airplane silhouettes.

### Nearby

Nearby mode can use ADSB.lol or ADSB.fi around the configured QTH.

### Local

Local mode can use your own dump1090/readsb `aircraft.json`.

Diagnostic endpoint:

```bash
curl -s http://localhost:4040/api/aircraft | python3 -m json.tool | head -100
```

Watch the helper:

```bash
docker compose logs -f | grep '\[AIR\]'
```

---

## Public carrier-status layer

The carrier layer represents the **11 commissioned U.S. Navy aircraft carriers**.

It intentionally separates two kinds of public information:

- **DEPLOYED / UNDERWAY** — coarse operating regions from public USNI Fleet Tracker reporting when available
- **HOMEPORT / REFERENCE** — public homeport, training or maintenance reference locations for carriers not shown as deployed

Maintenance states can also be shown separately, such as:

- `RCOH / MAINTENANCE`

The layer is intentionally **not live tactical ship tracking** and does not attempt to infer precise carrier positions.

If USNI blocks automated requests, ShackClock uses its bundled public deployment snapshot and merges that with public fleet-reference locations.

Diagnostic endpoint:

```bash
curl -s http://localhost:4040/api/carriers | python3 -m json.tool
```

A normal response contains a `counts` object similar to:

```json
{
  "counts": {
    "total": 11,
    "deployed": 3,
    "reference": 8
  }
}
```

The deployed/reference numbers can change as the bundled/public source data changes.

---

## Earthquakes

The selectable earthquake layer uses USGS real-time GeoJSON.

Settings include:

```text
EARTHQUAKE_MIN_MAG
EARTHQUAKE_MAX_AGE_HOURS
```

---

## Clocks

The display includes:

- local time
- UTC
- up to eight configurable city clocks

Default city clocks are:

- Tokyo
- Sydney
- London
- New York
- Denver
- Chicago

City clocks are sorted by their current local date/time rather than by configuration slot.

---

## Settings

Click **SETTINGS** in the Layers panel for normal application settings.

Most application settings are stored persistently in the Docker data volume. Deployment-level settings such as the Docker host port are intentionally kept in the project `.env` file because Docker must know the port mapping before the web UI starts.

Saved settings are stored persistently in:

```text
/data/shackclock-settings.json
```

The persistent Docker volume survives normal upgrades.


### Docker web port

The default browser port is:

```text
4040
```

To change the host port, copy the example environment file once:

```bash
cp .env.example .env
```

Then edit:

```text
SHACKCLOCK_PORT=4040
```

For example, to expose ShackClock on port `8080`:

```text
SHACKCLOCK_PORT=8080
```

Recreate the container:

```bash
docker compose up -d
```

The internal Node-RED port remains `4040`; only the Docker host-side port changes. With the example above, use:

```text
http://localhost:8080/
http://localhost:8080/admin
http://localhost:8080/api/health
```

You can also set the port for a single invocation without creating `.env`:

```bash
SHACKCLOCK_PORT=8080 docker compose up -d --build
```

`SHACKCLOCK_PORT` is a deployment setting and therefore does **not** appear in the in-dashboard Settings dialog.


### Weather units

Choose the display system in Settings or `.env`:

```text
WEATHER_UNITS=imperial
```

or:

```text
WEATHER_UNITS=metric
```

Imperial displays °F, mph and inches. Metric displays °C, km/h and millimetres. OpenWeather is requested in the selected unit system. If you use a custom WeeWX/local JSON source, make sure its values match the selected display units.

### PSKReporter filters

The PSK Paths layer can now be filtered at the source. Useful examples:

```text
PSKREPORTER_SCOPE=global
PSKREPORTER_BAND=6m
PSKREPORTER_MODE=FT8
```

`PSKREPORTER_SCOPE=station` preserves the original behavior and asks PSKReporter for reports involving your station callsign. `global` removes the callsign restriction and displays recent activity matching the selected band/mode. ShackClock still refreshes PSKReporter no more often than every five minutes.

Supported band choices in the Settings UI include 160m through 70cm, including 6m and 2m. Leave the mode blank for any mode.

### POTA feed

To disable POTA completely rather than merely hiding its map layer:

```text
POTA_ENABLED=false
```

The **POTA MAP** checkbox controls only the map overlay and its state is remembered by that browser.

### Docker data volume

ShackClock stores persistent settings and caches in a named Docker volume.

The default is:

```text
SHACKCLOCK_DATA_VOLUME=shackclock-data
```

You can change the volume name in `.env` before starting the container:

```text
SHACKCLOCK_DATA_VOLUME=my-shackclock-data
```

This is useful when carrying forward an existing data volume. On startup, if `/data/shackclock-settings.json` does not yet exist but another `*-settings.json` file is present in the mounted data volume, ShackClock imports that file once as the starting settings file.

`SHACKCLOCK_DATA_VOLUME` is a Docker deployment setting and does **not** appear in the in-dashboard Settings dialog.

Important settings include:

```text
TZ
STATION_CALL
STATION_NAME
STATION_LAT
STATION_LON
STATION_ELEV_M

OPENWEATHER_API_KEY
WEEWX_JSON_URL
LIGHTNING_GEOJSON_URL

DX_CLUSTER_ENABLED
DX_CLUSTER_HOST
DX_CLUSTER_PORT
DX_CLUSTER_CALL
DX_CLUSTER_MAX_AGE_MIN

POTA_SPOTS_URL
PSKREPORTER_SECONDS
PSKREPORTER_LIMIT

AMSAT_ACTIVE_HOURS

ISS_TLE_URL

AIR_TRAFFIC_ENABLED
AIR_TRAFFIC_MODE
AIR_TRAFFIC_REFRESH_SEC

CARRIER_ENABLED
CARRIER_GEOJSON_URL
CARRIER_REFRESH_HOURS
CARRIER_MAX_AGE_HOURS
```

City clock settings are also available for slots 1 through 8.

---

## Quick start — macOS

Install Docker Desktop.

Unzip the release:

```bash
unzip node-red-shackclock-v1.1.4.zip
cd node-red-shackclock-v1.1.4
```

Build and start:

```bash
docker compose up -d --build
```

Or use the included launcher, which prints the actual mapped port after startup:

```bash
./start.sh
```

The default port is `4040`. To change it, set `SHACKCLOCK_PORT` in `.env` as described in **Docker web port** above.

Open:

```text
http://localhost:4040/
```

Node-RED editor:

```text
http://localhost:4040/admin
```

Watch logs:

```bash
docker compose logs -f
```

Useful helper-specific logs:

```bash
docker compose logs -f | grep -E '\[AMSAT\]|\[CARRIER\]|\[AIR\]'
```

---

## Quick start — Raspberry Pi

Install Docker Engine and the Docker Compose plugin.

Copy the project to the Pi, then:

```bash
cd node-red-shackclock-v1.1.4
docker compose up -d --build
```

Browse from another computer:

```text
http://PI-IP:4040/
```

For a dedicated local display:

```bash
chromium \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  http://localhost:4040/
```

---

## Upgrading from a v0.x release

Keep the persistent Docker volume.

From the v1.1.4 directory:

```bash
docker compose build --no-cache
docker rm -f shackclock 2>/dev/null || true
docker compose up -d
```

Do **not** use:

```bash
docker compose down -v
```

unless you intentionally want to erase persistent configuration.

Your saved settings live in the Docker data volume and should survive normal container replacement.

If Docker reports that the existing volume was created by an older Compose project name, that is expected when carrying the same persistent ShackClock data volume forward across versioned directories.

---

### If you used an earlier development package

Some earlier test packages used the Docker volume name `n3bkv-shackclock-data`. The GitHub repository convention is `shackclock-data`.

To keep using the older volume, create `.env` before starting this v1.1.4 release:

```text
SHACKCLOCK_DATA_VOLUME=n3bkv-shackclock-data
```

Check existing volumes with:

```bash
docker volume ls | grep shackclock
```

Do not delete the old volume until you have confirmed your saved settings are present.

## Useful Docker checks

Show the running container:

```bash
docker ps -a --filter name=shackclock
```

Confirm the image:

```bash
docker inspect shackclock \
  --format='Image={{.Config.Image}} Status={{.State.Status}} Exit={{.State.ExitCode}}'
```

For v1.1.3 the image should be:

```text
node-red-shackclock:1.1.4
```

Check the version embedded in the Docker image:

```bash
docker image inspect node-red-shackclock:1.1.4 \
  --format='{{ index .Config.Labels "org.opencontainers.image.version" }}'
```

Expected:

```text
1.1.2
```

The health API also reports the release version and the configured public port:

```bash
curl -s http://localhost:4040/api/health | python3 -m json.tool
```

With the default port, a normal response includes:

```json
{
  "ok": true,
  "service": "node-red-shackclock",
  "version": "1.1.4",
  "publicPort": 4040
}
```

If `SHACKCLOCK_PORT` is changed, use that port in the `curl` URL.

Show recent logs:

```bash
docker logs shackclock --tail=150
```

---

## Useful API endpoints

```text
/api/config
/api/station
/api/forecast
/api/radar
/api/lightning
/api/space/kp
/api/space/flux
/api/space/scales
/api/space/aurora
/api/iss/state
/api/iss/tle
/api/dx
/api/pota
/api/psk
/api/amateur/tle
/api/amateur/status
/api/earthquakes
/api/aircraft
/api/carriers
/api/health
/api/settings-config
```

---

## Data sources

The project currently integrates public/community data from services including:

- Esri
- RainViewer
- OpenWeather
- National Weather Service
- NOAA Space Weather Prediction Center
- USGS
- W3LPL DX Cluster
- POTA
- PSKReporter
- AMSAT
- WhereTheISS.at
- OpenSky
- ADSB.lol / ADSB.fi
- USNI News Fleet Tracker
- optional local WeeWX/MQTT
- optional local dump1090/readsb

Browser refreshes do not directly drive the high-frequency upstream polling for the major cached helpers. Server-side helpers cache and reuse data where appropriate.

---

## Persistent data

The Docker data volume stores configuration and helper caches under `/data`.

Examples include:

```text
/data/shackclock-settings.json
/data/amateur-active-meta.json
/data/amateur-active-tle.txt
/data/amateur-active-names.json
/data/amateur-all-tle.txt
```

Deleting the Docker data volume deletes saved configuration.

---

## Project structure

```text
.
├── Dockerfile
├── docker-compose.yml
├── docker/
│   └── start-container.sh
├── helpers/
│   ├── airtraffic.js
│   ├── amsats.js
│   ├── carriertracker.js
│   ├── dxcluster.js
│   ├── isstracker.js
│   └── ...
├── node-red/
│   ├── defaults/
│   │   ├── flows.json
│   │   └── settings.js
│   └── public/
│       ├── app.js
│       ├── index.html
│       ├── settings.css
│       ├── settings.html
│       ├── settings.js
│       └── style.css
└── examples/
    └── weewx-mqtt-flow.json
```

---

## Known limitations

- Public/community APIs can change, rate-limit or temporarily reject automated requests.
- CelesTrak may return HTTP 403; ShackClock can continue using AMSAT orbital data and local cache.
- An AMSAT satellite can be reported active but remain unplottable if no current matching TLE is available.
- Carrier markers are public/coarse status information, not real-time tactical positions.
- OpenSky global snapshots are periodic rather than real-time streaming.
- Optional sources such as lightning, WeeWX and local ADS-B depend on user configuration.

---

## License / third-party services

This project combines open web technologies and public/community data services.

Each upstream provider retains its own:

- terms of service
- attribution requirements
- usage limits
- data rights

Check current provider policies before redistribution or large-scale deployment.

---

## Release status

**Version:** `1.1.4`

**Default dashboard port:** `4040` (configurable with `SHACKCLOCK_PORT`)

**Primary deployment targets:**

- macOS with Docker Desktop
- Raspberry Pi with Docker Engine / Docker Compose

**Configuration model:** persistent Docker volume plus in-dashboard Settings UI

**Primary UI:** `http://HOST:PORT/` (`4040` by default)

**Node-RED editor:** `http://HOST:PORT/admin`


## Project repository

https://github.com/n3bkv/node-red-shackclock
