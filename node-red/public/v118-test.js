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
  const c=$('v118-muf-toggle');
  if(c){
   c.checked=active('muf',false);
   c.addEventListener('change',()=>{
    prefs.muf=c.checked;
    try{localStorage.setItem(key,JSON.stringify(prefs))}catch{}
    show('v118-muf-panel',c.checked);
    refreshMuf();
   });
  }
  show('v118-passes-panel',active('passes'));
  show('v118-charts-panel',active('charts'));
  show('v118-muf-panel',active('muf',false));
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
 async function dataset(local,remote){
  try{return await get(local)}catch(e){console.warn('Local NOAA route failed; trying NOAA directly:',local,e);return await get(remote)}
 }
 async function charts(){
  if(!active('charts'))return;
  const messages=[];
  try{
   const kp=await dataset('/api/space/kp','https://services.swpc.noaa.gov/json/planetary_k_index_1m.json');
   const karr=(Array.isArray(kp)?kp:[]).map(x=>[Date.parse(x.time_tag||x.time),Number(x.kp_index??x.kp)]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1])).sort((a,b)=>a[0]-b[0]).slice(-1440);
   if(!karr.length)throw Error('no numeric Kp samples');
   plot($('v118-kp-canvas'),karr,0,9,'#67d7ff');
   messages.push('Kp '+karr.length+' samples');
  }catch(e){messages.push('Kp unavailable: '+e.message)}
  try{
   const xray=await dataset('/api/space/xray','https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json');
   const arr=(Array.isArray(xray)?xray:[]).filter(x=>String(x.energy||'').includes('0.1-0.8')).map(x=>[Date.parse(x.time_tag),Number(x.flux)]).filter(x=>Number.isFinite(x[0])&&x[1]>0).sort((a,b)=>a[0]-b[0]);
   if(!arr.length)throw Error('no long-channel X-ray samples');
   plot($('v118-xray-canvas'),arr,-9,-3,'#ffca66',true);
   messages.push('GOES X-ray '+arr.length+' samples');
  }catch(e){messages.push('X-ray unavailable: '+e.message)}
  $('v118-chart-status').textContent='NOAA SWPC · '+messages.join(' · ')+' · UTC';
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
 const KC2G_SOURCE='https://prop.kc2g.com/';
 function mufValue(feature){
  const p=feature?.properties||{};
  for(const key of ['level-value','value','level','muf','MUF','muf_mhz','mufd','MHz','mhz','contour','CONTOUR']){
   const raw=p[key];if(raw===null||raw===undefined||raw==='')continue;
   const number=Number(raw);if(Number.isFinite(number)&&number>=0&&number<=100)return number;
  }
  return null;
 }
 function mufColor(n){return n>=28?'#fe665e':n>=21?'#feb65b':n>=14?'#e9e86e':n>=7?'#73debb':'#668cf5'}

 let mufLabels=null,mufFeatures=[],mufLabelMap=null;
 function mufStatus(message){const e=$('v118-muf-status');if(e)e.textContent=message}
 function mufTime(r,features){
   const p=features.find(f=>f?.properties?.time||f?.properties?.timestamp)?.properties||{};
   const candidates=[r?.properties?.timestamp,r?.properties?.time,r?.metadata?.timestamp,r?.metadata?.time,r?.timestamp,r?.time,p.timestamp,p.time];
   const nice=c=>{if(c===null||c===undefined||c==='')return null;const d=new Date(c);return Number.isFinite(d.getTime())?d.toISOString().slice(0,16).replace('T',' ')+' UTC':null};
   for(const c of candidates){if(!c)continue;const n=nice(c);if(n)return 'KC2G map time: '+n+' (model time)'}
   const modified=nice(r?._shackclock?.sourceLastModified);
   const retrieved=nice(r?._shackclock?.retrievedAt)||nice(Date.now());
   return modified?'KC2G source modified: '+modified+' · checked '+retrieved:'Retrieved '+retrieved+' · KC2G model time unavailable';
 }
 function wrapLine(coords){
   let last=null,shift=0;
   return (coords||[]).map(p=>{
     const lon=Number(p[0]);if(!Number.isFinite(lon))return p;
     let x=lon+shift;
     if(last!==null){
       while(x-last>180){shift-=360;x-=360}
       while(x-last< -180){shift+=360;x+=360}
     }
     last=x;return [x,...p.slice(1)];
   });
 }
 function wrapGeometry(g,delta){
   if(!g)return null;
   const tr=line=>wrapLine(line).map(p=>[Number(p[0])+delta,...p.slice(1)]);
   if(g.type==='LineString')return {type:g.type,coordinates:tr(g.coordinates)};
   if(g.type==='MultiLineString'||g.type==='Polygon')return {type:g.type,coordinates:g.coordinates.map(tr)};
   if(g.type==='MultiPolygon')return {type:g.type,coordinates:g.coordinates.map(poly=>poly.map(tr))};
   return null;
 }
 function worldCopies(features){
   const out=[];
   for(const f of features){
     for(const offset of [-720,-360,0,360,720]){
       const geometry=wrapGeometry(f.geometry,offset);
       if(geometry)out.push({type:'Feature',properties:f.properties,geometry});
     }
   }
   return out;
 }
 function colorFor(f){return f.properties?.stroke||mufColor(mufValue(f))}
 function legend(features){
   const values=new Map();
   for(const f of features){const n=mufValue(f);if(n!==null&&!values.has(n))values.set(n,colorFor(f))}
   const el=$('v118-muf-legend');if(!el)return;
   el.replaceChildren();
   for(const [n,color] of [...values].sort((a,b)=>a[0]-b[0])){
     const item=document.createElement('span');item.className='v118-muf-key';
     const swatch=document.createElement('i');swatch.className='v118-muf-swatch';swatch.style.backgroundColor=color;
     const label=document.createElement('span');label.textContent=Number(n).toLocaleString(undefined,{maximumFractionDigits:1});
     item.append(swatch,label);el.append(item);
   }
 }
 function lineParts(geometry){
   if(!geometry)return [];
   if(geometry.type==='LineString')return [geometry.coordinates];
   if(geometry.type==='MultiLineString')return geometry.coordinates;
   if(geometry.type==='Polygon')return geometry.coordinates.slice(0,1);
   if(geometry.type==='MultiPolygon')return geometry.coordinates.map(x=>x[0]);
   return [];
 }
 function updateMufLabels(){
   if(!mufLabelMap||!mufLabels||!mufLabelMap.hasLayer(mufLabels))return;
   mufLabels.clearLayers();
   const bounds=mufLabelMap.getBounds(),occupied=[],seenValues=new Map();
   // One or two labels per MHz contour level in the viewport, with collision avoidance.
   for(const f of mufFeatures){
     const n=mufValue(f);if(n===null||seenValues.get(n)>=2)continue;
     const parts=lineParts(f.geometry).sort((a,b)=>b.length-a.length);
     let chosen=null,score=-1;
     for(const coords of parts){
       if(!Array.isArray(coords)||coords.length<3)continue;
       const step=Math.max(1,Math.floor(coords.length/30));
       for(let i=0;i<coords.length;i+=step){
         const coord=coords[i];if(!Array.isArray(coord)||coord.length<2)continue;
         const lat=Number(coord[1]),lon=Number(coord[0]);
         if(!Number.isFinite(lat)||!Number.isFinite(lon)||!bounds.contains([lat,lon]))continue;
         const pt=mufLabelMap.latLngToContainerPoint([lat,lon]);
         const w=mufLabelMap.getSize();
         if(pt.x<25||pt.y<30||pt.x>w.x-25||pt.y>w.y-30)continue;
         if(occupied.some(o=>Math.hypot(o.x-pt.x,o.y-pt.y)<90))continue;
         const q=Math.min(pt.x,w.x-pt.x,pt.y,w.y-pt.y);
         if(q>score){score=q;chosen={lat,lon,pt}}
       }
     }
     if(!chosen)continue;
     occupied.push(chosen.pt);seenValues.set(n,(seenValues.get(n)||0)+1);
     const icon=L.divIcon({className:'v118-muf-label-icon',html:'<span class="v118-muf-label">'+Number(n).toLocaleString(undefined,{maximumFractionDigits:1})+' MHz</span>',iconSize:[58,17],iconAnchor:[29,8]});
     L.marker([chosen.lat,chosen.lon],{icon,interactive:false,keyboard:false,zIndexOffset:250}).addTo(mufLabels);
     if(occupied.length>=20)break;
   }
 }
 async function refreshMuf(){
   if(!active('muf',false)){
     if(mufLayer&&mufMap)mufMap.removeLayer(mufLayer);
     if(mufLabels&&mufMap)mufMap.removeLayer(mufLabels);
     return;
   }
   try{
     const r=await get('/api/space/muf');
     if(r?.error)throw Error(r.error);
     const features=(Array.isArray(r?.features)?r.features:[]).filter(f=>f&&f.geometry);
     if(!features.length)throw Error('KC2G returned no GeoJSON features');
     const map=window.shackclockMap;if(!map)throw Error('Leaflet map is not ready');
     const styled=features.filter(f=>mufValue(f)!==null);
     if(!styled.length)throw Error('KC2G contour level-value missing');
     const wrapped=worldCopies(styled);
     const layer=L.geoJSON({type:'FeatureCollection',features:wrapped},{
       style:f=>{const n=mufValue(f),t=f.geometry?.type||'';return {color:colorFor(f),weight:t.includes('Line')?2:0.6,opacity:.9,fillColor:mufColor(n),fillOpacity:t.includes('Polygon')?.20:0}},
       onEachFeature:(f,l)=>{const n=mufValue(f);if(n!==null)l.bindTooltip('KC2G MUF(3000): '+n.toFixed(1)+' MHz')}
     });
     if(mufLayer&&mufMap)mufMap.removeLayer(mufLayer);
     if(mufLabels&&mufMap)mufMap.removeLayer(mufLabels);
     mufMap=map;mufLayer=layer;mufFeatures=wrapped;
     layer.addTo(map);
     mufLabels=L.layerGroup().addTo(map);
     if(mufLabelMap!==map){
       if(mufLabelMap)mufLabelMap.off('moveend zoomend',updateMufLabels);
       mufLabelMap=map;map.on('moveend zoomend',updateMufLabels);
     }
     legend(styled);updateMufLabels();
     const timeEl=$('v118-muf-time');if(timeEl)timeEl.textContent=mufTime(r,features);
     mufStatus('KC2G MUF(3000) · '+styled.length+' contours · repeated across world copies');
   }catch(e){mufStatus('KC2G MUF unavailable: '+e.message);console.warn('KC2G MUF',e)}
 }
 function syncSettings(){
  for(const name of ['passes','charts']){
   const el=$('v118-setting-'+name);
   if(el)el.value=active(name)?'on':'off';
  }
 }
 function saveSettings(){
  for(const name of ['passes','charts']){
   const el=$('v118-setting-'+name);
   if(el)prefs[name]=el.value==='on';
  }
  try{localStorage.setItem(key,JSON.stringify(prefs))}catch{}
  for(const name of ['passes','charts'])show('v118-'+name+'-panel',active(name));
  charts();passes();
 }
 window.shackclock118={syncSettings,saveSettings};
 function ready(){
  setup();setTimeout(()=>{charts();passes();refreshMuf()},3000);
  setInterval(charts,5*60000);setInterval(passes,30*60000);setInterval(refreshMuf,15*60000);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();