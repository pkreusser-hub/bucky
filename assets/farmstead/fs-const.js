/* FARMSTEAD fs-const.js — constants, enums, data tables, PRNG.
 * Single source of truth for every tunable. Sim-safe: no THREE, no DOM.
 * All mechanics are original code implementing classic settlement-game rules.
 */
(function () {
  "use strict";

  // ---------- PRNG (mulberry32) — ALL sim randomness flows through FSC.rng ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FSC = {};
  FSC.VERSION = 1;

  FSC.makeRng = mulberry32;
  FSC._rng = mulberry32(1);
  FSC.reseed = function (seed) { FSC._rng = mulberry32(seed >>> 0); FSC._rngState = seed >>> 0; FSC._rngCalls = 0; };
  FSC.rng = function () { FSC._rngCalls = (FSC._rngCalls || 0) + 1; return FSC._rng(); };
  FSC.rngInt = function (n) { return Math.floor(FSC.rng() * n); };
  // Save/restore stream position: we persist seed + call count and replay (calls are cheap).
  FSC.rngSnapshot = function () { return { seed: FSC._rngState >>> 0, calls: FSC._rngCalls || 0 }; };
  FSC.rngRestore = function (snap) {
    FSC.reseed(snap.seed);
    for (let i = 0; i < snap.calls; i++) FSC._rng();
    FSC._rngCalls = snap.calls;
  };

  // ---------- Core timing ----------
  FSC.TICK_S = 0.1;            // one game tick = 100ms at 1x
  FSC.SPEEDS = [0, 1, 2, 4];   // pause / 1x / 2x / 4x
  FSC.MAX_TICKS_PER_FRAME = 16;
  FSC.WALK_TICKS = 5;          // ticks per lattice edge for a serf (0.5s at 1x)
  FSC.WALK_TICKS_CARRY = 6;    // loaded carrier slightly slower
  FSC.WALK_TICKS_OFFROAD = 7;

  // ---------- Terrain ----------
  FSC.TERR = { WATER: 0, GRASS: 1, DESERT: 2, SWAMP: 3, MOUNTAIN: 4, SNOW: 5 };
  FSC.TILE = 2.0;              // world units per lattice step
  FSC.S_ROAD = 1.1;            // max |dy| per edge for roads
  FSC.S_SMALL = 0.9;           // max height spread around small building
  FSC.S_LARGE = 0.55;          // …medium/large buildings & farms (before leveling)
  FSC.MAP_SIZES = { small: 48, medium: 64, large: 96 };

  // Map objects (per-vertex)
  FSC.OBJ = {
    NONE: 0,
    TREE1: 1, TREE2: 2, TREE3: 3, TREE4: 4,      // growth stages; 4 = mature (choppable)
    STUMP: 5,
    STONE1: 6, STONE2: 7, STONE3: 8, STONE4: 9,  // pile size = charges bucket (objArg = exact)
    SAPLING: 10,
    FIELD0: 11, FIELD1: 12, FIELD2: 13, FIELD3: 14, FIELD4: 15, // sown..ripe
    FIELD_STUB: 16,                              // harvested, becomes NONE after a while
  };
  FSC.MINERAL = { NONE: 0, STONE: 1, COAL: 2, IRON: 3, GOLD: 4 };

  FSC.TREE_GROW_T = 2400;      // ticks per growth stage (4 min at 1x; forester keeps up)
  FSC.FIELD_GROW_T = 900;      // per field stage
  FSC.FIELD_STUB_T = 1800;
  FSC.FISH_REGROW_T = 6000;    // one fish regrows per this many ticks per coastal vertex (slow)

  // ---------- Resources (26) ----------
  const RES_LIST = [
    "plank", "stone", "lumber", "boat",
    "sword", "shield", "goldBar", "goldOre", "steel", "ironOre", "coal",
    "fish", "bread", "meat", "pig", "wheat", "flour",
    "shovel", "hammer", "rod", "cleaver", "scythe", "axe", "saw", "pick", "pincer",
  ];
  FSC.RES_LIST = RES_LIST;
  FSC.RES = {}; RES_LIST.forEach((r, i) => (FSC.RES[r] = r)); // string ids everywhere (save-friendly)
  FSC.RES_ORDER = RES_LIST.slice(); // default transport priority (index 0 = picked up first)
  FSC.TOOLS = ["shovel", "hammer", "rod", "cleaver", "scythe", "axe", "saw", "pick", "pincer"];
  FSC.FOODS = ["fish", "bread", "meat"];
  FSC.RES_ICON = {
    plank: "🪵", stone: "🪨", lumber: "🌲", boat: "🛶", sword: "⚔️", shield: "🛡", goldBar: "🪙",
    goldOre: "✨", steel: "🔩", ironOre: "⛏", coal: "⬛", fish: "🐟", bread: "🍞", meat: "🍖",
    pig: "🐖", wheat: "🌾", flour: "🥡", shovel: "🥄", hammer: "🔨", rod: "🎣", cleaver: "🔪",
    scythe: "🌙", axe: "🪓", saw: "🪚", pick: "⛏️", pincer: "🗜",
  };

  // ---------- Serf jobs ----------
  FSC.JOB = {
    GENERIC: "generic", TRANSPORTER: "transporter", SAILOR: "sailor",
    DIGGER: "digger", BUILDER: "builder",
    LUMBERJACK: "lumberjack", FORESTER: "forester", STONECUTTER: "stonecutter",
    FISHER: "fisher", FARMER: "farmer", MILLER: "miller", BAKER: "baker",
    PIGFARMER: "pigfarmer", BUTCHER: "butcher", SAWYER: "sawyer",
    MINER: "miner", SMELTER: "smelter", GOLDSMELTER: "goldsmelter",
    TOOLMAKER: "toolmaker", WEAPONSMITH: "weaponsmith", BOATWRIGHT: "boatwright",
    GEOLOGIST: "geologist", KNIGHT: "knight",
  };
  // tools needed to create each profession from a generic serf
  FSC.JOB_TOOLS = {
    transporter: [], sailor: [], digger: ["shovel"], builder: ["hammer"],
    lumberjack: ["axe"], forester: ["shovel"], stonecutter: ["pick"], fisher: ["rod"],
    farmer: ["scythe"], miller: [], baker: [], pigfarmer: [], butcher: ["cleaver"],
    sawyer: ["saw"], miner: ["pick"], smelter: [], goldsmelter: [],
    toolmaker: ["hammer", "saw"], weaponsmith: ["hammer", "pincer"], boatwright: ["hammer"],
    geologist: ["hammer"], knight: ["sword", "shield"], generic: [],
  };

  // ---------- Buildings ----------
  // size: 0 small, 1 medium, 2 large (large+medium need digger leveling)
  // cost {plank,stone}; radius = work radius; mil = {cap, terrRadius, goldCap}
  const B = {};
  function def(type, o) { o.type = type; B[type] = o; }
  def("castle",      { size: 2, cost: { plank: 0, stone: 0 }, hq: true, warehouse: true, mil: { cap: 12, terrRadius: 16, goldCap: 8 } });
  def("stock",       { size: 2, cost: { plank: 4, stone: 6 }, warehouse: true });
  def("hut",         { size: 0, cost: { plank: 2, stone: 1 }, mil: { cap: 3, terrRadius: 8, goldCap: 2 } });
  def("tower",       { size: 1, cost: { plank: 3, stone: 5 }, mil: { cap: 6, terrRadius: 11, goldCap: 4 } });
  def("fortress",    { size: 2, cost: { plank: 5, stone: 8 }, mil: { cap: 12, terrRadius: 14, goldCap: 8 } });
  def("fisher",      { size: 0, cost: { plank: 2, stone: 0 }, job: "fisher", radius: 7, out: "fish", cycleT: 220 });
  def("lumberjack",  { size: 0, cost: { plank: 2, stone: 0 }, job: "lumberjack", radius: 7, out: "lumber", cycleT: 180 });
  def("forester",    { size: 0, cost: { plank: 2, stone: 0 }, job: "forester", radius: 7, cycleT: 200 });
  def("stonecutter", { size: 0, cost: { plank: 2, stone: 0 }, job: "stonecutter", radius: 7, out: "stone", cycleT: 200 });
  def("sawmill",     { size: 1, cost: { plank: 2, stone: 2 }, job: "sawyer", in: { lumber: 1 }, out: "plank", cycleT: 140 });
  def("farm",        { size: 2, cost: { plank: 4, stone: 2 }, job: "farmer", radius: 7, out: "wheat", cycleT: 160 });
  def("mill",        { size: 1, cost: { plank: 2, stone: 2 }, job: "miller", in: { wheat: 1 }, out: "flour", cycleT: 160 });
  def("bakery",      { size: 1, cost: { plank: 2, stone: 3 }, job: "baker", in: { flour: 1 }, out: "bread", cycleT: 180 });
  def("pigfarm",     { size: 2, cost: { plank: 4, stone: 2 }, job: "pigfarmer", in: { wheat: 1 }, out: "pig", cycleT: 380 });
  def("butcher",     { size: 1, cost: { plank: 2, stone: 1 }, job: "butcher", in: { pig: 1 }, out: "meat", outN: 2, cycleT: 160 });
  def("stoneMine",   { size: 0, cost: { plank: 4, stone: 1 }, mine: "STONE", job: "miner", inFood: 1, out: "stone", cycleT: 260, mountain: true });
  def("coalMine",    { size: 0, cost: { plank: 4, stone: 1 }, mine: "COAL", job: "miner", inFood: 1, out: "coal", cycleT: 260, mountain: true });
  def("ironMine",    { size: 0, cost: { plank: 4, stone: 1 }, mine: "IRON", job: "miner", inFood: 1, out: "ironOre", cycleT: 280, mountain: true });
  def("goldMine",    { size: 0, cost: { plank: 4, stone: 1 }, mine: "GOLD", job: "miner", inFood: 1, out: "goldOre", cycleT: 300, mountain: true });
  def("smelter",     { size: 1, cost: { plank: 2, stone: 3 }, job: "smelter", in: { coal: 1, ironOre: 1 }, out: "steel", cycleT: 240 });
  def("goldsmelter", { size: 1, cost: { plank: 2, stone: 3 }, job: "goldsmelter", in: { coal: 1, goldOre: 1 }, out: "goldBar", cycleT: 240 });
  def("toolmaker",   { size: 1, cost: { plank: 3, stone: 3 }, job: "toolmaker", in: { plank: 1, steel: 1 }, outTool: true, cycleT: 300 });
  def("weaponsmith", { size: 1, cost: { plank: 2, stone: 3 }, job: "weaponsmith", in: { coal: 1, steel: 1 }, outWeapon: true, cycleT: 300 });
  def("boatwright",  { size: 0, cost: { plank: 2, stone: 0 }, job: "boatwright", in: { plank: 2 }, out: "boat", cycleT: 400 });
  FSC.BLD = B;
  FSC.BLD_LIST = Object.keys(B);
  FSC.BLD_NAME = {
    castle: "Castle", stock: "Storehouse", hut: "Guard Hut", tower: "Watchtower", fortress: "Fortress",
    fisher: "Fisher's Hut", lumberjack: "Woodcutter", forester: "Forester", stonecutter: "Stonecutter",
    sawmill: "Sawmill", farm: "Grain Farm", mill: "Windmill", bakery: "Bakery", pigfarm: "Pig Farm",
    butcher: "Butcher", stoneMine: "Stone Mine", coalMine: "Coal Mine", ironMine: "Iron Mine",
    goldMine: "Gold Mine", smelter: "Iron Smelter", goldsmelter: "Gold Smelter",
    toolmaker: "Toolmaker", weaponsmith: "Weaponsmith", boatwright: "Boatwright",
  };

  // ---------- Transport / flags ----------
  FSC.FLAG_CAP = 8;            // goods waiting at a flag
  FSC.IN_CAP = 2;              // building input stock target (per res) incl. in-flight
  FSC.RETRY_T = 40;            // destless goods reschedule period (ticks)
  FSC.CONGEST_T = 120;         // carrier gives up waiting on a full dest flag
  FSC.DOOR_T = 4;              // flag->building hand-off ticks
  FSC.SPAWN_GAP = 8;           // ticks between serfs exiting a warehouse door
  FSC.DOOR_DIR = "SE";         // building door flag = SE neighbour of building vertex

  // ---------- Construction ----------
  FSC.LEVEL_T = 250;           // digger leveling ticks (medium/large)
  FSC.BUILD_T_PER_MAT = 90;    // builder ticks per material unit consumed
  FSC.BURN_T = 300;

  // ---------- Mines / geology ----------
  FSC.MINE_P = [0, 0.35, 0.55, 0.72, 0.88]; // success prob by ceil(mineralAmt/4) bucket
  FSC.GEO_SPOTS = 7;
  FSC.GEO_T = 60;              // per sample
  FSC.SIGN_EMPTY = 255;

  // ---------- Military ----------
  FSC.MORALE_BASE = 1.0;
  FSC.MORALE_GOLD = 0.6;       // + gold/goldCap * this
  FSC.KNIGHT_RANKS = 5;        // 0..4
  FSC.ATTACK_RANGE = 20;       // own mil bld within this of target can contribute
  FSC.FIGHT_ROUND_T = 22;      // ticks per duel round (rendered swings)
  FSC.CASTLE_RADIUS = 12;      // starting territory
  FSC.KNIGHT_DEFAULTS = { minHut: 1, maxHut: 3, minTower: 2, maxTower: 6, minFort: 4, maxFort: 12, recruitRate: 5, attackStrong: true };

  // ---------- Start inventory (castle) ----------
  FSC.START_INV = {
    plank: 40, stone: 30, lumber: 10, boat: 2,
    sword: 3, shield: 3, goldBar: 0, goldOre: 0, steel: 6, ironOre: 4, coal: 10,
    fish: 12, bread: 8, meat: 4, pig: 0, wheat: 6, flour: 0,
    shovel: 4, hammer: 6, rod: 2, cleaver: 1, scythe: 2, axe: 3, saw: 2, pick: 4, pincer: 1,
    serf: 40, knight: 4,
  };

  // ---------- Distribution defaults (0..8 weights) ----------
  FSC.DIST_DEFAULTS = {
    planksConstruction: 8, planksBoats: 2, planksTools: 4,
    steelTools: 4, steelWeapons: 6,
    coalSteel: 6, coalGold: 4, coalWeapons: 6,
    wheatMill: 6, wheatPigs: 4,
    foodStoneMine: 2, foodCoalMine: 6, foodIronMine: 6, foodGoldMine: 8,
  };
  FSC.TOOL_PRIO_DEFAULT = { shovel: 5, hammer: 6, rod: 2, cleaver: 1, scythe: 3, axe: 5, saw: 4, pick: 5, pincer: 1 };

  // ---------- Players ----------
  FSC.PLAYER_COLORS = [0x2b6cb0, 0xc53030, 0xd69e2e, 0x6b46c1]; // blue you, red, gold, purple
  FSC.PLAYER_NAMES = ["You", "Rosso", "Goldy", "Viola"];

  // ---------- AI ----------
  FSC.AI_PERIOD = 50;          // planner cadence (ticks), staggered
  FSC.AI_AGGRO = 1.35;         // attack when strength ratio above

  // ---------- Misc ----------
  FSC.AUTOSAVE_T = 1200;       // ticks (2 min at 1x)
  FSC.NOTIF_CAP = 40;
  FSC.EVENT_CAP = 400;

  /* ===== PHASE-A: world generation ===== */
  FSC.ROW_Z = 0.8660254037844386;   // sqrt(3)/2 — row spacing factor (world z = r*TILE*ROW_Z)
  FSC.WATER_Y = 0;                  // world y of the water surface (heights are relative to it)
  FSC.GEN = {
    OCTAVES: 5, BASE_CELLS: 3, PERSIST: 0.52,   // fBm heightfield
    // island bowl: f = smoothstep(EDGE_0,EDGE_1,edgeDist) * (1-smoothstep(RAD_0,RAD_1,radius))
    EDGE_0: 0.02, EDGE_1: 0.18, RAD_0: 0.86, RAD_1: 1.4, SEA_BOWL: 0.75,
    // fields are percentile-flattened, so these thresholds ARE area fractions
    WATER_N: 0.27,        // normalized height of the shoreline
    MOUNT_N: 0.745,       // normalized height where the plains band ends
    PLAIN_H: 2.1,         // world height of the top of the plains band (gentle slopes)
    MOUNT_H: 12.0,        // world height added across the mountain band (steep)
    DEEP_H: 9.0,          // world depth scale below the shoreline
    MOUNTAIN_Y: 2.72,     // y above which land is MOUNTAIN
    SNOW_Y: 11.2,         // y above which mountain is SNOW
    SWAMP_Y: 0.75, SWAMP_MOIST: 0.62,   // wet lowlands
    DESERT_Y: 0.25, DESERT_MOIST: 0.16, // arid patches
    SMOOTH_PASSES: 3, SMOOTH_W: 0.7,   // lowland smoothing (plains stay buildable)
    BORDER: 3,            // vertices of forced deep water at the map edge
    FOREST_T: 0.50, FOREST_P: 0.85,     // tree clump threshold / max density
    ROCK_T: 0.72, ROCK_P: 0.34,         // stone pile threshold / max density
    ROCK_NEAR_MOUNT: 6,   // stone piles get a density bonus within this many steps of a mountain
    FISH_MIN: 3, FISH_MAX: 8, FISH_COAST: 2,
    MINERAL_BLOB_P: 0.055,              // chance a mountain vertex seeds a deposit blob
    MINERAL_W: { STONE: 0.28, COAL: 0.34, IRON: 0.27, GOLD: 0.11 },
    MINERAL_R: { STONE: 4, COAL: 5, IRON: 4, GOLD: 2 },
    MINERAL_AMT: [4, 15],
    TREE_STAGE_W: [0.05, 0.09, 0.16, 0.70],  // stage 1..4 weights
  };
  FSC.START = {
    R_FLAT: 2,            // castle footprint flatness radius
    R_AREA: 6,            // "flat grass radius" tested for buildable room
    GRASS_FRAC: 0.62,     // min grass share inside R_AREA (soft — relaxes per tier)
    LAND_FRAC: 0.92,      // min non-water share inside R_AREA (soft)
    GRASS_FLOOR: 0.42,    // hard floors: never relaxed, whatever the seed
    LAND_FLOOR: 0.78,
    SPREAD_AREA: 3.2,     // max height spread inside R_AREA
    WATER_CLEAR: 3,       // no water this close to the castle
    MOUNTAIN_MAX: 25,     // a mountain must be within this many lattice steps
    TREES_R: 8, TREES_MIN: 6,
    STONES_R: 10, STONES_MIN: 2,
    SEP_FRAC: [0, 0.50, 0.50, 0.42, 0.36],   // min separation as a fraction of W, by player count
    SEP_RELAX: 0.9, SEP_PASSES: 3,
    SEP_FLOOR_FRAC: 0.26, SEP_FLOOR_STEP: 0.07, SEP_HARD_FLOOR: 0.14,
    TOPUP_TREES: 14, TOPUP_TREE_R: 7,        // fairness top-up around every start site
    TOPUP_STONES: 5, TOPUP_STONE_R: 9,
    CLEAR_R: 1,           // objects cleared around the castle vertex
  };

  /* ===== PHASE-A: camera / render tunables ===== */
  FSC.CAM = {
    FOV: 52, NEAR: 0.5, FAR: 2000,
    DIST_MIN: 8, DIST_MAX: 80, DIST_START: 34,
    PITCH_MIN: 35 * Math.PI / 180, PITCH_MAX: 70 * Math.PI / 180, PITCH_START: 52 * Math.PI / 180,
    ZOOM_RATE: 0.0016, YAW_RATE: 1.5, KEY_PAN: 0.55, DRAG_PAN: 0.0022,
    ORBIT_YAW: 0.006, ORBIT_PITCH: 0.004, LERP: 12,
  };
  // Shared palette (plain ints — no THREE here). Render + models read these.
  FSC.COL = {
    TERR: {
      0: 0x3d6d84,  // WATER (lake bed, mostly hidden under the water plane)
      1: 0x6d9b4c,  // GRASS
      2: 0xd6c188,  // DESERT
      3: 0x566b3f,  // SWAMP
      4: 0x8b8478,  // MOUNTAIN
      5: 0xeff3f7,  // SNOW
    },
    BEACH: 0xd8c79c,
    WATER_SURF: 0x2f6f9e,
    SKY: 0x9fc4e0,
    FOG_NEAR: 70, FOG_FAR: 340,
    TREE_TRUNK: [0x5b4632, 0x6b5137],
    TREE_LEAF: [0x2f5d3a, 0x4f8039],
    TREE_AUTUMN: [0xa3702c, 0xc08a2e, 0x8f5f2a],
    STUMP: 0x6b5137,
    STONE: 0x8d949c,
    SAPLING: 0x6fae54,
    FIELD: [0x6b5236, 0x7f7a44, 0x94974a, 0xc0b055, 0xdcb94a],
    FIELD_STUB: 0x8a7a55,
    CASTLE_WALL: 0xbfb6a4,
    CASTLE_ROOF: 0x7d3a2e,
    CASTLE_WOOD: 0x6b5137,
    BLD_WALL: 0xc9b79a,
    BLD_ROOF: 0x8c4a34,
    BLD_WOOD: 0x6f5334,
    SIGN_POST: 0x6b5137,
    MINERAL: { 0: 0x999999, 1: 0x8d949c, 2: 0x2a2a2e, 3: 0xa8703a, 4: 0xe0b93a },
    HOVER: 0xffe9a8,
  };
  FSC.EMISSIVE_LIFT = 0.3;   // unlit faces never render black (house rule)

  if (typeof window !== "undefined") window.FSC = FSC;
  if (typeof module !== "undefined" && module.exports) module.exports = FSC; // node tests
})();
