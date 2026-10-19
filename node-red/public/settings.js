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

load();
})();