/* Headless loader for Wooldom: stubs the DOM + canvas, concatenates the
   game modules in the same order as index.html, and evals them.
   Usage:  const {D, G} = require('./shim').load();  // D = WoolDbg (once ui.js ships) */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const noop = new Proxy(function(){}, {
  get: (t,p) => p===Symbol.toPrimitive ? ()=>'' : noop,
  apply: () => noop,
});
function ctxStub(){
  return new Proxy({}, {
    get(t,p){
      if(p==='createImageData') return (w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h});
      if(p in t) return t[p];
      return noop;
    },
    set(t,p,v){ t[p]=v; return true; },
  });
}
function makeEl(){
  const ctx = ctxStub();
  return {
    style:{}, dataset:{}, classList:{add(){},remove(){},toggle(){},contains:()=>false},
    addEventListener(){}, removeEventListener(){}, appendChild(){}, append(){}, remove(){},
    querySelector:()=>makeEl(), querySelectorAll:()=>[],
    getContext:()=>ctx, focus(){}, blur(){}, click(){},
    getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720}),
    innerHTML:'', textContent:'', className:'', title:'', id:'', value:'',
    width:0, height:0, disabled:false, hidden:false,
  };
}

function load(){
  const els = {};
  global.document = {
    getElementById: id => els[id] || (els[id] = makeEl()),
    createElement: () => makeEl(),
    querySelector: () => makeEl(),
    addEventListener(){}, removeEventListener(){},
    body: makeEl(), documentElement: makeEl(),
  };
  global.window = global;
  try{ Object.defineProperty(global,'navigator',{value:{maxTouchPoints:0,userAgent:'node-test'},configurable:true}); }catch(e){}
  global.performance = { now: () => Date.now() };
  global.requestAnimationFrame = () => 0;
  global.matchMedia = () => ({ matches:false, addEventListener(){}, addListener(){} });
  const store = {};
  global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k,v) => { store[k]=String(v); },
    removeItem: k => { delete store[k]; },
  };

  // concatenate modules in index.html's script order
  const html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m=>m[1]);
  if(!order.length) throw new Error('no script tags found in index.html');
  const src = order.map(f => fs.readFileSync(path.join(ROOT,f),'utf8')
                              .replace(/^'use strict';/m,'')).join('\n;\n');
  // append a probe so suites can reach eval-scoped consts before WoolDbg exists
  eval(src + "\n;window.__probe = (e)=>eval(e);");

  const D = global.window.WoolDbg, G = global.window.G;
  return { D, G, probe: global.window.__probe };
}
module.exports = { load };
