#!/usr/bin/env node
'use strict';

const fs = require('fs');
const satellite = require('satellite.js');

const SETTINGS = '/data/shackclock-settings.json';
const OUT = '/data/iss-state.json';
const CACHE_RAW = '/data/iss-orbit-cache.txt';
const CACHE_META = '/data/iss-orbit-cache.json';
const DEFAULT_URL = 'https://api.wheretheiss.at/v1/satellites/25544/tles?format=text';
const CELESTRAK_FALLBACK = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=JSON';
const FETCH_EVERY_MS = 2 * 60 * 60 * 1000;
const WRITE_EVERY_MS = 1000;
const EARTH_KM = 6371;

let satrec = null;
let sourceFormat = '';
let sourceFetchedAt = 0;
let sourceUrl = '';
let lastError = '';
let warning = '';
let track = [];
let fetching = false;
let nextFetchAt = 0;
let configuredUrlSeen = '';

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); }
  catch (_) { return {}; }
}

function cfg(key, fallback='') {
  const c = readSettings();
  if (Object.prototype.hasOwnProperty.call(c,key) && String(c[key] ?? '').trim() !== '') return c[key];
  if (process.env[key] !== undefined && String(process.env[key]).trim() !== '') return process.env[key];
  return fallback;
}

function haversineKm(lat1,lon1,lat2,lon2) {
  const toRad=x=>x*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return EARTH_KM*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function parseOrbit(text) {
  const trimmed=String(text||'').trim();
  if (!trimmed) throw new Error('empty orbit-data response');
  if (/^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) throw new Error('orbit-data source returned HTML instead of orbital elements');
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed=JSON.parse(trimmed);
    const arr=Array.isArray(parsed) ? parsed : [parsed];
    const obj=arr.find(x => Number(x?.NORAD_CAT_ID ?? x?.norad_cat_id ?? x?.id) === 25544) || arr[0];
    if (!obj) throw new Error('ISS OMM record not found');
    // WhereTheISS /tles default JSON uses line1/line2 rather than OMM fields.
    const l1=obj.line1 || obj.tle_line1 || obj.TLE_LINE1;
    const l2=obj.line2 || obj.tle_line2 || obj.TLE_LINE2;
    if (l1 && l2) {
      const sr=satellite.twoline2satrec(String(l1),String(l2));
      if (!sr || sr.error) throw new Error(`JSON TLE parse failed${sr?.error ? ` (code ${sr.error})` : ''}`);
      return {satrec:sr, format:'TLE JSON'};
    }
    const sr=satellite.json2satrec(obj);
    if (!sr || sr.error) throw new Error(`OMM parse failed${sr?.error ? ` (code ${sr.error})` : ''}`);
    return {satrec:sr, format:'OMM JSON'};
  }
  const lines=trimmed.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  let l1=null,l2=null;
  for (let i=0;i<lines.length-1;i++) {
    if (/^1\s+25544(?:U|\s)/.test(lines[i]) && /^2\s+25544(?:\s)/.test(lines[i+1])) { l1=lines[i]; l2=lines[i+1]; break; }
  }
  if (!l1 || !l2) throw new Error(`ISS TLE not found in ${lines.length} lines`);
  const sr=satellite.twoline2satrec(l1,l2);
  if (!sr || sr.error) throw new Error(`TLE parse failed${sr?.error ? ` (code ${sr.error})` : ''}`);
  return {satrec:sr, format:'TLE'};
}

function positionAt(date) {
  if (!satrec) return null;
  const pv=satellite.propagate(satrec,date);
  if (!pv || !pv.position || typeof pv.position !== 'object') return null;
  const gd=satellite.eciToGeodetic(pv.position,satellite.gstime(date));
  const lat=satellite.degreesLat(gd.latitude), lon=satellite.degreesLong(gd.longitude), altKm=Number(gd.height);
  if (![lat,lon,altKm].every(Number.isFinite)) return null;
  return {lat,lon,altKm};
}

function rebuildTrack() {
  const now=Date.now(), out=[];
  for (let mins=-45; mins<=45; mins+=2) {
    const p=positionAt(new Date(now+mins*60000));
    if (p) out.push([p.lat,p.lon]);
  }
  track=out;
}

function saveCache(raw,url,format,fetchedAt) {
  try {
    fs.writeFileSync(CACHE_RAW,String(raw));
    fs.writeFileSync(CACHE_META,JSON.stringify({url,format,fetchedAt},null,2)+'\n');
  } catch (e) { console.error(`[ISS] cache write: ${e.message}`); }
}

