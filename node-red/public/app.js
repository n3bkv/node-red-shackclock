/* Node-RED ShackClock v1.0.0
 * Full-screen Leaflet client. Node-RED serves/proxies the data APIs.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    config: { call: 'N0CALL', lat: 0, lon: 0 },
    map: null,
    layers: {},
    radarTimer: null,
    radarFrames: [],
    radarIndex: 0,
    radarCurrentLayer: null,
    radarLayers: [],
    radarReady: [],
    radarGeneration: 0,
    cloudOpacity: 0.48,
    issUpdated: 0,
    issTrackSignature: '',
    cityClockOrderKey: '',
    lastHealth: Date.now(),
    weatherUpdated: 0,
    spaceUpdated: 0,
    amateurSatRecs: [],
    hamFeedUpdated: 0
  };

  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function getJSON(url, timeout = 12000) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ac.signal });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function getText(url, timeout = 12000) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ac.signal });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.text();
    } finally { clearTimeout(t); }
  }

  function freshApiUrl(path) {
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}_=${Date.now()}`;
  }

  let hamRefreshInFlight = null;
  function refreshHamActivity() {
    if (hamRefreshInFlight) return hamRefreshInFlight;
    hamRefreshInFlight = Promise.allSettled([refreshDXSpots(), refreshPOTA()])
      .finally(() => { hamRefreshInFlight = null; });
    return hamRefreshInFlight;
  }

  function fmtNum(v, digits = 0, fallback = '--') {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(digits) : fallback;
  }

  function first(obj, paths) {
    for (const p of paths) {
      const v = p.split('.').reduce((a, k) => (a != null ? a[k] : undefined), obj);
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  async function loadConfig() {
    try {
      state.config = { ...state.config, ...(await getJSON('/api/config')) };
    } catch (e) {
      console.warn('Config fallback:', e);
    }
    $('station-call').textContent = `${state.config.call} WEATHER`;
    document.title = state.config.name || `${state.config.call} ShackClock`;
  }

  function initMap() {
    const map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: true,
      minZoom: 2,
      maxZoom: 12,
      preferCanvas: true
    }).setView([state.config.lat, state.config.lon], 5);
    state.map = map;

    state.layers.imagery = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 18 }
    ).addTo(map);

    state.layers.borders = L.tileLayer(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 18, opacity: 0.85, pane: 'overlayPane' }
    ).addTo(map);

    // Cloud tiles are proxied by Node-RED so the OpenWeatherMap API key
    // remains server-side and never appears in browser source/devtools.
    const savedCloudOpacity = Number(localStorage.getItem('shackclock.cloudOpacity'));
    if (Number.isFinite(savedCloudOpacity)) {
      state.cloudOpacity = Math.min(1, Math.max(0, savedCloudOpacity));
    }
    if (state.config.openWeatherConfigured) {
      state.layers.clouds = L.tileLayer('/api/clouds/{z}/{x}/{y}', {
        opacity: state.cloudOpacity,
        maxZoom: 10,
        maxNativeZoom: 10,
        zIndex: 240,
        updateWhenIdle: false,
        updateWhenZooming: false,
        keepBuffer: 4
      }).addTo(map);
    } else {
      state.layers.clouds = L.layerGroup();
    }

    state.layers.radar = L.layerGroup().addTo(map);
    state.layers.lightning = L.layerGroup().addTo(map);
    state.layers.iss = L.layerGroup().addTo(map);
    state.layers.issTrack = L.layerGroup().addTo(map);
    state.layers.footprint = L.layerGroup().addTo(map);
    state.layers.station = L.layerGroup().addTo(map);
    state.layers.dxSpots = L.layerGroup();
    state.layers.pota = L.layerGroup();
    state.layers.pskPaths = L.layerGroup();
    state.layers.amateurSat = L.layerGroup();
    state.layers.aurora = L.layerGroup();
    state.layers.earthquakes = L.layerGroup();
    state.layers.airTraffic = L.layerGroup();
    state.layers.carriers = L.layerGroup();

    if (typeof L.terminator === 'function') {
      state.layers.greyline = L.terminator({
        fillColor: '#07101e',
        fillOpacity: 0.47,
        color: '#96b3ff',
        opacity: 0.35,
        weight: 1,
        resolution: 2
      }).addTo(map);
      setInterval(() => state.layers.greyline?.setTime?.(), 60000);
    }

    addStationMarker();
    wireLayerControls();
  }

  function addStationMarker() {
    const icon = L.divIcon({
      className: '',
      html: `<div class="station-marker">◎ ${state.config.call}</div>`,
      iconAnchor: [8, 8]
    });
    L.marker([state.config.lat, state.config.lon], { icon, zIndexOffset: 900 })
      .bindTooltip(`${state.config.call} QTH`, { direction: 'top' })
      .addTo(state.layers.station);
  }

  function wireLayerControls() {
    const cloudToggle = document.querySelector('[data-layer="clouds"]');
    const cloudOpacity = $('cloud-opacity');
    const cloudOpacityValue = $('cloud-opacity-value');
    if (cloudToggle && !state.config.openWeatherConfigured) {
      cloudToggle.checked = false;
      cloudToggle.disabled = true;
      cloudToggle.parentElement.title = 'Set OPENWEATHER_API_KEY in .env and restart the container';
      if (cloudOpacity) cloudOpacity.disabled = true;
    }
    const airToggle = document.querySelector('[data-layer="airTraffic"]');
    if (airToggle && state.config.airTraffic?.enabled === false) {
      airToggle.checked = false;
      airToggle.disabled = true;
      airToggle.parentElement.title = 'Enable air traffic in Settings';
    }

    if (cloudOpacity) {
      cloudOpacity.value = String(Math.round(state.cloudOpacity * 100));
      if (cloudOpacityValue) cloudOpacityValue.textContent = `${cloudOpacity.value}%`;
      cloudOpacity.addEventListener('input', () => {
        const pct = Math.min(100, Math.max(0, Number(cloudOpacity.value) || 0));
        state.cloudOpacity = pct / 100;
        if (state.layers.clouds?.setOpacity) state.layers.clouds.setOpacity(state.cloudOpacity);
        if (cloudOpacityValue) cloudOpacityValue.textContent = `${pct}%`;
        localStorage.setItem('shackclock.cloudOpacity', String(state.cloudOpacity));
      });
    }

    document.querySelectorAll('[data-layer]').forEach(cb => {
      cb.addEventListener('change', () => {
        const name = cb.dataset.layer;
        const layer = state.layers[name];
        if (!layer) return;
        if (cb.checked) {
          layer.addTo(state.map);
          if (name === 'radar') drawRadarFrame();
        } else {
          state.map.removeLayer(layer);
        }
      });
    });
    $('view-local').onclick = () => state.map.setView([state.config.lat, state.config.lon], 7);
    $('view-usa').onclick = () => state.map.setView([38.5, -98.5], 4);
    $('view-world').onclick = () => state.map.setView([20, -20], 2);
  }

  function updateClocks() {
    const d = new Date();
    const tz = state.config.timezone || undefined;
    $('local-clock').textContent = d.toLocaleTimeString([], { timeZone:tz, hour:'numeric', minute:'2-digit', second:'2-digit' });
    $('utc-clock').textContent = d.toLocaleTimeString('en-US', { timeZone:'UTC', hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
    $('date-local').textContent = d.toLocaleDateString([], { timeZone:tz, weekday:'short', year:'numeric', month:'short', day:'numeric' });
    $('date-utc').textContent = d.toLocaleDateString('en-US', { timeZone:'UTC', weekday:'short', year:'numeric', month:'short', day:'numeric' }) + ' UTC';
    updateCityClocks(d);
    if (state.weatherUpdated) $('station-age').textContent = ageText(state.weatherUpdated);
    if (state.spaceUpdated) $('space-age').textContent = ageText(state.spaceUpdated);
  }

  function cityWallClockSortKey(d, timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone, year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', hourCycle:'h23'
      }).formatToParts(d);
      const v = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
      return Date.UTC(Number(v.year), Number(v.month)-1, Number(v.day), Number(v.hour), Number(v.minute));
    } catch (_) {
      return Number.POSITIVE_INFINITY;
    }
  }

  function sortedCityClocks(d = new Date()) {
    const clocks = Array.isArray(state.config.cityTimes) ? state.config.cityTimes.slice(0,8) : [];
    return clocks.map((c, index) => ({...c, _index:index, _sort:cityWallClockSortKey(d, c.timezone)}))
      .sort((a,b) => (a._sort-b._sort) || String(a.label||'').localeCompare(String(b.label||'')));
  }

  function renderCityClocks(d = new Date()) {
    const panel = $('city-times-panel');
    const host = $('city-times');
    if (!panel || !host) return [];
    const clocks = sortedCityClocks(d);
    host.innerHTML = '';
    if (!clocks.length) {
      panel.hidden = true;
      panel.classList.remove('active');
      state.cityClockOrderKey = '';
      return [];
    }
    clocks.forEach((c, i) => {
      const item = document.createElement('div');
      item.className = 'city-time-item';
      item.dataset.tz = c.timezone || '';
      item.innerHTML = `<span class="city-time-label">${escapeHtml(c.label || c.timezone || `CITY ${i+1}`)}</span><b id="city-time-${i}">--:--</b><span id="city-date-${i}" class="city-time-date">---</span>`;
      host.appendChild(item);
    });
    state.cityClockOrderKey = clocks.map(c => `${c.label}|${c.timezone}`).join('||');
    panel.hidden = false;
    panel.classList.add('active');
    return clocks;
  }

  function initCityClocks() {
    renderCityClocks(new Date());
  }

  function updateCityClocks(d) {
    let clocks = sortedCityClocks(d);
    const key = clocks.map(c => `${c.label}|${c.timezone}`).join('||');
    if (key !== state.cityClockOrderKey) clocks = renderCityClocks(d);
    clocks.forEach((c, i) => {
      const timeEl = $(`city-time-${i}`), dateEl = $(`city-date-${i}`);
      if (!timeEl || !dateEl) return;
      try {
        timeEl.textContent = d.toLocaleTimeString('en-US', {timeZone:c.timezone, hour12:false, hour:'2-digit', minute:'2-digit'});
        dateEl.textContent = d.toLocaleDateString('en-US', {timeZone:c.timezone, weekday:'short', month:'short', day:'numeric'});
        timeEl.title = c.timezone;
      } catch (e) {
        timeEl.textContent = 'ERR';
        dateEl.textContent = 'BAD TZ';
        timeEl.title = `Invalid timezone: ${c.timezone}`;
      }
    });
  }

  function ageText(ts) {
    const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
    return `${Math.floor(sec/3600)}h ago`;
  }

  async function refreshStation() {
    try {
      const d = await getJSON('/api/station');
      if (d.configured === false) {
        $('station-age').textContent = 'weather source not configured';
        $('station-source').textContent = '';
        return;
      }

      // Flexible mapper: handles the normalized OpenWeather response as well
      // as common WeeWX/controller JSON field names.
      const temp = first(d, ['outTemp','temperature','temp','current.outTemp','current.temperature','current.temp_f','weather.temperature']);
      const feels = first(d, ['heatindex','heatIndex','feelsLike','appTemp','current.heatindex','current.feels_like','weather.feelsLike']);
      const rh = first(d, ['outHumidity','humidity','rh','current.outHumidity','current.humidity','weather.humidity']);
      const dew = first(d, ['dewpoint','dewPoint','current.dewpoint','current.dew_point','weather.dewPoint']);
      const wind = first(d, ['windSpeed','wind_speed','current.windSpeed','current.wind_mph','weather.windSpeed']);
      const dir = first(d, ['windDir','wind_direction','current.windDir','current.wind_dir','weather.windDir']);
      const rain = first(d, ['rain1hIn','dayRain','rain','rainToday','current.dayRain','current.rain','weather.dayRain']);
      const clouds = first(d, ['clouds','cloudiness','current.clouds']);
      const description = first(d, ['description','weatherDescription','current.description']);

      $('temp').textContent = fmtNum(temp,0);
      $('feels').textContent = `${fmtNum(feels ?? temp,0)}°`;
      $('rh').textContent = `${fmtNum(rh,0)}%`;
      $('dew').textContent = `${fmtNum(dew,0)}°`;
      $('wind').textContent = `${dir !== undefined ? fmtWindDir(dir) + ' ' : ''}${fmtNum(wind,0)}`.trim();
      $('rain').textContent = rain !== undefined ? fmtNum(rain,2) : '--';
      $('rain-label').textContent = d.source === 'OpenWeather' ? 'Rain 1h' : 'Rain';
      $('station-source').textContent = d.source ? `· ${d.source}` : '';
      $('weather-condition').textContent = [description, clouds !== undefined ? `Clouds ${fmtNum(clouds,0)}%` : ''].filter(Boolean).join(' · ');
      state.weatherUpdated = Number(d.observedAt || 0) || Date.now();
    } catch (e) {
      console.warn('Station:', e);
      $('station-age').textContent = 'weather offline';
    }
  }

  function fmtWindDir(v) {
    if (typeof v === 'string' && isNaN(Number(v))) return v;
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round((((n % 360) + 360) % 360) / 22.5) % 16];
  }

  async function refreshForecast() {
    try {
      const d = await getJSON('/api/forecast');
      const periods = d?.properties?.periods?.slice(0,3) || [];
      $('forecast').innerHTML = periods.map(p => `
        <div class="forecast-day">
          <div class="name">${escapeHtml(p.name || '')}</div>
          <div class="f-temp">${p.temperature ?? '--'}°</div>
          <div class="desc">${escapeHtml(p.shortForecast || '')}</div>
        </div>`).join('') || '<div class="muted">Forecast unavailable</div>';
    } catch (e) {
      console.warn('Forecast:', e);
      $('forecast').innerHTML = '<div class="muted">NWS unavailable</div>';
    }
  }

  async function refreshSpaceWeather() {
    try {
      const [kpData, fluxData, scales] = await Promise.all([
        getJSON('/api/space/kp'),
        getJSON('/api/space/flux'),
        getJSON('/api/space/scales')
      ]);
      const kpLast = Array.isArray(kpData) ? kpData[kpData.length - 1] : kpData;
      const kp = Number(kpLast?.kp_index ?? kpLast?.Kp ?? kpLast?.kp);
      const fluxObj = Array.isArray(fluxData) ? fluxData[fluxData.length - 1] : fluxData;
      const flux = Number(fluxObj?.flux ?? fluxObj?.Flux);
      const nowScale = scales?.['0'] || scales?.[0] || {};
      $('kp').textContent = Number.isFinite(kp) ? kp.toFixed(1) : '--';
      $('sfi').textContent = Number.isFinite(flux) ? flux.toFixed(0) : '--';
      $('r-scale').textContent = `R${nowScale?.R?.Scale ?? '-'}`;
      $('s-scale').textContent = `S${nowScale?.S?.Scale ?? '-'}`;
      $('g-scale').textContent = `G${nowScale?.G?.Scale ?? '-'}`;
      $('hf-condition').textContent = hfCondition(kp, flux);
      state.spaceUpdated = Date.now();
    } catch (e) {
      console.warn('Space weather:', e);
      $('space-age').textContent = 'SWPC unavailable';
    }
  }

  function hfCondition(kp, flux) {
    if (!Number.isFinite(kp) || !Number.isFinite(flux)) return '--';
    if (kp >= 7) return 'POOR';
    if (kp >= 5) return 'DISTURBED';
    if (flux >= 160 && kp <= 3) return 'VERY GOOD';
    if (flux >= 120 && kp <= 4) return 'GOOD';
    return kp <= 3 ? 'FAIR' : 'VARIABLE';
  }

  async function refreshRadar() {
    try {
      const d = await getJSON('/api/radar');
      const past = d?.radar?.past || [];
      if (!past.length || !d.host) throw new Error('No radar frames');
      const frames = past.slice(-6).map(f => ({ host:d.host, ...f }));
      const newKey = frames.map(f => f.path).join('|');
      const oldKey = state.radarFrames.map(f => f.path).join('|');
      if (newKey === oldKey && state.radarLayers.length) return;
      await prepareRadarFrames(frames);
    } catch (e) {
      console.warn('Radar:', e);
    }
  }

  function waitForLayerLoad(layer, timeoutMs = 7000) {
    return new Promise(resolve => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      };
      layer.once('load', () => finish(true));
      // tileerror may still leave most visible tiles loaded, so let the normal
      // load event or timeout decide rather than treating one missing tile as fatal.
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  async function prepareRadarFrames(frames) {
    const generation = ++state.radarGeneration;
    const newLayers = [];
    const ready = new Array(frames.length).fill(false);
    const loadPromises = [];

    // Preload every animation frame while the currently-visible radar frame
    // remains untouched. Animation later switches only between loaded layers,
    // eliminating the clear/recreate flash seen in earlier versions.
    frames.forEach((f, i) => {
      const url = `${f.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`;
      const layer = L.tileLayer(url, {
        opacity: 0,
        maxZoom: 7,
        maxNativeZoom: 7,
        zIndex: 300,
        updateWhenIdle: false,
        updateWhenZooming: false,
        keepBuffer: 6,
        className: 'radar-frame'
      });
      newLayers.push(layer);
      layer.addTo(state.layers.radar);
      loadPromises.push(waitForLayerLoad(layer).then(ok => { ready[i] = ok; return ok; }));
    });

    // Start as soon as the first frame is actually ready; do not wait for a
    // slow tile in every frame. Give the preload a short head start first.
    await Promise.race([
      Promise.all(loadPromises),
      new Promise(resolve => setTimeout(resolve, 2200))
    ]);
    if (generation !== state.radarGeneration) {
      newLayers.forEach(l => state.layers.radar.removeLayer(l));
      return;
    }

    // If the first frame has not loaded, choose the first loaded frame. If none
    // have loaded yet, wait for the complete preload/fallback timers to finish.
    if (!ready.some(Boolean)) await Promise.all(loadPromises);
    if (generation !== state.radarGeneration) return;
    let firstReady = ready.findIndex(Boolean);
    if (firstReady < 0) {
      newLayers.forEach(l => state.layers.radar.removeLayer(l));
      console.warn('Radar frames did not preload');
      return;
    }

    const oldLayers = state.radarLayers.slice();
    const oldCurrent = state.radarCurrentLayer;
    state.radarFrames = frames;
    state.radarLayers = newLayers;
    state.radarReady = ready;
    state.radarIndex = firstReady;
    state.radarCurrentLayer = newLayers[firstReady];
    state.radarCurrentLayer.setOpacity(0.72);

    // Cross-fade off the old frame only after the replacement is visible.
    if (oldCurrent && oldCurrent !== state.radarCurrentLayer) oldCurrent.setOpacity(0);
    setTimeout(() => oldLayers.forEach(l => {
      if (!newLayers.includes(l) && state.layers.radar.hasLayer(l)) state.layers.radar.removeLayer(l);
    }), 350);

    scheduleNextRadarFrame();
  }

  function scheduleNextRadarFrame() {
    clearTimeout(state.radarTimer);
    if (!state.radarLayers.length) return;
    const newest = state.radarIndex === state.radarLayers.length - 1;
    const delay = newest ? 2800 : 1400;
    state.radarTimer = setTimeout(() => {
      showNextReadyRadarFrame();
      scheduleNextRadarFrame();
    }, delay);
  }

  function showNextReadyRadarFrame() {
    if (!state.radarLayers.length || !state.map.hasLayer(state.layers.radar)) return;
    const count = state.radarLayers.length;
    let nextIndex = -1;
    for (let step = 1; step <= count; step++) {
      const idx = (state.radarIndex + step) % count;
      if (state.radarReady[idx]) { nextIndex = idx; break; }
    }
    if (nextIndex < 0 || nextIndex === state.radarIndex) return;

    const oldLayer = state.radarCurrentLayer;
    const nextLayer = state.radarLayers[nextIndex];
    nextLayer.setOpacity(0.72);
    if (oldLayer && oldLayer !== nextLayer) oldLayer.setOpacity(0);
    state.radarCurrentLayer = nextLayer;
    state.radarIndex = nextIndex;
  }

  function drawRadarFrame() {
    // Kept for layer-toggle compatibility. Frames are already preloaded; this
    // simply ensures the current ready frame is visible when RADAR is re-enabled.
    if (state.radarCurrentLayer) state.radarCurrentLayer.setOpacity(0.72);
  }

  async function refreshLightning() {
    try {
      const geo = await getJSON('/api/lightning');
      state.layers.lightning.clearLayers();
      if (!geo?.features?.length) return;
      for (const ft of geo.features.slice(-1500)) {
        if (ft?.geometry?.type !== 'Point') continue;
        const [lon,lat] = ft.geometry.coordinates || [];
        if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) continue;
        const ageMin = Number(ft.properties?.ageMinutes ?? ft.properties?.age_min ?? 0);
        const radius = ageMin < 2 ? 5 : ageMin < 10 ? 3 : 2;
        L.circleMarker([lat,lon], { radius, weight:1, color:'#ffe15b', fillColor:'#fff7b0', fillOpacity:.85, opacity:.9 })
          .bindTooltip(`Lightning ${ageMin ? ageMin + ' min ago' : ''}`)
          .addTo(state.layers.lightning);
      }
    } catch (e) { console.warn('Lightning:', e); }
  }

  function setISSStatus(text, bad = false) {
    const el = $('iss-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
  }

  function splitTrackAtDateline(points) {
    const segments=[[]];
    let prevLon=null;
    for (const p of Array.isArray(points) ? points : []) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const lat=Number(p[0]), lon=Number(p[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (prevLon !== null && Math.abs(lon-prevLon) > 180) segments.push([]);
      segments[segments.length-1].push([lat,lon]);
      prevLon=lon;
    }
    return segments;
  }

  function renderISSState(d) {
    if (!d || d.ok !== true) {
      setISSStatus(`ISS DATA ERROR · ${d?.error || 'tracker unavailable'}`, true);
      return;
    }
    const lat=Number(d.lat), lon=Number(d.lon), alt=Number(d.altKm), dist=Number(d.distanceKm);
    if (![lat,lon,alt].every(Number.isFinite)) {
      setISSStatus('ISS DATA ERROR · invalid propagated coordinates', true);
      return;
    }

    state.issUpdated = Number(d.updatedAt) || Date.now();
    state.layers.iss.clearLayers();
    const icon=L.divIcon({className:'',html:'<div class="iss-icon">🛰️</div>',iconSize:[26,26],iconAnchor:[13,13]});
    L.marker([lat,lon],{icon,zIndexOffset:1000}).bindTooltip(`ISS · ${alt.toFixed(0)} km`).addTo(state.layers.iss);

    state.layers.footprint.clearLayers();
    const groundRadiusKm=Number(d.footprintKm);
    if (Number.isFinite(groundRadiusKm) && groundRadiusKm > 0) {
      L.circle([lat,lon],{radius:groundRadiusKm*1000,weight:1,color:'#d8c4ff',dashArray:'5 7',fillColor:'#b79cff',fillOpacity:.035,opacity:.8}).addTo(state.layers.footprint);
    }

    const sig=JSON.stringify(d.track || []);
    if (sig !== state.issTrackSignature) {
      state.layers.issTrack.clearLayers();
      for (const seg of splitTrackAtDateline(d.track)) {
        if (seg.length > 1) L.polyline(seg,{color:'#d8c4ff',weight:2,opacity:.8,dashArray:'2 7'}).addTo(state.layers.issTrack);
      }
      state.issTrackSignature=sig;
    }

    $('iss-alt').textContent=alt.toFixed(0);
    $('iss-latlon').textContent=`${lat.toFixed(1)}°, ${lon.toFixed(1)}°`;
    $('iss-distance').textContent=Number.isFinite(dist) ? Math.round(dist).toLocaleString() : Math.round(haversineKm(state.config.lat,state.config.lon,lat,lon)).toLocaleString();
    const fmt=escapeHtml(d.sourceFormat || 'orbit data');
    const age=d.sourceFetchedAt ? ageText(Number(d.sourceFetchedAt)) : 'live';
    setISSStatus(`SERVER PROPAGATION · ${fmt} · ${age}` + (d.warning ? ` · ${d.warning}` : ''));
  }

  async function refreshISSState() {
    try {
      const d=await getJSON(freshApiUrl('/api/iss/state'),5000);
      renderISSState(d);
    } catch (e) {
      setISSStatus(`ISS DATA ERROR · ${e.message}`, true);
      console.warn('ISS state:',e);
    }
  }

  function haversineKm(lat1,lon1,lat2,lon2) {
    const R=6371, toRad=x=>x*Math.PI/180;
    const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
    const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }


  function maidenheadToLatLon(grid) {
    const g=String(grid||'').trim().toUpperCase();
    if (g.length<4 || !/^[A-R]{2}[0-9]{2}/.test(g)) return null;
    let lon=(g.charCodeAt(0)-65)*20-180, lat=(g.charCodeAt(1)-65)*10-90;
    lon+=Number(g[2])*2; lat+=Number(g[3]);
    let lonSize=2, latSize=1;
    if (g.length>=6 && /^[A-X]{2}$/.test(g.slice(4,6))) {
      lon+=(g.charCodeAt(4)-65)*(2/24); lat+=(g.charCodeAt(5)-65)*(1/24);
      lonSize=2/24; latSize=1/24;
    }
    return [lat+latSize/2, lon+lonSize/2];
  }

  function prefixLatLon(call) {
    const c=String(call||'').toUpperCase().replace(/[^A-Z0-9/]/g,'');
    const table=[
      [/^3D2/,-17.8,178.1],[/^KH6/,20.8,-157.3],[/^KL7/,64.2,-152.5],[/^JA/,36.2,138.2],[/^J[HIKN]/,36.2,138.2],
      [/^VK/,-25.3,133.8],[/^ZL/,-41.3,174.8],[/^DL/,51.1,10.4],[/^D[A-R]/,51.1,10.4],[/^G/,52.4,-1.5],[/^M/,52.4,-1.5],
      [/^F/,46.2,2.2],[/^I/,42.8,12.5],[/^EA/,40.4,-3.7],[/^CT/,39.6,-8.0],[/^PA/,52.1,5.3],[/^ON/,50.8,4.5],
      [/^SM/,62.0,15.0],[/^LA/,61.0,8.0],[/^OH/,64.0,26.0],[/^OZ/,56.0,10.0],[/^SP/,52.0,19.1],[/^OK/,49.8,15.5],
      [/^OM/,48.7,19.7],[/^HA/,47.1,19.5],[/^YU/,44.0,21.0],[/^SV/,39.1,22.9],[/^TA/,39.0,35.0],[/^4X/,31.5,34.8],
      [/^ZS/,-30.7,22.9],[/^PY/,-14.2,-51.9],[/^LU/,-38.4,-63.6],[/^CX/,-32.5,-55.8],[/^CE/,-33.4,-70.7],
      [/^VE/,56.1,-106.3],[/^V[EOY]/,56.1,-106.3],[/^XE/,23.6,-102.5],[/^KP4/,18.2,-66.5],[/^HI/,18.7,-70.2],
      [/^[KNW][0-9]/,39.0,-98.0]
    ];
    for(const [re,lat,lon] of table) if(re.test(c)) return [lat,lon];
    return null;
  }

  function spotLatLon(s) {
    const lat=Number(first(s,['lat','latitude','dx_lat','dxLat']));
    const lon=Number(first(s,['lon','lng','longitude','dx_lon','dxLon']));
    if (Number.isFinite(lat)&&Number.isFinite(lon)) return [lat,lon];
    return maidenheadToLatLon(first(s,['grid','grid6','locator','dxGrid','dx_grid','dx_locator'])) || prefixLatLon(first(s,['spotted','dx','call','callsign','dxCall']));
  }

  function freqBand(freq) {
    let f=Number(freq); if (!Number.isFinite(f)) return '';
    if (f>1000000) f/=1000; // Hz -> kHz
    const b=[[1800,2000,'160m'],[3500,4000,'80m'],[5330,5410,'60m'],[7000,7300,'40m'],[10100,10150,'30m'],[14000,14350,'20m'],[18068,18168,'17m'],[21000,21450,'15m'],[24890,24990,'12m'],[28000,29700,'10m'],[50000,54000,'6m'],[144000,148000,'2m']];
    return (b.find(x=>f>=x[0]&&f<=x[1])||[])[2]||'';
  }

  function formatFreq(freq) {
    const n = Number(freq);
    if (!Number.isFinite(n)) return String(freq || '');
    if (n >= 1000) return n.toFixed(n % 1 ? 1 : 0);
    return n.toFixed(n % 1 ? 1 : 0);
  }

  function spotAgeLabel(ts) {
    if (!ts) return '';
    let t = Number(ts);
    if (!Number.isFinite(t)) {
      const parsed = Date.parse(ts);
      if (!Number.isFinite(parsed)) return '';
      t = parsed;
    }
    if (t < 1e12) t *= 1000;
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    return `${Math.floor(min / 60)}h`;
  }

  function renderRecentDX(spots) {
    const host = $('dx-recent');
    if (!host) return;
    const rows = (spots || []).slice(0,10).map(s => {
      const call = first(s,['spotted','dx','call','callsign','dxCall']) || 'DX';
      const freq = first(s,['frequency','freq','qrg']) || '';
      const mode = first(s,['mode']) || '';
      const detail = [formatFreq(freq), mode].filter(Boolean).join(' · ');
      return `<div class="recent-spot-row"><b>${escapeHtml(call)}</b><span>${escapeHtml(detail)}</span></div>`;
    });
    host.innerHTML = rows.length ? rows.join('') : '<div class="spot-empty">No recent DX spots</div>';
  }

  function potaTimestamp(s) {
    return first(s,['spotTime','timestamp','time','updated','updatedAt','createdAt','dateTime']);
  }

  function renderRecentPOTA(spots) {
    const host = $('pota-recent');
    if (!host) return;
    const sorted = [...(spots || [])].sort((a,b) => {
      const ta = Date.parse(potaTimestamp(a) || '') || Number(first(a,['timestamp','time'])) || 0;
      const tb = Date.parse(potaTimestamp(b) || '') || Number(first(b,['timestamp','time'])) || 0;
      return tb - ta;
    });
    const rows = sorted.slice(0,10).map(s => {
      const call = first(s,['activator','call']) || 'POTA';
      const ref = first(s,['reference','park']) || '';
      const freq = first(s,['frequency','freq']) || '';
      const mode = first(s,['mode']) || '';
      const detail = [ref, formatFreq(freq), mode].filter(Boolean).join(' · ');
      return `<div class="recent-spot-row"><b>${escapeHtml(call)}</b><span>${escapeHtml(detail)}</span></div>`;
    });
    host.innerHTML = rows.length ? rows.join('') : '<div class="spot-empty">No recent POTA spots</div>';
  }

  async function refreshDXSpots() {
    try {
      const raw=await getJSON(freshApiUrl('/api/dx'));
      const spots=Array.isArray(raw)?raw:(raw?.data||raw?.spots||[]);
      if(raw && !Array.isArray(raw) && raw.connected===false && raw.error) $('spot-ticker').textContent=`DX cluster: ${raw.error}`;
      state.layers.dxSpots.clearLayers();
      let mapped=0;
      for (const s of spots.slice(0,250)) {
        const ll=spotLatLon(s); if(!ll) continue;
        const call=first(s,['spotted','dx','call','callsign','dxCall'])||'DX';
        const freq=first(s,['frequency','freq','qrg']);
        const band=first(s,['band'])||freqBand(freq);
        L.circleMarker(ll,{radius:4,weight:1,color:'#7ee7ff',fillColor:'#44badc',fillOpacity:.78,opacity:.9})
          .bindTooltip(`${escapeHtml(call)} ${band||''} ${freq||''}`)
          .addTo(state.layers.dxSpots); mapped++;
      }
      $('dx-count').textContent=String(spots.length||mapped);
      renderRecentDX(spots);
      const s=spots[0]; if(s) $('spot-ticker').textContent=`${raw?.connected?'● ':''}DX ${first(s,['spotted','dx','call','callsign'])||''} ${first(s,['frequency','freq','qrg'])||''} ${first(s,['message','comment','mode'])||''}`.trim(); else if(raw?.connected) $('spot-ticker').textContent=`● ${raw.host||'DX cluster'} connected · waiting for spots`;
    } catch(e){console.warn('DX spots:',e);$('dx-count').textContent='--'; if($('dx-recent')) $('dx-recent').innerHTML='<div class="spot-empty">DX feed unavailable</div>';}
  }

  async function refreshPOTA() {
    try {
      const raw=await getJSON(freshApiUrl('/api/pota')); const spots=Array.isArray(raw)?raw:(raw?.data||[]);
      state.layers.pota.clearLayers(); let mapped=0;
      for (const s of spots.slice(0,300)) {
        const ll=maidenheadToLatLon(first(s,['grid6','grid','locator'])); if(!ll) continue;
        const call=first(s,['activator','call'])||'POTA'; const ref=first(s,['reference','park'])||''; const freq=first(s,['frequency','freq'])||'';
        L.circleMarker(ll,{radius:4,weight:1,color:'#ffe36e',fillColor:'#f1c94b',fillOpacity:.82,opacity:.95})
          .bindTooltip(`${escapeHtml(call)} · ${escapeHtml(ref)} · ${freq}`)
          .addTo(state.layers.pota); mapped++;
      }
      $('pota-count').textContent=String(spots.length||mapped);
      renderRecentPOTA(spots);
    } catch(e){console.warn('POTA:',e);$('pota-count').textContent='--'; if($('pota-recent')) $('pota-recent').innerHTML='<div class="spot-empty">POTA feed unavailable</div>';}
  }

  async function refreshPSK() {
    try {
      const xml=await getText('/api/psk',20000); const doc=new DOMParser().parseFromString(xml,'application/xml');
      const reports=[...doc.querySelectorAll('receptionReport')]; state.layers.pskPaths.clearLayers(); let n=0;
      for (const r of reports.slice(-120)) {
        const tx=maidenheadToLatLon(r.getAttribute('senderLocator')); const rx=maidenheadToLatLon(r.getAttribute('receiverLocator'));
        if(!tx||!rx) continue;
        const f=Number(r.getAttribute('frequency')); const mode=r.getAttribute('mode')||''; const sc=r.getAttribute('senderCallsign')||''; const rc=r.getAttribute('receiverCallsign')||'';
        L.polyline([tx,rx],{color:'#ff77df',weight:1,opacity:.42,className:'psk-path'}).bindTooltip(`${sc} → ${rc} ${freqBand(f)} ${mode}`).addTo(state.layers.pskPaths); n++;
      }
      $('psk-count').textContent=String(n);
    } catch(e){console.warn('PSKReporter:',e);$('psk-count').textContent='--';}
  }

  function parseTleSet(text) {
    const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean), out=[];
    for(let i=0;i<lines.length-2;i++) if(!/^1 /.test(lines[i]) && /^1 /.test(lines[i+1]) && /^2 /.test(lines[i+2])) {
      try { out.push({name:lines[i],satrec:satellite.twoline2satrec(lines[i+1],lines[i+2])}); } catch(_){} i+=2;
    }
    return out;
  }

  async function refreshAmateurSatData() {
    try {
      state.amateurSatRecs=parseTleSet(await getText(freshApiUrl('/api/amateur/tle'),20000));
      $('sat-count').textContent=String(state.amateurSatRecs.length);
      updateAmateurSats();
      try {
        const meta=await getJSON(freshApiUrl('/api/amateur/status'),8000);
        if(meta?.warning) console.warn('AMSAT active filter:',meta.warning);
        else console.log(`AMSAT active filter: ${meta?.activeTleCount ?? state.amateurSatRecs.length} orbital matches from ${meta?.activeReports ?? '--'} active satellites in ${meta?.hours ?? '--'}h`);
      } catch(_) {}
    }
    catch(e){console.warn('Amateur sats:',e);$('sat-count').textContent='--';state.layers.amateurSat.clearLayers();}
  }

  function updateAmateurSats() {
    if(!state.amateurSatRecs.length) return; state.layers.amateurSat.clearLayers(); const now=new Date(), gmst=satellite.gstime(now), pts=[];
    for(const s of state.amateurSatRecs){try{const pv=satellite.propagate(s.satrec,now);if(!pv.position)continue;const gd=satellite.eciToGeodetic(pv.position,gmst);const lat=satellite.degreesLat(gd.latitude),lon=satellite.degreesLong(gd.longitude);pts.push({...s,lat,lon,alt:gd.height,dist:haversineKm(state.config.lat,state.config.lon,lat,lon)});}catch(_){}}
    pts.sort((a,b)=>a.dist-b.dist);
    for(const s of pts.slice(0,45)) {
      const icon=L.divIcon({className:'',html:'<div class="satellite-icon">🛰</div>',iconSize:[18,18],iconAnchor:[9,9]});
      L.marker([s.lat,s.lon],{icon,zIndexOffset:540}).bindTooltip(`${escapeHtml(s.name)} · ${s.alt.toFixed(0)} km`).addTo(state.layers.amateurSat);
    }
  }

  async function refreshAurora() {
    try {
      const d=await getJSON('/api/space/aurora',20000); const coords=d?.coordinates||d?.data||[]; state.layers.aurora.clearLayers();
      let stride=Math.max(1,Math.ceil(coords.length/2500)); let shown=0;
      for(let i=0;i<coords.length;i+=stride){const c=coords[i]; if(!Array.isArray(c)||c.length<3)continue; const lon=Number(c[0]),lat=Number(c[1]),p=Number(c[2]); if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(p)||p<12)continue; const op=Math.min(.65,.10+p/150); L.circleMarker([lat,lon],{radius:3,stroke:false,fillColor:p>60?'#ffef76':p>35?'#7dff8c':'#60d5ff',fillOpacity:op}).addTo(state.layers.aurora);shown++;}
    } catch(e){console.warn('Aurora:',e);}
  }

  async function refreshEarthquakes() {
    try {
      const d = await getJSON('/api/earthquakes', 20000);
      const features = Array.isArray(d?.features) ? d.features : [];
      state.layers.earthquakes.clearLayers();
      for (const f of features.slice(0,600)) {
        const c = f?.geometry?.coordinates;
        if (!Array.isArray(c) || c.length < 2) continue;
        const lon=Number(c[0]), lat=Number(c[1]), depth=Number(c[2]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const mag=Number(f?.properties?.mag);
        const m=Number.isFinite(mag)?mag:0;
        const radius=Math.max(3,Math.min(15,2.2+m*1.7));
        const color=m>=6?'#ff4e55':m>=5?'#ff8b4e':m>=4?'#ffd45a':'#ffe9a8';
        const place=escapeHtml(f?.properties?.place||'Earthquake');
        const when=Number(f?.properties?.time);
        const age=Number.isFinite(when)?ageText(when):'';
        L.circleMarker([lat,lon],{radius,weight:1,color,fillColor:color,fillOpacity:.42,opacity:.95})
          .bindTooltip(`M${m.toFixed(1)} · ${place}${Number.isFinite(depth)?` · ${depth.toFixed(0)} km deep`:''}${age?` · ${age}`:''}`)
          .addTo(state.layers.earthquakes);
      }
    } catch(e) { console.warn('Earthquakes:',e); }
  }

  class AircraftCanvasLayer extends L.Layer {
    constructor(points = []) {
      super();
      this.points = points;
      this._redraw = this._redraw.bind(this);
    }
    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', 'aircraft-canvas-layer leaflet-layer');
      this._canvas.style.position = 'absolute';
      this._canvas.style.pointerEvents = 'none';
      map.getPanes().overlayPane.appendChild(this._canvas);
      map.on('moveend zoomend resize viewreset', this._redraw);
      this._redraw();
    }
    onRemove(map) {
      map.off('moveend zoomend resize viewreset', this._redraw);
      if (this._canvas?.parentNode) this._canvas.parentNode.removeChild(this._canvas);
      this._canvas = null;
      this._map = null;
    }
    _redraw() {
      if (!this._map || !this._canvas) return;
      const size = this._map.getSize();
      const topLeft = this._map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(this._canvas, topLeft);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this._canvas.width = Math.max(1, Math.round(size.x * dpr));
      this._canvas.height = Math.max(1, Math.round(size.y * dpr));
      this._canvas.style.width = `${size.x}px`;
      this._canvas.style.height = `${size.y}px`;
      const ctx = this._canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      for (const a of this.points) {
        const pt = this._map.latLngToContainerPoint([a.lat, a.lon]);
        if (pt.x < -10 || pt.y < -10 || pt.x > size.x + 10 || pt.y > size.y + 10) continue;
        const heading = Number.isFinite(a.heading) ? a.heading : 0;
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(heading * Math.PI / 180);
        ctx.beginPath();
        // Small airplane silhouette, nose points north at heading 0.
        ctx.moveTo(0, -6.5);
        ctx.lineTo(1.6, -1.8);
        ctx.lineTo(6.2, 1.0);
        ctx.lineTo(6.2, 2.6);
        ctx.lineTo(1.7, 1.7);
        ctx.lineTo(1.0, 5.7);
        ctx.lineTo(2.5, 6.7);
        ctx.lineTo(2.5, 7.5);
        ctx.lineTo(0, 6.8);
        ctx.lineTo(-2.5, 7.5);
        ctx.lineTo(-2.5, 6.7);
        ctx.lineTo(-1.0, 5.7);
        ctx.lineTo(-1.7, 1.7);
        ctx.lineTo(-6.2, 2.6);
        ctx.lineTo(-6.2, 1.0);
        ctx.lineTo(-1.6, -1.8);
        ctx.closePath();
        ctx.fillStyle = a.color || '#8ee7ff';
        ctx.strokeStyle = 'rgba(0,0,0,.80)';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function aircraftArray(raw) {
    if (Array.isArray(raw?.ac)) return raw.ac;
    if (Array.isArray(raw?.aircraft)) return raw.aircraft;
    if (Array.isArray(raw?.states)) return raw.states;
    return [];
  }

  async function refreshAirTraffic() {
    if (state.config.airTraffic?.enabled === false) {
      const st=$('air-source-status'); if(st) st.textContent='AIR · DISABLED';
      return;
    }
    try {
      const raw=await getJSON(freshApiUrl('/api/aircraft'),30000);
      const aircraft=aircraftArray(raw);
      const isWorld=String(raw?.mode||state.config.airTraffic?.mode||'').toLowerCase()==='worldwide' || /opensky/i.test(String(raw?.source||''));
      const st=$('air-source-status');
      if(st) st.textContent=`AIR · ${Number(raw?.count??aircraft.length).toLocaleString()} · ${isWorld?'WORLD · OPENSKY':String(raw?.source||'source').toUpperCase()}`;
      state.layers.airTraffic.clearLayers();

      // Worldwide snapshots can contain many thousands of aircraft. Keep them on one
      // HTML canvas so the map can use actual airplane silhouettes without creating
      // thousands of DOM marker elements (important for Raspberry Pi performance).
      const maxPlot=isWorld?18000:1000;
      const stride=Math.max(1,Math.ceil(aircraft.length/maxPlot));
      const worldPlanes=[];
      let plotted=0;
      for (let i=0;i<aircraft.length;i+=stride) {
        const a=aircraft[i];
        let lat,lon,call,alt,gs,track,reg,type,country,onGround;
        if (Array.isArray(a)) {
          call=String(a[1]||'').trim(); lon=Number(a[5]); lat=Number(a[6]); alt=Number(a[7]); gs=Number(a[9]); track=Number(a[10]); country=a[2]||''; onGround=!!a[8];
        } else {
          lat=Number(a.lat); lon=Number(a.lon); call=String(a.flight||a.callsign||'').trim();
          alt=a.alt_baro ?? a.altitude ?? a.alt_geom; gs=a.gs ?? a.speed; track=Number(a.track ?? a.heading);
          reg=a.r || a.registration || ''; type=a.t || a.type || ''; country=a.country||''; onGround=!!a.on_ground;
        }
        if (!Number.isFinite(lat)||!Number.isFinite(lon)) continue;
        const altN=Number(alt), speedN=Number(gs), hdg=Number.isFinite(track)?track:0;
        const altText=onGround||alt==='ground'?'ground':(Number.isFinite(altN)?`${Math.round(altN).toLocaleString()} ft`:'');
        const speedText=Number.isFinite(speedN)?`${Math.round(speedN)} kt`:'';
        const label=[call||reg||'Aircraft',type,country,altText,speedText].filter(Boolean).join(' · ');
        if (isWorld) {
          const fill=onGround?'#c8d0d9':(!Number.isFinite(altN)?'#63d6ff':altN>=30000?'#ffe46b':altN>=10000?'#62d9ff':'#7ef08b');
          worldPlanes.push({lat,lon,heading:hdg,color:fill,label});
        } else {
          const icon=L.divIcon({className:'',html:`<div class="aircraft-icon" style="transform:rotate(${hdg}deg)">✈</div>`,iconSize:[18,18],iconAnchor:[9,9]});
          L.marker([lat,lon],{icon,zIndexOffset:600}).bindTooltip(escapeHtml(label)).addTo(state.layers.airTraffic);
        }
        plotted++;
      }
      if (isWorld && worldPlanes.length) {
        state.layers.airTraffic.addLayer(new AircraftCanvasLayer(worldPlanes));
      }
      if(st && plotted<aircraft.length) st.textContent += ` · ${plotted.toLocaleString()} plotted`;
      if(raw?.warning) console.warn('Air traffic upstream:',raw.warning);
    } catch(e) {
      const st=$('air-source-status'); if(st) st.textContent='AIR · ERROR';
      console.warn('Air traffic:',e);
    }
  }

  function featureTimestampMs(props={}) {
    for (const k of ['time','timestamp','updatedAt','updated','date']) {
      const v=props[k]; if(v===undefined||v===null||v==='') continue;
      if (typeof v==='number') return v>1e12?v:v*1000;
      const n=Number(v); if(Number.isFinite(n)) return n>1e12?n:n*1000;
      const t=Date.parse(v); if(Number.isFinite(t)) return t;
    }
    return NaN;
  }

  async function refreshCarriers() {
    if (state.config.carriers?.enabled === false) {
      const st=$('carrier-source-status'); if(st) st.textContent='CARRIERS · DISABLED';
      return;
    }
    try {
      const d=await getJSON(freshApiUrl('/api/carriers'),20000);
      const features=Array.isArray(d?.features)?d.features:[];
      const st=$('carrier-source-status');
      if(st) st.textContent=d?.counts?`CARRIERS · ${features.length} · ${d.counts.deployed} DEPLOYED`:`CARRIERS · ${features.length} · ${d?.source?.includes('USNI')?'USNI':'CUSTOM'}`;
      state.layers.carriers.clearLayers();
      const maxAge=Number(state.config.carriers?.maxAgeHours||336)*3600000;
      for (const f of features.slice(0,100)) {
        const c=f?.geometry?.coordinates;
        if (f?.geometry?.type!=='Point'||!Array.isArray(c)||c.length<2) continue;
        let lon=Number(c[0]),lat=Number(c[1]); if(!Number.isFinite(lat)||!Number.isFinite(lon)) continue;
        const t=featureTimestampMs(f.properties||{}); if(Number.isFinite(t)&&Date.now()-t>maxAge) continue;
        // Deliberately coarse. Built-in USNI data is region-level, not precise live tracking.
        lat=Math.round(lat); lon=Math.round(lon);
        const name=f?.properties?.name||f?.properties?.ship||f?.properties?.callsign||'Carrier';
        const hull=f?.properties?.hull||'';
        const region=f?.properties?.region||f?.properties?.area||'';
        const status=f?.properties?.status||'';
        const category=f?.properties?.category|| (f?.properties?.deployed?'deployed':'reference');
        const icon=L.divIcon({className:'',html:`<div class="carrier-icon ${escapeHtml(category)}">CVN</div>`,iconSize:[28,18],iconAnchor:[14,9]});
        L.marker([lat,lon],{icon,zIndexOffset:category==='deployed'?650:500}).bindTooltip(`${escapeHtml(name)}${hull?` · ${escapeHtml(hull)}`:''}${region?` · ${escapeHtml(region)}`:''}${status?` · ${escapeHtml(status)}`:''} · public/approx.`).addTo(state.layers.carriers);
      }
      if(d?.warning) console.warn('Carrier source:',d.warning);
    } catch(e) {
      const st=$('carrier-source-status'); if(st) st.textContent='CARRIERS · ERROR';
      console.warn('Carrier activity:',e);
    }
  }

  async function healthCheck() {
    try {
      const d = await getJSON('/api/health', 5000);
      if (!d.ok) throw new Error('not ok');
      state.lastHealth = Date.now();
      $('health-dot').className = 'dot ok';
      $('health-text').textContent = `NODE-RED OK${d.version ? ` · v${d.version}` : ''}`;
    } catch (e) {
      $('health-dot').className = 'dot bad';
      $('health-text').textContent = 'NODE-RED OFFLINE';
      if (Date.now() - state.lastHealth > 120000) location.reload();
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }


  const ENV_SETTINGS = [
    'TZ','STATION_CALL','STATION_NAME','STATION_LAT','STATION_LON','STATION_ELEV_M',
    'WEEWX_JSON_URL','LIGHTNING_GEOJSON_URL','OPENWEATHER_API_KEY',
    'EARTHQUAKE_MIN_MAG','EARTHQUAKE_MAX_AGE_HOURS','AIR_TRAFFIC_ENABLED','AIR_TRAFFIC_MODE','AIR_TRAFFIC_JSON_URL','AIR_TRAFFIC_RADIUS_NM','AIR_TRAFFIC_REFRESH_SEC','OPENSKY_CLIENT_ID','OPENSKY_CLIENT_SECRET','CARRIER_ENABLED','CARRIER_GEOJSON_URL','CARRIER_REFRESH_HOURS','CARRIER_MAX_AGE_HOURS',
    'DX_CLUSTER_ENABLED','DX_CLUSTER_HOST','DX_CLUSTER_PORT','DX_CLUSTER_CALL','DX_CLUSTER_MAX_AGE_MIN',
    'ISS_TLE_URL','POTA_SPOTS_URL','PSKREPORTER_SECONDS','PSKREPORTER_LIMIT','AMSAT_ACTIVE_HOURS',
    'CITY1_LABEL','CITY1_TZ','CITY2_LABEL','CITY2_TZ','CITY3_LABEL','CITY3_TZ','CITY4_LABEL','CITY4_TZ','CITY5_LABEL','CITY5_TZ','CITY6_LABEL','CITY6_TZ','CITY7_LABEL','CITY7_TZ','CITY8_LABEL','CITY8_TZ'
  ];

  async function loadUiSettings() {
    const form = $('ui-settings-form');
    const status = $('ui-settings-status');
    if (!form || !status) return;
    status.textContent = 'Loading…';
    try {
      const d = await getJSON('/api/settings-config');
      for (const key of ENV_SETTINGS) {
        const el = form.elements.namedItem(key);
        if (el) el.value = d[key] ?? '';
      }
      status.textContent = 'Loaded';
    } catch (e) {
      status.textContent = `Load failed: ${e.message}`;
    }
  }

  async function saveUiSettings(event) {
    event.preventDefault();
    const form = $('ui-settings-form');
    const status = $('ui-settings-status');
    status.textContent = 'Saving…';
    const payload = {};
    for (const key of ENV_SETTINGS) {
      const el = form.elements.namedItem(key);
      if (el) payload[key] = el.value;
    }
    try {
      const r = await fetch('/api/settings-config', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(payload)
      });
      const out = await r.json();
      if (!r.ok || !out.ok) throw new Error(out.error || `${r.status}`);
      status.textContent = 'Saved. Applying…';
      setTimeout(() => location.reload(), 450);
    } catch (e) {
      status.textContent = `Save failed: ${e.message}`;
    }
  }

  async function resetUiSettings() {
    if (!confirm('Clear saved UI settings and fall back to .env / packaged defaults?')) return;
    const status = $('ui-settings-status');
    status.textContent = 'Resetting…';
    try {
      const r = await fetch('/api/settings-config', {
        method:'POST', headers:{'content-type':'application/json'}, body:'{}'
      });
      const out = await r.json();
      if (!r.ok || !out.ok) throw new Error(out.error || `${r.status}`);
      await loadUiSettings();
      status.textContent = 'Reset. Reloading…';
      setTimeout(() => location.reload(), 450);
    } catch (e) {
      status.textContent = `Reset failed: ${e.message}`;
    }
  }

  function initSettingsUi() {
    const dialog = $('settings-dialog');
    const form = $('ui-settings-form');
    if (!dialog || !form) return;
    $('open-settings').addEventListener('click', async () => {
      await loadUiSettings();
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open','');
    });
    $('close-settings').addEventListener('click', () => dialog.close ? dialog.close() : dialog.removeAttribute('open'));
    $('reload-ui-settings').addEventListener('click', loadUiSettings);
    $('reset-ui-settings').addEventListener('click', resetUiSettings);
    form.addEventListener('submit', saveUiSettings);
    $('toggle-key').addEventListener('click', () => {
      const key = $('owm-key');
      const showing = key.type === 'text';
      key.type = showing ? 'password' : 'text';
      $('toggle-key').textContent = showing ? 'SHOW' : 'HIDE';
    });
    dialog.addEventListener('click', e => {
      if (e.target === dialog) dialog.close();
    });
  }

  async function init() {
    await loadConfig();
    initSettingsUi();
    initCityClocks();
    initMap();
    updateClocks();
    setInterval(updateClocks,1000);

    await Promise.allSettled([
      refreshStation(), refreshForecast(), refreshSpaceWeather(), refreshRadar(), refreshLightning(), refreshEarthquakes(), refreshAirTraffic(), refreshCarriers(), refreshISSState(), refreshHamActivity(), refreshPSK(), refreshAmateurSatData(), refreshAurora(), healthCheck()
    ]);
    refreshISSState();

    setInterval(refreshISSState,2000);
    setInterval(updateAmateurSats,10000);
    setInterval(refreshRadar,5*60*1000);
    setInterval(refreshLightning,60*1000);
    setInterval(refreshEarthquakes,5*60*1000);
    setInterval(refreshAirTraffic,Math.max(60,Number(state.config.airTraffic?.refreshSec||900))*1000);
    setInterval(refreshCarriers,30*60*1000);
    setInterval(refreshStation,15*1000);
    setInterval(refreshForecast,30*60*1000);
    setInterval(refreshSpaceWeather,5*60*1000);
    setInterval(refreshDXSpots,15*1000);
    setInterval(refreshPOTA,60*1000);
    setInterval(refreshPSK,5*60*1000);
    setInterval(refreshAmateurSatData,15*60*1000);
    setInterval(refreshAurora,5*60*1000);
    setInterval(healthCheck,15*1000);

    // A normal browser reload, tab return, or window focus should immediately
    // repoll the live local DX cache and POTA feed rather than waiting for timers.
    window.addEventListener('pageshow', () => refreshHamActivity());
    window.addEventListener('focus', () => refreshHamActivity());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshHamActivity();
    });

    toast('ShackClock loaded');
  }

  window.addEventListener('error', e => console.error('ShackClock error:',e.error || e.message));
  init();
})();
