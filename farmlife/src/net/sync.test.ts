import { describe, expect, it } from "vitest";
import {
  REGION_SIZE,
  regionKeyForTile,
  regionKeyForTileKey,
  parseTileKey,
  playerDocId,
  isRegionDocId,
  isPlayerDocId,
  toWireTile,
  fromWireTile,
  groupTileWritesByRegion,
  diffTiles,
  toWirePlayer,
  applyWirePlayer,
  buildFarmStateFromDocs,
  collectionIsEmpty,
  extractPlayerFields,
  mergeLocalDirty,
  toWireDecor,
  sanitizeDecor,
  buildDecorFromDocs,
  diffDecor,
  buildMetaFromDocs,
  emptyMetaState,
  REGION_WORLD_M,
  regionKeyForWorldPos,
  toWirePlant,
  fromWirePlant,
  toWirePatch,
  fromWirePatch,
  diffPlants,
  diffPatches,
  collectLegacyTiles,
  freeformMigrated,
  type RawDoc,
} from "./sync";
import type { DecorRecord } from "../world/decorConst";
import type { Plant, TilledPatch } from "../farm/plots";
import { defaultFarmState, type FarmState, type TileRecord } from "../farm/store";

describe("region/tile key math", () => {
  it("maps tiles inside one region for the 12x12 field", () => {
    for (let gx = 0; gx < 12; gx++) {
      for (let gz = 0; gz < 12; gz++) {
        expect(regionKeyForTile(gx, gz)).toBe("region_0_0");
      }
    }
  });

  it("REGION_SIZE splits farther-out tiles into distinct regions", () => {
    expect(regionKeyForTile(0, 0)).toBe("region_0_0");
    expect(regionKeyForTile(REGION_SIZE, 0)).toBe("region_1_0");
    expect(regionKeyForTile(0, REGION_SIZE)).toBe("region_0_1");
    expect(regionKeyForTile(-1, 0)).toBe("region_-1_0"); // floor(-1/16) = -1
  });

  it("regionKeyForTileKey round-trips through parseTileKey", () => {
    expect(regionKeyForTileKey("t_6_6")).toBe("region_0_0");
    expect(regionKeyForTileKey("t_20_3")).toBe("region_1_0");
    expect(regionKeyForTileKey("bogus")).toBeNull();
  });

  it("parseTileKey rejects malformed keys", () => {
    expect(parseTileKey("t_6_6")).toEqual({ gx: 6, gz: 6 });
    expect(parseTileKey("t_-2_3")).toEqual({ gx: -2, gz: 3 });
    expect(parseTileKey("nope")).toBeNull();
    expect(parseTileKey("t_a_b")).toBeNull();
  });

  it("playerDocId sanitizes names but stays readable", () => {
    expect(playerDocId("Eleanor")).toBe("player_Eleanor");
    expect(playerDocId("  Isaac  ")).toBe("player_Isaac");
    expect(playerDocId("a/b c")).toBe("player_a_b_c");
    expect(playerDocId("")).toBe("player_Farmer");
  });

  it("doc id classifiers", () => {
    expect(isRegionDocId("region_0_0")).toBe(true);
    expect(isRegionDocId("region_-1_2")).toBe(true);
    expect(isRegionDocId("player_Dad")).toBe(false);
    expect(isRegionDocId("world")).toBe(false);
    expect(isPlayerDocId("player_Dad")).toBe(true);
    expect(isPlayerDocId("region_0_0")).toBe(false);
  });
});

describe("tile wire (de)serialization", () => {
  it("toWireTile omits undefined fields for a bare tilled tile", () => {
    expect(toWireTile({})).toEqual({});
  });

  it("toWireTile round-trips a planted tile through fromWireTile", () => {
    const rec: TileRecord = { crop: "turnip", plantedAt: 1000, accruedMs: 500, lastWatered: 1200 };
    const wire = toWireTile(rec);
    expect(wire).toEqual({ crop: "turnip", plantedAt: 1000, accruedMs: 500, lastWatered: 1200 });
    expect(fromWireTile(wire)).toEqual(rec);
  });

  it("fromWireTile is defensive against garbage", () => {
    expect(fromWireTile(null)).toEqual({});
    expect(fromWireTile("nope")).toEqual({});
    expect(fromWireTile({ crop: "not-a-crop" })).toEqual({});
    expect(fromWireTile({ crop: "corn" })).toEqual({ crop: "corn", plantedAt: 0, accruedMs: 0, lastWatered: 0 });
  });
});