function loadCache() {
  try {
    const raw=fs.readFileSync(CACHE_RAW,'utf8');
    const meta=JSON.parse(fs.readFileSync(CACHE_META,'utf8'));
    const parsed=parseOrbit(raw);
    satrec=parsed.satrec;
    sourceFormat=meta.format || parsed.format;
    sourceFetchedAt=Number(meta.fetchedAt)||0;
    sourceUrl=String(meta.url||'cache');
    nextFetchAt=Math.max(Date.now(), sourceFetchedAt + FETCH_EVERY_MS);
    rebuildTrack();
    console.log(`[ISS] loaded cached orbit data (${sourceFormat}); age ${Math.round((Date.now()-sourceFetchedAt)/60000)} min`);
    return true;
  } catch (_) { return false; }
}

async function fetchOne(url) {
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(),15000);
  try {
    const r=await fetch(url,{headers:{'User-Agent':'ShackClock/1.1.0','Accept':'application/json,text/plain;q=0.9,*/*;q=0.1'},signal:ac.signal,cache:'no-store'});
    const body=await r.text();
    if (!r.ok) {
      const err=new Error(`orbit-data HTTP ${r.status}`);
      err.status=r.status;
      err.body=body.slice(0,300);
      throw err;
    }
    const parsed=parseOrbit(body);
    return {raw:body,parsed};
  } finally { clearTimeout(timer); }
}

function candidateUrls(configured) {
  const out=[];
  const add=u=>{u=String(u||'').trim(); if(u && !out.includes(u)) out.push(u);};
  add(configured || DEFAULT_URL);
  add(DEFAULT_URL);
  add(CELESTRAK_FALLBACK);
  return out;
}

async function fetchOrbitData(force=false) {
  if (fetching) return;
  const now=Date.now();
  const configured=String(cfg('ISS_TLE_URL',DEFAULT_URL)).trim() || DEFAULT_URL;
  const configChanged=configured !== configuredUrlSeen;
  configuredUrlSeen=configured;
  if (!force && !configChanged && now < nextFetchAt) return;
  fetching=true;
  const errors=[];
  try {
    for (const url of candidateUrls(configured)) {
      try {
        const got=await fetchOne(url);
        satrec=got.parsed.satrec;
        sourceFormat=got.parsed.format;
        sourceFetchedAt=Date.now();
        sourceUrl=url;
        lastError='';
        warning=errors.length ? `primary source failed; using fallback ${url}` : '';
        nextFetchAt=sourceFetchedAt+FETCH_EVERY_MS;
        rebuildTrack();
        saveCache(got.raw,url,sourceFormat,sourceFetchedAt);
        console.log(`[ISS] orbit data loaded (${sourceFormat}) from ${url}; next fetch in 2h`);
        return;
      } catch (e) {
        const detail=e?.status ? `${e.message}${e.status===403?' (provider rate/block policy)':''}` : (e?.message||String(e));
        errors.push(`${url}: ${detail}`);
        console.error(`[ISS] ${detail} from ${url}`);
      }
    }
    lastError=errors.join(' | ') || 'all ISS orbit-data sources failed';
    warning=satrec ? `using cached orbit data; ${lastError}` : '';
    // Critical: do not hammer providers after an error. CelesTrak explicitly asks clients
    // to stop requests and wait for the next 2-hour update window after HTTP errors.
    nextFetchAt=Date.now()+FETCH_EVERY_MS;
  } finally { fetching=false; }
}

function writeState() {
  const now=Date.now();
  const p=positionAt(new Date(now));
  let out;
  if (!p) {
    out={ok:false,updatedAt:now,error:lastError || 'no usable ISS orbital elements yet',sourceUrl,sourceFormat,sourceFetchedAt,nextFetchAt};
  } else {
    const qLat=Number(cfg('STATION_LAT',0)), qLon=Number(cfg('STATION_LON',0));
    const footprintKm=EARTH_KM*Math.acos(EARTH_KM/(EARTH_KM+p.altKm));
    out={ok:true,updatedAt:now,sourceUrl,sourceFormat,sourceFetchedAt,nextFetchAt,lat:p.lat,lon:p.lon,altKm:p.altKm,distanceKm:haversineKm(qLat,qLon,p.lat,p.lon),footprintKm,track,warning:warning || lastError || ''};
  }
  const tmp=`${OUT}.tmp`;
  try { fs.writeFileSync(tmp,JSON.stringify(out)); fs.renameSync(tmp,OUT); }
  catch (e) { console.error(`[ISS] write state: ${e.message}`); }
}

(async()=>{
  console.log('[ISS] server-side tracker starting (cached, 2-hour fetch interval)');
  const cached=loadCache();
  await fetchOrbitData(!cached || Date.now() >= nextFetchAt);
  writeState();
  setInterval(()=>fetchOrbitData(false),60000);
  setInterval(writeState,WRITE_EVERY_MS);
})();
