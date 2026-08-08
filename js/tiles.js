'use strict';
/* ==================================================================
   WOOLDOM — js/tiles.js  (Wave 1-A)
   The roster: the 72-tile base satchel + the 12-tile Brook module.
   Pure data + three lookups. No drawing, no rules: art.js paints from
   these segments, board.js builds the feature graph from them.

   SLOT ENCODING (frozen by CONTRACT.md)
     sides  N=0 E=1 S=2 W=3;  slot = side*3 + i, i clockwise round the rim
       N: 0,1,2   (w→e)      E: 3,4,5   (n→s)
       S: 6,7,8   (e→w)      W: 9,10,11 (s→n)
     abut    side s slot i  meets  side (s+2)%4 slot 2-i
     rotate  90° cw → slot (slot+3)%12; the edges array rotates right
     owners  F side → all 3 slots to the fold seg
             M side → all 3 slots to ONE meadow seg
             L / B side → centre slot to the lane / brook seg,
                          flanks (i=0,2) to the meadows either side
             shrines own no slots (e:[])

   Segment fields
     t        'm' meadow | 'l' lane | 'f' fold | 's' shrine | 'b' brook
     e        slot ids at canonical rotation 0
     spot     [x,y] 0..63 art coords — where the shepherd stands
     ram      1 on the fold seg of a Prize Ram tile (authoritative for
              scoring); the tile also carries ram:1 as a "bears a ram" flag
     touches  meadow only: fold seg indices this meadow borders ON THIS TILE
              (board.js lifts these into feature-graph adjacency)

   Internal-connectivity rules worth stating once, because two tiles can
   share an edge signature and differ inside:
     · a spanning fold (FOLD2O) splits the meadows either side of it;
       two facing folds (FOLD2SEP_O) leave ONE meadow wrapping the middle.
     · lane crossings terminate their lanes: each arm of a 3-/4-way is its
       own segment ending at the hamlet. A through-lane is one segment
       holding both centre slots.
     · the brook fork is ONE segment — water is continuous, and a brook
       never scores, so it has no ends to terminate.

   A segment is identified by (cell, segIdx) — NEVER by (cell, type) or by
   its cell set. 20 of the 30 tiles carry two or more segments of one type,
   so several distinct features can sit on a single cell: Market Cross has
   four separate lanes and four separate meadows, Facing Folds and Neighbour
   Folds each hold two folds that score separately, and a Spanning Fold's two
   meadows both cover exactly the one cell they sit on. Anything keying
   features by cells collapses them.
   ================================================================== */

/* rotate a slot by `rot` quarter-turns clockwise (the frozen identity) */
function rotSlot(slot, rot){ return (slot + 3 * (((rot % 4) + 4) % 4)) % 12; }

/* the tile pre-placed at the origin when the Brook module is off */
const OPENING_TILE = 'FOLD1_LS';

