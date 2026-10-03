'use strict';

const fs = require('fs');
const mqtt = require('mqtt');

const VERSION = '1.1.4';
const CFG = '/data/shackclock-settings.json';
const CACHE = '/data/psk-mqtt-cache.json';
const BROKER = process.env.PSKREPORTER_MQTT_URL || 'mqtt://mqtt.pskreporter.info:1883';
const CONFIG_CHECK_MS = 5000;

let client = null;
let currentKey = '';
let currentTopic = '';
let currentCfg = null;
let spots = [];
let connected = false;
let lastMessageAt = 0;
let lastError = '';
let received = 0;
let accepted = 0;
let shuttingDown = false;

function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? fallback : v;
}

function readCfg() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch (_) {}
  const V = (k, d = '') => Object.prototype.hasOwnProperty.call(saved, k) ? saved[k] : env(k, d);
  const scope = String(V('PSKREPORTER_SCOPE', 'station')).toLowerCase() === 'global' ? 'global' : 'station';
  const band = String(V('PSKREPORTER_BAND', 'all')).trim().toLowerCase() || 'all';
  const mode = String(V('PSKREPORTER_MODE', '')).trim().toUpperCase();
  const lookbackSeconds = Math.max(60, Math.abs(Number(V('PSKREPORTER_SECONDS', '-3600')) || 3600));
  const limit = Math.min(1000, Math.max(20, Number(V('PSKREPORTER_LIMIT', '100')) || 100));
  return { scope, band, mode, lookbackSeconds, limit };
}

function topicFor(cfg) {
  // The full all-band feed is extremely high volume. For all-band Global mode,
  // use PSKReporter's documented 1% raw sample and apply any mode filter locally.
  if (cfg.band === 'all') return { topic: 'pskr/filter/v2raw_1pc/#', sampled: true };
  const mode = cfg.mode || '+';
  return { topic: `pskr/filter/v2/${cfg.band}/${mode}/#`, sampled: false };
}

function cacheObject() {
  const t = currentCfg ? topicFor(currentCfg) : { topic: '', sampled: false };
  return {
    ok: currentCfg?.scope === 'global',
    source: 'PSKReporter MQTT',
    helperVersion: VERSION,
    broker: BROKER,
    connected,
    scope: currentCfg?.scope || 'station',
    band: currentCfg?.band || 'all',
    mode: currentCfg?.mode || '',
    topic: currentTopic || t.topic,
    sampled: t.sampled,
    updatedAt: Date.now(),
    lastMessageAt,
    received,
    accepted,
    spotCount: spots.length,
    lastError,
    spots
  };
}

function writeCache() {
  try {
    const tmp = `${CACHE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cacheObject()));
    fs.renameSync(tmp, CACHE);
  } catch (e) {
    console.warn('[PSK MQTT] cache write failed:', e.message);
  }
}

function prune() {
  if (!currentCfg) return;
  const cutoff = Date.now() - currentCfg.lookbackSeconds * 1000;
  spots = spots.filter(s => Number(s.receivedAt || 0) >= cutoff);
  if (spots.length > currentCfg.limit) spots = spots.slice(-currentCfg.limit);
}

function normalizeSpot(raw) {
  const f = Number(raw?.f);
  const mode = String(raw?.md || '').trim().toUpperCase();
  const senderCallsign = String(raw?.sc || '').trim();
  const senderLocator = String(raw?.sl || '').trim();
  const receiverCallsign = String(raw?.rc || '').trim();
  const receiverLocator = String(raw?.rl || '').trim();
  const band = String(raw?.b || '').trim().toLowerCase();
  if (!Number.isFinite(f) || !senderCallsign || !receiverCallsign) return null;
  return {
    senderCallsign,
    senderLocator,
    receiverCallsign,
    receiverLocator,
    frequency: f,
    mode,
    report: Number.isFinite(Number(raw?.rp)) ? Number(raw.rp) : null,
    band,
    sequenceNumber: raw?.sq ?? null,
    flowStartSeconds: Number(raw?.t_tx || raw?.t || 0) || null,
    receivedAt: Date.now()
  };
}

function acceptSpot(spot) {
  if (!spot || !currentCfg || currentCfg.scope !== 'global') return false;
  if (currentCfg.band !== 'all' && spot.band && spot.band !== currentCfg.band) return false;
  if (currentCfg.mode && spot.mode !== currentCfg.mode) return false;
  return true;
}

function disconnect(reason = '') {
  if (client) {
    try { client.end(true); } catch (_) {}
    client = null;
  }
  connected = false;
  currentTopic = '';
  if (reason) lastError = reason;
  writeCache();
}

function connectFor(cfg) {
  const desired = topicFor(cfg);
  currentTopic = desired.topic;
  connected = false;
  lastError = '';
  received = 0;
  accepted = 0;
  spots = [];
  writeCache();

  console.log(`[PSK MQTT] connecting ${BROKER} · topic=${desired.topic}${desired.sampled ? ' · 1% sample' : ''}`);
  const c = mqtt.connect(BROKER, {
    protocolVersion: 4,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 15000,
    keepalive: 45,
    clientId: `shackclock-${process.pid}-${Date.now().toString(36)}`
  });
  client = c;

  c.on('connect', () => {
    if (c !== client) return;
    connected = true;
    lastError = '';
    c.subscribe(desired.topic, { qos: 0 }, err => {
      if (err) {
        lastError = `subscribe failed: ${err.message}`;
        console.warn('[PSK MQTT]', lastError);
      } else {
        console.log(`[PSK MQTT] subscribed ${desired.topic}`);
      }
      writeCache();
    });
  });

  c.on('message', (_topic, payload) => {
    if (c !== client) return;
    received++;
    lastMessageAt = Date.now();
    try {
      const raw = JSON.parse(payload.toString('utf8'));
      const spot = normalizeSpot(raw);
      if (acceptSpot(spot)) {
        accepted++;
        spots.push(spot);
        prune();
      }
      if (received % 10 === 0 || accepted <= 3) writeCache();
    } catch (e) {
      lastError = `message parse failed: ${e.message}`;
      if (received % 50 === 1) console.warn('[PSK MQTT]', lastError);
    }
  });

  c.on('reconnect', () => {
    if (c !== client) return;
    connected = false;
    writeCache();
  });

  c.on('offline', () => {
    if (c !== client) return;
    connected = false;
    writeCache();
  });

  c.on('close', () => {
    if (c !== client) return;
    connected = false;
    writeCache();
  });

  c.on('error', e => {
    if (c !== client) return;
    lastError = `${e.code ? `${e.code}: ` : ''}${e.message || e}`;
    console.warn('[PSK MQTT]', lastError);
    writeCache();
  });
}

function applyConfig() {
  const cfg = readCfg();
  const desired = topicFor(cfg);
  const key = `${cfg.scope}|${cfg.band}|${cfg.mode}|${cfg.lookbackSeconds}|${cfg.limit}|${desired.topic}`;
  if (key === currentKey) {
    prune();
    writeCache();
    return;
  }

  currentKey = key;
  currentCfg = cfg;
  if (client) disconnect();

  if (cfg.scope !== 'global') {
    spots = [];
    lastError = '';
    console.log('[PSK MQTT] idle · station scope uses PSKReporter query API');
    writeCache();
    return;
  }

  connectFor(cfg);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (client) {
    try { client.end(true); } catch (_) {}
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log(`[PSK MQTT] helper starting v${VERSION}`);
applyConfig();
setInterval(applyConfig, CONFIG_CHECK_MS);
setInterval(() => { prune(); writeCache(); }, 30000);