describe("diffTiles — the snapshot-diff function", () => {
  it("returns nothing for identical maps", () => {
    const a = { t_1_1: { crop: "turnip" as const, plantedAt: 1, accruedMs: 0, lastWatered: 1 } };
    const b = { t_1_1: { crop: "turnip" as const, plantedAt: 1, accruedMs: 0, lastWatered: 1 } };
    expect(diffTiles(a, b)).toEqual([]);
  });

  it("detects an added tile", () => {
    expect(diffTiles({}, { t_2_2: {} })).toEqual(["t_2_2"]);
  });

  it("detects a removed tile", () => {
    expect(diffTiles({ t_2_2: {} }, {})).toEqual(["t_2_2"]);
  });

  it("detects a changed field (e.g. watering) without flagging untouched tiles", () => {
    const prev = {
      t_1_1: { crop: "turnip" as const, plantedAt: 1, accruedMs: 0, lastWatered: 1 },
      t_2_2: { crop: "corn" as const, plantedAt: 1, accruedMs: 0, lastWatered: 1 },
    };
    const next = {
      t_1_1: { crop: "turnip" as const, plantedAt: 1, accruedMs: 100, lastWatered: 50 },
      t_2_2: { crop: "corn" as const, plantedAt: 1, accruedMs: 0, lastWatered: 1 },
    };
    expect(diffTiles(prev, next)).toEqual(["t_1_1"]);
  });

  it("is symmetric-key-order safe (Set-based)", () => {
    const prev = { t_5_5: {} };
    const next = { t_9_9: {}, t_5_5: {} };
    expect(diffTiles(prev, next).sort()).toEqual(["t_9_9"]);
  });
});

describe("groupTileWritesByRegion", () => {
  it("groups changed keys by region and wire-encodes each tile", () => {
    const tiles: Record<string, TileRecord> = {
      t_1_1: {},
      t_1_2: { crop: "turnip", plantedAt: 5, accruedMs: 0, lastWatered: 5 },
      t_30_1: {}, // region_1_0 (floor(30/16)=1)
    };
    const groups = groupTileWritesByRegion(tiles, Object.keys(tiles));
    expect([...groups.keys()].sort()).toEqual(["region_0_0", "region_1_0"]);
    expect(groups.get("region_0_0")).toEqual({
      t_1_1: {},
      t_1_2: { crop: "turnip", plantedAt: 5, accruedMs: 0, lastWatered: 5 },
    });
    expect(groups.get("region_1_0")).toEqual({ t_30_1: {} });
  });

  it("skips malformed keys", () => {
    const groups = groupTileWritesByRegion({}, ["not-a-tile-key"]);
    expect(groups.size).toBe(0);
  });
});

describe("player wire", () => {
  it("toWirePlayer/applyWirePlayer round-trip", () => {
    const state = defaultFarmState();
    state.coins = 250;
    state.seeds.corn = 3;
    state.crops.pumpkin = 2;
    state.tank = 4;
    state.selectedTool = "can";
    state.selectedCrop = "corn";
    const wire = toWirePlayer(state);
    const base = defaultFarmState();
    const applied = applyWirePlayer(base, wire);
    expect(applied.coins).toBe(250);
    expect(applied.seeds.corn).toBe(3);
    expect(applied.crops.pumpkin).toBe(2);
    expect(applied.tank).toBe(4);
    expect(applied.selectedTool).toBe("can");
    expect(applied.selectedCrop).toBe("corn");
    expect(applied.tiles).toBe(base.tiles); // tiles are NOT touched by player wire
  });

  it("applyWirePlayer is defensive against garbage", () => {
    const base = defaultFarmState();
    const applied = applyWirePlayer(base, { coins: -5, selectedTool: "laser" });
    expect(applied.coins).toBe(base.coins);
    expect(applied.selectedTool).toBe(base.selectedTool);
  });
});

