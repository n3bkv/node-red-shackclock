# Node-RED ShackClock v1.0.0

A full-screen amateur-radio ShackClock dashboard built with Node-RED, Leaflet and Docker for macOS and Raspberry Pi. It is designed for a large shack display and combines weather, space weather, amateur-radio activity, satellites, aircraft, public carrier-status information, clocks and station data in one browser-based dashboard.

## v1.0.0

v1.0.0 is the first release.

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
- Docker image/runtime version reporting for `1.0.0`
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

- W3LPL DX Cluster spots
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

Some recently reported satellites may remain unmatched when no usable orbital element exists in the available TLE sources. These are reported in `/api/amateur/status` rather than silently plotted at an inferred location.

### Satellite diagnostics

Check current AMSAT filtering:

```bash
curl -s http://localhost:4040/api/amateur/status | python3 -m json.tool
```

A normal result includes:

```json
{
  "ok": true,
  "helperVersion": "1.0.0",
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

The aircraft carrier layer represents the **11 commissioned U.S. Navy aircraft carriers**.

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
unzip node-red-shackclock-v1.0.0.zip
cd node-red-shackclock-v1.0.0
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
cd node-red-shackclock-v1.0.0
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

For v1.0.0 the image should be:

```text
node-red-shackclock:1.0.0
```

Check the version embedded in the Docker image:

```bash
docker image inspect node-red-shackclock:1.0.0 \
  --format='{{ index .Config.Labels "org.opencontainers.image.version" }}'
```

Expected:

```text
1.0.0
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
  "version": "1.0.0",
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

**Version:** `1.0.0`

**Default dashboard port:** `4040` (configurable with `SHACKCLOCK_PORT`)

**Primary deployment targets:**

- macOS with Docker Desktop
- Raspberry Pi with Docker Engine / Docker Compose

**Configuration model:** persistent Docker volume plus in-dashboard Settings UI

**Primary UI:** `http://HOST:PORT/` (`4040` by default)

**Node-RED editor:** `http://HOST:PORT/admin`

## Support This Project

If you find this useful, star ⭐ the repo! It helps others discover it.

73, Dave N3BKV


https://hamradiohacks.blogspot.com

https://hamradiohacks.n3bkv.com
