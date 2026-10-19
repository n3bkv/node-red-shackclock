/* ShackClock 1.1.8 experimental add-on. Keeps 1.1.7 solar UI intact. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const key='shackclock.v118.display';
 const prefs=(()=>{try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return {}}})();
 const active=(name,defaultValue=true)=>prefs[name]!==undefined?!!prefs[name]:defaultValue;
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const get=async(url)=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);return r.json()};
 function show(id,on){const e=$(id);if(e)e.hidden=!on}
 function setup(){
  for(const name of ['passes','charts','muf']){const c=$('v118-'+name+'-toggle');if(!c)continue;c.checked=active(name,name!=='muf');c.addEventListener('change',()=>{prefs[name]=c.checked;localStorage.setItem(key,JSON.stringify(prefs));show('v118-'+name+'-panel',c.checked);if(name==='muf')refreshMuf()})}
  show('v118-passes-panel',active('passes'));show('v118-charts-panel',active('charts'));show('v118-muf-panel',active('muf',false));
 }
 function plot(canvas,points,min,max,color,log=false){
  if(!canvas)return;const dpr=window.devicePixelRatio||1,w=Math.max(100,canvas.clientWidth),h=canvas.clientHeight||90;canvas.width=w*dpr;canvas.height=h*dpr;
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);ctx.strokeStyle='rgba(255,255,255,.14)';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){let y=6+i*(h-18)/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  if(points.length<2)return;const t0=points[0][0],span=Math.max(1,points.at(-1)[0]-t0);
  ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=1.8;let drawn=0;
  points.forEach(([t,v])=>{const n=log?Math.log10(Math.max(1e-10,v)):v;if(!Number.isFinite(n))return;const x=(t-t0)/span*(w-1),y=6+(1-(n-min)/(max-min))*(h-18);if(drawn++)ctx.lineTo(x,y);else ctx.moveTo(x,y)});
  ctx.stroke();
 }
 async function charts(){
  if(!active('charts'))return;
  try{
   const [kp,xray]=await Promise.all([get('/api/space/kp'),get('/api/space/xray')]);
   const karr=(Array.isArray(kp)?kp:[]).map(x=>[Date.parse(x.time_tag||x.time),Number(x.kp_index??x.kp)]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1])).sort((a,b)=>a[0]-b[0]).slice(-1000);
   plot($('v118-kp-canvas'),karr,0,9,'#67d7ff');
   const arr=(Array.isArray(xray)?xray:[]).filter(x=>String(x.energy||'').includes('0.1-0.8')).map(x=>[Date.parse(x.time_tag),Number(x.flux)]).filter(x=>Number.isFinite(x[0])&&x[1]>0).sort((a,b)=>a[0]-b[0]);
   plot($('v118-xray-canvas'),arr,-9,-3,'#ffca66',true);
   $('v118-chart-status').textContent='NOAA SWPC · Kp '+karr.length+' points · X-ray '+arr.length+' points · UTC';
  }catch(e){$('v118-chart-status').textContent='NOAA charts unavailable: '+e.message}
 }
 function look(satrec,observer,date){
  const pv=satellite.propagate(satrec,date);if(!pv.position)return null;
  const gmst=satellite.gstime(date),ecf=satellite.eciToEcf(pv.position,gmst);
  const angle=satellite.ecfToLookAngles(observer,ecf);
  return {elev:angle.elevation*180/Math.PI,az:(angle.azimuth*180/Math.PI+360)%360};
 }
 async function passes(){
  if(!active('passes'))return;
  try{
   const config=await get('/api/config'),lat=Number(config.lat),lon=Number(config.lon);
   if(!Number.isFinite(lat)||!Number.isFinite(lon))throw Error('Invalid station coordinates');
   const observer={latitude:lat*Math.PI/180,longitude:lon*Math.PI/180,height:0};
   const text=await (await fetch('/api/amateur/tle',{cache:'no-store'})).text();
   const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),sats=[];
   for(let i=0;i<lines.length-2;i++)if(!lines[i].startsWith('1 ')&&lines[i+1].startsWith('1 ')&&lines[i+2].startsWith('2 ')){try{sats.push({name:lines[i],rec:satellite.twoline2satrec(lines[i+1],lines[i+2])})}catch{}i+=2}
   const now=Date.now(),step=60000,end=now+24*3600000,results=[];
   for(const sat of sats){
    let prev=look(sat.rec,observer,new Date(now)),start=null,maximum=-90,peakAz=0;
    for(let t=now+step;t<=end;t+=step){
     const p=look(sat.rec,observer,new Date(t));if(!p)continue;
     if(p.elev>maximum&&start!==null){maximum=p.elev;peakAz=p.az}
     if(prev&&prev.elev<10&&p.elev>=10){start=t;maximum=p.elev;peakAz=p.az}
     if(start!==null&&prev&&prev.elev>=10&&p.elev<10){if(maximum>=10)results.push({name:sat.name,aos:start,los:t,max:maximum,az:peakAz});start=null;maximum=-90}
     prev=p;
    }
   }
   results.sort((a,b)=>a.aos-b.aos);
   $('v118-passes-body').innerHTML=results.slice(0,7).map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+new Date(p.aos).toISOString().slice(11,16)+'</td><td>'+new Date(p.los).toISOString().slice(11,16)+'</td><td>'+p.max.toFixed(0)+'°</td></tr>').join('')||'<tr><td colspan="4">No passes above 10° in 24h</td></tr>';
   $('v118-pass-status').textContent='Next 24h · '+sats.length+' AMSAT-active TLEs · 10° minimum · times UTC · 1-minute sampling';
  }catch(e){$('v118-pass-status').textContent='Pass predictions unavailable: '+e.message}
 }
 let mufLayer=null,mufMap=null;
 async function refreshMuf(){
  if(!active('muf',false)){if(mufLayer&&mufMap)mufMap.removeLayer(mufLayer);return}
  try{
   const r=await get('/api/space/muf');
   if(r?.error)throw Error(r.error);
   const features=(r.type==='FeatureCollection'?r.features:[]).filter(f=>f?.geometry&&Number.isFinite(Number(f.properties?.muf??f.properties?.MUF??f.properties?.muf_mhz)));
   if(!features.length)throw Error('Source returned no recognized MUF geometries');
   const map=window.shackclockMap;
   if(!map)throw Error('Leaflet map not yet available to add-on');
   mufMap=map;if(mufLayer)map.removeLayer(mufLayer);
   mufLayer=L.geoJSON({type:'FeatureCollection',features},{style:f=>{const n=Number(f.properties.muf??f.properties.MUF??f.properties.muf_mhz);return {color:'#000',weight:.1,fillColor:n>=28?'#fe665e':n>=21?'#feb65b':n>=14?'#e9e86e':n>=7?'#73debb':'#668cf5',fillOpacity:.28}},interactive:false}).addTo(map);
   $('v118-muf-status').textContent='MUF · '+features.length+' source grid cells · estimated ionospheric conditions (source dependent)';
  }catch(e){$('v118-muf-status').textContent='MUF not available: '+e.message}
 }
 function ready(){
  setup();setTimeout(()=>{charts();passes();refreshMuf()},3000);
  setInterval(charts,5*60000);setInterval(passes,30*60000);setInterval(refreshMuf,15*60000);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();