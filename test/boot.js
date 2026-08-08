'use strict';
/* Wave 0 smoke: shim loads every module in index.html order without throwing,
   and core.js's contract globals exist with their frozen values. */
const { load } = require('./shim');
const results=[];
const check=(l,ok)=>{ console.log((ok?'PASS':'FAIL')+'  '+l); results.push(ok); };
let g=null, err=null, probe=null;
try{ g=load(); probe=g.probe; }catch(e){ err=e; }
check('all modules load headlessly', !err || (console.log('  → '+err), false));
check('TILE/TPS/SHEPHERDS frozen', probe && probe('TILE')===64 && probe('TPS')===30 && probe('SHEPHERDS')===7);
check('ZOOMS are the three steps', probe && probe('ZOOMS.join(",")')==='0.5,1,2');
check('RNG deterministic + shuffle stable',
  probe && probe("(()=>{ RNG.seed(9); const a=RNG.shuffle([1,2,3,4,5]).join(''); RNG.seed(9); return a===RNG.shuffle([1,2,3,4,5]).join(''); })()"));
check('PAL + helpers present', probe && typeof probe('PAL.meadow')==='string' && probe("cellKey(3,-2)")==='3,-2');
console.log(results.every(Boolean)?'BOOT OK':'BOOT FAILED');
process.exit(results.every(Boolean)?0:1);
