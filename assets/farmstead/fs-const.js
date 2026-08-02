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
  /* PLAYTEST 2026-08-02 ("maps ~2x bigger"): read as 2x AREA, so each side grows
   * by ~sqrt(2) and lands on an even number (odd-row offset lattice — an even
   * side keeps the same number of shifted and unshifted rows).
   *   48 -> 68 (2.01x area) · 64 -> 90 (1.98x) · 96 -> 136 (2.01x)
   * Everything sized in ROAD STEPS (MOUNTAIN_MAX, the balancing radii, the work
   * spirals) is deliberately left alone: a serf does not walk faster on a bigger
   * map. Only the things expressed as a FRACTION OF THE MAP move with it, and
   * those move by themselves (SEP_FRAC, the island bowl, the fBm base cells). */
  FSC.MAP_SIZES = { small: 68, medium: 90, large: 136 };

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
  /* `radius` is the outer bound the sampler enumerates; the ring WEIGHTS come
     from FSC.WORK_SPIRAL, so each radius here is just the ring its own index
     range can reach (fisher idx 64 → a sliver of ring 5, forester 60 → ring 4). */
  def("fisher",      { size: 0, cost: { plank: 2, stone: 0 }, job: "fisher", radius: 5, out: "fish", cycleT: 26, swings: 16 });
  def("lumberjack",  { size: 0, cost: { plank: 2, stone: 0 }, job: "lumberjack", radius: 7, out: "lumber", cycleT: 26, swings: 16 });
  def("forester",    { size: 0, cost: { plank: 2, stone: 0 }, job: "forester", radius: 4, cycleT: 26, swings: 16 });
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
  /* ONE plain sentence per building, for the build panel's info strip
   * (playtest 2026-08-02 — "what does this thing actually do?"). Under a dozen
   * words each, in the language a nine-year-old uses, and deliberately about
   * PURPOSE rather than numbers: the numbers are on the card and the panel, and
   * a sentence that recites them tells you nothing you cannot already see.
   * REQUIREMENTS are NOT written here — FSUI derives them from the definition
   * above (mountain, plot size, inputs, food, the profession's tool), so they
   * can never drift away from the rules the game actually enforces. */
  FSC.BLD_DESC = {
    castle: "Your home, your storehouse and your first knights.",
    stock: "A second storehouse, so goods stop walking all the way home.",
    hut: "A few knights hold a little more land for you.",
    tower: "More knights, more land, a sturdier border.",
    fortress: "Twelve knights on the frontier. Nobody takes it cheaply.",
    fisher: "Sits by the water and pulls out supper.",
    lumberjack: "Fells the grown trees around his hut.",
    forester: "Plants saplings so the woodcutter never runs out.",
    stonecutter: "Chips stone off the boulders lying nearby.",
    sawmill: "Saws logs into the planks everything is built from.",
    farm: "Sows and reaps the wheat that feeds everyone.",
    mill: "Grinds wheat into flour.",
    bakery: "Bakes flour into bread — a miner's favourite meal.",
    pigfarm: "Fattens pigs on spare wheat.",
    butcher: "Turns a pig into meat for hungry miners.",
    stoneMine: "Digs stone straight out of the mountain.",
    coalMine: "Coal for every furnace you will ever light.",
    ironMine: "Iron ore — the first half of steel.",
    goldMine: "Gold ore. Your knights fight braver for it.",
    smelter: "Melts coal and iron ore together into steel.",
    goldsmelter: "Melts coal and gold ore into gold bars.",
    toolmaker: "Makes the tools that turn settlers into workers.",
    weaponsmith: "Hammers out the swords and shields knights carry.",
    boatwright: "Builds boats to carry goods across the water.",
  };

  // ---------- Transport / flags ----------
  FSC.FLAG_CAP = 8;            // goods waiting at a flag
  FSC.IN_CAP = 8;              // building input stock target (per res) incl. in-flight
  // (PHASE-C: these are all "how many edges of walking is that?" numbers, so they
  //  were rescaled when the confirmed slope-based walk pacing landed — flat 26 t/edge.)
  FSC.RETRY_T = 120;           // destless goods reschedule period (ticks)
  FSC.CONGEST_T = 600;         // carrier gives up waiting on a full dest flag
  /* Anti-starvation pickup aging (deviation, plan §14.11): a waiting item gains one
   * effective priority step per AGE_T ticks so low-priority plank/stone bound for a
   * construction site can never lose the pickup race forever on a busy road. */
  FSC.PICKUP_AGE_T = 600;      // ticks per gained priority step (1 game-minute)
  FSC.PICKUP_AGE_MAX = 26;     // enough steps to eventually outrank anything
  /* ===== PHASE-E: flags this full get a pulsing "congested" highlight ===== */
  FSC.CONGEST_GLOW_MIN = 6;
  FSC.DOOR_T = 4;              // flag->building hand-off ticks
  FSC.SPAWN_GAP = 8;           // ticks between serfs exiting a warehouse door
  FSC.DOOR_DIR = "SE";         // building door flag = SE neighbour of building vertex

  // ---------- Construction ----------
  // The builder swings a hammer; each swing adds BLD.phase to a 16-bit accumulator and
  // one material is eaten every SWING_PER_MAT swings (planks first, then stones).
  FSC.LEVEL_T = 250;           // digger leveling ticks (large sites)
  /* ═══ CONSTRUCTION RUNS 1.5x FASTER THAN THE ORIGINAL (batch #4, 2026-08-02,
   * user request) ═══════════════════════════════════════════════════════════
   * THE authoritative construction rate: the builder's swing cadence. The
   * accumulator, the per-material draw (SWING_PER_MAT) and every building's
   * own `swings` table are the ORIGINAL's numbers and are untouched — only the
   * ticks between swings changed, [77,51,51,77] → [51,34,34,51], mean 64 → 42.5
   * ticks = 1.506x. Multiplying here rather than dividing the swing counts
   * keeps the material draw landing on exactly the swings it always did.
   * The ARRAY LENGTH is deliberately unchanged: FSC.rngInt(SWING_TICKS.length)
   * draws once per swing, so the rng STREAM keeps its shape and only the clock
   * moves. A documented deviation from the recovered original — see
   * farmstead-plan.md deviation 15. */
  FSC.SWING_TICKS = [51, 34, 34, 51];   // ticks per swing, picked by rng
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
  FSC.NOTIF_CAP = 40;          // per PLAYER — one player's chatter can't evict another's
  FSC.NOTIF_CAP_TOTAL = 160;   // global backstop on the shared ring (4 players x 40)
  FSC.EVENT_CAP = 400;

  /* ===== PHASE-A: world generation ===== */
  FSC.ROW_Z = 0.8660254037844386;   // sqrt(3)/2 — row spacing factor (world z = r*TILE*ROW_Z)
  FSC.WATER_Y = 0;                  // world y of the water surface (heights are relative to it)
  FSC.GEN = {
    OCTAVES: 5, BASE_CELLS: 3, PERSIST: 0.52,   // fBm heightfield
    // island bowl: f = smoothstep(EDGE_0,EDGE_1,edgeDist) * (1-smoothstep(RAD_0,RAD_1,radius))
    // PLAYTEST 2026-08-01 ("more open green space"): the bowl used to carve ~49%
    // of every map into sea. A shallower bowl over a slightly wider interior
    // keeps the island read (a hard deep-water ring still frames it) and hands
    // the difference back as playable ground.
    /* PLAYTEST 2026-08-02 ("more open area and mountain and less water"): the
     * board was still ~41% sea on average (46/41/37 by size). Three levers, all
     * measured over 8 seeds x 3 sizes: a shallower bowl (SEA_BOWL), a lower
     * shoreline (WATER_N — the field is percentile-flattened, so this really is
     * an area fraction of the interior) and a wider interior before the radial
     * falloff starts (RAD_0). Result 33.2/29.5/25.6% water; the biggest single
     * sea is still 29/24/20% of the board, so boats and fisheries keep an
     * ocean, and all four starts land on ONE landmass on every seed measured. */
    EDGE_0: 0.02, EDGE_1: 0.15, RAD_0: 1.00, RAD_1: 1.5, SEA_BOWL: 0.20,
    // fields are percentile-flattened, so these thresholds ARE area fractions
    WATER_N: 0.145,           // normalized height of the shoreline
    /* …and the promised notch more MOUNTAIN. Dropping MOUNT_N alone would have
     * grown the snow cap with it (snow is scenery — not walkable, not buildable),
     * so SNOW_Y rises to hold the peaks roughly where they were: mountain
     * 13.5 -> 17.8% of the board, snow 3.4 -> 3.1%. */
    MOUNT_N: 0.715,       // normalized height where the plains band ends
    PLAIN_H: 2.1,         // world height of the top of the plains band (gentle slopes)
    /* PLAYTEST 2026-08-01 ("mines are hard to place"): a mine needs MOUNTAIN
     * under it AND a road up to its door, and roads cap a step at FSC.S_ROAD
     * (1.1). Twelve world units of relief across the mountain band made most
     * peaks road-proof — measured, only about half of all mountain ground could
     * ever hold a mine. MOUNT_H is now less than half that and the mountains get
     * a smoothing floor of their own (SMOOTH_W_MOUNT), so the range still reads
     * as rock but a road can climb it. MOUNTAIN_Y / SNOW_Y are re-anchored to
     * the new band so the MOUNTAIN AREA (and therefore the ore) barely moves. */
    MOUNT_H: 5.2,         // world height added across the mountain band
    DEEP_H: 9.0,          // world depth scale below the shoreline
    MOUNTAIN_Y: 2.30,     // y above which land is MOUNTAIN
    SNOW_Y: 6.0,          // y above which mountain is SNOW (see MOUNT_N above)
    SWAMP_Y: 0.75, SWAMP_MOIST: 0.72,   // wet lowlands
    DESERT_Y: 0.25, DESERT_MOIST: 0.11, // arid patches
    SMOOTH_PASSES: 3, SMOOTH_W: 0.7,   // lowland smoothing (plains stay buildable)
    SMOOTH_W_MOUNT: 0.42, // …and the floor that keeps the high ground climbable
    BORDER: 3,            // vertices of forced deep water at the map edge
    FOREST_T: 0.56, FOREST_P: 0.85,     // tree clump threshold / max density
    ROCK_T: 0.84, ROCK_P: 0.20,         // stone pile threshold / max density
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
    /* PLAYTEST 2026-08-02 ("every start needs its ore close to home"): 25 road
     * steps is not "close" — it is about 65 s of walking each way at 1x, and a
     * start whose only coal sits out there reads as a start with no coal. The
     * site scorer's soft bar and the new MINERAL GUARANTEE now share ONE number
     * so "close" means one thing in the code. 18 is where the map's own supply
     * already sits (measured before the change: coal was inside 16 steps for
     * 28-32 starts in 32, iron for 24-29), so the guarantee only has to fire on
     * the tail instead of rewriting mountains everywhere. */
    MOUNTAIN_MAX: 18,     // MINABLE rock must be within this many ROAD-LEGAL steps
    WIDE_R: 12,           // radius of the wide land-share reading (columns)
    WIDE_LAND_FRAC: 0.80, // …and the share a start needs (soft — relaxes per tier)
    TREES_R: 8, TREES_MIN: 6,
    STONES_R: 10, STONES_MIN: 2,
    /* PLAYTEST 2026-08-01 ("starting areas too close"): the ladder now asks for
     * roughly half the map between castles and the farthest-point set is
     * weighed at EVERY rung instead of only after the whole ladder failed, so
     * a clustered candidate pool no longer collapses straight to the floor. */
    SEP_FRAC: [0, 0.60, 0.60, 0.52, 0.46],   // min separation as a fraction of W, by player count
    SEP_RELAX: 0.94, SEP_PASSES: 3,
    SEP_FLOOR_FRAC: 0.36, SEP_FLOOR_STEP: 0.04, SEP_HARD_FLOOR: 0.22,
    TOPUP_TREES: 14, TOPUP_TREE_R: 7,        // fairness top-up around every start site
    TOPUP_STONES: 4, TOPUP_STONE_R: 9,
    REACH_MIN: 60,        // HARD floor: road-reachable vertices from the castle door
    REACH_CAP: 420,       // BFS node guard (early exit at REACH_MIN)
    CLEAR_R: 1,           // objects cleared around the castle vertex
    DOORSTEP_R: 2,        // …and around its door flag (the road head)
    APPROACH_ROUNDS: 24,  // passes of clutter-clearing that open a walled-in start
    APPROACH_CUT: 8,      // …objects removed per pass
    PLOTS_MIN: 24,        // legal small-building plots a start must open with
    /* --- FAIR STARTS (playtest 2026-08-01) -------------------------------
     * Every kingdom should open on comparable ground. After the per-site
     * top-up, balanceStarts() measures what each start can actually REACH
     * (road-legal ground from its door) and moves wood, stone and ore toward
     * a common target — topping the poor up and trimming the rich down to a
     * tolerance band, never to a mirror image. */
    /* The BFS has to be able to walk PAST the ore radius or the budget is a
     * measurement of the cap, not of the ground (radius 26 is ~2100 vertices),
     * and the ore radius has to cover MOUNTAIN_MAX or a start whose only rock
     * sits at the scorer's own limit reads as having none. */
    BAL_REACH: 2400,      // BFS cap when measuring one start's budget
    BAL_TOL: 0.22,        // how far above target a rich start may stay
    BAL_ORE_R: 26,        // ore is balanced over this radius (mines sit off-road)
    BAL_TREE_R: 12,       // planted wood stays inside a woodcutter's world
    BAL_STONE_R: 12,
    BAL_OPEN_R: 16,       // radius the "open buildable ground" reading covers
    BAL_CORE_R: 4,        // trimming never reaches inside this ring
    BAL_TREE_MAX_FRAC: 0.16,  // planted wood may not exceed this share of its disc
    BAL_STONE_MAX_FRAC: 0.10, // …nor stone charges (piles block plots too)
    BAL_ORE_MIN: 240,     // ore floor: nobody opens with a dead mountain
    BAL_MAX_ADD: 120,     // per start, per resource — a guard, never normally hit
    BAL_ORE_RINGS: [2, 4],   // shape of a balancing ore seam (as GEN.MINERAL_RINGS)
    /* --- GUARANTEED START ORE (playtest 2026-08-02) -----------------------
     * balanceStarts equalises the TOTAL buried amount; it says nothing about
     * WHICH ore, and the economy does not care about totals. Without coal AND
     * iron a kingdom can never smelt steel, so it can never make a tool, so it
     * can never create a new profession — it is over before it starts, and the
     * player cannot see why. So after the balancing, every start is checked for
     * each ore it actually needs INSIDE MOUNTAIN_MAX road steps of its own door,
     * and given one where the mountain came up empty.
     *   coal + iron  REQUIRED  (the steel chain, and therefore every tool)
     *   gold         WANTED    (knight morale; rare by design at MINERAL_W 2,
     *                           and measured absent from 8 starts in 32 on small)
     *   stone        NOT guaranteed — the stonecutter works SURFACE piles and
     *                those are already balanced; a stone mine is a late-game
     *                convenience, not a chain everything hangs off.
     * The cheap fix is preferred and usually applies: RE-KIND a seam that is
     * already near home, which costs the start's ore budget exactly nothing and
     * so cannot re-break the fairness band. Only a start with no near seam at
     * all gets fresh ore. */
    GUAR_ORE: ["COAL", "IRON"],       // a start without these cannot play
    GUAR_ORE_SOFT: ["GOLD"],          // …and this one it should still have
    GUAR_MIN_AMT: 8,                  // a seam this rich counts as "has it"
    GUAR_SEAM_RINGS: [2, 3],          // shape of a guaranteed seam (small on purpose)
    GUAR_FAR: 26,                     // fallback radius when nothing is inside MOUNTAIN_MAX
  };

  /* ===== PHASE-A: camera / render tunables ===== */
  /* ═════════════════ 2026-08-01: THE YAW IS FREE, THE PITCH IS A BAND ════════
   * Fork B LOCKED the yaw so the cast's sprite sheets could index a unit's
   * ABSOLUTE facing and be lit by a world-fixed sun. That lock is GONE (user
   * playtest): the sheets are re-baked DELTA-INDEXED — a cell is chosen by
   * (unit facing − live camera yaw) — and lit CAMERA-RELATIVE, which is the
   * only lighting a delta-indexed atlas can carry, because one cell has to
   * serve every (facing, camera) pair sharing that difference. fs-render
   * asserts `manifest.bake.lighting.mode === "camera-relative"` at load; a
   * world-fixed bake is refused rather than drawn wrong.
   *
   * Q/E and right/shift-drag turn the world again; the 2-finger twist is back.
   *
   * PITCH is baked at PITCH_START (52°) and clamped to a MEASURED band around
   * it. A sprite is a flat card in the camera's image plane, so tilting away
   * from the bake pitch foreshortens the drawn man differently from the way the
   * mesh he was baked from would. MEASURED in-game, not guessed (scratchpad
   * fs_pitchband.cjs): one still serf, the same world and camera rendered twice
   * — sprites, then the 3D fallback the sheets were baked from — differenced
   * over a 110 px crop, swept 30°..74°. At the CLOSEST legal zoom (DIST_MIN 8;
   * sampled at 10) the crop's mean |ΔRGB| is a clean V with its minimum exactly
   * at the bake pitch:
   *
   *     30° 5.73 · 40° 4.89 · 46° 3.60 · 50° 2.17 · [52° 1.21] · 56° 2.20
   *     · 58° 2.40 · 64° 2.74 · 74° 3.18            (mean |ΔRGB| /255)
   *
   * 1.21 at 52° is the bake's own floor — cell resolution, AA, and the constant
   * depth bias toward the camera. The band is where the error stays inside
   * TWICE that floor: 49°..58° (it is asymmetric because tilting toward
   * top-down saturates while tilting toward side-on shows the card edge-on).
   * At the default zoom the whole sweep is under 0.4 — invisible at play
   * distance either way. A vertical orbit drag is still WIRED (2026-08-01), it
   * simply cannot leave the band; the band also exists so a saved or staged
   * camera can be nudged for framing.
   * ══════════════════════════════════════════════════════════════════════════ */
  FSC.CAM = {
    FOV: 52, NEAR: 0.5, FAR: 2000,
    DIST_MIN: 8, DIST_MAX: 80, DIST_START: 34,
    YAW_START: 0,                                  // = manifest.bake.cameraYaw
    PITCH_MIN: 49 * Math.PI / 180, PITCH_MAX: 58 * Math.PI / 180, PITCH_START: 52 * Math.PI / 180,
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
    /* BATCH #4 2026-08-02: darker. In the user's DOS-Settlers reference the
     * trunk is a small dark stem under a big canopy, not a lit post. */
    TREE_TRUNK: [0x43331f, 0x4e3b26],
    TREE_LEAF: [0x2f5d3a, 0x4f8039],
    TREE_AUTUMN: [0xa3702c, 0xc08a2e, 0x8f5f2a],
    STUMP: 0x6b5137,
    STONE: 0x7c838d,
    SAPLING: 0x6fae54,
    FIELD: [0x6b5236, 0x7f7a44, 0x94974a, 0xc0b055, 0xdcb94a],
    FIELD_STUB: 0x8a7a55,
    CASTLE_WALL: 0xbfb6a4,
    CASTLE_ROOF: 0x74282c,
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
  FSC.WORK_IDLE_T = 60;        // fallback: look again in this many ticks
  /* Confirmed original per-profession retry cadences after a MISSED random
   * sample (internal ticks ÷ 10, same conversion as every other timer). */
  FSC.WORK_RETRY = { lumberjack: 40, forester: 70, stonecutter: 10, fisher: 10, farmer: 50 };
  /* Confirmed original SPIRAL-INDEX ranges (pos_add_spirally with a random dist).
   * The spiral is a hex ring walk, so ring R holds 6R tiles and the cumulative
   * boundaries are 6/18/36/60/90/126/168 — an index range therefore weights the
   * OUTER rings by their size, which is why a worker roams instead of clearing
   * inside-out. Ranges are [minIndex, maxIndex], 1-based.
   *   FORESTER IS A DELIBERATE DEVIATION (plan §14.12): the original plants out
   *   to index 128 (mean ≈ 4.4 tiles, a quarter of trips at the rim); we keep
   *   his grove inside ring 4 so the trees grow AROUND the hut. Restore 128
   *   here for the original's scattering. */
  FSC.WORK_SPIRAL = {
    lumberjack: [1, 128],      // rings 1-6 + a sliver of 7
    forester: [1, 60],         // rings 1-4  (original: [1, 128])
    stonecutter: [1, 128],
    fisher: [1, 64],           // rings 1-4 + a sliver of 5
    farmer: [7, 38],           // fields keep a MINIMUM distance: ring 2 out
  };
  FSC.FARM_GIVEUP_N = 131;     // consecutive missed samples before the farmer rests
  FSC.FARM_GIVEUP_IDLE_T = 500;
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

  /* --- DIFFICULTY (playtest 2026-08-01) -------------------------------------
   * A table OVER the personalities, exactly like Farm Kart's DIFF_BEHAVIOR over
   * BOT_PERSONA: personality still says who an opponent IS, difficulty says how
   * hard they play. Every field is a multiplier or a plain gate, so an easy AI
   * is a slower, gentler version of the same character rather than a different
   * one — and nothing here is per-player state, so both machines in a lockstep
   * game read the same numbers from G.difficulty.
   *
   *   period   planner cadence (×AI_PERIOD) — the pace it thinks at
   *   expand   territory hunger (×persona.expand)
   *   build    concurrent building sites (×AI_MAX_SITES, floored at 1)
   *   tries    wish-list entries one run may hunt for (×AI_TRIES)
   *   aggro    odds it demands before attacking (×AI_AGGRO — HIGHER is shyer)
   *   attackT  ticks between attack considerations (×AI_ATTACK_T)
   *   share    fraction of the spare garrison it commits (×AI_ATTACK_SHARE)
   *   answer   how much of the garrison it will scramble when its own land is
   *            attacked (occupancy levels added while under threat)
   */
  FSC.AI_DIFFS = ["easy", "normal", "hard"];
  FSC.AI_DIFF_DEFAULT = "normal";
  FSC.AI_DIFF = {
    easy:   { period: 1.8, expand: 0.6, build: 0.5, tries: 0.5, aggro: 2.0, attackT: 2.0, share: 0.5, answer: 0 },
    normal: { period: 1.0, expand: 1.0, build: 1.0, tries: 1.0, aggro: 1.0, attackT: 1.0, share: 1.0, answer: 1 },
    hard:   { period: 0.6, expand: 1.35, build: 1.5, tries: 1.5, aggro: 0.75, attackT: 0.6, share: 1.3, answer: 2 },
  };
  FSC.aiDiff = function (name) {
    return FSC.AI_DIFF[name] || FSC.AI_DIFF[FSC.AI_DIFF_DEFAULT];
  };

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

  /* ===================================================================== */
  /* ===== PHASE-V look — palettes, densities, FX budgets ================= */
  /* PURELY COSMETIC. Nothing below is read by fs-sim / fs-map / fs-military /
   * fs-ai / fs-net; nothing below may ever be fed into FSC.rng. The renderer,
   * the model builders and FSFX are the only consumers. ================== */
  /* ===================================================================== */

  // --- warm lush ground palette (replaces the Phase-A flat greens) ---------
  FSC.COL.TERR[1] = 0x74a04b;      // GRASS — warmer, more saturated meadow
  FSC.COL.TERR[2] = 0xd9c084;      // DESERT — warm sand
  FSC.COL.TERR[3] = 0x5b7040;      // SWAMP — wet olive
  FSC.COL.TERR[4] = 0x8b7c66;      // MOUNTAIN — warm rock
  FSC.COL.TERR[5] = 0xeef3fa;      // SNOW — crisp, faintly blue
  FSC.COL.GRASS_DRY = 0xaeb45c;    // sun-bleached upland meadow
  FSC.COL.BEACH = 0xe4d3a4;        // warm shore sand
  FSC.COL.WATER_SURF = 0x2d7fae;
  FSC.COL.FIELD = [0x6b5236, 0x7a7440, 0x8b8f46, 0xb8a44c, 0xd2ab3e];   // warmer, less bleached
  // a villager's tunic must not share the skin's tone or he reads as one bare
  // blob at game distance — dyed wool, cool against warm skin and green grass
  FSC.COL.SERF_CLOTH = 0x77879c;
  FSC.COL.SERF_SKIN = 0xdba977;
  FSC.COL.SKY = 0xa8d0e8;

  FSC.VIS = {
    // ---- sky + light -----------------------------------------------------
    SKY_TOP: 0x5f9ed8, SKY_MID: 0xa6d0ea, SKY_LOW: 0xdfe7e4,   // gradient dome
    SUN_COL: 0xfff1cf, SUN_I: 0.72,
    HEMI_SKY: 0xcfe6ff, HEMI_GND: 0x6a7346, HEMI_I: 0.58,
    FILL_COL: 0xbcd4f0, FILL_I: 0.20,                          // cool bounce
    FOG_COL: 0xcadeea, FOG_NEAR: 90, FOG_FAR: 400,
    TERR_EMISSIVE_K: 0.14,

    // ---- terrain surface -------------------------------------------------
    /* BATCH #4 2026-08-02 — THE CARPET. See FSModels.groundTex for the
     * arithmetic; the short version is that at play zoom one tile covers about
     * 100x80 screen px, so a 256-texel sheet was minified 2.5x and every blade
     * stroke fell inside the mip average. 512 texels over a 3.6-unit tile puts
     * the sheet at ~1.4 texels per screen pixel at play zoom (crisp) and 0.5 at
     * the closest legal zoom (magnified, not blurred), and the CLUMP layer is
     * authored at 0.2-0.6 world units precisely so it survives to 5-14 px. */
    GROUND_TEX_PX: 512,        // grass-carpet canvas size
    GROUND_TEX_UV: 3.6,        // world units per texture tile
    GROUND_BLADES: 6000,       // strokes PER RANK (dark stems, then lit tips)
    GROUND_CLUMPS: 620,        // mid-scale lumps — the layer the play camera reads
    GROUND_SPECKS: 46000,      // single-pixel sparkle, written straight into the buffer
    GROUND_TEX_MEAN: 0.955,    // the sheet's normalised mean (it multiplies the ground)
    GROUND_TEX_ANISO: 8,       // the one surface seen at a 49-58° graze to the fog
    PATCH_A: 0.085, PATCH_B: 0.055,   // low-freq meadow blotch amplitudes
    PATCH_FA: 0.041, PATCH_FB: 0.017, // …and their spatial frequencies
    GRASS_DEEP: 0x4e7a3a,      // lush hollows
    ROCK_STEEP: 0x5a5348,      // bare crag
    ROCK_WARM: 0x9a8464, ROCK_COOL: 0x6d7280,   // strata banding across a face
    SWAMP_WET: 0x3f5a4c,       // standing-water tint in the marshes
    SNOW_SHADE: 0xc9d8ea,
    SCREE_FRAC: 0.34,          // share of bare mountain vertices that grow a boulder

    // ---- grass tufts + flowers ------------------------------------------
    // CHARM PASS (2026-08-02, user: "hide the flat surfaces with low cost
    // grass… charming little sprite grass"). The meadow is BACK — Phase F had
    // switched it off as "too visually busy", and the two things that made it
    // busy are both fixed rather than dialled down: the clumps now take their
    // colour FROM THE GROUND THEY STAND ON (tuftTint samples the terrain's own
    // vertex colour, so a tuft reads as the meadow standing up rather than a
    // separate green object sitting on it), and they no longer appear on
    // painted road, on a footprint or on anything but GRASS. The per-frame CPU
    // breeze is gone too — sway is a vertex shader now, shared with the trees.
    // TUFT_PER_VERTEX 0 still disables the whole path (pools, spawn, the lot).
    TUFT_VARIANTS: 3,
    TUFT_PER_VERTEX: 4,        // clumps scattered per eligible GRASS vertex (0 = off)
    TUFT_MAX: 30000,           // hard cap (large maps thin out to fit)
    /* TALLER THAN WIDE, and that is the whole trick on this camera. Farmstead
     * looks down at 49-58°, so an upright quad loses ~62% of its HEIGHT to
     * foreshortening and none of its width: a clump authored wider than it is
     * tall arrives on screen as a squat spiky rectangle lying on the meadow —
     * a fallen leaf, which is exactly what the first pass looked like. At 0.26
     * wide by 0.36 tall the same clump projects to roughly square and reads as
     * grass standing up. (Phase V's "tall + thin = scratches" note was written
     * for the OLD wide-fan sheet; with the fan narrowed, tall is right.) */
    /* BATCH #4 2026-08-02: up ~25% in both axes, aspect ratio kept (0.72 →
     * 0.73). Once the back-face lighting bug was fixed the meadow stopped
     * being a scatter of dark specks and became almost invisible — a clump
     * covering 6x6 screen px at play zoom simply is not enough grass to read
     * as a carpet. Bigger clumps cover ~1.6x the ground for exactly the same
     * triangle count, which is the cheapest coverage on the board. */
    TUFT_H: 0.45, TUFT_W: 0.325,
    TUFT_GREEN: [0x6f9c46, 0x84ae52, 0x5e8a3c, 0x95b95a],
    TUFT_GROUND_MIX: 0.86,     // how much of a tuft's colour is the ground's own vertex colour
    TUFT_TINT_LIFT: 1.13,      // …and then a touch above it, so lit tips clear the meadow
    TUFT_SWAY: 0.16,           // (legacy CPU breeze — unused now the sway is a shader)
    TUFT_SWAY_HZ: 0.55,
    TUFT_WINDOW: 300,
    TUFT_SHADER_SWAY: 0.9,     // grass sway amplitude, as a multiple of the shared wind
    TUFT_SWAY_MASK: 2.4,       // height at which a blade reaches full lean (1/units)
    TUFT_ROAD_ALPHA: 26,       // roadCover above this (0..255) means "this is path, no grass"
    TUFT_FADE_DIST: 66,        // above this camera distance a tuft is sub-pixel
    FLOWER_FADE_DIST: 44,
    QUALITY_SOFT: 0.08,        // meadow density on a software rasteriser
    FLOWER_FRAC: 0.10,         // standalone per-eligible-grass-vertex chance of a flower (0 disables them too)
    FLOWER_MAX: 4000,          // hard cap for the (now tuft-independent) flower pool
    FLOWER_COL: [0xfff4e0, 0xffd94a, 0xe2624c, 0xd8a8e0],
    DESERT_TUFT: 0xc3b071, SWAMP_TUFT: 0x63793f,

    // ---- chunked frustum culling ----------------------------------------
    // Every instanced world pool used to set frustumCulled=false and submit the
    // WHOLE map every frame (playtest batch #3 measured ~340k of 376k triangles
    // as un-culled tree instances). Instances are now bucketed on a world grid;
    // only the buckets whose padded AABB meets the camera frustum are packed
    // into the draw buffer. Draw-call COUNT is unchanged — one mesh per kind,
    // exactly as before — so the zoomed-out case can never regress.
    CULL: true,                // master switch (FSRender.setCulling overrides)
    CULL_CELL: 16,             // world units per bucket side
    CULL_PAD_XZ: 1.8,          // widest object half-span + sway, added to every bucket
    CULL_PAD_UP: 4.0,          // tallest object above its ground vertex
    CULL_PAD_DOWN: 0.8,

    // ---- water -----------------------------------------------------------
    WATER_DEEP: 0x2a6c9c, WATER_SHALLOW: 0x5cb4cf,
    SHIMMER_OP: 0.22, SHIMMER_SPEED: 0.035,
    FOAM_COL: 0xf2fbff, FOAM_MAX: 1400, FOAM_HZ: 0.9, FOAM_S: 0.95,
    SPARK_COL: 0xfffbe8, SPARK_MAX: 240, SPARK_HZ: 2.3,
    BOAT_BOB: 0.045,

    // ---- trees -----------------------------------------------------------
    /* BATCH #4 2026-08-02 — the user's DOS-Settlers reference reads OLIVE and
     * a shade darker than Farmstead's summer green: its clumps run from a
     * near-black olive in the shadow to a warm yellow-green on the lit tops.
     * The atlas paint carries the value structure; these two carry the hue. */
    LEAF_A: [0x2b5a33, 0x3a6b2b, 0xa06d24],    // per species: deep tone
    LEAF_B: [0x4b8a4a, 0x7ba844, 0xd8a63a],    // …and highlight tone
    LEAF_CONIFER_MEAN: 0.94,   // the opaque conifer cell multiplies every fir tier's colour
    TREE_VARIANTS: 2,          // extra canopy arrangements for mature stages
    TREE_SWAY: 0.09,           // world units of lean at the top of a mature tree
    WIND_SWAY: 0.055, WIND_HZ: 0.33, WIND_WINDOW: 220,
    LEAF_FALL_MAX: 60,
    // CHARM PASS (2026-08-02): the canopy is FOLIAGE CARDS over a small solid
    // core, not a bag of icosahedra. A card is 2 triangles carrying a painted
    // leaf-mass cutout, so a mature tree costs a QUARTER of what a lobe cluster
    // did AND its silhouette is ragged instead of faceted.
    LEAF_TEX_PX: 256,          // one cell of the 4x3 foliage atlas
    /* BATCH #4: one more card on the two mature stages and one more crown
     * card at the top. The reference's canopies are CHUNKY — a ball of clumps
     * — and at 5 cards a mature broadleaf still showed daylight between the
     * fans when the camera happened to catch two of them edge-on. */
    LEAF_CARDS: [3, 4, 6, 7],  // cards per canopy, stage 1..4
    LEAF_CARD_TILT: 0.42,      // radians a card leans back from vertical
    LEAF_CROWN_CARDS: [0, 1, 2, 3],  // near-horizontal top cards (the 52° camera looks DOWN)
    LEAF_CORE: 0.56,           // solid core radius, as a fraction of canopy radius
    LEAF_ALPHA_TEST: 0.42,
    TREE_SWAY_MASK: 0.55,      // height at which a tree reaches full lean (1/units)

    // ---- crops -----------------------------------------------------------
    WHEAT_CLUSTERS: 5,         // stalk clumps pushed per ripe field vertex
    WHEAT_MAX: 700,

    // ---- contact shadows -------------------------------------------------
    SHADOW_COL: 0x2c3623, SHADOW_OP: 0.44, SHADOW_MAX: 4600,
    SHADOW_OFF: 0.26,          // shadows lie away from the sun, not under the model

    // ---- building charm --------------------------------------------------
    ATLAS_PX: 512,
    WALL_PLASTER: 0xe3d3b2, WALL_TIMBER: 0x6a4a2e, WALL_PLANK: 0xb08a56,
    WALL_STONE: 0xb3ab99, ROOF_THATCH: 0xc2a05a, ROOF_SHINGLE: 0x9b4b38,
    ROOF_SLATE: 0x6a6f78, WINDOW_GLOW: 0xffd98a, CHIMNEY: 0xa08a72,
    FOUNDATION: 0x8e8577,
    BLD_TRI_MAX: 900,

    // ---- FX budgets (FSFX) ----------------------------------------------
    FX_BUDGET_MS: 1.5,
    FISH_MAX: 14, FISH_BASE_HZ: 0.10, FISH_STOCK_K: 0.07, FISH_ARC_T: 1.05,
    SPLASH_MAX: 30, DROP_MAX: 90,
    BIRD_N: 4, BIRD_Y: 16, BIRD_R: 34, BIRD_SPD: 0.10,
    BFLY_MAX: 14, BFLY_R: 22,
    DUST_MAX: 40,
    SMOKE_PUFF_MAX: 120,
  };
  FSC.VIS.WHEAT_GREEN = 0x8aa844;
  FSC.VIS.WHEAT_RIPE = 0xd6b048;

  if (typeof window !== "undefined") window.FSC = FSC;
  if (typeof module !== "undefined" && module.exports) module.exports = FSC; // node tests
})();
