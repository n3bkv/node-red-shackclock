#!/usr/bin/env node
'use strict';

const fs=require('fs');
const CACHE='/data/carrier-cache.json';
const SETTINGS='/data/shackclock-settings.json';
const ARCHIVE='https://news.usni.org/category/fleet-tracker';
const RSS='https://news.usni.org/category/fleet-tracker/feed/';

// Public/reference locations only. These are not tactical/live positions.
// Deployed carriers are replaced with coarse USNI-reported operating regions
// when available. Non-deployed ships remain at public homeport/maintenance
// reference locations so the layer represents the whole commissioned fleet.
const FLEET=[
 {name:'USS Nimitz',hull:'CVN-68',lat:36.95,lon:-76.30,region:'Norfolk, VA',status:'TRAINING / DEACTIVATION PREP',category:'reference'},
 {name:'USS Dwight D. Eisenhower',hull:'CVN-69',lat:36.95,lon:-76.30,region:'Norfolk, VA',status:'HOMEPORT / REFERENCE',category:'reference'},
 {name:'USS Carl Vinson',hull:'CVN-70',lat:32.69,lon:-117.17,region:'San Diego, CA',status:'HOMEPORT / REFERENCE',category:'reference'},
 {name:'USS Theodore Roosevelt',hull:'CVN-71',lat:32.69,lon:-117.17,region:'San Diego, CA',status:'HOMEPORT / REFERENCE',category:'reference'},
 {name:'USS Abraham Lincoln',hull:'CVN-72',lat:32.69,lon:-117.17,region:'San Diego, CA',status:'HOMEPORT / REFERENCE',category:'reference'},
 {name:'USS George Washington',hull:'CVN-73',lat:35.29,lon:139.67,region:'Yokosuka, Japan',status:'FORWARD HOMEPORT / REFERENCE',category:'reference'},
 {name:'USS John C. Stennis',hull:'CVN-74',lat:36.99,lon:-76.44,region:'Newport News, VA',status:'RCOH / MAINTENANCE',category:'maintenance'},
 {name:'USS Harry S. Truman',hull:'CVN-75',lat:36.95,lon:-76.30,region:'Norfolk, VA',status:'HOMEPORT / REFERENCE',category:'reference'},
 {name:'USS Ronald Reagan',hull:'CVN-76',lat:47.56,lon:-122.64,region:'Bremerton, WA',status:'HOMEPORT / REFERENCE',category:'reference'},
 {name:'USS George H. W. Bush',hull:'CVN-77',lat:36.95,lon:-76.30,region:'Norfolk, VA',status:'HOMEPORT / REFERENCE',category:'reference'},
 {name:'USS Gerald R. Ford',hull:'CVN-78',lat:36.95,lon:-76.30,region:'Norfolk, VA',status:'HOMEPORT / REFERENCE',category:'reference'}
];

const CARRIER_NAMES=[
 ['USS Nimitz','CVN-68'],['USS Dwight D. Eisenhower','CVN-69'],['USS Carl Vinson','CVN-70'],
 ['USS Theodore Roosevelt','CVN-71'],['USS Abraham Lincoln','CVN-72'],['USS George Washington','CVN-73'],
 ['USS John C. Stennis','CVN-74'],['USS Harry S. Truman','CVN-75'],['USS Ronald Reagan','CVN-76'],
 ['USS George H.W. Bush','CVN-77'],['USS George H. W. Bush','CVN-77'],['USS Gerald R. Ford','CVN-78']
];
const REGION_POINTS=[
 [/philippine sea/i,[18,135]], [/south china sea/i,[13,114]], [/arabian sea/i,[18,64]], [/red sea/i,[18,39]],
 [/persian gulf|arabian gulf/i,[26,52]], [/indian ocean/i,[-5,75]], [/eastern pacific/i,[30,-130]],
 [/western pacific/i,[25,145]], [/western atlantic/i,[32,-67]], [/north atlantic/i,[45,-35]],
 [/mediterranean/i,[35,18]], [/japan/i,[35,137]], [/korea/i,[36,128]], [/guam|apra harbor/i,[13.45,144.7]],
 [/san diego/i,[32.7,-117.2]], [/norfolk/i,[36.95,-76.3]], [/bremerton/i,[47.6,-122.65]],
 [/hawaii|pearl harbor/i,[21.35,-157.95]], [/atlantic ocean/i,[30,-45]], [/pacific ocean/i,[20,-150]]
];

