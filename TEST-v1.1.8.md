# ShackClock v1.1.8 TEST — based on v1.1.7 solar imagery

**Experimental development branch — not a tagged release.** All v1.1.7 features, including SDO solar disk imagery, are retained.

## What's added
- **Satellite next passes**: local computation from the existing AMSAT-filtered TLE feed, next 24 hours, AOS/LOS UTC, maximum elevation, elevation cutoff 10 degrees, ~1 minute time resolution. Table lists next 7 passes. Refreshes every 30 minutes. This is an approximate planning display and not a substitute for precise satellite prediction software.
- **NOAA history charts**: GOES long X-ray 0.1–0.8 nm channel on logarithmic scale, and planetary Kp history. Both refresh every five minutes and show upstream-data errors.
- **MUF experimental overlay**: available behind the **MUF MAP** checkbox, disabled by default; the backend calls IonoFlux's GeoJSON MUF endpoint when an IONOFLUX_API_KEY is configured. No false simulated MUF values are shown without usable data. IonoFlux authentication, rate limits, GeoJSON property names and coverage require live validation before this can be promoted to production.

## Installation for testing

Use the branch archive rather than the old main branch:

https://github.com/n3bkv/node-red-shackclock/archive/refs/heads/test/v1.1.8-propagation-passes-charts.zip

Extract it, copy the existing .env (or configure a new one), and start with `docker compose up -d --build`. For a separate test install, set a different **SHACKCLOCK_PORT** and **SHACKCLOCK_DATA_VOLUME** and use a distinct Compose project name (e.g., `docker compose -p shackclock118test up -d --build`) to avoid collisions. **Important:** Docker Compose's explicit `container_name: shackclock` also conflicts with an existing installation; change it to `shackclock118test` in your test compose file before starting a side-by-side instance.

Optional IonoFlux MUF credential in `.env`:

```ini
IONOFLUX_API_KEY=
```

Only obtain a key through the provider's official terms. The key is passed to the Node-RED service and never embedded in the browser application. The optional MUF layer uses a server-side `X-API-Key` header, which still needs confirmation against the live provider.

## Display controls

The three new checkboxes are in LAYERS: **MUF MAP**, **SAT PASSES**, and **SOLAR CHARTS**. Their selection is stored per browser and is independent from the persistent app settings.

## Testing checklist

1. Verify the solar imagery from v1.1.7 still loads and the Off/Sunspots/Dual mode still works.
2. Verify the GOES X-ray and Kp charts show data and source status. The GOES channel uses `https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json`.
3. Confirm amateur satellite passes correlate with a trusted pass predictor for the station coordinates.
4. Verify the optional MUF checkbox shows a clear error when no key or valid grid is present.
5. Verify the optional MUF source's actual license, authentication, API response shape, refresh cadence and usage allowance before production use.
6. Validate layout at 1920x1080 as well as smaller screens; experimental panels may need further responsive layout refinement.

## Data-provider references

NOAA SWPC: https://services.swpc.noaa.gov/

IonoFlux API docs: https://ionoflux.runvia.app/developers

This branch has passed static JS syntax and Node-RED wire-reference checks; **live Docker and provider integration tests have not been run**.
