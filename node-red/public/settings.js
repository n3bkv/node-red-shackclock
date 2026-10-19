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

const carrierRegionPoints={
 'Philippine Sea':[135,18],'Western Pacific':[145,25],'Eastern Pacific':[-130,30],
 'Arabian Sea':[64,18],'North Atlantic':[-35,45],'Mediterranean Sea':[18,35],
 'Indian Ocean':[75,-5],'Red Sea':[39,18],'South China Sea':[114,13],
 'Norfolk, VA - reference':[-76.3,36.95],'San Diego, CA - reference':[-117.17,32.69],
 'Yokosuka, Japan - reference':[139.67,35.29],
 'Bremerton, WA - reference':[-122.64,47.56],
 'Newport News, VA - maintenance':[-76.44,36.99]
};
const carrierNames=['Nimitz','Dwight D. Eisenhower','Carl Vinson','Theodore Roosevelt','Abraham Lincoln','George Washington','John C. Stennis','Harry S. Truman','Ronald Reagan','George H. W. Bush','Gerald R. Ford'];
const carrierDraft=new Map();
const cw=id=>document.getElementById('carrier-wiz-'+id);
const hullSelect=cw('hull');
if(hullSelect)carrierNames.forEach((name,i)=>{
 const opt=document.createElement('option');opt.value='CVN-'+(i+68);opt.textContent='USS '+name+' · '+opt.value;hullSelect.append(opt);
});
function carrierDraftRender(){
 const el=cw('list');if(!el)return;el.replaceChildren();
 if(!carrierDraft.size){el.textContent='No carriers added yet.';return}
 const ul=document.createElement('ul');
 for(const [h,v] of [...carrierDraft].sort((a,b)=>a[0].localeCompare(b[0]))){
  const li=document.createElement('li');
  li.textContent=h+' · '+v.region+' · '+v.category+' ';
  const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';
  remove.addEventListener('click',()=>{carrierDraft.delete(h);carrierDraftRender()});
  li.append(remove);ul.append(li);
 }
 el.append(ul);
}
function carrierDraftAdd(){
 const h=cw('hull').value,region=cw('region').value,category=cw('category').value;
 if(!region||!carrierRegionPoints[region])throw Error('Select a region supported by the published report');
 if(category==='reference'&&!region.endsWith(' - reference'))throw Error('Reference records must use a designated homeport reference region');
 if(category==='maintenance'&&!region.endsWith(' - maintenance'))throw Error('Maintenance records must use a designated maintenance reference region');
 if(category==='deployed'&&(region.endsWith(' - reference')||region.endsWith(' - maintenance')))throw Error('Deployed reports must use a broad public operating region');
 carrierDraft.set(h,{region,category,status:cw('status').value.trim().slice(0,120)});
 carrierDraftRender();
}
function carrierDraftJSON(){
 const source=cw('source').value.trim(),sourceUrl=cw('url').value.trim(),sourceDate=cw('date').value.trim();
 if(!source||!sourceUrl.startsWith('https://'))throw Error('Enter a source name and HTTPS URL for the specific report');
 const d=new Date(sourceDate);
 if(!sourceDate||!/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(sourceDate)||!Number.isFinite(d.getTime()))throw Error('Enter a publication time with timezone, e.g. 2026-10-13T15:11:00-04:00');
 if(d.getTime()>Date.now()+86400000)throw Error('Report date cannot be in the future');
 if(!carrierDraft.size)throw Error('Add at least one verified carrier record');
 return {type:'FeatureCollection',source,sourceUrl,sourceDate,features:[...carrierDraft].sort((a,b)=>a[0].localeCompare(b[0])).map(([h,v])=>({
  type:'Feature',geometry:{type:'Point',coordinates:carrierRegionPoints[v.region]},
  properties:{hull:h,region:v.region,category:v.category,status:v.status||v.category.toUpperCase()}
 }))};
}
async function carrierDraftAction(mode){
 const el=cw('message');if(!el)return;
 try{
  if(mode==='add'){carrierDraftAdd();el.textContent='Carrier added to draft. Add more or preview the report.';return}
  if(mode==='reset'){carrierDraft.clear();carrierDraftRender();el.textContent='Draft cleared; saved carrier report unchanged.';return}
  const data=carrierDraftJSON(),json=JSON.stringify(data,null,2);
  document.getElementById('carrier-data-json').value=json;
  if(mode==='preview'){document.getElementById('carrier-data-json').closest('details').open=true;el.textContent='GeoJSON prepared in Advanced section. Review before importing.';return}
  if(mode==='download'){const blob=new Blob([json+'\\n'],{type:'application/geo+json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='shackclock-carriers-'+data.sourceDate.slice(0,10)+'.geojson';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);el.textContent='GeoJSON downloaded. Review before sharing or importing.';return}
  if(!confirm('Import '+data.features.length+' reviewed carrier record(s) from '+data.sourceDate+'? This replaces the current carrier report.'))return;
  const r=await fetch('/api/carriers/import',{method:'POST',headers:{'content-type':'application/json'},body:json});
  const result=await r.json();if(!r.ok||!result.ok)throw Error(result.error||'Import rejected');
  el.textContent='Imported '+result.imported+' carrier record(s). Source date: '+result.sourceDate+'. Refresh the map to see updated markers.';
  await carrierRefresh();
 }catch(e){el.textContent='Cannot '+mode+': '+e.message}
}
for(const mode of ['add','preview','download','reset']){
 cw(mode)?.addEventListener('click',()=>carrierDraftAction(mode));
}
cw('apply')?.addEventListener('click',()=>carrierDraftAction('apply'));

load();
})();