const BUNDLED_DEPLOYED={
 sourceUrl:'https://news.usni.org/2026/09/21/usni-news-fleet-and-marine-tracker-sept-21-2026',
 sourceDate:'2026-09-21T12:50:00-04:00',
 features:[
   {hull:'CVN-72',name:'USS Abraham Lincoln',lat:18,lon:135,region:'Philippine Sea'},
   {hull:'CVN-73',name:'USS George Washington',lat:20,lon:65,region:'Arabian Sea'},
   {hull:'CVN-77',name:'USS George H. W. Bush',lat:17,lon:61,region:'Arabian Sea'}
 ]
};

function readSettings(){let s={};try{s=JSON.parse(fs.readFileSync(SETTINGS,'utf8'));}catch(_){};const V=(k,d='')=>Object.prototype.hasOwnProperty.call(s,k)?s[k]:(process.env[k]??d);return{V};}
function delay(ms){return new Promise(r=>setTimeout(r,ms));}
function strip(s=''){return s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#8211;|&ndash;/g,'–').replace(/&#8217;|&rsquo;/g,"'").replace(/\s+/g,' ').trim();}
async function fetchText(url,timeout=15000){const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; ShackClock/1.1.3)','Accept':'text/html,application/xhtml+xml,application/rss+xml'},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text();}
async function fetchJson(url,timeout=15000){const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; ShackClock/1.1.3)','Accept':'application/geo+json,application/json'},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.json();}
function regionPoint(name){for(const [re,p] of REGION_POINTS)if(re.test(name))return p;return null;}
function articleDate(html){const m=html.match(/property=["']article:published_time["'][^>]*content=["']([^"']+)/i)||html.match(/<time[^>]+datetime=["']([^"']+)/i);return m?m[1]:new Date().toISOString();}
function decodeCdata(s=''){return s.replace(/^<!\[CDATA\[/,'').replace(/\]\]>$/,'');}
function firstRssItem(xml){const m=xml.match(/<item>([\s\S]*?)<\/item>/i);if(!m)return null;const item=m[1];const link=(item.match(/<link>([\s\S]*?)<\/link>/i)||[])[1]||'';const content=(item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i)||[])[1]||(item.match(/<description>([\s\S]*?)<\/description>/i)||[])[1]||'';return{link:strip(decodeCdata(link)),content:decodeCdata(content)};}
function latestArticleUrl(html){const matches=[...html.matchAll(/href=["'](https?:\/\/news\.usni\.org\/\d{4}\/\d{2}\/\d{2}\/usni-news-fleet-and-marine-tracker-[^"'#?]+)["']/gi)].map(m=>m[1]);return [...new Set(matches)][0]||'';}
function parseUsni(html,url){
  const headingRe=/<h2[^>]*>([\s\S]*?)<\/h2>/gi; const heads=[]; let m;
  while((m=headingRe.exec(html))) heads.push({i:m.index,name:strip(m[1])});
  const pub=articleDate(html); const features=[]; const seen=new Set();
  for(let hi=0;hi<heads.length;hi++){
    const h=heads[hi]; const end=hi+1<heads.length?heads[hi+1].i:html.length; const section=strip(html.slice(h.i,end));
    const p=regionPoint(h.name); if(!p) continue;
    for(const [name,hull] of CARRIER_NAMES){
      const canonical=name.replace(/H\. W\./g,'H.W.'); const alt=name.replace(/H\.W\./g,'H. W.');
      if(!(section.includes(name)||section.includes(canonical)||section.includes(alt)||section.includes(hull))) continue;
      if(seen.has(hull)) continue; seen.add(hull);
      features.push({hull,name:canonical,lat:p[0],lon:p[1],region:h.name.replace(/^In\s+the\s+/i,'').replace(/^In\s+/i,''),updatedAt:pub,source:'USNI News Fleet Tracker',sourceUrl:url});
    }
  }
  return {features,sourceUrl:url,sourceDate:pub};
}
function referenceFeature(x){return{type:'Feature',geometry:{type:'Point',coordinates:[x.lon,x.lat]},properties:{name:x.name,hull:x.hull,region:x.region,status:x.status,category:x.category,deployed:false,approximate:true,source:'Public fleet reference'}};}
function mergeFleet(deployed=[],meta={}){
  const byHull=new Map(deployed.map(x=>[x.hull,x]));
  const features=FLEET.map(x=>{
    const d=byHull.get(x.hull); if(!d)return referenceFeature(x);
    return{type:'Feature',geometry:{type:'Point',coordinates:[d.lon,d.lat]},properties:{name:d.name||x.name,hull:x.hull,region:d.region||'',status:'DEPLOYED / UNDERWAY',category:'deployed',deployed:true,updatedAt:d.updatedAt||meta.sourceDate||new Date().toISOString(),source:d.source||'USNI News Fleet Tracker',sourceUrl:d.sourceUrl||meta.sourceUrl||'',approximate:true}};
  });
  return{type:'FeatureCollection',features,source:meta.source||'USNI + public fleet reference',sourceUrl:meta.sourceUrl||'',sourceDate:meta.sourceDate||'',updatedAt:Date.now(),approximate:true,warning:meta.warning||'',counts:{total:features.length,deployed:features.filter(f=>f.properties.deployed).length,reference:features.filter(f=>!f.properties.deployed).length}};
}
function bundled(reason=''){
  return mergeFleet(BUNDLED_DEPLOYED.features.map(x=>({...x,updatedAt:BUNDLED_DEPLOYED.sourceDate,source:'USNI News Fleet Tracker',sourceUrl:BUNDLED_DEPLOYED.sourceUrl})),{source:'USNI bundled deployment snapshot + public fleet reference',sourceUrl:BUNDLED_DEPLOYED.sourceUrl,sourceDate:BUNDLED_DEPLOYED.sourceDate,warning:reason?`Live USNI fetch unavailable (${reason}); deployed positions use bundled Sept. 21, 2026 snapshot. Non-deployed markers are public homeport/maintenance references.`:'Deployed positions use bundled Sept. 21, 2026 snapshot. Non-deployed markers are public homeport/maintenance references.'});
}
function readOld(){try{return JSON.parse(fs.readFileSync(CACHE,'utf8'));}catch(_){return null;}}
function write(x){fs.writeFileSync(CACHE,JSON.stringify(x,null,2)+'\n');}