/* ---------------- BASE SET — 72 tiles, our own mix ⚑ ---------------- */
const TILES = (function buildBaseSet(){
  const T = [

  /* -- lanes, shrines: the meadow-and-lane group, 28 tiles -- */

  { id:'LANE2_S', name:"Drover's Straight", edges:['L','M','L','M'], count:8,
    segs:[                                              // lane runs N–S
      {t:'l', e:[1,7],          spot:[32,32]},
      {t:'m', e:[2,3,4,5,6],    spot:[50,32]},          // east of the lane
      {t:'m', e:[8,9,10,11,0],  spot:[14,32]},          // west of the lane
    ]},

  { id:'LANE2_C', name:'Lane Bend', edges:['M','M','L','L'], count:9,
    segs:[                                              // curve S–W
      {t:'l', e:[7,10],             spot:[18,46]},
      {t:'m', e:[8,9],              spot:[9,55]},       // pocket inside the bend
      {t:'m', e:[11,0,1,2,3,4,5,6], spot:[40,22]},      // the rest
    ]},

  { id:'LANE3', name:'Hamlet Cross', edges:['M','L','L','L'], count:4,
    segs:[                                              // 3 arms end at the hamlet
      {t:'l', e:[4],          spot:[50,32]},
      {t:'l', e:[7],          spot:[32,50]},
      {t:'l', e:[10],         spot:[14,32]},
      {t:'m', e:[5,6],        spot:[48,52]},
      {t:'m', e:[8,9],        spot:[16,52]},
      {t:'m', e:[11,0,1,2,3], spot:[32,14]},            // wraps over the hamlet
    ]},

  { id:'LANE4', name:'Market Cross', edges:['L','L','L','L'], count:1,
    segs:[                                              // 4 arms, 4 meadow quarters
      {t:'l', e:[1],    spot:[32,12]},
      {t:'l', e:[4],    spot:[52,32]},
      {t:'l', e:[7],    spot:[32,52]},
      {t:'l', e:[10],   spot:[12,32]},
      {t:'m', e:[2,3],  spot:[50,14]},
      {t:'m', e:[5,6],  spot:[50,50]},
      {t:'m', e:[8,9],  spot:[14,50]},
      {t:'m', e:[11,0], spot:[14,14]},
    ]},

  { id:'SHRINE', name:'Wayside Shrine', edges:['M','M','M','M'], count:4,
    segs:[
      {t:'s', e:[],                        spot:[32,28]},
      {t:'m', e:[0,1,2,3,4,5,6,7,8,9,10,11], spot:[14,52]},
    ]},

  { id:'SHRINE_L', name:"Pilgrim's Stub", edges:['M','M','L','M'], count:2,
    segs:[                                              // lane dies at the shrine
      {t:'s', e:[],                          spot:[32,26]},
      {t:'l', e:[7],                         spot:[32,54]},
      {t:'m', e:[8,9,10,11,0,1,2,3,4,5,6],   spot:[12,44]}, // wraps behind the shrine
    ]},

  /* -- folds: 44 tiles -- */

  { id:'FOLD1', name:'Fold Edge', edges:['F','M','M','M'], count:5,
    segs:[
      {t:'f', e:[0,1,2],               spot:[32,10]},
      {t:'m', e:[3,4,5,6,7,8,9,10,11], spot:[32,46], touches:[0]},
    ]},

  { id:'FOLD1_LS', name:'Gate Road', edges:['F','L','M','L'], count:4,
    segs:[                                              // fold N, lane through E–W
      {t:'f', e:[0,1,2],       spot:[32,10]},
      {t:'l', e:[4,10],        spot:[32,40]},
      {t:'m', e:[3,11],        spot:[10,26], touches:[0]},  // strip under the wall
      {t:'m', e:[5,6,7,8,9],   spot:[32,55]},               // south of the lane
    ]},

  { id:'FOLD1_CSW', name:'Gate Bend West', edges:['F','M','L','L'], count:3,
    segs:[                                              // fold N + curve S–W
      {t:'f', e:[0,1,2],       spot:[32,10]},
      {t:'l', e:[7,10],        spot:[16,48]},
      {t:'m', e:[8,9],         spot:[8,56]},                // pocket inside the bend
      {t:'m', e:[11,3,4,5,6],  spot:[44,34], touches:[0]},  // band under the wall
    ]},

  { id:'FOLD1_CSE', name:'Gate Bend East', edges:['F','L','L','M'], count:3,
    segs:[                                              // fold N + curve S–E
      {t:'f', e:[0,1,2],       spot:[32,10]},
      {t:'l', e:[4,7],         spot:[47,47]},
      {t:'m', e:[5,6],         spot:[57,57]},
      {t:'m', e:[8,9,10,11,3], spot:[20,34], touches:[0]},
    ]},

  { id:'FOLD1_L3', name:'Fold Hamlet', edges:['F','L','L','L'], count:3,
    segs:[                                              // fold N + 3-way hamlet
      {t:'f', e:[0,1,2], spot:[32,10]},
      {t:'l', e:[4],     spot:[52,34]},
      {t:'l', e:[7],     spot:[32,52]},
      {t:'l', e:[10],    spot:[12,34]},
      {t:'m', e:[5,6],   spot:[50,52]},
      {t:'m', e:[8,9],   spot:[14,52]},
      {t:'m', e:[11,3],  spot:[32,26], touches:[0]},    // strip between wall and hamlet
    ]},

  { id:'FOLD2A', name:'Corner Fold', edges:['F','F','M','M'], count:3,
    segs:[                                              // one fold over the NE corner
      {t:'f', e:[0,1,2,3,4,5],    spot:[42,20]},
      {t:'m', e:[6,7,8,9,10,11],  spot:[18,46], touches:[0]},
    ]},

  { id:'FOLD2O', name:'Spanning Fold', edges:['F','M','F','M'], count:1,
    segs:[                                              // one fold N–S: splits the meadows
      {t:'f', e:[0,1,2,6,7,8], spot:[32,32]},
      {t:'m', e:[3,4,5],       spot:[56,32], touches:[0]},
      {t:'m', e:[9,10,11],     spot:[8,32],  touches:[0]},
    ]},

  { id:'FOLD2A_C', name:'Corner Fold Bend', edges:['F','F','L','L'], count:3,
    segs:[                                              // NE fold + curve S–W
      {t:'f', e:[0,1,2,3,4,5], spot:[44,18]},
      {t:'l', e:[7,10],        spot:[16,48]},
      {t:'m', e:[8,9],         spot:[10,56]},               // pocket inside the bend
      {t:'m', e:[6,11],        spot:[42,50], touches:[0]},  // band between wall and lane
    ]},

  { id:'FOLD2SEP_O', name:'Facing Folds', edges:['F','M','F','M'], count:3,
    segs:[                                    // same rim as FOLD2O, different insides:
      {t:'f', e:[0,1,2],           spot:[32,9]},
      {t:'f', e:[6,7,8],           spot:[32,55]},
      {t:'m', e:[3,4,5,9,10,11],   spot:[32,32], touches:[0,1]}, // ONE meadow, wraps
    ]},

  { id:'FOLD2SEP_A', name:'Neighbour Folds', edges:['F','F','M','M'], count:2,
    segs:[
      {t:'f', e:[0,1,2],          spot:[26,9]},
      {t:'f', e:[3,4,5],          spot:[55,42]},
      {t:'m', e:[6,7,8,9,10,11],  spot:[22,46], touches:[0,1]},
    ]},

  { id:'FOLD3', name:'Great Fold', edges:['F','F','M','F'], count:3,
    segs:[                                              // fold on three sides
      {t:'f', e:[0,1,2,3,4,5,9,10,11], spot:[32,24]},
      {t:'m', e:[6,7,8],               spot:[32,56], touches:[0]},
    ]},

  { id:'FOLD3_L', name:'Great Fold Gate', edges:['F','F','L','F'], count:1,
    segs:[                          // lane stub S dies at the gate, splitting the verge
      {t:'f', e:[0,1,2,3,4,5,9,10,11], spot:[32,22]},
      {t:'l', e:[7],                   spot:[32,56]},
      {t:'m', e:[6],                   spot:[52,58], touches:[0]},
      {t:'m', e:[8],                   spot:[12,58], touches:[0]},
    ]},

  { id:'FOLD4_R', name:'High Fold', edges:['F','F','F','F'], count:1, ram:1,
    segs:[                                              // the only High Fold, always rammed
      {t:'f', e:[0,1,2,3,4,5,6,7,8,9,10,11], spot:[32,32], ram:1},
    ]},

  ];

  /* Prize Ram twins: same geometry and art, plus the ram emblem. Derived
     rather than retyped so the two versions can never drift apart. */
  const RAM_TWINS = [
    ['FOLD2A',     'FOLD2A_R',     'Corner Fold & Ram',      2],
    ['FOLD2O',     'FOLD2O_R',     'Spanning Fold & Ram',    2],
    ['FOLD2A_C',   'FOLD2A_C_R',   'Corner Fold Bend & Ram', 2],
    ['FOLD3',      'FOLD3_R',      'Great Fold & Ram',       1],
    ['FOLD3_L',    'FOLD3_L_R',    'Great Fold Gate & Ram',  2],
  ];
  for(const [baseId, id, name, count] of RAM_TWINS){
    const i = T.findIndex(t => t.id === baseId);
    if(i < 0) continue;
    const t = JSON.parse(JSON.stringify(T[i]));
    t.id = id; t.name = name; t.count = count; t.ram = 1;
    const fold = t.segs.find(s => s.t === 'f');
    if(fold) fold.ram = 1;
    T.splice(i + 1, 0, t);                              // sits beside its plain twin
  }
  return T;
})();