describe("buildFarmStateFromDocs / collectionIsEmpty", () => {
  it("merges tiles from every region doc, and only MY player doc", () => {
    const docs: RawDoc[] = [
      { id: "region_0_0", data: { t_1_1: { crop: "turnip", plantedAt: 1, accruedMs: 0, lastWatered: 1 } } },
      { id: "region_1_0", data: { t_20_2: {} } },
      { id: "player_Eleanor", data: { coins: 40, seeds: { turnip: 2 } } },
      { id: "player_Isaac", data: { coins: 999 } }, // someone else's — must NOT leak in
      { id: "meta", data: { name: "Amen Farms" } },
      { id: "world", data: { data: "default" } },
    ];
    const state = buildFarmStateFromDocs(docs, "player_Eleanor");
    // R5: legacy `t_` tiles convert IN MEMORY to free-form plants/patches with
    // deterministic migration ids; state.tiles stays empty (never surfaced live).
    expect(Object.keys(state.tiles)).toEqual([]);
    expect(Object.keys(state.patches).sort()).toEqual(["tp_mig_1_1", "tp_mig_20_2"]);
    expect(state.plants.p_mig_1_1.crop).toBe("turnip"); // planted tile → a plant
    expect(state.plants.p_mig_20_2).toBeUndefined(); // bare tilled tile → patch only
    expect(state.coins).toBe(40);
    expect(state.seeds.turnip).toBe(2);
  });

  it("collectionIsEmpty is true only with no tiles and no player docs", () => {
    expect(collectionIsEmpty([])).toBe(true);
    expect(collectionIsEmpty([{ id: "meta", data: {} }])).toBe(true);
    expect(collectionIsEmpty([{ id: "region_0_0", data: {} }])).toBe(true);
    expect(collectionIsEmpty([{ id: "region_0_0", data: { t_1_1: {} } }])).toBe(false);
    expect(collectionIsEmpty([{ id: "player_Dad", data: { coins: 5 } }])).toBe(false);
  });
});

describe("mergeLocalDirty — echo-during-debounce guard (Fix 1)", () => {
  // Simulate a harvest: local FarmState has crops.turnip = 1 and the tile
  // cleared to bare soil; the just-arrived snapshot echo still shows the
  // PRE-harvest server state (crops 0, turnip still growing). The old guard
  // froze to last-SENT (pre-harvest) values, reverting the harvest and then
  // re-sending it = data loss. mergeLocalDirty must keep the local values.
  function preHarvestSnapshot(): FarmState {
    const s = defaultFarmState();
    s.tiles = { t_6_6: { crop: "turnip", plantedAt: 0, accruedMs: 0, lastWatered: 0 } };
    s.coins = 10;
    s.crops.turnip = 0;
    return s;
  }

  it("no dirty state -> snapshot passes through untouched", () => {
    const fresh = preHarvestSnapshot();
    const out = mergeLocalDirty(fresh, null, null);
    expect(out.crops.turnip).toBe(0);
    expect(out.tiles.t_6_6.crop).toBe("turnip");
  });

  it("dirty player fields WIN over a stale echo (harvest is never reverted)", () => {
    const localPlayer = extractPlayerFields(
      Object.assign(defaultFarmState(), {
        coins: 15,
        crops: { turnip: 1, potato: 0, corn: 0, pumpkin: 0, strawberry: 0, carrot: 0, tomato: 0, sunflower: 0 },
      })
    );
    const out = mergeLocalDirty(preHarvestSnapshot(), localPlayer, null);
    expect(out.crops.turnip).toBe(1); // local harvest preserved, NOT reverted to 0
    expect(out.coins).toBe(15);
  });

  it("dirty tile keys WIN over a stale echo (harvested tile stays bare)", () => {
    const out = mergeLocalDirty(preHarvestSnapshot(), null, { t_6_6: {} });
    expect(out.tiles.t_6_6).toEqual({}); // bare tilled soil, not the echo's growing turnip
  });

  it("only the dirty tile is overridden — a co-op player's other tile stays live", () => {
    const fresh = preHarvestSnapshot();
    fresh.tiles.t_2_2 = { crop: "corn", plantedAt: 5, accruedMs: 0, lastWatered: 5 }; // another player just planted
    const out = mergeLocalDirty(fresh, null, { t_6_6: {} });
    expect(out.tiles.t_6_6).toEqual({});
    expect(out.tiles.t_2_2.crop).toBe("corn"); // remote tile still applied live
  });

  it("extractPlayerFields deep-copies the seed/crop maps (immune to later edits)", () => {
    const s = defaultFarmState();
    s.crops.turnip = 3;
    const snap = extractPlayerFields(s);
    s.crops.turnip = 99; // later in-place mutation of the live state
    expect(snap.crops.turnip).toBe(3); // protected copy unchanged
  });
});

