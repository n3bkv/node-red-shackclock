#!/usr/bin/env node
'use strict';

const fs=require('fs');
const SETTINGS='/data/shackclock-settings.json';
const ACTIVE_TLE='/data/amateur-active-tle.txt';
const ACTIVE_META='/data/amateur-active-meta.json';
const ACTIVE_NAMES_CACHE='/data/amateur-active-names.json';
const ALL_TLE='/data/amateur-all-tle.txt';
const AMSAT_BASES=['https://www.amsat.org/status/api/v1','https://amsat.org/status/api/v1'];
const AMSAT_ACTIVE_DB='https://raw.githubusercontent.com/palewire/amateur-satellite-database/main/data/amsat-active-frequencies.json';
const ORBITAL_SOURCES=[
  {name:'AMSAT nasabare',url:'https://www.amsat.org/tle/current/nasabare.txt'},
  {name:'AMSAT daily TLE',url:'https://www.amsat.org/tle/current/dailytle.txt'},
  {name:'CelesTrak amateur group',url:'https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle'}
];
const REFRESH_MS=30*60*1000;

function readSettings(){let s={};try{s=JSON.parse(fs.readFileSync(SETTINGS,'utf8'));}catch(_){};const V=(k,d='')=>Object.prototype.hasOwnProperty.call(s,k)?s[k]:(process.env[k]??d);return{V};}
function delay(ms){return new Promise(r=>setTimeout(r,ms));}
function normName(s=''){
  return String(s).toUpperCase().replace(/_\[[^\]]+\]/g,'').replace(/\[[^\]]+\]/g,'').replace(/\([^)]*\)/g,'').replace(/_/g,' ').replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function compact(s=''){return normName(s).replace(/\s+/g,'');}
function canonicalName(s=''){
  const raw=String(s||'').trim();
  const n=normName(raw);
  let c=compact(raw);
  const aliases={
    'AO7':'AO7',
    'AO07':'AO7',
    'KNACKSAT2':'KNACKSAT2',
    'KOSTKA':'KOSTKA',
    'OTP2':'OTP2',
    'REPLICATOR2':'REPLICATOR2',
    'REPLICATORII':'REPLICATOR2'
  };
  return aliases[c]||c;
}
function dedupeActiveNames(names=[]){
  const seen=new Set(), out=[];
  for(const n of names){ const key=canonicalName(n); if(!key||seen.has(key)) continue; seen.add(key); out.push(n); }
  return out;
}
function reportName(r={}){return r.name||r.satellite||r.satellite_name||r.sat||r.object_name||r.api_name||'';}
function reportStatus(r={}){return String(r.status||r.report||r.value||r.state||r.report_value||'').trim();}
function activeStatus(v=''){const s=String(v).toLowerCase();return s==='heard'||s==='crew active'||s.includes('sat/mode active')||s==='active';}
function browserHeaders(accept='application/json'){
  return {
    'User-Agent':'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Safari/537.36 ShackClock/1.1.3',
    'Accept':accept,
    'Accept-Language':'en-US,en;q=0.9',
    'Referer':'https://www.amsat.org/status/',
    'Cache-Control':'no-cache'
  };
}
async function fetchJson(url,timeout=20000){
  const r=await fetch(url,{headers:browserHeaders('application/json,text/plain;q=0.9,*/*;q=0.8'),redirect:'follow',signal:AbortSignal.timeout(timeout)});
  if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
  const text=await r.text();
  try{return JSON.parse(text);}catch(e){throw new Error(`invalid JSON from ${new URL(url).host}: ${text.slice(0,80).replace(/\s+/g,' ')}`);}
}
async function getText(url,timeout=20000){const r=await fetch(url,{headers:browserHeaders('text/plain,*/*;q=0.8'),redirect:'follow',signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text();}
function parseTle(text=''){
 const lines=String(text).split(/\r?\n/).map(x=>x.trim()).filter(Boolean), out=[];
 for(let i=0;i<lines.length-2;i++){
   if(!/^1 /.test(lines[i])&&/^1 /.test(lines[i+1])&&/^2 /.test(lines[i+2])){out.push({name:lines[i],l1:lines[i+1],l2:lines[i+2]});i+=2;}
 }
 return out;
}
function isMatch(tleName,activeNames){
 const a=normName(tleName), ac=compact(tleName), ack=canonicalName(tleName);
 for(const n of activeNames){const b=normName(n),bc=compact(n),bck=canonicalName(n);if(!b)continue;if(a===b||ac===bc||ack===bck)return true;if(a.startsWith(b+' ')||b.startsWith(a+' '))return true;if(ack&&bck&&(ack.startsWith(bck)||bck.startsWith(ack)))return true;}
 return false;
}
function writeMeta(x){fs.writeFileSync(ACTIVE_META,JSON.stringify(x,null,2)+'\n');}
function cachedAge(path){try{return Date.now()-fs.statSync(path).mtimeMs;}catch(_){return Infinity;}}
function saveNames(names,source,extra={}){fs.writeFileSync(ACTIVE_NAMES_CACHE,JSON.stringify({updatedAt:Date.now(),source,names:[...new Set(names)].filter(Boolean),...extra},null,2)+'\n');}
function loadNamesCache(maxAge=48*3600000){try{const d=JSON.parse(fs.readFileSync(ACTIVE_NAMES_CACHE,'utf8'));if(Date.now()-Number(d.updatedAt||0)<=maxAge&&Array.isArray(d.names)&&d.names.length)return d;}catch(_){}return null;}

function summaryRows(d){
  if(Array.isArray(d))return d;
  if(Array.isArray(d?.data))return d.data;
  const data=d?.data;
  if(data&&typeof data==='object'){
    const out=[];
    for(const [name,v] of Object.entries(data)){
      if(Array.isArray(v)){for(const x of v)out.push({name,...(x||{})});}
      else if(v&&typeof v==='object'){
        // Accept either {Heard:3,"Crew Active":1} or nested count objects.
        for(const [k,val] of Object.entries(v)){
          if(typeof val==='number')out.push({name,status:k,count:val});
          else if(val&&typeof val==='object')out.push({name,status:k,...val});
        }
      }
    }
    return out;
  }
  return [];
}
function namesFromSummary(d){
  const names=new Set(); const stats={heard:0,crewActive:0,totalReports:0};
  for(const r of summaryRows(d)){
    const n=reportName(r); const st=reportStatus(r); const count=Number(r.count??r.total??r.reports??r.report_count??1)||0;
    if(!n||!activeStatus(st))continue;
    names.add(n); stats.totalReports+=count;
    if(String(st).toLowerCase()==='heard')stats.heard+=count; else if(String(st).toLowerCase()==='crew active')stats.crewActive+=count;
  }
  return {names:[...names],stats};
}
function namesFromReports(d){
  const rows=Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]);
  const names=new Set(),stats={heard:0,crewActive:0,totalReports:rows.length};
  for(const r of rows){const st=reportStatus(r);if(!activeStatus(st))continue;const n=reportName(r);if(n)names.add(n);if(st.toLowerCase()==='heard')stats.heard++;if(st.toLowerCase()==='crew active')stats.crewActive++;}
  return {names:[...names],stats};
}
function namesFromActiveDb(d){
  const rows=Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]); const names=[];
  for(const r of rows){const n=reportName(r)||r?.satellite_name||r?.satellite||r?.Name||r?.name;if(n)names.push(n);}
  return [...new Set(names)];
}

