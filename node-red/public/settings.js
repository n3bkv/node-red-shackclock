(()=>{'use strict';
const form=document.getElementById('settings-form'),status=document.getElementById('status'),source=document.getElementById('settings-source-note');
function showSource(meta={}){
  const savedCount=Number(meta.savedCount||0);
  if(!source)return;
  source.classList.toggle('saved-active',savedCount>0);
  source.textContent=savedCount>0
    ? `Persistent dashboard settings are active (${savedCount} saved values). They override matching .env values and survive Docker rebuilds. Saving this form stores the displayed settings in the Docker data volume.`
    : 'No dashboard settings are currently saved. Values shown come from .env when present, otherwise from ShackClock defaults. Saving this form will create persistent dashboard settings.';
}
async function load(){
  status.textContent='Loading…';
  try{
    const r=await fetch('/api/settings-config',{cache:'no-store'});
    if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
    const d=await r.json();
    for(const [k,v] of Object.entries(d)){const el=form.elements.namedItem(k);if(el)el.value=v??'';}
    showSource(d._meta);
    for(const name of ['passes','charts']){const el=document.getElementById('v118-setting-'+name);if(el){let p={};try{p=JSON.parse(localStorage.getItem('shackclock.v118.display')||'{}')}catch{}el.value=(p[name]!==undefined?p[name]:name!=='muf')?'on':'off'}}
    status.textContent='Loaded';
  }catch(e){status.textContent=`Load failed: ${e.message}`;}
}
form.addEventListener('submit',async e=>{
  e.preventDefault();status.textContent='Saving…';
  const d={};for(const el of form.elements){if(el.name)d[el.name]=el.value;}
  try{
    const r=await fetch('/api/settings-config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});
    const out=await r.json();if(!r.ok||!out.ok)throw new Error(out.error||`${r.status}`);
    let p={};try{p=JSON.parse(localStorage.getItem('shackclock.v118.display')||'{}')}catch{}for(const name of ['passes','charts']){const el=document.getElementById('v118-setting-'+name);if(el)p[name]=el.value==='on'}localStorage.setItem('shackclock.v118.display',JSON.stringify(p));
    status.textContent='Saved in Docker data volume. These values now override matching .env settings.';
    await load();
  }catch(e){status.textContent=`Save failed: ${e.message}`;}
});
document.getElementById('reload').addEventListener('click',load);
document.getElementById('reset').addEventListener('click',async()=>{
  if(!confirm('Discard all settings saved through ShackClock? Values will fall back to .env where present and then packaged defaults.'))return;
  status.textContent='Discarding saved settings…';
  try{
    const r=await fetch('/api/settings-config',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const out=await r.json();if(!r.ok||!out.ok)throw new Error(out.error||`${r.status}`);
    await load();
    status.textContent='Saved dashboard settings discarded. Using .env / packaged defaults.';
  }catch(e){status.textContent=`Reset failed: ${e.message}`;}
});

const carrierStatus=document.getElementById('carrier-data-status'),carrierMessage=document.getElementById('carrier-data-message');
async function carrierRefresh(){
 if(!carrierStatus)return;
 try{
  const r=await fetch('/api/carriers',{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);
  const d=await r.json();
  const days=d.sourceDate?Math.max(0,Math.floor((Date.now()-Date.parse(d.sourceDate))/86400000)):null;
  carrierStatus.textContent='Source: '+(d.source||'Unknown')+' | Report: '+(d.sourceDate||'unknown')+(days===null?'':' | '+days+' days old')+' | '+(d.manualImport?'MANUAL IMPORT ACTIVE':'Automatic/fallback')+' | '+(d.counts?.deployed??'?')+' last reported deployed'+(d.warning?' | Warning: '+d.warning:'');
 }catch(e){carrierStatus.textContent='Carrier source unavailable: '+e.message}
}
async function carrierImport(clear=false){
 if(!carrierMessage)return;
 if(clear&&!confirm('Clear the manually imported carrier report? This allows the automatic source or historical snapshot to resume on the next carrier refresh.'))return;
 carrierMessage.textContent=clear?'Clearing imported report…':'Validating and importing…';
 try{
  const body=clear?{clear:true}:JSON.parse(document.getElementById('carrier-data-json').value);
  const r=await fetch('/api/carriers/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Import rejected');
  carrierMessage.textContent=clear?'Import file cleared. Restart the ShackClock container to resume automatic reports.':'Imported '+d.imported+' carrier record(s) from '+d.sourceDate+'. Reload the dashboard to display the new data.';
  await carrierRefresh();
 }catch(e){carrierMessage.textContent='Carrier import failed: '+e.message}
}
document.getElementById('carrier-data-import')?.addEventListener('click',()=>carrierImport(false));
document.getElementById('carrier-data-clear')?.addEventListener('click',()=>carrierImport(true));
document.getElementById('carrier-data-refresh')?.addEventListener('click',carrierRefresh);
carrierRefresh();


const simple=id=>document.getElementById('carrier-simple-'+id);
const shipNames=['Nimitz','Dwight D. Eisenhower','Carl Vinson','Theodore Roosevelt','Abraham Lincoln','George Washington','John C. Stennis','Harry S. Truman','Ronald Reagan','George H. W. Bush','Gerald R. Ford'];
const broadRegions=[
 ['Philippine Sea',135,18],['Western Pacific',145,25],['Eastern Pacific',-130,30],
 ['Arabian Sea',64,18],['North Atlantic',-35,45],['Mediterranean Sea',18,35],
 ['Indian Ocean',75,-5],['Red Sea',39,18],['South China Sea',114,13]
];
let simpleCandidates=[];
function reportDate(url,text){
 const m=String(url).match(/\/((?:20)\d{2})\/(\d{2})\/(\d{2})\//);
 if(m){const iso=m[1]+'-'+m[2]+'-'+m[3]+'T12:00:00Z';if(Number.isFinite(Date.parse(iso)))return iso}
 const d=String(text).match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2}\b/i);
 if(d){const t=Date.parse(d[0]);if(Number.isFinite(t))return new Date(t).toISOString()}
 return null;
}
function extractCarriers(text){
 const lines=String(text).replace(/\\r/g,'').split(/\\n+/).map(x=>x.trim()).filter(Boolean);
 const locations=[
  ['Pacific Ocean',[-150,20]],['Arabian Sea',[64,18]],['Philippine Sea',[135,18]],
  ['Western Pacific',[145,25]],['Eastern Pacific',[-130,30]],['Indian Ocean',[75,-5]],
  ['Red Sea',[39,18]],['Mediterranean Sea',[18,35]],['South China Sea',[114,13]],['North Atlantic',[-35,45]]
 ];
 const found=new Map();
 for(const line of lines){
  if(line.length>700)continue;
  const lower=line.toLowerCase().replace(/h\\.\\s*w\\./g,'h.w.');
  const ships=shipNames.map((name,i)=>({name,i,hull:'CVN-'+(68+i)})).filter(x=>lower.includes(x.name.toLowerCase().replace(/h\\.\\s*w\\./g,'h.w.'))||lower.includes(x.hull.toLowerCase()));
  if(ships.length!==1)continue;
  const ship=ships[0];let candidate=null;
  if(/\\b(returned|returns|arrived|back in)\\b/i.test(line)&&/san diego/i.test(line)){
   candidate={...ship,area:['San Diego, CA - reference',-117.17,32.69],category:'reference',quote:line.slice(0,360)};
  }else if(/\\b(transiting|operating|underway|deployed|deployment|sailing|patrolling)\\b/i.test(line)&& !/\\b(homeported|assigned to|replenishment|photo|launches)\\b/i.test(line)){
   const matches=locations.filter(x=>lower.includes(x[0].toLowerCase()));
   if(matches.length===1)candidate={...ship,area:[matches[0][0],...matches[0][1]],category:'deployed',quote:line.slice(0,360)};
  }
  if(candidate){const prev=found.get(ship.hull);if(!prev||candidate.category==='reference')found.set(ship.hull,candidate)}
 }
 return [...found.values()];
}
function renderCarrierReview(){
 const root=simple('results');root.replaceChildren();
 if(!simpleCandidates.length){simple('review').hidden=true;return}
 for(const c of simpleCandidates){
  const row=document.createElement('label');row.style.cssText='display:block;margin:9px 0;padding:8px;border:1px solid #355064;border-radius:5px';
  const cb=document.createElement('input');cb.type='checkbox';cb.checked=false;cb.dataset.hull=c.hull;cb.style.marginRight='8px';
  const strong=document.createElement('strong');strong.textContent='USS '+c.name+' ('+c.hull+') — '+c.area[0];
  const evidence=document.createElement('div');evidence.textContent='Article excerpt: '+c.quote;evidence.style.cssText='font-size:11px;margin:5px 0;opacity:.8';
  row.append(cb,strong,evidence);root.append(row);
 }
 simple('review').hidden=false;
}
function analyzeText(){
 const text=simple('text').value.trim(),url=simple('url').value.trim();
 if(!text||text.length<200)throw Error('Paste the report article text (at least 200 characters).');
 if(!/^https:\/\//.test(url)||!/^https:\/\/news\.usni\.org\//i.test(url))throw Error('Paste the direct USNI Fleet Tracker article URL, not the category page.');
 const date=reportDate(url,text);
 if(!date)throw Error('Cannot determine the report date from its URL or article text.');
 if(Date.parse(date)>Date.now()+86400000)throw Error('Report date is in the future.');
 simpleCandidates=extractCarriers(text);
 renderCarrierReview();
 simple('message').textContent=simpleCandidates.length
   ?'Found '+simpleCandidates.length+' possible carrier/region match(es). Review the cited excerpts and check only accurate records before importing. Report date: '+date.slice(0,10)
   :'No unambiguous carrier/region matches found. Nothing was changed; use Advanced GeoJSON for manual import.';
}
simple('analyze')?.addEventListener('click',()=>{try{analyzeText()}catch(e){simple('message').textContent=e.message}});
simple('update')?.addEventListener('click',async()=>{
 simple('message').textContent='Checking whether the public Fleet Tracker feed is available…';
 try{
  const r=await fetch('https://news.usni.org/category/fleet-tracker/feed/',{signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('HTTP '+r.status);
  // Feed metadata is useful, but never treat RSS snippets as full deployment reports.
  simple('message').textContent='Feed reachable, but the full report must be reviewed before updating. Open the latest article, copy its text and link below.';
 }catch(e){
  simple('message').textContent='Automatic report access is blocked or unavailable. Open the USNI report link above, copy the latest article text, paste its direct URL and text below, then click Find carriers.';
 }
 simple('fallback').hidden=false;
});
simple('apply')?.addEventListener('click',async()=>{
 try{
  const selected=simpleCandidates.filter(c=>simple('results').querySelector('input[data-hull="'+c.hull+'"]')?.checked);
  if(!selected.length)throw Error('Select at least one verified carrier.');
  const sourceUrl=simple('url').value.trim(),sourceDate=reportDate(sourceUrl,simple('text').value);
  const data={type:'FeatureCollection',source:'USNI News Fleet Tracker (user reviewed)',sourceUrl,sourceDate,features:selected.map(c=>({
   type:'Feature',geometry:{type:'Point',coordinates:[c.area[1],c.area[2]]},
   properties:{hull:c.hull,region:c.area[0],category:c.category,status:c.category==='deployed'?'LAST REPORTED IN '+c.area[0]:'RETURNED TO '+c.area[0]}
  }))};
  if(!confirm('Import '+selected.length+' reviewed approximate carrier region(s) from '+sourceDate.slice(0,10)+'? All other ships will show homeport/reference records.'))return;
  const r=await fetch('/api/carriers/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Import rejected');
  simple('message').textContent='Carrier data updated: '+d.imported+' reported region(s), source '+d.sourceDate.slice(0,10)+'. Reload the map.';
  await carrierRefresh();
 }catch(e){simple('message').textContent='Not imported: '+e.message}
});

load();
})();