async function poll(){
  const {V}=readSettings(); const enabled=String(V('CARRIER_ENABLED','true'))!=='false';
  const hours=Math.max(1,Math.min(168,Number(V('CARRIER_REFRESH_HOURS',6))||6));
  if(!enabled){write({type:'FeatureCollection',features:[],source:'disabled',updatedAt:Date.now(),disabled:true});return hours;}
  const custom=String(V('CARRIER_GEOJSON_URL','')).trim();
  try{
    let out;
    if(custom){
      const d=await fetchJson(custom); out=(d&&d.type==='FeatureCollection')?d:{type:'FeatureCollection',features:[]};
      out.source=out.source||'custom public GeoJSON';out.sourceUrl=custom;out.updatedAt=Date.now();out.approximate=true;out.warning='';
      if(!out.features.length) throw new Error('custom carrier GeoJSON contains no features');
    }else{
      let parsed=null,rssErr='';
      try{
        const rss=await fetchText(RSS); const item=firstRssItem(rss);
        if(item?.content) parsed=parseUsni(item.content,item.link||RSS);
        if(!parsed?.features?.length && item?.link){const article=await fetchText(item.link);parsed=parseUsni(article,item.link);}
      }catch(e){rssErr=e.message;}
      if(!parsed?.features?.length){
        try{const archive=await fetchText(ARCHIVE); const url=latestArticleUrl(archive);if(!url)throw new Error('latest Fleet Tracker article not found');const article=await fetchText(url);parsed=parseUsni(article,url);}catch(e){out=bundled([rssErr,e.message].filter(Boolean).join('; '));}
      }
      if(!out){
        if(parsed?.features?.length) out=mergeFleet(parsed.features,{source:'USNI live deployment regions + public fleet reference',sourceUrl:parsed.sourceUrl,sourceDate:parsed.sourceDate});
        else out=bundled('no carrier regions parsed from live Fleet Tracker');
      }
    }
    write(out); console.log(`[CARRIER] ${out.source}: ${out.features.length} fleet markers${out.counts?` (${out.counts.deployed} deployed)`:''}${out.warning?' (fallback)':''}`);
  }catch(e){
    console.warn('[CARRIER]',e.message); const old=readOld();
    if(old?.features?.length){old.warning=e.message;old.lastErrorAt=Date.now();write(old);}
    else if(!custom){const out=bundled(e.message);write(out);console.log(`[CARRIER] ${out.source}: ${out.features.length} fleet markers (fallback)`);}
    else write({type:'FeatureCollection',features:[],source:'custom public GeoJSON',updatedAt:Date.now(),approximate:true,warning:e.message});
  }
  return hours;
}

(async function main(){console.log('[CARRIER] public coarse carrier tracker starting');while(true){let h=6;try{h=await poll();}catch(e){console.error('[CARRIER] poll:',e.message);}await delay(h*3600000);}})();