async function tryAmsatApi(hours){
  const errors=[];
  for(const base of AMSAT_BASES){
    // Prefer summary: one small request instead of two filtered report queries.
    try{
      const u=`${base}/summary.php?hours=${hours}`;
      const d=await fetchJson(u); const x=namesFromSummary(d);
      if(x.names.length){return {...x,source:'AMSAT Satellite Status API summary',sourceUrl:u};}
      errors.push(`${new URL(u).host} summary returned no positive statuses`);
    }catch(e){errors.push(`${new URL(base).host} summary: ${e.message}`);}
    // Compatibility fallback: one unfiltered recent-report request.
    try{
      const u=`${base}/reports.php?hours=${hours}&limit=500`;
      const d=await fetchJson(u); const x=namesFromReports(d);
      if(x.names.length){return {...x,source:'AMSAT Satellite Status API reports',sourceUrl:u};}
      errors.push(`${new URL(u).host} reports returned no positive statuses`);
    }catch(e){errors.push(`${new URL(base).host} reports: ${e.message}`);}
  }
  throw new Error(errors.join('; '));
}
async function getActiveNames(hours){
  try{
    const x=await tryAmsatApi(hours);
    x.names=dedupeActiveNames(x.names);
    saveNames(x.names,x.source,{hours,stats:x.stats,sourceUrl:x.sourceUrl});
    return {...x,fallback:false,warning:''};
  }catch(apiErr){
    const stale=loadNamesCache();
    if(stale){
      return {names:dedupeActiveNames(stale.names),stats:stale.stats||{},source:`${stale.source} (cached)`,sourceUrl:stale.sourceUrl||'',fallback:true,warning:`AMSAT API unavailable (${apiErr.message}); using cached positive-status list.`};
    }
    // Last-resort AMSAT-curated active catalog mirror used by satdb.amsat.org.
    try{
      const d=await fetchJson(AMSAT_ACTIVE_DB); const names=dedupeActiveNames(namesFromActiveDb(d));
      if(!names.length)throw new Error('active database contained no satellite names');
      return {names,stats:{catalogActive:names.length},source:'AMSAT active-frequency database fallback',sourceUrl:AMSAT_ACTIVE_DB,fallback:true,warning:`AMSAT Status API unavailable (${apiErr.message}); using AMSAT active catalog fallback, which is not the same as recently-heard status.`};
    }catch(dbErr){throw new Error(`AMSAT Status API failed (${apiErr.message}); active catalog fallback failed (${dbErr.message})`);}
  }
}
async function updateAllTle(){
 if(cachedAge(ALL_TLE)<6*3600000){
   return {text:fs.readFileSync(ALL_TLE,'utf8'),source:'cached orbital elements',sourceUrl:'',cached:true};
 }
 const errors=[], merged=[], seen=new Set(), used=[];
 for(const src of ORBITAL_SOURCES){
   try{
     const t=await getText(src.url);
     const parsed=parseTle(t);
     if(parsed.length<5)throw new Error(`unexpectedly small TLE set (${parsed.length})`);
     let added=0;
     for(const x of parsed){
       const key=canonicalName(x.name)||compact(x.name)||normName(x.name);
       if(!key||seen.has(key))continue;
       seen.add(key);
       merged.push(x);
       added++;
     }
     used.push(src.name);
     console.log(`[AMSAT] orbital elements: ${src.name} (${parsed.length} objects, +${added} unique)`);
   }catch(e){
     errors.push(`${src.name}: ${e.message}`);
     console.warn(`[AMSAT] orbital source failed: ${src.name}: ${e.message}`);
   }
 }
 if(merged.length){
   const t=merged.map(x=>`${x.name}\n${x.l1}\n${x.l2}`).join('\n')+'\n';
   fs.writeFileSync(ALL_TLE,t);
   return {text:t,source:used.join(' + '),sourceUrl:'',cached:false,warning:errors.length?errors.join('; '):''};
 }
 if(fs.existsSync(ALL_TLE)){
   console.warn(`[AMSAT] all orbital sources failed; using cached TLE set (${errors.join('; ')})`);
   return {text:fs.readFileSync(ALL_TLE,'utf8'),source:'cached orbital elements',sourceUrl:'',cached:true,warning:errors.join('; ')};
 }
 throw new Error(`orbital elements unavailable: ${errors.join('; ')}`);
}
async function poll(){
 const {V}=readSettings(); const hours=Math.max(1,Math.min(720,Number(V('AMSAT_ACTIVE_HOURS',24))||24));
 const active=await getActiveNames(hours); const names=dedupeActiveNames(active.names||[]), stats=active.stats;
 console.log(`[AMSAT] activity source: ${active.source}; ${names.length} active names`);
 const orbital=await updateAllTle(); const all=parseTle(orbital.text);
 const filtered=all.filter(x=>isMatch(x.name,names));
 const txt=filtered.map(x=>`${x.name}\n${x.l1}\n${x.l2}`).join('\n')+(filtered.length?'\n':'');
 if(filtered.length||!fs.existsSync(ACTIVE_TLE))fs.writeFileSync(ACTIVE_TLE,txt);
 const matchedKeys=new Set(filtered.map(x=>canonicalName(x.name)));
 const unmatched=names.filter(n=>!matchedKeys.has(canonicalName(n)));
 const combinedWarning=[active.warning||'',orbital.warning||''].filter(Boolean).join(' | ');
 const meta={ok:true,helperVersion:'1.1.3',updatedAt:Date.now(),hours,source:active.source,sourceUrl:active.sourceUrl||'',fallback:!!active.fallback,orbitalSource:orbital.source,orbitalSourceUrl:orbital.sourceUrl||'',orbitalCached:!!orbital.cached,activeReports:names.length,activeTleCount:filtered.length,reportStats:stats,unmatched:unmatched.slice(0,40),warning:combinedWarning};
 writeMeta(meta);
 if(combinedWarning)console.warn(`[AMSAT] ${combinedWarning}`);
 console.log(`[AMSAT] ${active.source}: ${names.length} active names; ${filtered.length} matched orbital entries; orbitals=${orbital.source}${unmatched.length?`; ${unmatched.length} unmatched`:''}`);
}
(async function main(){console.log('[AMSAT] active amateur-satellite filter starting v1.1.3');while(true){try{await poll();}catch(e){console.warn('[AMSAT] poll failed:',e.message);writeMeta({ok:false,helperVersion:'1.1.3',updatedAt:Date.now(),source:'AMSAT active satellite filter',warning:e.message});}await delay(REFRESH_MS);}})();