// ---- P5: decor wire (de)serialization + sanitizer ---------------------------
describe("decor wire", () => {
  const rec: DecorRecord = { id: "d_abc123", type: "bench", x: 5, z: -3, rotY: 0.5, placedBy: "Eleanor", placedAt: 1000 };

  it("toWireDecor omits the id (it's the field key) and keeps defined fields", () => {
    expect(toWireDecor(rec)).toEqual({ type: "bench", x: 5, z: -3, rotY: 0.5, placedBy: "Eleanor", placedAt: 1000 });
  });

  it("sanitizeDecor round-trips a good field value", () => {
    expect(sanitizeDecor("d_abc123", toWireDecor(rec))).toEqual(rec);
  });

  it("sanitizeDecor is defensive against garbage / unknown types / bad keys", () => {
    expect(sanitizeDecor("d_abc123", null)).toBeNull();
    expect(sanitizeDecor("d_abc123", { type: "not-a-decor" })).toBeNull();
    expect(sanitizeDecor("bogus-key", toWireDecor(rec))).toBeNull();
    // missing numeric fields default to 0, still a valid record
    expect(sanitizeDecor("d_x1", { type: "gnome" })).toEqual({
      id: "d_x1",
      type: "gnome",
      x: 0,
      z: 0,
      rotY: 0,
      placedBy: "",
      placedAt: 0,
    });
  });

  it("buildDecorFromDocs reads the decor doc, skipping null (removed) fields", () => {
    const docs: RawDoc[] = [
      { id: "decor", data: { d_a: toWireDecor(rec), d_b: null, junk: 5 } },
      { id: "region_0_0", data: {} },
    ];
    const map = buildDecorFromDocs(docs);
    expect(Object.keys(map)).toEqual(["d_a"]);
    expect(map.d_a.type).toBe("bench");
  });

  it("buildDecorFromDocs returns {} when the decor doc is absent (normal empty state)", () => {
    expect(buildDecorFromDocs([{ id: "region_0_0", data: {} }])).toEqual({});
  });

  it("diffDecor detects add / remove / transform changes", () => {
    const a = { d_a: rec };
    const moved: DecorRecord = { ...rec, x: 9 };
    expect(diffDecor(a, { d_a: moved })).toEqual(["d_a"]);
    expect(diffDecor({}, { d_a: rec })).toEqual(["d_a"]);
    expect(diffDecor(a, {})).toEqual(["d_a"]);
    expect(diffDecor(a, { d_a: rec })).toEqual([]);
  });
});

// ---- P5: meta doc ----------------------------------------------------------
describe("meta doc", () => {
  it("buildMetaFromDocs parses shipped_/milestone_/farmName/foundedAt", () => {
    const docs: RawDoc[] = [
      {
        id: "meta",
        data: { shipped_turnip: 12, shipped_milk: 3, milestone_tenTurnips: 555, farmName: "Amen Acres", foundedAt: 100, junk: "x" },
      },
    ];
    const m = buildMetaFromDocs(docs);
    expect(m.shipped.turnip).toBe(12);
    expect(m.shipped.milk).toBe(3);
    expect(m.milestones.tenTurnips).toBe(555);
    expect(m.farmName).toBe("Amen Acres");
    expect(m.foundedAt).toBe(100);
  });

  it("buildMetaFromDocs returns an empty state when the meta doc is absent", () => {
    expect(buildMetaFromDocs([])).toEqual(emptyMetaState());
  });
});

// ---- R5: free-form plants + patches wire -----------------------------------
describe("free-form region-by-world-pos key math", () => {
  it("buckets metres into region docs (REGION_WORLD_M = 32)", () => {
    expect(REGION_WORLD_M).toBe(32);
    expect(regionKeyForWorldPos(0, 0)).toBe("region_0_0");
    expect(regionKeyForWorldPos(5, 5)).toBe("region_0_0"); // 5/32 → 0
    expect(regionKeyForWorldPos(40, 3)).toBe("region_1_0"); // 40/32 → 1
    expect(regionKeyForWorldPos(-17, 6)).toBe("region_-1_0"); // floor(-17/32) = -1
  });
});

describe("plant wire (de)serialization", () => {
  const p: Plant = { id: "p_abc12", x: 3.5, z: -2.25, crop: "corn", plantedAt: 100, accruedMs: 50, lastWatered: 120, waterings: 2 };
  it("toWirePlant omits the id (it's the field key); fromWirePlant round-trips", () => {
    const wire = toWirePlant(p);
    expect(wire).toEqual({ crop: "corn", x: 3.5, z: -2.25, plantedAt: 100, accruedMs: 50, lastWatered: 120, waterings: 2 });
    expect(fromWirePlant("p_abc12", wire)).toEqual(p);
  });
  it("fromWirePlant is defensive (bad key / null / unknown crop → null)", () => {
    expect(fromWirePlant("p_abc12", null)).toBeNull(); // a removed (null) field
    expect(fromWirePlant("nope", toWirePlant(p))).toBeNull();
    expect(fromWirePlant("p_x", { crop: "not-a-crop" })).toBeNull();
    expect(fromWirePlant("p_x", { crop: "turnip" })).toMatchObject({ crop: "turnip", x: 0, z: 0, waterings: 0 });
  });
});

