#!/usr/bin/env node
'use strict';

const fs = require('fs');
const CACHE = '/data/aircraft-cache.json';
const SETTINGS = '/data/shackclock-settings.json';
const OPENSKY_STATES = 'https://opensky-network.org/api/states/all';
const OPENSKY_TOKEN = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

let oauth = { token:'', expiresAt:0 };

function readSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch (_) {}
  const V = (k, d='') => Object.prototype.hasOwnProperty.call(s, k) ? s[k] : (process.env[k] ?? d);
  return { V };
}
function n(v,d){ const x=Number(v); return Number.isFinite(x)?x:d; }
function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
function readOld(){ try{return JSON.parse(fs.readFileSync(CACHE,'utf8'));}catch(_){return null;} }
function write(obj){ fs.writeFileSync(CACHE, JSON.stringify(obj,null,2)+'\n'); }
function ft(m){ const x=Number(m); return Number.isFinite(x)?Math.round(x*3.28084):null; }
function kt(ms){ const x=Number(ms); return Number.isFinite(x)?Math.round(x*1.943844):null; }

function aircraftArray(raw){
  if(Array.isArray(raw?.ac)) return raw.ac;
  if(Array.isArray(raw?.aircraft)) return raw.aircraft;
  if(Array.isArray(raw?.states)) return raw.states;
  return [];
}
function normalizeNearby(a){
  if(Array.isArray(a)){
    return {hex:a[0]||'', flight:String(a[1]||'').trim(), lon:Number(a[5]), lat:Number(a[6]), alt_baro:a[7], gs:a[9], track:a[10]};
  }
  return {...a, lat:Number(a?.lat), lon:Number(a?.lon)};
}
function normalizeOpenSky(a){
  if(!Array.isArray(a)) return null;
  const lon=Number(a[5]), lat=Number(a[6]);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)) return null;
  return {
    hex:a[0]||'', flight:String(a[1]||'').trim(), country:a[2]||'',
    time_position:a[3]||null, last_contact:a[4]||null,
    lon, lat, alt_baro:ft(a[7]), on_ground:!!a[8], gs:kt(a[9]), track:Number(a[10]),
    vertical_rate:Number.isFinite(Number(a[11]))?Math.round(Number(a[11])*196.8504):null,
    alt_geom:ft(a[13]), squawk:a[14]||'', position_source:a[16], category:a[17]
  };
}
async function fetchJson(url, opts={}, timeoutMs=20000){
  const r=await fetch(url,{...opts,headers:{'User-Agent':'ShackClock/1.1.0','Accept':'application/json',...(opts.headers||{})},signal:AbortSignal.timeout(timeoutMs)});
  const text=await r.text();
  let data=null; try{data=JSON.parse(text);}catch(_){}
  if(!r.ok){
    const e=new Error(`${r.status} ${r.statusText}`); e.status=r.status; e.retryAfter=Number(r.headers.get('x-rate-limit-retry-after-seconds')||r.headers.get('retry-after')||0); e.body=text.slice(0,300); throw e;
  }
  if(data===null) throw new Error('non-JSON response');
  return {data, headers:r.headers};
}
async function openSkyToken(id, secret){
  const now=Date.now();
  if(oauth.token && oauth.expiresAt-now>60000) return oauth.token;
  const body=new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret});
  const r=await fetch(OPENSKY_TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'ShackClock/1.1.0'},body,signal:AbortSignal.timeout(15000)});
  if(!r.ok) throw new Error(`OpenSky auth ${r.status} ${r.statusText}`);
  const d=await r.json(); if(!d.access_token) throw new Error('OpenSky auth returned no access token');
  oauth.token=d.access_token; oauth.expiresAt=now+Math.max(60,Number(d.expires_in||1800))*1000; return oauth.token;
}
async function fetchWorldwide(V){
  const clientId=String(V('OPENSKY_CLIENT_ID','')).trim();
  const clientSecret=String(V('OPENSKY_CLIENT_SECRET','')).trim();
  const headers={}; let authenticated=false;
  if(clientId && clientSecret){ headers.Authorization=`Bearer ${await openSkyToken(clientId,clientSecret)}`; authenticated=true; }
  let result;
  try{ result=await fetchJson(OPENSKY_STATES,{headers},30000); }
  catch(e){
    if(e.status===401 && authenticated){ oauth={token:'',expiresAt:0}; headers.Authorization=`Bearer ${await openSkyToken(clientId,clientSecret)}`; result=await fetchJson(OPENSKY_STATES,{headers},30000); }
    else throw e;
  }
  const ac=aircraftArray(result.data).map(normalizeOpenSky).filter(Boolean);
  return {ac,authenticated,remaining:result.headers.get('x-rate-limit-remaining')};
}

