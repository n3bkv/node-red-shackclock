#!/usr/bin/env node
'use strict';
const fs=require('fs');
const p='/data/shackclock-settings.json';
const old='https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=JSON';
const newer='https://api.wheretheiss.at/v1/satellites/25544/tles?format=text';
try {
  if (!fs.existsSync(p)) process.exit(0);
  const c=JSON.parse(fs.readFileSync(p,'utf8'));
  if (!c.ISS_TLE_URL || c.ISS_TLE_URL===old || c.ISS_TLE_URL===old.replace('FORMAT=JSON','FORMAT=TLE')) {
    c.ISS_TLE_URL=newer;
    fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n');
    console.log('[ShackClock] migrated default ISS source to WhereTheISS.at');
  }
} catch(e) { console.error('[ShackClock] v0.12.1 settings migration:',e.message); }