/* ---------------- BROOK MODULE — 12 tiles ----------------
   EVERY non-brook edge in this module is meadow, and that is load-bearing,
   not decoration. A Lake has one brook edge, so exactly one rotation faces
   any given open end: it has NO rotational freedom, and its other three sides
   must match three already-placed neighbours. Any L or F edge anywhere in the
   module is therefore a mine the Lake can step on, and when it does, the
   Lake is set aside and that brook end stays open for the whole game — no
   base tile carries a B edge to close it later.
   Measured over 4000 seeded openings: 3 non-meadow rim edges (the Plank
   Crossing's two lanes + the Bankside Fold's wall) → 19.2% of games ended
   with a dangling brook; the same mix with those edges gone → 1.5%. A shrine
   owns no rim slots, so it is the one feature a brook tile can carry free —
   which is why the crossing and the bankside fold gave way to a second
   Brookside Shrine and a fourth Brook Reach, keeping the straight/curve
   profile (4 straights, 4 bends) exactly as it was. */
const BROOK_TILES = [

  { id:'B_SPRING', name:'The Spring', edges:['M','M','B','M'], count:1,
    segs:[                                              // source pond, outflow S
      {t:'b', e:[7],                       spot:[32,44]},
      {t:'m', e:[8,9,10,11,0,1,2,3,4,5,6], spot:[14,20]},   // wraps behind the pond
    ]},

  { id:'B_FORK', name:'The Parting', edges:['B','B','B','M'], count:1,
    segs:[                                    // one body of water, three ways out
      {t:'b', e:[1,4,7],       spot:[32,32]},
      {t:'m', e:[2,3],         spot:[50,14]},
      {t:'m', e:[5,6],         spot:[50,50]},
      {t:'m', e:[8,9,10,11,0], spot:[13,32]},
    ]},

  { id:'B_STR', name:'Brook Reach', edges:['B','M','B','M'], count:4,
    segs:[
      {t:'b', e:[1,7],         spot:[32,32]},
      {t:'m', e:[2,3,4,5,6],   spot:[50,32]},
      {t:'m', e:[8,9,10,11,0], spot:[14,32]},
    ]},

  { id:'B_CURVE', name:'Brook Bend', edges:['M','B','B','M'], count:2,
    segs:[                                              // bend E–S
      {t:'b', e:[4,7],              spot:[47,47]},
      {t:'m', e:[5,6],              spot:[57,57]},
      {t:'m', e:[8,9,10,11,0,1,2,3], spot:[22,22]},
    ]},

  { id:'B_SHRINE', name:'Brookside Shrine', edges:['M','B','B','M'], count:2,
    segs:[                                    // shrine sits in the crook of the bend
      {t:'s', e:[],                  spot:[26,24]},
      {t:'b', e:[4,7],               spot:[48,48]},
      {t:'m', e:[5,6],               spot:[58,58]},
      {t:'m', e:[8,9,10,11,0,1,2,3], spot:[14,44]},
    ]},

  { id:'B_LAKE', name:'The Lake', edges:['B','M','M','M'], count:2,
    segs:[                                              // terminus: the water stops here
      {t:'b', e:[1],                       spot:[32,26]},
      {t:'m', e:[2,3,4,5,6,7,8,9,10,11,0], spot:[14,50]},
    ]},

];

