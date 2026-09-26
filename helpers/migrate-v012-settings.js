#!/usr/bin/env node
'use strict';
const fs=require('fs');
const file='/data/shackclock-settings.json';
let c={};
try { c=JSON.parse(fs.readFileSync(file,'utf8')); } catch (_) { process.exit(0); }
const any=Array.from({length:8},(_,i)=>String(c[`CITY${i+1}_TZ`]||'').trim()).some(Boolean);
if (any) process.exit(0);
const defs=[['Tokyo','Asia/Tokyo'],['Sydney','Australia/Sydney'],['London','Europe/London'],['New York','America/New_York'],['Denver','America/Denver'],['Chicago','America/Chicago']];
for(let i=1;i<=8;i++){ c[`CITY${i}_LABEL`]=''; c[`CITY${i}_TZ`]=''; }
defs.forEach((x,i)=>{c[`CITY${i+1}_LABEL`]=x[0]; c[`CITY${i+1}_TZ`]=x[1];});
fs.writeFileSync(file,JSON.stringify(c,null,2)+'\n');
console.log('[ShackClock] seeded v0.12 default city clocks');
