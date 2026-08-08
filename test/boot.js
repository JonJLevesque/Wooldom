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


/* Third collision vector (ui-e/game-c): `window.X =` publishes have no
   declaration keyword — same silent last-loader-wins overwrite, invisible to
   the declaration scan above. Do NOT use indentation as a guard proxy (env
   guards are indented too). Measured: a stubbed window.paintTile passed seven
   suites. */
{
  const fs=require('fs'), path=require('path');
  const ROOT=path.join(__dirname,'..');
  const order=[...fs.readFileSync(path.join(ROOT,'index.html'),'utf8')
    .matchAll(/<script src="([^"]+)"><\/script>/g)].map(m=>m[1]);
  const INTENDED = {   // pinned PUBLISHER SETS, not bare names — a third
    // publisher or a changed set fires this check. Why each is safe:
    // G: ui.js publishes only under a guard when game.js hasn't landed
    //    (uiflow asserts the guard's SEMANTICS at runtime — engine G carries
    //    autoAI/replaying/step; the placeholder doesn't).
    // WoolDbg: game.js defines; ai.js accessor-intercepts to add aiMove;
    //    ui.js augments — the contract's "augment, never replace" chain.
    G:'js/game.js,js/ui.js', WoolDbg:'js/ai.js,js/game.js,js/ui.js' };
  const pubs={};
  for(const f of order){
    const src=fs.readFileSync(path.join(ROOT,f),'utf8');
    for(const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=[^=]/g))
      (pubs[m[1]] = pubs[m[1]]||new Set()).add(f);
    for(const m of src.matchAll(/Object\.defineProperty\(\s*window\s*,\s*['"]([\w$]+)['"]/g))
      (pubs[m[1]] = pubs[m[1]]||new Set()).add(f);
  }
  const bad=[];
  for(const [n,files] of Object.entries(pubs)){
    if(files.size<2) continue;
    const key=[...files].sort().join(',');
    if(INTENDED[n]!==key) bad.push(n+' in '+key+(INTENDED[n]?' (expected '+INTENDED[n]+')':''));
  }
  check('window publishes have exactly their intended publisher sets', bad.length===0);
  if(bad.length) console.log('  → '+bad.join('; '));

  /* Fourth vector: a window.X publish vs a top-level function/var DECLARATION
     of X in another module. In the browser a classic script's function/var
     declaration IS window.X, so the publish overwrites the binding and
     bare-name callers get the stub — invisible to both scans alone. */
  const decls={};
  for(const f of order)
    for(const ln of fs.readFileSync(path.join(ROOT,f),'utf8').split('\n')){
      const d=/^(function|var)\s+([A-Za-z_$][\w$]*)/.exec(ln);
      if(d) (decls[d[2]] = decls[d[2]]||new Set()).add(f);
    }
  const cross=[];
  for(const [n,pubFiles] of Object.entries(pubs)){
    if(!decls[n]) continue;
    const others=[...pubFiles].filter(f=>!decls[n].has(f));
    if(others.length) cross.push(n+' declared in '+[...decls[n]].join('+')+' but window-published by '+others.join('+'));
  }
  check('no window publish overwrites another module\'s declaration', cross.length===0);
  if(cross.length) console.log('  → '+cross.join('; '));
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
