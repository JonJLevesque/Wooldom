'use strict';
/* Wave 0 smoke: shim loads every module in index.html order without throwing,
   and core.js's contract globals exist with their frozen values. */
const { load } = require('./shim');
const results=[];
const check=(l,ok)=>{ console.log((ok?'PASS':'FAIL')+'  '+l); results.push(ok); };

/* Page-integrity scan — BEFORE load(): two modules declaring one top-level
   name is a defect in the shared eval scope. const/let/class dies loudly as a
   SyntaxError; function/var redeclaration is LEGAL and silently overwrites
   (last file in load order wins) — measured: an empty stub painter planted
   that way passed every suite except this check. Column-0 only = top-level. */
{
  const fs=require('fs'), path=require('path');
  const ROOT=path.join(__dirname,'..');
  const order=[...fs.readFileSync(path.join(ROOT,'index.html'),'utf8')
    .matchAll(/<script src="([^"]+)"><\/script>/g)].map(m=>m[1]);
  const seen={};
  for(const f of order)
    for(const ln of fs.readFileSync(path.join(ROOT,f),'utf8').split('\n')){
      const d=/^(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/.exec(ln);
      if(d) (seen[d[2]] = seen[d[2]]||[]).push(f);
      const m=/^(const|let|var)\s+(.+)$/.exec(ln);
      if(m) for(const seg of m[2].split(','))
        { const n=/^\s*([A-Za-z_$][\w$]*)\s*=/.exec(seg); if(n) (seen[n[1]] = seen[n[1]]||[]).push(f); }
    }
  const dupes=Object.entries(seen)
    .map(([n,fl])=>[n,[...new Set(fl)]]).filter(([,fl])=>fl.length>1);
  check('no two modules declare the same top-level name', dupes.length===0);
  if(dupes.length) console.log('  → '+dupes.map(([n,fl])=>n+' in '+fl.join(' + ')).join('; '));
}

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