/* ---------------- lookups (built once at load) ---------------- */
const _TILE_BY_ID = new Map();
const _EDGE_CODES = new Map();   // id → [rot0,rot1,rot2,rot3] 4-char strings
const _SLOT_OWNER = new Map();   // id → Int8Array(12) of segment indices

(function indexTiles(){
  for(const t of TILES.concat(BROOK_TILES)){
    _TILE_BY_ID.set(t.id, t);

    // rotating cw by r sends side i to side (i+r)%4, so side j reads edges[j-r]
    const codes = [];
    for(let r = 0; r < 4; r++){
      let code = '';
      for(let side = 0; side < 4; side++) code += t.edges[(side - r + 4) % 4];
      codes.push(code);
    }
    _EDGE_CODES.set(t.id, codes);

    const own = new Int8Array(12).fill(-1);
    t.segs.forEach((sg, i) => { for(const slot of sg.e) own[slot] = i; });
    _SLOT_OWNER.set(t.id, own);
  }
})();

function tileById(id){ return _TILE_BY_ID.get(id) || null; }

/* the 4-char N,E,S,W type string for a tile at `rot` quarter-turns cw */
function edgeCode(tileId, rot){
  const c = _EDGE_CODES.get(typeof tileId === 'string' ? tileId : tileId && tileId.id);
  return c ? c[((rot % 4) + 4) % 4] : null;
}

/* which segment owns a slot at canonical rotation (−1 = unowned/unknown) */
function slotOwner(tile, slot){
  const own = _SLOT_OWNER.get(typeof tile === 'string' ? tile : tile && tile.id);
  return own ? own[slot] : -1;
}