describe("patch wire (de)serialization", () => {
  const tp: TilledPatch = { id: "tp_abc12", x: 1, z: 2, r: 0.9 };
  it("round-trips through fromWirePatch", () => {
    expect(toWirePatch(tp)).toEqual({ x: 1, z: 2, r: 0.9 });
    expect(fromWirePatch("tp_abc12", toWirePatch(tp))).toEqual(tp);
  });
  it("clamps r to PATCH_MAX_R and rejects r<=0 / bad key", () => {
    expect(fromWirePatch("tp_x", { x: 0, z: 0, r: 99 })!.r).toBe(1.8);
    expect(fromWirePatch("tp_x", { x: 0, z: 0, r: 0 })).toBeNull();
    expect(fromWirePatch("bad", toWirePatch(tp))).toBeNull();
  });
});

describe("diffPlants / diffPatches", () => {
  const p = (id: string, x: number, watered: number): Plant => ({ id, x, z: 0, crop: "turnip", plantedAt: 0, accruedMs: 0, lastWatered: watered, waterings: 0 });
  it("detects added / removed / watered plants, ignores unchanged", () => {
    expect(diffPlants({}, { a: p("a", 0, 0) })).toEqual(["a"]); // added
    expect(diffPlants({ a: p("a", 0, 0) }, {})).toEqual(["a"]); // removed (harvested)
    expect(diffPlants({ a: p("a", 0, 0) }, { a: p("a", 0, 500) })).toEqual(["a"]); // watered
    expect(diffPlants({ a: p("a", 0, 0) }, { a: p("a", 0, 0) })).toEqual([]);
  });
  it("detects patch add / grow, ignores unchanged", () => {
    const tp = (id: string, r: number): TilledPatch => ({ id, x: 0, z: 0, r });
    expect(diffPatches({}, { a: tp("a", 0.9) })).toEqual(["a"]);
    expect(diffPatches({ a: tp("a", 0.9) }, { a: tp("a", 1.2) })).toEqual(["a"]); // grown
    expect(diffPatches({ a: tp("a", 0.9) }, { a: tp("a", 0.9) })).toEqual([]);
  });
});

describe("cloud migration helpers", () => {
  it("collectLegacyTiles gathers every t_ field across region docs", () => {
    const docs: RawDoc[] = [
      { id: "region_0_0", data: { t_1_1: { crop: "turnip", plantedAt: 1, accruedMs: 0, lastWatered: 1 }, p_x: { crop: "corn", x: 0, z: 0 } } },
      { id: "region_1_0", data: { t_20_2: {} } },
      { id: "meta", data: {} },
    ];
    const tiles = collectLegacyTiles(docs);
    expect(Object.keys(tiles).sort()).toEqual(["t_1_1", "t_20_2"]);
    expect(tiles.t_1_1.crop).toBe("turnip");
  });
  it("freeformMigrated reads the marker on region_0_0", () => {
    expect(freeformMigrated([{ id: "region_0_0", data: { t_1_1: {} } }])).toBe(false);
    expect(freeformMigrated([{ id: "region_0_0", data: { mig_freeform: 12345 } }])).toBe(true);
  });
});

describe("buildFarmStateFromDocs reads free-form plants/patches", () => {
  it("reads p_/tp_ fields and converts leftover legacy t_ (deterministic, no dup)", () => {
    const docs: RawDoc[] = [
      { id: "region_0_0", data: { p_live1: { crop: "corn", x: 2, z: 3, plantedAt: 0, accruedMs: 0, lastWatered: 0, waterings: 0 }, tp_live1: { x: 2, z: 3, r: 0.9 } } },
      // a leftover legacy tile not yet migrated in Firestore → converted in memory
      { id: "region_-1_0", data: { t_1_1: { crop: "turnip", plantedAt: 5, accruedMs: 0, lastWatered: 5 } } },
    ];
    const state = buildFarmStateFromDocs(docs, "player_Eleanor");
    expect(Object.keys(state.plants).sort()).toEqual(["p_live1", "p_mig_1_1"]);
    expect(Object.keys(state.patches).sort()).toEqual(["tp_live1", "tp_mig_1_1"]);
    expect(state.plants.p_live1.crop).toBe("corn");
    expect(Object.keys(state.tiles)).toEqual([]); // legacy never surfaced live
  });
});
