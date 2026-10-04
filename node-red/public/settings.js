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
    status.textContent='Loaded';
  }catch(e){status.textContent=`Load failed: ${e.message}`;}
}
form.addEventListener('submit',async e=>{
  e.preventDefault();status.textContent='Saving…';
  const d={};for(const el of form.elements){if(el.name)d[el.name]=el.value;}
  try{
    const r=await fetch('/api/settings-config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});
    const out=await r.json();if(!r.ok||!out.ok)throw new Error(out.error||`${r.status}`);
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
load();
})();