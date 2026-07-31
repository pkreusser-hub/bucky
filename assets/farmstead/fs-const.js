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
  // Walking pace is SLOPE dependent and identical loaded or empty (confirmed original):
  // ticks per lattice edge indexed by the height-difference bucket
  // clamp(round(dy / WALK_DY), -4, +4) + 4  →  flat = 26 ticks (2.6 s at 1x).
  // Downhill is quicker than up; a steep drop is picked carefully again.
  FSC.WALK_TICKS_TABLE = [51, 45, 38, 32, 26, 32, 51, 77, 102];
  FSC.WALK_DY = 0.275;         // world height per bucket step
  FSC.WALK_TICKS = 26;         // flat-ground reference (render/UI convenience)

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

  // Growing things are driven by the BACKGROUND SWEEP (see FSC.SWEEP_* below), not by
  // per-object timers: every SWEEP_EVERY ticks a strided handful of vertices is visited
  // and each visit rolls that vertex forward. One full pass ≈ SWEEP_EVERY*1024 ticks.
  FSC.SWEEP_EVERY = 2;         // ticks between sweep steps
  FSC.SWEEP_PER_1024 = 1;      // vertices visited per step, per 1024 map vertices
  FSC.SWEEP_STRIDE = 1021;     // prime stride → hits every vertex, spread out
  FSC.SAPLING_P = 0.25;        // chance a young tree grows a stage on a visit
  FSC.STUMP_P = 0.25;          // chance a stump rots away on a visit
  FSC.FISH_REGROW_P = 63 / 64; // chance a water vertex gains a fish on a visit
  FSC.FISH_CAP = 10;           // regrowth ceiling
  FSC.FISH_MIGRATE_DIRS = [0, 4, 1, 3];  // E, SE, W, NW — shoals drift

  // ---------- Resources (26) ----------
  const RES_LIST = [
    "plank", "stone", "lumber", "boat",
    "sword", "shield", "goldBar", "goldOre", "steel", "ironOre", "coal",
    "fish", "bread", "meat", "pig", "wheat", "flour",
    "shovel", "hammer", "rod", "cleaver", "scythe", "axe", "saw", "pick", "pincer",
  ];
  FSC.RES_LIST = RES_LIST;
  FSC.RES = {}; RES_LIST.forEach((r, i) => (FSC.RES[r] = r)); // string ids everywhere (save-friendly)
  // Default FLAG transport priority (index 0 = picked up first) — the classic's exact
  // default order: gold moves most urgently, raw planks/stone dead last.
  FSC.RES_ORDER = [
    "goldOre", "goldBar", "wheat", "flour", "pig", "boat", "pincer", "scythe", "rod",
    "cleaver", "saw", "axe", "pick", "shovel", "hammer", "shield", "sword", "bread",
    "meat", "fish", "ironOre", "lumber", "coal", "steel", "stone", "plank",
  ];
  // Separate WAREHOUSE OUTPUT priority list (which stored goods leave storage first) —
  // fully confirmed original order: food ships out first, gold LAST (even though gold is
  // first on the flag-transport list; warehouses hoard it, roads rush it).
  FSC.INV_ORDER = [
    "wheat", "flour", "pig", "bread", "fish", "meat", "lumber", "plank", "boat", "stone",
    "coal", "ironOre", "steel", "shovel", "hammer", "rod", "cleaver", "scythe", "axe",
    "saw", "pick", "pincer", "shield", "sword", "goldOre", "goldBar",
  ];
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
  // Sizes follow the classic's real model: 0 = small (center vertex only, no leveling),
  // 2 = large (flat 7-vertex footprint, digger leveling). There is NO medium tier.
  // Mines are size 0 + mountain:true (no leveling). Costs are the confirmed originals.
  // `cycleT` = confirmed original production cycle in OUR ticks (internal ÷ 10).
  // `swings` = hammer swings a builder needs (construction accumulator, see below).
  def("castle",      { size: 2, cost: { plank: 0, stone: 0 }, hq: true, warehouse: true, swings: 64, mil: { cap: 12, terrRadius: 12, goldCap: 8 } });
  def("stock",       { size: 2, cost: { plank: 4, stone: 3 }, warehouse: true, swings: 56 });
  def("hut",         { size: 0, cost: { plank: 1, stone: 1 }, swings: 16, mil: { cap: 3, terrRadius: 8, goldCap: 2 } });
  def("tower",       { size: 2, cost: { plank: 2, stone: 3 }, swings: 32, mil: { cap: 6, terrRadius: 8, goldCap: 4 } });
  def("fortress",    { size: 2, cost: { plank: 5, stone: 5 }, swings: 64, mil: { cap: 12, terrRadius: 8, goldCap: 8 } });
  // Offsite professions: the TRIP is the cycle (walk out, work, walk back); cycleT is
  // only the short hand-over pause inside the hut. Work lengths live in FSC.CHOP_T etc.
  def("fisher",      { size: 0, cost: { plank: 2, stone: 0 }, job: "fisher", radius: 7, out: "fish", cycleT: 26, swings: 16 });
  def("lumberjack",  { size: 0, cost: { plank: 2, stone: 0 }, job: "lumberjack", radius: 7, out: "lumber", cycleT: 26, swings: 16 });
  def("forester",    { size: 0, cost: { plank: 2, stone: 0 }, job: "forester", radius: 7, cycleT: 26, swings: 16 });
  def("stonecutter", { size: 0, cost: { plank: 2, stone: 0 }, job: "stonecutter", radius: 7, out: "stone", cycleT: 26, swings: 16 });
  def("sawmill",     { size: 2, cost: { plank: 3, stone: 2 }, job: "sawyer", in: { lumber: 1 }, out: "plank", cycleT: 237, swings: 32 });
  def("farm",        { size: 2, cost: { plank: 4, stone: 1 }, job: "farmer", radius: 4, out: "wheat", cycleT: 26, swings: 32 });
  def("mill",        { size: 0, cost: { plank: 3, stone: 1 }, job: "miller", in: { wheat: 1 }, out: "flour", cycleT: 377, swings: 32 });
  def("bakery",      { size: 2, cost: { plank: 2, stone: 1 }, job: "baker", in: { flour: 1 }, out: "bread", cycleT: 227, swings: 20 });
  // pigfarm cycleT is the one production number that was NOT recovered — tuned stand-in.
  def("pigfarm",     { size: 2, cost: { plank: 4, stone: 1 }, job: "pigfarmer", in: { wheat: 1 }, out: "pig", cycleT: 380, swings: 32 });
  def("butcher",     { size: 2, cost: { plank: 2, stone: 1 }, job: "butcher", in: { pig: 1 }, out: "meat", outN: 1, cycleT: 154, swings: 20 });
  def("stoneMine",   { size: 0, cost: { plank: 4, stone: 1 }, mine: "STONE", job: "miner", inFood: 1, out: "stone", mountain: true, swings: 32 });
  def("coalMine",    { size: 0, cost: { plank: 5, stone: 0 }, mine: "COAL", job: "miner", inFood: 1, out: "coal", mountain: true, swings: 32 });
  def("ironMine",    { size: 0, cost: { plank: 5, stone: 0 }, mine: "IRON", job: "miner", inFood: 1, out: "ironOre", mountain: true, swings: 32 });
  def("goldMine",    { size: 0, cost: { plank: 5, stone: 0 }, mine: "GOLD", job: "miner", inFood: 1, out: "goldOre", mountain: true, swings: 32 });
  def("smelter",     { size: 2, cost: { plank: 3, stone: 2 }, job: "smelter", in: { coal: 1, ironOre: 1 }, out: "steel", cycleT: 806, swings: 32 });
  def("goldsmelter", { size: 2, cost: { plank: 4, stone: 1 }, job: "smelter", in: { coal: 1, goldOre: 1 }, out: "goldBar", cycleT: 806, swings: 32 });
  def("toolmaker",   { size: 2, cost: { plank: 3, stone: 3 }, job: "toolmaker", in: { plank: 1, steel: 1 }, outTool: true, cycleT: 461, swings: 40 });
  // weaponsmith: the SWORD half-cycle eats 1 coal + 1 steel, the SHIELD half is free.
  def("weaponsmith", { size: 2, cost: { plank: 2, stone: 3 }, job: "weaponsmith", in: { coal: 1, steel: 1 }, outWeapon: true, cycleT: 346, swings: 20 });
  def("boatwright",  { size: 0, cost: { plank: 3, stone: 0 }, job: "boatwright", in: { plank: 1 }, out: "boat", cycleT: 1002, swings: 20 });
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
  FSC.IN_CAP = 8;              // building input stock target (per res) incl. in-flight
  // (PHASE-C: these are all "how many edges of walking is that?" numbers, so they
  //  were rescaled when the confirmed slope-based walk pacing landed — flat 26 t/edge.)
  FSC.RETRY_T = 120;           // destless goods reschedule period (ticks)
  FSC.CONGEST_T = 600;         // carrier gives up waiting on a full dest flag
  /* ===== PHASE-E: flags this full get a pulsing "congested" highlight ===== */
  FSC.CONGEST_GLOW_MIN = 6;
  FSC.DOOR_T = 4;              // flag->building hand-off ticks
  FSC.SPAWN_GAP = 8;           // ticks between serfs exiting a warehouse door
  FSC.DOOR_DIR = "SE";         // building door flag = SE neighbour of building vertex

  // ---------- Construction ----------
  // The builder swings a hammer; each swing adds BLD.phase to a 16-bit accumulator and
  // one material is eaten every SWING_PER_MAT swings (planks first, then stones).
  FSC.LEVEL_T = 250;           // digger leveling ticks (large sites)
  FSC.SWING_TICKS = [77, 51, 51, 77];   // ticks per swing, picked by rng
  FSC.SWING_PER_MAT = 8;       // swings between material draws
  FSC.BUILD_FULL = 0x10000;    // accumulator target
  FSC.BUILD_IDLE_T = 26;       // waiting for the next material
  FSC.BURN_T = 205;            // confirmed 2047 internal ticks
  FSC.BURN_T_CASTLE = 819;     // castles burn 4x longer (8191)
  FSC.BURN_ESCAPE_MAX = 12;    // up to 12 occupants escape a burning building

  // ---------- Mines / geology ----------
  // A miner: thinks (MINE_WAIT), eats one meal (skipped 1 time in MINE_SKIP_EVERY),
  // then makes up to MINE_DIGS attempts; each attempt samples ONE random vertex in
  // lattice rings 0..MINE_RING and hits only if that vertex really holds the mineral.
  FSC.MINE_WAIT = [10, 61];
  FSC.MINE_SKIP_EVERY = 8;     // 1-in-8 cycles the miner does not eat
  FSC.MINE_EAT_T = 38;
  FSC.MINE_PRE_T = 30;
  FSC.MINE_DIG_T = 100;
  FSC.MINE_DIGS = 4;
  FSC.MINE_POST_T = 30;
  FSC.MINE_OUT_T = 38;
  FSC.MINE_IDLE_T = 26;        // no food in store — look again later
  FSC.MINE_RING = 3;
  FSC.MINE_EXHAUST_REG = 0x8000;  // 16-bit find-history register: fires the notification
  FSC.GEO_SPOTS = 12;          // hard safety cap on one geologist's tour
  FSC.GEO_T = 78;              // hammering one sample
  FSC.GEO_TRIES = 8;           // candidate vertices examined per search
  FSC.GEO_SIGN_STOP = 2;       // two signs already there → the tour is over
  FSC.GEO_RING = [1, 4];       // candidates live this far from the flag
  FSC.GEO_BIG_AMT = 12;        // a "large deposit" sign
  FSC.SIGN_EMPTY = 255;

  // ---------- Military ----------
  // Knight strength doubles per rank (exponential — confirmed). Defenders on their OWN
  // territory fight at full strength; fighting on foreign soil uses the player's
  // gold-funded morale instead (0..1).
  FSC.KNIGHT_EXP = [1, 2, 4, 8, 16];
  FSC.MORALE_MIN = 0.25;       // morale floor when the game has gold but you hold none
  // morale = (game has no gold anywhere) ? 1.0 : MORALE_MIN + (1-MORALE_MIN)*min(1, 2*myGoldShare)
  FSC.KNIGHT_RANKS = 5;        // 0..4
  FSC.ATTACK_RANGE = 20;       // own mil bld within this of target can contribute
  FSC.FIGHT_ROUND_T = 22;      // ticks per duel round (rendered swings)
  FSC.CASTLE_RADIUS = 12;      // starting territory
  // Garrison occupancy: 4 threat tiers by distance to the nearest enemy border
  // (tier 3 = at the border), each with min/max occupation LEVEL 0..9.
  // headcount = max(1, round(level/9 * building cap)). Defaults are the originals.
  FSC.KNIGHT_OCC_DEFAULTS = [[0, 1], [1, 2], [2, 3], [3, 4]];
  FSC.THREAT_NEAR = [26, 18, 10];  // lattice dist to enemy border → tier 0/1/2/3 boundaries
  FSC.SERF_TO_KNIGHT_DEFAULT = 20000; // 0..65500 slider: eagerness of generic→knight
  FSC.CASTLE_KNIGHTS_DEFAULT = 3;  // castle desired garrison (stepper, cap 99)
  FSC.CASTLE_KNIGHTS_MAX = 99;
  FSC.CYCLE_KNIGHTS_T = 2400;      // rotate-garrisons cooldown (ticks)
  FSC.KNIGHT_DEFAULTS = { recruitRate: 20000, attackStrong: true, castleKnights: 3 };

  // ---------- Start inventory (castle) ----------
  // The classic's confirmed Supplies model: 5 anchor columns (Supplies 0/10/20/30/40+),
  // linearly interpolated; ≥40 clamps. Default 25 — empirically matches the observed
  // original default game (sword/shield 80, goldOre 6, goldBar 3, pig 3, meat 4…).
  FSC.SUPPLIES_TABLE = {
    fish:    [0, 2, 3, 8, 30],   pig:     [0, 1, 2, 4, 10],   meat:   [0, 1, 2, 6, 30],
    wheat:   [0, 3, 10, 20, 50], flour:   [0, 2, 3, 7, 10],   bread:  [0, 1, 1, 5, 30],
    lumber:  [0, 0, 0, 3, 10],   plank:   [7, 25, 40, 80, 200], boat: [0, 1, 2, 5, 10],
    stone:   [2, 8, 20, 40, 100], ironOre: [0, 4, 12, 20, 30], steel: [0, 3, 8, 40, 150],
    coal:    [0, 8, 20, 50, 100], goldOre: [0, 2, 4, 8, 10],   goldBar:[0, 1, 2, 4, 5],
    shovel:  [1, 3, 5, 10, 20],  hammer:  [6, 12, 20, 30, 50], rod:    [1, 2, 3, 5, 10],
    cleaver: [0, 1, 1, 2, 5],    scythe:  [0, 1, 2, 4, 10],    axe:    [1, 2, 3, 6, 20],
    saw:     [2, 3, 4, 6, 20],   pick:    [3, 4, 6, 12, 50],   pincer: [0, 1, 2, 4, 10],
    sword:   [10, 30, 60, 100, 200], shield: [10, 30, 60, 100, 200],
  };
  FSC.SUPPLIES_DEFAULT = 25;
  FSC.suppliesInv = function (s) {
    s = Math.max(0, Math.min(50, s == null ? FSC.SUPPLIES_DEFAULT : s));
    const hi = Math.min(4, Math.floor(s / 10) + 1), lo = hi - 1;
    const f = Math.max(0, Math.min(1, (s - lo * 10) / 10));
    const inv = {};
    for (const k in FSC.SUPPLIES_TABLE) {
      const t = FSC.SUPPLIES_TABLE[k];
      inv[k] = Math.round(t[lo] + (t[hi] - t[lo]) * f);
    }
    return inv;
  };
  FSC.START_INV = FSC.suppliesInv(FSC.SUPPLIES_DEFAULT);
  // Exact confirmed starting serf roster (19 spawnable; the classic's 20th is an
  // in-warehouse goods handler our model doesn't represent as an entity). Pre-made
  // professionals are consumed FIRST when a building requests that worker; else a
  // generic + the profession's tool(s) are consumed.
  FSC.START_SERFS = {
    generic: 5, knight: 3, toolmaker: 1, lumberjack: 1, sawyer: 1, stonecutter: 1,
    digger: 1, builder: 1, fisher: 1, geologist: 2, miner: 2,
  };

  // ---------- Distribution defaults (0..8 weights) ----------
  // All priority/distribution sliders share the classic's 0..65500 scale with 20 discrete
  // notches of 3275 (build stepped controls, not smooth sliders). Values are the
  // confirmed original defaults.
  FSC.PRIO_MAX = 65500;
  FSC.PRIO_STEP = 3275;
  FSC.DIST_DEFAULTS = {
    planksConstruction: 65500, planksTools: 19650, planksBoats: 3275,
    steelWeapons: 65500, steelTools: 45850,
    coalGold: 65500, coalWeapons: 52400, coalSteel: 32750,
    wheatPigs: 65500, wheatMill: 32750,
    foodGoldMine: 65500, foodCoalMine: 45850, foodIronMine: 45850, foodStoneMine: 13100,
  };
  FSC.TOOL_PRIO_DEFAULT = {
    hammer: 65500, pick: 45850, saw: 32750, axe: 26200, rod: 13100,
    scythe: 13100, shovel: 9825, cleaver: 6550, pincer: 6550,
  };

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
    ROCK_T: 0.80, ROCK_P: 0.22,         // stone pile threshold / max density
    ROCK_NEAR_MOUNT: 6,   // stone piles get a density bonus within this many steps of a mountain
    FISH_MAX: 7,                        // every water vertex gets rng & 7 fish
    MINERAL_BLOB_P: 0.055,              // chance a mountain vertex seeds a deposit
    // relative cluster frequency (confirmed): coal is common, gold is precious
    MINERAL_W: { STONE: 2, COAL: 9, IRON: 4, GOLD: 2 },
    MINERAL_RINGS: [2, 5],              // ring count 2..5 (center + 1..4)
    MINERAL_STEP: 4,                    // ring j holds STEP × (rings − j), max 20
    TREE_STAGE_W: [0.05, 0.09, 0.16, 0.70],  // stage 1..4 weights
  };
  FSC.START = {
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
    TOPUP_STONES: 4, TOPUP_STONE_R: 9,
    REACH_MIN: 60,        // HARD floor: road-reachable vertices from the castle door
    REACH_CAP: 420,       // BFS node guard (early exit at REACH_MIN)
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
      1: 0x6b9350,  // GRASS
      2: 0xd6c188,  // DESERT
      3: 0x566b3f,  // SWAMP
      4: 0x6e6455,  // MOUNTAIN
      5: 0xe4eaf1,  // SNOW
    },
    BEACH: 0xd9c9a0,
    GRASS_DRY: 0x9cae63,
    WATER_SURF: 0x2f6f9e,
    SKY: 0x9fc4e0,
    FOG_NEAR: 70, FOG_FAR: 340,
    TREE_TRUNK: [0x5b4632, 0x6b5137],
    TREE_LEAF: [0x2f5d3a, 0x4f8039],
    TREE_AUTUMN: [0xa3702c, 0xc08a2e, 0x8f5f2a],
    STUMP: 0x6b5137,
    STONE: 0x7c838d,
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

  /* ===== PHASE-B: command layer, transport tuning, serf/goods palette ===== */
  // Command layer (see plan §16). Solo issues execute on the next tick; MP hosts
  // stamp execTick = hostTick + CMD_DELAY_MP so both sides run them in lockstep.
  FSC.CMD_DELAY = 1;
  FSC.CMD_DELAY_MP = 4;
  FSC.CMD_TYPES = ["flag", "road", "build", "demolish", "speed", "prio",
    /* ===== PHASE-C ===== */ "geologist", "dist", "toolPrio", "stockMode", "halt",
    /* ===== PHASE-D ===== */ "attack", "knightSet", "cycleKnights",
    /* ===== PHASE-E ===== */ "invPrio"];

  // Scheduling budgets — every per-tick loop is bounded, nothing scans the map.
  FSC.WH_DISPATCH_T = 6;       // ticks between one warehouse pushing a good out (staggered by id)
  FSC.SERF_REQ_PER_TICK = 4;   // pending serf requests examined per tick
  FSC.SERF_REQ_RETRY_T = 100;  // a request that found no warehouse waits this long
  FSC.RETRY_PER_TICK = 6;      // destless-goods flags re-scheduled per tick
  FSC.CREW_WATCHDOG_T = 3000;  // a digger/builder who never arrives lets the site re-ask
  // Population (confirmed original REPRODUCTION rule — PHASE-C): the castle produces
  // one settler every (60 − reproRate) × REPRO_UNIT ticks. The same clock recruits
  // knights: a 16-bit counter gathers `recruitRate` per firing and every overflow
  // banks a knight credit, so a firing with a credit + a sword + a shield in store
  // turns out a rank-0 knight instead of a plain settler.
  FSC.REPRO_UNIT = 5;
  FSC.REPRO_DEFAULT = 30;      // slider 0..60 → 150 ticks between settlers
  FSC.REPRO_MAX = 60;
  FSC.KNIGHT_COUNTER_START = 0x8000;
  FSC.KNIGHT_CREDIT_MAX = 2;
  FSC.SERF_CAP = 200;          // hard population ceiling per player
  FSC.ROUTE_MAX_HOPS = 96;     // flag-graph BFS cap for scheduling searches

  // Road building / offroad walking
  FSC.ROAD_MAX_LEN = 40;       // vertices in an auto-routed road path
  FSC.ROAD_SEARCH_NODES = 6000;
  FSC.ROAD_SLOPE_COST = 1.6;   // per world-unit of |dy| on a road step
  FSC.OFFROAD_MAX = 240;       // max steps for a specialist walking offroad
  FSC.OFFROAD_NODES = 12000;
  FSC.OFFROAD_SLOPE_COST = 2.2;
  FSC.OFFROAD_SWAMP_COST = 1.4;

  // Flag goods colours (tiny crates stacked at the flag base + over a carrier's head)
  FSC.RES_COLOR = {
    plank: 0xd2a869, stone: 0x9aa0a8, lumber: 0x6e4f2f, boat: 0x8a5a2b,
    sword: 0xd8dde3, shield: 0xb0762d, goldBar: 0xf2c53d, goldOre: 0xd9a441,
    steel: 0x7f8b99, ironOre: 0xa8703a, coal: 0x2f2f34,
    fish: 0x4fa3c7, bread: 0xcf9a4e, meat: 0xb2503f, pig: 0xe8a9ad,
    wheat: 0xe0c352, flour: 0xefe6cf,
    shovel: 0x9c6b3e, hammer: 0x8c6239, rod: 0x6fae54, cleaver: 0xc0c6cc,
    scythe: 0xa9b3bd, axe: 0x8f5a34, saw: 0xb9bfc6, pick: 0x87919b, pincer: 0x707a85,
  };
  // Serf hat colour per profession (the silhouette reads at a glance from above)
  FSC.JOB_COLOR = {
    generic: 0xd9d2c4, transporter: 0xcbb894, sailor: 0x4f7fa8, digger: 0x8c6b3f,
    builder: 0xe08a2a, lumberjack: 0x3f6b34, forester: 0x2f7a45, stonecutter: 0x8a8f96,
    fisher: 0x3a7fa8, farmer: 0xd6b64a, miller: 0xe8e2d0, baker: 0xefe6cf,
    pigfarmer: 0xd58b90, butcher: 0xb2503f, sawyer: 0xa9743d, miner: 0x4a4f57,
    smelter: 0x7f5a3a, goldsmelter: 0xd9a441, toolmaker: 0x9a6a3a,
    weaponsmith: 0x6a6f78, boatwright: 0x7a5230, geologist: 0x8f5fa8, knight: 0xb03a3a,
  };
  FSC.COL.ROAD = 0x9b8460;        // trodden earth ribbon
  FSC.COL.ROAD_EDGE = 0x7d6a4c;
  FSC.COL.FLAG_POLE = 0x8d7449;
  FSC.COL.SITE_STAKE = 0xb99b62;
  FSC.COL.SITE_PAD = 0x8f7a58;
  FSC.COL.SITE_ROPE = 0xe0d6b8;
  FSC.COL.SCAFFOLD = 0xc0a06a;
  FSC.COL.BURN = 0x3a3128;
  FSC.COL.FIRE = [0xff9b2e, 0xffd24a];
  FSC.COL.SERF_SKIN = 0xe3b58a;
  FSC.COL.SERF_CLOTH = 0xcfc3a8;
  FSC.COL.TOOL = 0x6b5137;
  FSC.ROAD_W = 0.32;              // ribbon half-width (world units)
  FSC.ROAD_LIFT = 0.06;           // y lift so the ribbon never z-fights the terrain

  /* ===================================================================== */
  /* ===== PHASE-C: production, jobs, geology, boats, distribution ======== */
  /* ===================================================================== */

  // --- offsite worker trips (confirmed original work lengths, in our ticks) ---
  FSC.CHOP_T = 284;            // lumberjack felling a mature tree (staged animation)
  FSC.PLANT_T = 147;           // forester planting a sapling (not separately recovered)
  FSC.HACK_T = 154;            // stonecutter knocking a charge off a pile
  FSC.SOW_T = 147;             // farmer sowing one field
  FSC.REAP_T = 198;            // farmer harvesting
  // Fishing is a run of chances, not a fixed job: the rod goes in, and every
  // FISH_CHECK_T / FISH_WAIT_T (alternating) there is a (fish-4)/64 chance of a bite.
  FSC.FISH_CHECK_T = 13;
  FSC.FISH_WAIT_T = 77;
  FSC.FISH_CHECKS = 10;        // then he gives up and walks home empty handed
  FSC.FISH_MIN_STOCK = 4;      // fish below this never bite
  FSC.FISH_P_DIV = 64;
  FSC.WORK_WALK_MAX = 90;      // offroad A* budget for one worker trip (cost units)
  FSC.WORK_IDLE_T = 60;        // nothing to do in range → look again in this many ticks
  FSC.FIELD_MAX = 6;           // fields one farm keeps in rotation
  FSC.FIELD_RING = [2, 4];     // fields are sown this far from the farmhouse
  FSC.FIELD_HARVEST_MIN = 2;   // FIELD2 and up can be cut (and the stage advances)

  // --- producers ---
  FSC.OUT_CAP = 4;             // finished goods a producer holds when its flag is full
  FSC.PROD_FLUSH_T = 10;       // ticks between attempts to push a held output out
  FSC.PIG_HERD_MAX = 8;        // pigs living in one pen
  FSC.PIG_ROLLS = 3;           // breeding rolls per cycle
  FSC.PIG_P_BASE = 0.09;       // chance per roll at an empty pen…
  FSC.PIG_P_PER = 0.015;       // …plus this per pig already in the herd
  FSC.PIG_KEEP = 1;            // breeding stock the farmer never ships

  // --- boats / water roads ---
  FSC.BOAT_REQ_T = 30;         // ticks between a boatless water road asking for one

  // --- distribution arbitration (weights are the 0..PRIO_MAX slider scale) ---
  // A source picks the winning requester with smooth weighted round-robin over the
  // dist classes below; a class at weight 0 is never served.
  FSC.DIST_LOOKAHEAD = 3;      // extra hop levels searched once a requester is found
  FSC.DIST_MAX_CAND = 12;      // candidate requesters considered per scheduling decision
  FSC.DIST_CLASS = {
    plank: { _site: "planksConstruction", boatwright: "planksBoats", toolmaker: "planksTools" },
    steel: { toolmaker: "steelTools", weaponsmith: "steelWeapons" },
    coal: { smelter: "coalSteel", goldsmelter: "coalGold", weaponsmith: "coalWeapons" },
    wheat: { mill: "wheatMill", pigfarm: "wheatPigs" },
    _food: { stoneMine: "foodStoneMine", coalMine: "foodCoalMine", ironMine: "foodIronMine", goldMine: "foodGoldMine" },
  };

  // --- toolmaker choice: weighted-random roulette over the 9 priority sliders ---
  // (confirmed original: no scarcity maths, a 0 slider is simply never drawn, and
  //  an all-zero panel falls back to a uniform draw.)

  // --- warehouse per-resource modes ---
  FSC.STOCK_MODE = { IN: 0, STOP: 1, OUT: 2 };
  FSC.STOCK_MODE_NAMES = ["in", "stop", "out"];

  // --- stats rings (Phase E draws them; the sim just samples) ---
  FSC.STATS_T = 300;
  FSC.STATS_CAP = 240;

  /* ===================================================================== */
  /* ===== PHASE-D: knights, territory, combat, victory, AI =============== */
  /* ===================================================================== */

  // --- the duel (confirmed original: a per-fighter weighted lottery) ---------
  // strength = (STRENGTH_BASE × 2^rank × landFactor) >> 16, computed for EACH
  // fighter; landFactor = LAND_OWN when that fighter stands on his own player's
  // territory, otherwise his player's gold-funded morale (MORALE_FLOOR..FULL).
  // P(A wins a round) = sA / (sA + sB). The loser dies; NEITHER side changes rank
  // (promotion is a separate periodic roll — see PROMOTE_* below).
  FSC.STRENGTH_BASE = 1024;
  FSC.STRENGTH_SHIFT = 16;
  FSC.LAND_OWN = 4096;
  FSC.MORALE_FULL = 4096;      // ceiling — also what everyone gets when no gold exists
  FSC.MORALE_FLOOR = 1024;     // holding none of the world's gold
  FSC.MORALE_SHARE_K = 2;      // your share is doubled before the min(1, …) clamp
  FSC.RANK_NAMES = ["Recruit", "Private", "Sergeant", "Officer", "General"];
  FSC.RANK_COLOR = [0x9aa0a8, 0xb98b45, 0xd8dde3, 0xf2c53d, 0xe05a3a];

  // --- promotion: one roll per garrisoned knight every PROMOTE_T ticks -------
  // p/65536 by building tier × current rank (the castle is the training ground).
  FSC.PROMOTE_T = 600;
  FSC.PROMOTE_P = {
    hut: [250, 125, 62, 31],
    tower: [1000, 500, 250, 125],
    fortress: [2000, 1000, 500, 250],
    castle: [4000, 2000, 1000, 500],
  };

  // --- occupancy: player sets a LEVEL 0..4 per threat tier, tables give heads --
  FSC.OCC_TABLE = { hut: [1, 1, 2, 2, 3], tower: [1, 2, 3, 4, 6], fortress: [1, 3, 6, 9, 12] };
  FSC.OCC_NAMES = ["Minimum", "Weak", "Medium", "Good", "Full"];
  FSC.OCC_LEVEL_MAX = 4;
  FSC.GARRISON_T = 20;         // ticks between garrison-management sweeps
  /* ===== PHASE-E: display names for the 4 threat tiers (Knights panel) ===== */
  FSC.THREAT_TIER_NAMES = ["Interior", "Near", "Close", "Border"];

  // --- territory: the influence-weight model ---------------------------------
  // Every occupied military building projects a claim over radius TERR_RADIUS.
  // The table is indexed by CLOSENESS = TERR_RADIUS − distance (so influence
  // FALLS with distance and a building always owns the ground under itself):
  // closeness 8 → TERR_ABSOLUTE, 7..1 → the row below, 0 → nothing.
  // NOTE the raw research listed these eight numbers as "ring 0..7" which would
  // hand a building ZERO influence on its own vertex; the closeness reading is
  // the one that reproduces the original's behaviour (rings 8/9 are flagged
  // "no influence" = the absolute-claim marker). Either reading keeps the solid
  // headline result — a fortress out-claims a hut at every distance.
  FSC.TERR_RADIUS = 8;
  FSC.TERR_INFLUENCE = {
    hut: [0, 1, 2, 4, 7, 12, 18, 29],
    tower: [0, 3, 5, 8, 11, 15, 22, 30],
    fortress: [0, 6, 10, 14, 19, 23, 27, 31],
  };
  FSC.TERR_ABSOLUTE = 128;     // the ground under a military building is never contested
  FSC.TERR_CAP = 127;          // summed influence saturates just below absolute
  // The castle uses the fortress row stretched over CASTLE_RADIUS (deviation §8:
  // a widened castle claim so every start economy has room to breathe).

  // --- attacks ---------------------------------------------------------------
  FSC.ATTACK_MAX = 64;         // knights one attack order may commit
  FSC.KNIGHT_WALK_MAX = 320;   // offroad A* budget for an attacking knight (cost units)
  FSC.FIGHT_START_T = 8;       // pause after the defender steps out, before round 1
  FSC.SIEGE_GIVEUP_T = 2400;   // an attacker who can never reach the target goes home
  FSC.CORPSE_T = 40;           // ticks a corpse is reported to the renderer

  // --- burning / elimination -------------------------------------------------
  FSC.DOOM_PER_TICK = 3;       // eliminated player's estate is dismantled this fast

  // --- AI --------------------------------------------------------------------
  FSC.AI_STUCK_T = 3000;       // a site with no material progress for this long is scrapped
  FSC.AI_BLACKLIST_T = 6000;   // …and its vertex is left alone for this long
  FSC.AI_MAX_SITES = 3;        // concurrent unfinished buildings
  FSC.AI_ROAD_SEG = 7;         // vertices between flags on a long AI road
  FSC.AI_ROAD_MAX = 120;       // A* cost budget for one AI road hunt
  FSC.AI_SCAN_CAP = 500;       // vertices examined per site hunt (amortised, cached)
  FSC.AI_PLACE_CHECKS = 140;    // canPlaceBuilding calls one hunt may spend
  FSC.AI_SHORTLIST = 24;       // spots that reach the (dearer) scoring pass
  FSC.AI_ROCK_CHECKS = 12;     // mountain spots a prospecting run may weigh
  FSC.AI_ROOM_LOW = 16;       // …below which expansion jumps the queue
  FSC.AI_TRIES = 8;            // wish-list entries one planner run may hunt for         // plots left in own land before expansion jumps the queue
  FSC.AI_ATTACK_T = 900;       // ticks between one AI's attack considerations
  FSC.AI_ATTACK_SHARE = 0.6;   // fraction of the spare garrison committed to an attack
  // per-AI personality (index = player id): aggression + expansion multipliers
  FSC.AI_PERSONA = [
    { aggro: 1.0, expand: 1.0 },
    { aggro: 0.95, expand: 1.15 },
    { aggro: 1.25, expand: 0.9 },
    { aggro: 1.1, expand: 1.05 },
  ];

  // --- Phase-D palette -------------------------------------------------------
  FSC.COL.STAKE = 0x6b5137;
  FSC.COL.CORPSE = 0x6a5a4a;
  FSC.COL.CLANG = 0xfff2b0;
  FSC.TERRITORY_TINT = 0.13;   // how far own ground leans toward the player colour

  // --- Phase-C palette (per-type building models, signs, boats, smoke) ---
  FSC.COL.MILL_SAIL = 0xe8dfc6;
  FSC.COL.WHEEL = 0x7a5a34;
  FSC.COL.SMOKE = 0xd8d5cc;
  FSC.COL.BOAT = 0x8a5a2b;
  FSC.COL.WATER_ROAD = 0xa98a63;
  FSC.COL.PIG = 0xe8a9ad;
  FSC.COL.FIRE_BOX = 0xd9743a;
  FSC.COL.ROOF_ALT = 0x6f7f6a;
  FSC.COL.NET = 0xd8cfae;

  /* ===================================================================== */
  /* ===== PHASE-M: multiplayer (plan §16 — command lockstep) ============= */
  /* ===================================================================== */
  // "ping" is a look-here marker: an EVENT-ONLY command with zero sim effect,
  // so (like `speed`) it is invisible to FSSim.hash and its exec tick may drift
  // by a tick between the two machines without ever desyncing them.
  FSC.CMD_TYPES.push("ping");
  FSC.CMD_HASH_NEUTRAL = ["speed", "ping"];   // may run on a near tick, never hashed

  FSC.SYNC_HASH_T = 100;        // ticks between lockstep hash checkpoints
  FSC.NET_HASH_KEEP = 24;       // checkpoints each side remembers while comparing
  FSC.NET_CHUNK = 8192;         // b64 characters per state chunk
  FSC.NET_BEAT_MS = 250;        // host tick-clock heartbeat  (Date.now — NETWORK only)
  FSC.NET_HIDDEN_MS = 250;      // hidden-tab sim heartbeat, both roles (house pattern)
  FSC.NET_EXTRAP_MS = 1500;     // guest may extrapolate the host clock this far past a beat
  FSC.NET_LEAD_MARGIN = 1;      // …and always stops this many ticks short of the command lead
  FSC.NET_CATCHUP_SHOW = 100;   // ticks behind before the "catching up…" veil appears
  FSC.NET_CATCHUP_TICKS = 240;  // sim ticks per frame while catching up
  FSC.NET_TIMEOUT_MS = 8000;    // silence from the peer for this long = they are gone
  FSC.NET_MAX_PLAYERS = 2;      // co-op is strictly 2 seats
  FSC.NET_PING_T = 45;          // ticks a ping marker stays on screen
  FSC.NET_LOBBY_BEAT_MS = 15000;// family-lobby heartbeat (games.html liveness window)
  FSC.NET_SDK_URL = "https://unpkg.com/playroomkit@0.0.96/multiplayer.full.umd.js";

  if (typeof window !== "undefined") window.FSC = FSC;
  if (typeof module !== "undefined" && module.exports) module.exports = FSC; // node tests
})();