async function poll(){
  const {V}=readSettings();
  const enabled=String(V('AIR_TRAFFIC_ENABLED','true'))!=='false';
  const mode=String(V('AIR_TRAFFIC_MODE','worldwide')).trim().toLowerCase()||'worldwide';
  // Worldwide defaults to 15 minutes to stay inside OpenSky's anonymous daily quota.
  const minRefresh=mode==='worldwide'?900:15;
  const refreshSec=Math.max(minRefresh,Math.min(86400,n(V('AIR_TRAFFIC_REFRESH_SEC',mode==='worldwide'?900:30),mode==='worldwide'?900:30)));
  if(!enabled){write({ok:true,disabled:true,mode,source:'disabled',updatedAt:Date.now(),count:0,ac:[]});return refreshSec;}

  // Avoid spending another upstream API request just because Docker restarted.
  const old=readOld();
  if(old?.ok && old.mode===mode && Number.isFinite(Number(old.updatedAt))){
    const ageSec=(Date.now()-Number(old.updatedAt))/1000;
    if(ageSec>=0 && ageSec<refreshSec){
      return Math.max(15,Math.ceil(refreshSec-ageSec));
    }
  }

  if(mode==='worldwide'){
    try{
      const r=await fetchWorldwide(V);
      const out={ok:true,mode:'worldwide',source:'OpenSky worldwide',sourceUrl:OPENSKY_STATES,updatedAt:Date.now(),count:r.ac.length,ac:r.ac,warning:'',authenticated:r.authenticated,rateLimitRemaining:r.remaining};
      write(out); console.log(`[AIR] OpenSky worldwide: ${r.ac.length} aircraft${r.remaining?` · credits ${r.remaining}`:''}`); return refreshSec;
    }catch(e){
      console.warn(`[AIR] OpenSky worldwide failed: ${e.message}`);
      if(old?.ok && Array.isArray(old.ac)){old.warning=`OpenSky: ${e.message}`;old.lastErrorAt=Date.now();write(old);}else write({ok:false,mode:'worldwide',source:'OpenSky worldwide',updatedAt:Date.now(),count:0,ac:[],warning:e.message});
      if(e.status===429 && e.retryAfter>0) return Math.max(refreshSec,e.retryAfter);
      return refreshSec;
    }
  }

  const local=String(V('AIR_TRAFFIC_JSON_URL','')).trim();
  const lat=n(V('STATION_LAT',0),0), lon=n(V('STATION_LON',0),0);
  const radius=Math.max(10,Math.min(250,n(V('AIR_TRAFFIC_RADIUS_NM',150),150)));
  const providers=(mode==='local' && local)?[{name:'local readsb/dump1090',url:local}]:[
    {name:'ADSB.lol nearby',url:`https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${radius}`},
    {name:'ADSB.fi nearby',url:`https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${radius}`}
  ];
  const errors=[];
  for(const p of providers){
    try{
      const {data}=await fetchJson(p.url,{},15000);
      const ac=aircraftArray(data).map(normalizeNearby).filter(a=>Number.isFinite(a.lat)&&Number.isFinite(a.lon));
      write({ok:true,mode:mode==='local'?'local':'nearby',source:p.name,sourceUrl:p.url,updatedAt:Date.now(),count:ac.length,ac,warning:''});
      console.log(`[AIR] ${p.name}: ${ac.length} aircraft`); return refreshSec;
    }catch(e){errors.push(`${p.name}: ${e.message}`);console.warn(`[AIR] ${p.name} failed: ${e.message}`);}
  }
  if(old?.ok&&Array.isArray(old.ac)){old.warning=errors.join(' | ');old.lastErrorAt=Date.now();write(old);}else write({ok:false,mode,source:'none',updatedAt:Date.now(),count:0,ac:[],warning:errors.join(' | ')});
  return refreshSec;
}

(async function main(){
  console.log('[AIR] aircraft cache helper starting');
  while(true){let sec=30;try{sec=await poll();}catch(e){console.error('[AIR] poll:',e.message);}await delay(sec*1000);}
})();
