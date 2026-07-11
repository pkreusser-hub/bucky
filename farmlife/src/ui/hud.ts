import { CROP_ORDER, CROPS, CropId } from "../farm/growth";
import { TOOL_ORDER, TOOL_META, type ToolId } from "../farm/action";
import { EMOTE_ORDER, EMOTES, type EmoteKind } from "../player/emoteConst";
import { DECOR, DECOR_ORDER } from "../world/decorConst";

/** Farm Book (P5) content, assembled by main.ts from the meta doc. */
export interface FarmBookData {
  farmName: string;
  foundedAt: number; // ms (0 = unknown)
  shipped: Array<{ emoji: string; name: string; count: number }>;
  milestones: Array<{ key: string; label: string; emoji: string; desc: string; earnedAt: number }>;
}

// Farm HUD: coins (top-left), TOOL hotbar (bottom-center: 🖐 Hands · ⛏️ Hoe ·
// 🚿 Can w/ water meter · 🌱 Seeds w/ crop emoji + count), context-action label
// (floats near the targeted tile, reflects equipped tool vs target), toasts
// (max 2), the seed-stand shop, plus mobile JUMP + ACTION thumb buttons. All
// DOM overlay, CSS transitions only (house gotcha: @keyframes stall headless).
// Mobile-safe-area aware; sits clear of the P0 touch zones via z-index +
// pointer-events which win hit-testing over the joystick/orbit zones.

export interface ToolHudInfo {
  selectedTool: ToolId;
  tank: number;
  tankCap: number;
  cropEmoji: string; // selected crop emoji (seed-pouch slot)
  seedCount: number; // seeds owned of the selected crop
}

export interface Hud {
  root: HTMLElement;
  setCoins(n: number): void;
  setTools(info: ToolHudInfo): void;
  showActionLabel(text: string | null, sx: number, sy: number, color: string): void;
  toast(msg: string): void;
  showShop(coins: number, seeds: Record<CropId, number>): void;
  hideShop(): void;
  isShopOpen(): boolean;
  onSelectTool(cb: (id: ToolId) => void): void;
  onCycleCrop(cb: () => void): void;
  onBuySeed(cb: (id: CropId) => void): void;
  onCloseShop(cb: () => void): void;
  onAction(cb: () => void): void;
  onJump(cb: () => void): void;
  /** P5: shop's Decorate tab — buy a decoration (enters placement mode). */
  onBuyDecor(cb: (type: string) => void): void;
  /** P5: Farm Book panel (milestones + shipped totals). */
  showFarmBook(data: FarmBookData): void;
  hideFarmBook(): void;
  isFarmBookOpen(): boolean;
  onOpenBook(cb: () => void): void;
  onCloseBook(cb: () => void): void;
  /** P5: decoration placement mode — banner + mobile rotate/cancel buttons.
   * `valid` red/green-tints the banner to match the 3D ghost. */
  showPlacement(label: string, valid: boolean): void;
  hidePlacement(): void;
  onRotate(cb: () => void): void;
  onCancelPlace(cb: () => void): void;
  /** P3 emote picker (💬 button opens a 3-emote row). */
  onEmote(cb: (kind: EmoteKind) => void): void;
  /** P2 sync status pill (top-right): "synced" auto-tucks after a few seconds
   * (index.html status-tuck convention), "offline"/"connecting" stay visible. */
  setSyncStatus(mode: "synced" | "offline" | "connecting"): void;
  /** P3: number of family members on the farm (incl. self). >1 appends a
   * "· 👩‍🌾 N" count to the sync pill. */
  setPresence(count: number): void;
  /** P4: real Woodville weather chip (top-left, under coins). `text` is the
   * fully-formatted label (emoji + optional temp); null hides it (no data yet). */
  setWeather(text: string | null): void;

  // ---- P7: Farm Map -----------------------------------------------------
  /** The map's drawing surface — main.ts's frame loop draws onto this
   * (2D canvas) each frame while the map is open. Sized responsively by CSS;
   * `mapCanvasSize()` reports the current square backing-store side (px). */
  mapCanvas: HTMLCanvasElement;
  mapCanvasSize(): number;
  openMap(): void;
  closeMap(): void;
  isMapOpen(): boolean;
  /** Static legend row (emoji + label pairs), set once at boot. */
  setMapLegend(items: Array<{ emoji: string; label: string }>): void;

  // ---- P7: Inventory ------------------------------------------------------
  isInventoryOpen(): boolean;
  /** Opens (if not already) and (re)renders the full inventory content —
   * called once on open and every frame thereafter while open (cheap DOM
   * text/row updates) so remote-sync changes show live. */
  showInventory(data: InventoryData): void;
  hideInventory(): void;
  /** Button/key ('I') asked to open — main.ts responds by building fresh
   * InventoryData and calling showInventory(). */
  onOpenInventory(cb: () => void): void;
  onCloseInventory(cb: () => void): void;
  /** Tapped a seed row — select it as the active planting seed (syncs the
   * hotbar's seed-pouch slot) and close the panel. */
  onSelectInventorySeed(cb: (id: CropId) => void): void;
  /** Tapped a tool row — equip it and close the panel. */
  onEquipInventoryTool(cb: (id: ToolId) => void): void;
}

export interface InventorySeedRow {
  id: CropId;
  emoji: string;
  name: string;
  count: number;
  seedCost: number;
  selected: boolean;
}
export interface InventoryProduceRow {
  emoji: string;
  name: string;
  count: number;
  sellPrice: number;
}
export interface InventoryToolRow {
  id: ToolId;
  glyph: string; // innerHTML (icon) or emoji text
  isIcon: boolean;
  name: string;
  selected: boolean;
}
export interface InventoryData {
  seeds: InventorySeedRow[];
  produce: InventoryProduceRow[];
  produceTotalValue: number;
  tools: InventoryToolRow[];
  tank: number;
  tankCap: number;
}

export function buildHud(): Hud {
  const style = document.createElement("style");
  style.textContent = `
    #fl-hud { position: fixed; inset: 0; pointer-events: none; z-index: 25;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    #fl-coins { position: absolute; top: calc(env(safe-area-inset-top,0px) + 10px);
      left: 10px; background: rgba(24,20,10,.72); color: #ffe9a8; font-weight: 800;
      font-size: 17px; padding: 7px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); }
    #fl-sync { position: absolute; top: calc(env(safe-area-inset-top,0px) + 10px);
      right: 10px; background: rgba(24,20,10,.72); color: #cfe0ee; font-weight: 700;
      font-size: 12px; padding: 5px 11px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16);
      opacity: 1; transition: opacity .4s ease; white-space: nowrap; }
    #fl-sync.tucked { opacity: 0; }
    #fl-weather { position: absolute; top: calc(env(safe-area-inset-top,0px) + 46px);
      left: 10px; background: rgba(24,20,10,.72); color: #dcecff; font-weight: 700;
      font-size: 12px; padding: 5px 11px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16);
      white-space: nowrap; display: none; }
    #fl-weather.show { display: block; }
    #fl-hotbar { position: absolute; bottom: calc(env(safe-area-inset-bottom,0px) + 12px);
      left: 50%; transform: translateX(-50%); display: flex; gap: 8px; pointer-events: auto; }
    .fl-slot { position: relative; width: 58px; height: 64px; border-radius: 12px; background: rgba(24,20,10,.72);
      border: 2px solid rgba(255,255,255,.16); display: flex; flex-direction: column;
      align-items: center; justify-content: center; color: #fff; cursor: pointer;
      transition: border-color .12s, background .12s, transform .12s; user-select: none; }
    .fl-slot .key { position: absolute; top: 2px; left: 5px; font-size: 9px; color: #b7ad90; font-weight: 700; }
    .fl-slot .em { font-size: 24px; line-height: 1; }
    .fl-slot .cnt { font-size: 10px; margin-top: 2px; color: #dcd2b8; font-variant-numeric: tabular-nums; min-height: 12px; }
    .fl-slot.sel { border-color: #ffd35a; background: rgba(60,48,10,.85); transform: translateY(-3px); }
    .fl-slot .meter { position: absolute; right: 4px; top: 8px; bottom: 8px; width: 6px;
      border-radius: 3px; background: rgba(255,255,255,.18); overflow: hidden; }
    .fl-slot .meter .fill { position: absolute; left: 0; right: 0; bottom: 0; background: #4aa3d6;
      border-radius: 3px; transition: height .15s; }
    #fl-actionlabel { position: absolute; transform: translate(-50%,-100%); background: rgba(10,10,10,.78);
      color: #fff; font-weight: 700; font-size: 13px; padding: 4px 10px; border-radius: 8px;
      white-space: nowrap; opacity: 0; transition: opacity .1s; pointer-events: none; border: 1.5px solid; }
    #fl-actionbtn { position: absolute; right: calc(env(safe-area-inset-right,0px) + 18px);
      bottom: calc(env(safe-area-inset-bottom,0px) + 96px); width: 74px; height: 74px; border-radius: 50%;
      background: rgba(70,150,70,.88); border: 3px solid rgba(255,255,255,.55); color: #fff;
      font-size: 30px; display: none; align-items: center; justify-content: center;
      pointer-events: auto; z-index: 30; transition: transform .08s, background .12s; }
    #fl-actionbtn:active { transform: scale(0.92); }
    #fl-jumpbtn { position: absolute; right: calc(env(safe-area-inset-right,0px) + 26px);
      bottom: calc(env(safe-area-inset-bottom,0px) + 184px); width: 62px; height: 62px; border-radius: 50%;
      background: rgba(70,120,190,.88); border: 3px solid rgba(255,255,255,.5); color: #fff;
      font-size: 15px; font-weight: 800; display: none; align-items: center; justify-content: center;
      pointer-events: auto; z-index: 30; transition: transform .08s; }
    #fl-jumpbtn:active { transform: scale(0.9); }
    body.fl-mobile #fl-actionbtn, body.fl-mobile #fl-jumpbtn { display: flex; }
    #fl-emotebtn { position: absolute; top: calc(env(safe-area-inset-top,0px) + 46px);
      right: 10px; width: 42px; height: 42px; border-radius: 50%; background: rgba(24,20,10,.72);
      border: 1px solid rgba(255,255,255,.18); color: #fff; font-size: 20px; cursor: pointer;
      display: flex; align-items: center; justify-content: center; pointer-events: auto; z-index: 31;
      transition: transform .08s, background .12s; }
    #fl-emotebtn:active { transform: scale(0.9); }
    #fl-emotepick { position: absolute; top: calc(env(safe-area-inset-top,0px) + 94px);
      right: 10px; display: none; flex-direction: column; gap: 6px; pointer-events: auto; z-index: 31; }
    #fl-emotepick.open { display: flex; }
    #fl-emotepick button { width: 44px; height: 44px; border-radius: 50%; background: rgba(24,20,10,.82);
      border: 1px solid rgba(255,255,255,.2); font-size: 22px; cursor: pointer;
      transition: transform .08s, background .12s; }
    #fl-emotepick button:active { transform: scale(0.88); }
    #fl-toasts { position: absolute; top: calc(env(safe-area-inset-top,0px) + 56px); left: 50%;
      transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; align-items: center; }
    .fl-toast { background: rgba(20,16,8,.85); color: #fff; padding: 7px 14px; border-radius: 10px;
      font-size: 13px; font-weight: 600; opacity: 0; transform: translateY(-6px);
      transition: opacity .18s, transform .18s; border: 1px solid rgba(255,255,255,.14); }
    .fl-toast.show { opacity: 1; transform: translateY(0); }
    #fl-shop { position: fixed; inset: 0; background: rgba(10,14,8,.55); display: none;
      align-items: center; justify-content: center; z-index: 35; pointer-events: auto; }
    #fl-shop.open { display: flex; }
    #fl-shop .card { background: #fbf6e6; border-radius: 18px; padding: 18px; width: min(340px, 88vw);
      box-shadow: 0 12px 40px rgba(0,0,0,.4); }
    #fl-shop h3 { margin: 0 0 4px; color: #3f5a2c; font-size: 19px; }
    #fl-shop .sub { margin: 0 0 12px; color: #6b7a5a; font-size: 12px; }
    #fl-shop .row { display: flex; align-items: center; gap: 10px; padding: 8px 6px;
      border-bottom: 1px solid #e6dcc0; }
    #fl-shop .row .em { font-size: 26px; }
    #fl-shop .row .name { flex: 1; font-weight: 700; color: #3a3020; font-size: 14px; }
    #fl-shop .row .price { font-size: 12px; color: #8a7a4a; margin-right: 4px; }
    #fl-shop button.buy { background: #4a8a3f; color: #fff; border: 0; border-radius: 8px;
      padding: 8px 14px; font-weight: 800; font-size: 13px; cursor: pointer; }
    #fl-shop button.buy:disabled { background: #b9b9a8; cursor: not-allowed; }
    #fl-shop button.close { margin-top: 10px; width: 100%; background: #3f5a2c; color: #fff;
      border: 0; border-radius: 10px; padding: 10px; font-weight: 700; cursor: pointer; }
    #fl-shop .tabs { display: flex; gap: 6px; margin-bottom: 10px; }
    #fl-shop .tab { flex: 1; background: #ece3c8; color: #6b5a34; border: 0; border-radius: 9px;
      padding: 9px; font-weight: 800; font-size: 13px; cursor: pointer; }
    #fl-shop .tab.sel { background: #4a8a3f; color: #fff; }
    #fl-shop-rows { max-height: 46vh; overflow-y: auto; -webkit-overflow-scrolling: touch; }
    /* Farm Book panel (P5) — same modal shape as the shop */
    #fl-bookbtn { position: absolute; top: calc(env(safe-area-inset-top,0px) + 46px); left: 10px;
      background: rgba(24,20,10,.72); color: #ffe9a8; font-weight: 800; font-size: 13px;
      padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18);
      cursor: pointer; pointer-events: auto; z-index: 26; }
    body.fl-hasweather #fl-bookbtn { top: calc(env(safe-area-inset-top,0px) + 82px); }
    #fl-book { position: fixed; inset: 0; background: rgba(10,14,8,.55); display: none;
      align-items: center; justify-content: center; z-index: 36; pointer-events: auto; }
    #fl-book.open { display: flex; }
    #fl-book .card { background: #fbf6e6; border-radius: 18px; padding: 18px; width: min(380px, 90vw);
      max-height: 88vh; display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(0,0,0,.4); }
    #fl-book h3 { margin: 0 0 2px; color: #3f5a2c; font-size: 20px; }
    #fl-book .founded { margin: 0 0 12px; color: #8a7a4a; font-size: 12px; }
    #fl-book .scroll { overflow-y: auto; -webkit-overflow-scrolling: touch; }
    #fl-book .sect { font-weight: 800; color: #6b5a34; font-size: 13px; margin: 8px 0 6px; }
    #fl-book .ship { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 6px; }
    #fl-book .ship span { font-size: 14px; color: #3a3020; font-weight: 700; }
    #fl-book .ms { display: flex; align-items: center; gap: 9px; padding: 7px 8px; border-radius: 10px;
      margin-bottom: 5px; background: #efe7d0; }
    #fl-book .ms.earned { background: #fff2c4; border: 1px solid #e6c245; }
    #fl-book .ms .mi { font-size: 22px; width: 26px; text-align: center; filter: grayscale(1) opacity(.5); }
    #fl-book .ms.earned .mi { filter: none; }
    #fl-book .ms .mt { flex: 1; }
    #fl-book .ms .mn { font-weight: 800; font-size: 13px; color: #6b6250; }
    #fl-book .ms.earned .mn { color: #6b4a12; }
    #fl-book .ms .md { font-size: 11px; color: #9a9080; }
    #fl-book .ms .mdate { font-size: 10px; color: #b8891f; font-weight: 700; }
    #fl-book button.close { margin-top: 12px; width: 100%; background: #3f5a2c; color: #fff;
      border: 0; border-radius: 10px; padding: 10px; font-weight: 700; cursor: pointer; }
    /* Placement banner + mobile rotate/cancel (P5) */
    #fl-place { position: absolute; top: calc(env(safe-area-inset-top,0px) + 12px); left: 50%;
      transform: translateX(-50%); background: rgba(20,16,8,.9); color: #fff; font-weight: 800;
      font-size: 14px; padding: 8px 16px; border-radius: 12px; border: 2px solid #4caf50;
      display: none; white-space: nowrap; }
    #fl-place.show { display: block; }
    #fl-place.bad { border-color: #d64545; }
    #fl-rotatebtn { position: absolute; left: calc(env(safe-area-inset-left,0px) + 20px);
      bottom: calc(env(safe-area-inset-bottom,0px) + 96px); width: 66px; height: 66px; border-radius: 50%;
      background: rgba(90,110,180,.9); border: 3px solid rgba(255,255,255,.5); color: #fff;
      font-size: 24px; display: none; align-items: center; justify-content: center; pointer-events: auto;
      z-index: 30; }
    #fl-cancelbtn { position: absolute; left: calc(env(safe-area-inset-left,0px) + 20px);
      bottom: calc(env(safe-area-inset-bottom,0px) + 176px); width: 58px; height: 58px; border-radius: 50%;
      background: rgba(160,70,70,.9); border: 3px solid rgba(255,255,255,.5); color: #fff;
      font-size: 22px; display: none; align-items: center; justify-content: center; pointer-events: auto;
      z-index: 30; }
    body.fl-mobile.fl-placing #fl-rotatebtn, body.fl-mobile.fl-placing #fl-cancelbtn { display: flex; }
    /* P7: Farm Map + Inventory trigger buttons ------------------------- */
    #fl-mapbtn { position: absolute; top: calc(env(safe-area-inset-top,0px) + 46px); left: 145px;
      background: rgba(24,20,10,.72); color: #cfe8ff; font-weight: 800; font-size: 13px;
      padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18);
      cursor: pointer; pointer-events: auto; z-index: 26; }
    body.fl-hasweather #fl-mapbtn { top: calc(env(safe-area-inset-top,0px) + 82px); }
    #fl-invbtn { position: absolute; left: calc(env(safe-area-inset-left,0px) + 12px);
      bottom: calc(env(safe-area-inset-bottom,0px) + 12px); width: 52px; height: 52px; border-radius: 50%;
      background: rgba(24,20,10,.78); border: 2px solid rgba(255,255,255,.22); color: #fff; font-size: 22px;
      display: flex; align-items: center; justify-content: center; cursor: pointer; pointer-events: auto;
      z-index: 26; transition: transform .08s; }
    #fl-invbtn:active { transform: scale(0.9); }
    body.fl-mobile.fl-placing #fl-invbtn { display: none; }
    /* Farm Map panel — canvas + legend, same modal shape as the shop/book */
    #fl-map { position: fixed; inset: 0; background: rgba(10,14,8,.6); display: none;
      align-items: center; justify-content: center; z-index: 37; pointer-events: auto; }
    #fl-map.open { display: flex; }
    #fl-map .card { position: relative; background: #dfe9c9; border-radius: 18px; padding: 14px;
      width: min(560px, 94vw); max-height: 88vh; display: flex; flex-direction: column;
      box-shadow: 0 12px 40px rgba(0,0,0,.4); }
    #fl-map h3 { margin: 0 0 8px; color: #3f5a2c; font-size: 18px; }
    #fl-map-canvas { width: 100%; height: auto; aspect-ratio: 1 / 1; border-radius: 12px; display: block;
      background: #6f9c52; touch-action: none; }
    #fl-map .legend { display: flex; flex-wrap: wrap; gap: 5px 12px; margin-top: 10px; font-size: 11px;
      color: #2c3a1e; font-weight: 700; }
    #fl-map .legend span.dot { margin-right: 3px; }
    #fl-map .x { position: absolute; top: 10px; right: 10px; width: 38px; height: 38px; border-radius: 50%;
      background: rgba(20,16,8,.78); color: #fff; font-size: 18px; border: 0; cursor: pointer; z-index: 2; }
    @media (max-width: 520px) {
      #fl-map .card { width: 100vw; height: 100vh; max-height: 100vh; border-radius: 0;
        padding: calc(env(safe-area-inset-top,0px) + 16px) 14px calc(env(safe-area-inset-bottom,0px) + 14px);
        justify-content: center; }
    }
    /* Inventory panel — same modal shape, list-style rows like the shop */
    #fl-inv { position: fixed; inset: 0; background: rgba(10,14,8,.55); display: none;
      align-items: center; justify-content: center; z-index: 37; pointer-events: auto; }
    #fl-inv.open { display: flex; }
    #fl-inv .card { background: #fbf6e6; border-radius: 18px; padding: 18px; width: min(380px, 92vw);
      max-height: 88vh; display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(0,0,0,.4); }
    #fl-inv h3 { margin: 0 0 10px; color: #3f5a2c; font-size: 20px; }
    #fl-inv .scroll { overflow-y: auto; -webkit-overflow-scrolling: touch; }
    #fl-inv .sect { font-weight: 800; color: #6b5a34; font-size: 13px; margin: 10px 0 6px; }
    #fl-inv .row { display: flex; align-items: center; gap: 10px; padding: 7px 6px;
      border-bottom: 1px solid #e6dcc0; border-radius: 8px; }
    #fl-inv .row.tap { cursor: pointer; }
    #fl-inv .row.tap:active { background: #efe7cf; }
    #fl-inv .row.sel { background: #fff2c4; }
    #fl-inv .row .em { font-size: 24px; width: 28px; text-align: center; }
    #fl-inv .row .nm { flex: 1; font-weight: 700; color: #3a3020; font-size: 13.5px; }
    #fl-inv .row .cnt { font-weight: 800; color: #4a8a3f; font-size: 13px; }
    #fl-inv .row .price { font-size: 11px; color: #8a7a4a; }
    #fl-inv .row .meter { width: 60px; height: 8px; border-radius: 4px; background: #e6dcc0; overflow: hidden; }
    #fl-inv .row .meter .fill { height: 100%; background: #4aa3d6; }
    #fl-inv .total { text-align: right; font-weight: 800; color: #8a6a1f; font-size: 12.5px; margin: 4px 2px 0; }
    #fl-inv .empty { color: #9a9080; font-size: 12.5px; padding: 4px 6px 10px; }
    #fl-inv button.close { margin-top: 12px; width: 100%; background: #3f5a2c; color: #fff;
      border: 0; border-radius: 10px; padding: 10px; font-weight: 700; cursor: pointer; }
  `;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "fl-hud";
  root.innerHTML = `
    <div id="fl-coins">🪙 100</div>
    <div id="fl-sync">🌐 connecting…</div>
    <div id="fl-weather"></div>
    <div id="fl-toasts"></div>
    <div id="fl-actionlabel"></div>
    <div id="fl-hotbar"></div>
    <button id="fl-bookbtn" title="Farm Book">📖 Farm Book</button>
    <button id="fl-mapbtn" title="Farm Map (Tab)">🗺 Map</button>
    <button id="fl-invbtn" title="Inventory (I)">🎒</button>
    <button id="fl-emotebtn" title="Emote">💬</button>
    <div id="fl-emotepick"></div>
    <button id="fl-jumpbtn">JUMP</button>
    <button id="fl-actionbtn">✋</button>
    <button id="fl-rotatebtn" title="Rotate">↺</button>
    <button id="fl-cancelbtn" title="Cancel">✖</button>
    <div id="fl-place"></div>
  `;
  document.body.appendChild(root);

  const shop = document.createElement("div");
  shop.id = "fl-shop";
  shop.innerHTML = `
    <div class="card">
      <h3 id="fl-shop-title">🌾 Seed Stand</h3>
      <p class="sub" id="fl-shop-sub">Buy seeds to plant in the field.</p>
      <div class="tabs">
        <button class="tab sel" data-tab="seeds">🌱 Seeds</button>
        <button class="tab" data-tab="decor">🎀 Decorate</button>
      </div>
      <div id="fl-shop-rows"></div>
      <button class="close">Close</button>
    </div>`;
  document.body.appendChild(shop);

  const book = document.createElement("div");
  book.id = "fl-book";
  book.innerHTML = `
    <div class="card">
      <h3 id="fl-book-name">📖 Farm Book</h3>
      <p class="founded" id="fl-book-founded"></p>
      <div class="scroll" id="fl-book-scroll"></div>
      <button class="close">Close</button>
    </div>`;
  document.body.appendChild(book);

  // ---- P7: Farm Map panel ---------------------------------------------------
  const map = document.createElement("div");
  map.id = "fl-map";
  map.innerHTML = `
    <div class="card">
      <button class="x" title="Close map">✖</button>
      <h3>🗺 Farm Map</h3>
      <canvas id="fl-map-canvas" width="600" height="600"></canvas>
      <div class="legend" id="fl-map-legend"></div>
    </div>`;
  document.body.appendChild(map);

  // ---- P7: Inventory panel ----------------------------------------------------
  const inv = document.createElement("div");
  inv.id = "fl-inv";
  inv.innerHTML = `
    <div class="card">
      <h3>🎒 Inventory</h3>
      <div class="scroll" id="fl-inv-scroll"></div>
      <button class="close">Close</button>
    </div>`;
  document.body.appendChild(inv);

  const coinsEl = root.querySelector("#fl-coins") as HTMLElement;
  const syncEl = root.querySelector("#fl-sync") as HTMLElement;
  const weatherEl = root.querySelector("#fl-weather") as HTMLElement;
  const hotbarEl = root.querySelector("#fl-hotbar") as HTMLElement;
  const labelEl = root.querySelector("#fl-actionlabel") as HTMLElement;
  const toastsEl = root.querySelector("#fl-toasts") as HTMLElement;
  const actionBtn = root.querySelector("#fl-actionbtn") as HTMLButtonElement;
  const jumpBtn = root.querySelector("#fl-jumpbtn") as HTMLButtonElement;
  const emoteBtn = root.querySelector("#fl-emotebtn") as HTMLButtonElement;
  const emotePick = root.querySelector("#fl-emotepick") as HTMLElement;
  const shopRows = shop.querySelector("#fl-shop-rows") as HTMLElement;
  const shopCloseBtn = shop.querySelector("button.close") as HTMLButtonElement;
  const shopTitle = shop.querySelector("#fl-shop-title") as HTMLElement;
  const shopSub = shop.querySelector("#fl-shop-sub") as HTMLElement;
  const tabBtns = Array.from(shop.querySelectorAll(".tab")) as HTMLButtonElement[];
  const bookNameEl = book.querySelector("#fl-book-name") as HTMLElement;
  const bookFoundedEl = book.querySelector("#fl-book-founded") as HTMLElement;
  const bookScrollEl = book.querySelector("#fl-book-scroll") as HTMLElement;
  const bookCloseBtn = book.querySelector("button.close") as HTMLButtonElement;
  const bookBtn = root.querySelector("#fl-bookbtn") as HTMLButtonElement;
  const placeEl = root.querySelector("#fl-place") as HTMLElement;
  const rotateBtn = root.querySelector("#fl-rotatebtn") as HTMLButtonElement;
  const cancelBtn = root.querySelector("#fl-cancelbtn") as HTMLButtonElement;
  const mapBtn = root.querySelector("#fl-mapbtn") as HTMLButtonElement;
  const invBtn = root.querySelector("#fl-invbtn") as HTMLButtonElement;
  const mapCanvasEl = map.querySelector("#fl-map-canvas") as HTMLCanvasElement;
  const mapLegendEl = map.querySelector("#fl-map-legend") as HTMLElement;
  const mapCloseBtn = map.querySelector("button.x") as HTMLButtonElement;
  const invScrollEl = inv.querySelector("#fl-inv-scroll") as HTMLElement;
  const invCloseBtn = inv.querySelector("button.close") as HTMLButtonElement;

  let selectToolCb: (id: ToolId) => void = () => {};
  let cycleCropCb: () => void = () => {};
  let buyCb: (id: CropId) => void = () => {};
  let buyDecorCb: (type: string) => void = () => {};
  let closeCb: () => void = () => {};
  let actionCb: () => void = () => {};
  let jumpCb: () => void = () => {};
  let openBookCb: () => void = () => {};
  let closeBookCb: () => void = () => {};
  let rotateCb: () => void = () => {};
  let cancelPlaceCb: () => void = () => {};
  let emoteCb: (kind: EmoteKind) => void = () => {};
  let openInvCb: () => void = () => {};
  let closeInvCb: () => void = () => {};
  let invSeedCb: (id: CropId) => void = () => {};
  let invToolCb: (id: ToolId) => void = () => {};
  let shopTab: "seeds" | "decor" = "seeds";
  let shopCoins = 0;
  let shopSeeds: Record<CropId, number> = {} as Record<CropId, number>;
  let curTool: ToolId = "hoe";
  let presenceCount = 1;
  let syncMode: "synced" | "offline" | "connecting" = "connecting";

  // ---- tool slots ----
  const slotEls = new Map<ToolId, HTMLElement>();
  TOOL_ORDER.forEach((id, i) => {
    const slot = document.createElement("div");
    slot.className = "fl-slot";
    slot.dataset.tool = id;
    const meta = TOOL_META[id];
    const meter = id === "can" ? `<div class="meter"><div class="fill"></div></div>` : "";
    const glyph = meta.icon ?? meta.emoji; // hoe carries an inline SVG (no hoe emoji exists)
    slot.innerHTML = `<div class="key">${i + 1}</div><div class="em">${glyph}</div><div class="cnt"></div>${meter}`;
    slot.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      // tapping the already-selected seed slot cycles the crop
      if (id === "seeds" && curTool === "seeds") cycleCropCb();
      else selectToolCb(id);
    });
    hotbarEl.appendChild(slot);
    slotEls.set(id, slot);
  });

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const n = parseInt(k, 10);
    if (n >= 1 && n <= TOOL_ORDER.length) selectToolCb(TOOL_ORDER[n - 1]);
    else if (k === "q" && !e.repeat) cycleCropCb();
    // P7: Tab = Farm Map toggle (M is mute; E/Space/T/Z/X/C/1-4/Q are taken).
    else if (k === "tab" && !e.repeat) {
      e.preventDefault(); // never move browser focus
      if (map.classList.contains("open")) hud.closeMap();
      else hud.openMap();
    }
    // P7: I = Inventory toggle.
    else if (k === "i" && !e.repeat) {
      e.preventDefault();
      if (inv.classList.contains("open")) {
        hud.hideInventory();
        closeInvCb();
      } else openInvCb();
    }
  });

  actionBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    actionCb();
  });
  jumpBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    jumpCb();
  });

  // ---- emote picker (💬 -> 3-emote row) ----
  for (const kind of EMOTE_ORDER) {
    const b = document.createElement("button");
    b.textContent = EMOTES[kind];
    b.title = kind;
    b.dataset.emote = kind;
    b.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      emoteCb(kind);
      emotePick.classList.remove("open");
    });
    emotePick.appendChild(b);
  }
  emoteBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    emotePick.classList.toggle("open");
  });

  shopCloseBtn.addEventListener("click", () => closeCb());

  // ---- shop tabs (Seeds / Decorate) ----
  for (const tb of tabBtns) {
    tb.addEventListener("click", () => {
      shopTab = (tb.dataset.tab as "seeds" | "decor") || "seeds";
      renderShopRows();
    });
  }
  function renderShopRows(): void {
    for (const tb of tabBtns) tb.classList.toggle("sel", tb.dataset.tab === shopTab);
    shopTitle.textContent = shopTab === "seeds" ? "🌾 Seed Stand" : "🎀 Decorate Shop";
    shopSub.textContent = shopTab === "seeds" ? "Buy seeds to plant in the field." : "Buy a decoration, then place it on the farm.";
    shopRows.innerHTML = "";
    if (shopTab === "seeds") {
      for (const id of CROP_ORDER) {
        const c = CROPS[id];
        const row = document.createElement("div");
        row.className = "row";
        const afford = shopCoins >= c.seedCost;
        row.innerHTML = `<div class="em">${c.emoji}</div>
          <div class="name">${c.name}<br><span class="price">🪙${c.seedCost} · own ${shopSeeds[id] ?? 0}</span></div>
          <button class="buy" ${afford ? "" : "disabled"}>Buy</button>`;
        (row.querySelector(".buy") as HTMLButtonElement).addEventListener("click", () => buyCb(id));
        shopRows.appendChild(row);
      }
    } else {
      for (const type of DECOR_ORDER) {
        const d = DECOR[type];
        const row = document.createElement("div");
        row.className = "row";
        const afford = shopCoins >= d.cost;
        row.innerHTML = `<div class="em">${d.emoji}</div>
          <div class="name">${d.label}<br><span class="price">🪙${d.cost}</span></div>
          <button class="buy" data-decor="${type}" ${afford ? "" : "disabled"}>Place</button>`;
        (row.querySelector(".buy") as HTMLButtonElement).addEventListener("click", () => buyDecorCb(type));
        shopRows.appendChild(row);
      }
    }
  }

  bookBtn.addEventListener("click", () => openBookCb());
  bookCloseBtn.addEventListener("click", () => closeBookCb());
  rotateBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    rotateCb();
  });
  cancelBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    cancelPlaceCb();
  });

  // ---- P7: Farm Map open/close wiring ----------------------------------------
  mapBtn.addEventListener("click", () => hud.openMap());
  mapCloseBtn.addEventListener("click", () => hud.closeMap());
  map.addEventListener("pointerdown", (e) => {
    if (e.target === map) hud.closeMap(); // tap-outside closes
  });

  // ---- P7: Inventory open/close wiring ----------------------------------------
  invBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    openInvCb();
  });
  invCloseBtn.addEventListener("click", () => {
    hud.hideInventory();
    closeInvCb();
  });
  inv.addEventListener("pointerdown", (e) => {
    if (e.target === inv) {
      hud.hideInventory();
      closeInvCb();
    }
  });

  // Inventory content render: rebuilt only when the data signature changes, so
  // per-frame live refreshes (remote sync) are cheap and never yank a row out
  // from under a mid-tap pointer.
  let invSig = "";
  function renderInventory(data: InventoryData): void {
    const sig = JSON.stringify(data);
    if (sig === invSig) return;
    invSig = sig;
    const seedRows = data.seeds.length
      ? data.seeds
          .map(
            (s) => `<div class="row tap ${s.selected ? "sel" : ""}" data-seed="${s.id}">
              <div class="em">${s.emoji}</div>
              <div class="nm">${s.name}<br><span class="price">🪙${s.seedCost} a seed</span></div>
              <div class="cnt">🌱${s.count}</div>
            </div>`
          )
          .join("")
      : `<div class="empty">No seeds — visit the seed stand! 🏪</div>`;
    const prodRows = data.produce.length
      ? data.produce
          .map(
            (p) => `<div class="row">
              <div class="em">${p.emoji}</div>
              <div class="nm">${p.name}<br><span class="price">sells 🪙${p.sellPrice} each</span></div>
              <div class="cnt">×${p.count}</div>
            </div>`
          )
          .join("") + `<div class="total" id="fl-inv-total">Worth 🪙 ${data.produceTotalValue} at the bin!</div>`
      : `<div class="empty">Nothing harvested yet — grow some crops! 🌱</div>`;
    const toolRows = data.tools
      .map((t) => {
        const meter =
          t.id === "can"
            ? `<div class="meter"><div class="fill" style="width:${data.tankCap > 0 ? Math.round((100 * data.tank) / data.tankCap) : 0}%"></div></div><div class="cnt">💧${data.tank}</div>`
            : "";
        return `<div class="row tap ${t.selected ? "sel" : ""}" data-tool="${t.id}">
          <div class="em">${t.isIcon ? t.glyph : escapeText(t.glyph)}</div>
          <div class="nm">${t.name}</div>${meter}
        </div>`;
      })
      .join("");
    invScrollEl.innerHTML =
      `<div class="sect">🌱 Seeds — tap to pick what you plant</div>${seedRows}` +
      `<div class="sect">📦 Produce</div>${prodRows}` +
      `<div class="sect">🛠 Tools — tap to equip</div>${toolRows}`;
    for (const row of Array.from(invScrollEl.querySelectorAll("[data-seed]"))) {
      row.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        invSeedCb((row as HTMLElement).dataset.seed as CropId);
      });
    }
    for (const row of Array.from(invScrollEl.querySelectorAll("[data-tool]"))) {
      row.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        invToolCb((row as HTMLElement).dataset.tool as ToolId);
      });
    }
  }
  function escapeText(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  let toastActive: { el: HTMLElement; timer: number }[] = [];
  const MAX_TOASTS = 2;
  const TOAST_MS = 3200;
  let syncTuckTimer: number | null = null;

  const hud: Hud = {
    root,
    setCoins(n) {
      coinsEl.textContent = `🪙 ${Math.max(0, Math.round(n))}`;
    },
    setTools(info) {
      curTool = info.selectedTool;
      for (const id of TOOL_ORDER) {
        const el = slotEls.get(id)!;
        el.classList.toggle("sel", id === info.selectedTool);
        const cnt = el.querySelector(".cnt") as HTMLElement;
        const em = el.querySelector(".em") as HTMLElement;
        if (id === "seeds") {
          em.textContent = info.cropEmoji;
          cnt.textContent = `🌱${info.seedCount}`;
        } else if (id === "can") {
          cnt.textContent = `💧${info.tank}`;
          const fill = el.querySelector(".meter .fill") as HTMLElement;
          const frac = info.tankCap > 0 ? Math.max(0, Math.min(1, info.tank / info.tankCap)) : 0;
          fill.style.height = `${frac * 100}%`;
          fill.style.background = info.tank > 0 ? "#4aa3d6" : "#8f9aa0";
        } else {
          cnt.textContent = "";
        }
      }
      // action button shows the equipped tool (hoe = its inline SVG icon)
      const am = TOOL_META[info.selectedTool];
      if (am.icon) actionBtn.innerHTML = am.icon;
      else actionBtn.textContent = am.emoji;
    },
    showActionLabel(text, sx, sy, color) {
      if (!text) {
        labelEl.style.opacity = "0";
        return;
      }
      labelEl.textContent = text;
      labelEl.style.left = `${sx}px`;
      labelEl.style.top = `${sy}px`;
      labelEl.style.borderColor = color;
      labelEl.style.color = color;
      labelEl.style.opacity = "1";
    },
    toast(msg) {
      if (toastActive.length >= MAX_TOASTS) {
        const oldest = toastActive.shift()!;
        clearTimeout(oldest.timer);
        oldest.el.remove();
      }
      const el = document.createElement("div");
      el.className = "fl-toast";
      el.textContent = msg;
      toastsEl.appendChild(el);
      requestAnimationFrame(() => el.classList.add("show"));
      const timer = window.setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => el.remove(), 200);
        toastActive = toastActive.filter((t) => t.el !== el);
      }, TOAST_MS);
      toastActive.push({ el, timer });
    },
    showShop(coins, seeds) {
      shopCoins = coins;
      shopSeeds = seeds;
      renderShopRows();
      shop.classList.add("open");
    },
    hideShop() {
      shop.classList.remove("open");
    },
    isShopOpen() {
      return shop.classList.contains("open");
    },
    onBuyDecor(cb) {
      buyDecorCb = cb;
    },
    showFarmBook(data) {
      bookNameEl.textContent = `📖 ${data.farmName}`;
      bookFoundedEl.textContent = data.foundedAt
        ? `Founded ${new Date(data.foundedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`
        : "A brand-new farm";
      const shipped = data.shipped.filter((s) => s.count > 0);
      const shipHtml = shipped.length
        ? `<div class="ship">${shipped.map((s) => `<span>${s.emoji} ${s.name} ×${s.count}</span>`).join("")}</div>`
        : `<div class="md" style="color:#9a9080">Nothing shipped yet — sell crops at the bin!</div>`;
      const msHtml = data.milestones
        .map((m) => {
          const earned = m.earnedAt > 0;
          const date = earned ? `<div class="mdate">${new Date(m.earnedAt).toLocaleDateString()}</div>` : "";
          return `<div class="ms ${earned ? "earned" : ""}"><div class="mi">${m.emoji}</div>
            <div class="mt"><div class="mn">${m.label}</div><div class="md">${m.desc}</div></div>${date}</div>`;
        })
        .join("");
      bookScrollEl.innerHTML = `<div class="sect">📦 Shipped totals</div>${shipHtml}<div class="sect">🏅 Milestones</div>${msHtml}`;
      book.classList.add("open");
    },
    hideFarmBook() {
      book.classList.remove("open");
    },
    isFarmBookOpen() {
      return book.classList.contains("open");
    },
    onOpenBook(cb) {
      openBookCb = cb;
    },
    onCloseBook(cb) {
      closeBookCb = cb;
    },
    showPlacement(label, valid) {
      placeEl.textContent = label;
      placeEl.classList.add("show");
      placeEl.classList.toggle("bad", !valid);
      document.body.classList.add("fl-placing");
    },
    hidePlacement() {
      placeEl.classList.remove("show");
      document.body.classList.remove("fl-placing");
    },
    onRotate(cb) {
      rotateCb = cb;
    },
    onCancelPlace(cb) {
      cancelPlaceCb = cb;
    },
    onSelectTool(cb) {
      selectToolCb = cb;
    },
    onCycleCrop(cb) {
      cycleCropCb = cb;
    },
    onBuySeed(cb) {
      buyCb = cb;
    },
    onCloseShop(cb) {
      closeCb = cb;
    },
    onAction(cb) {
      actionCb = cb;
    },
    onJump(cb) {
      jumpCb = cb;
    },
    onEmote(cb) {
      emoteCb = cb;
    },
    setSyncStatus(mode) {
      syncMode = mode;
      renderSync();
    },
    setPresence(count) {
      presenceCount = Math.max(1, Math.round(count));
      renderSync();
    },
    setWeather(text) {
      if (!text) {
        weatherEl.classList.remove("show");
        document.body.classList.remove("fl-hasweather");
        return;
      }
      weatherEl.textContent = text;
      weatherEl.classList.add("show");
      document.body.classList.add("fl-hasweather");
    },
    // ---- P7: Farm Map -------------------------------------------------------
    mapCanvas: mapCanvasEl,
    mapCanvasSize() {
      return mapCanvasEl.width; // square backing store
    },
    openMap() {
      map.classList.add("open");
    },
    closeMap() {
      map.classList.remove("open");
    },
    isMapOpen() {
      return map.classList.contains("open");
    },
    setMapLegend(items) {
      mapLegendEl.innerHTML = items
        .map((it) => `<span><span class="dot">${it.emoji}</span>${it.label}</span>`)
        .join("");
    },
    // ---- P7: Inventory ------------------------------------------------------
    isInventoryOpen() {
      return inv.classList.contains("open");
    },
    showInventory(data) {
      renderInventory(data);
      inv.classList.add("open");
    },
    hideInventory() {
      inv.classList.remove("open");
      invSig = ""; // force a fresh render next open
    },
    onOpenInventory(cb) {
      openInvCb = cb;
    },
    onCloseInventory(cb) {
      closeInvCb = cb;
    },
    onSelectInventorySeed(cb) {
      invSeedCb = cb;
    },
    onEquipInventoryTool(cb) {
      invToolCb = cb;
    },
  };

  function renderSync(): void {
    if (syncTuckTimer != null) {
      clearTimeout(syncTuckTimer);
      syncTuckTimer = null;
    }
    syncEl.classList.remove("tucked");
    const suffix = presenceCount > 1 ? ` · 👩‍🌾 ${presenceCount}` : "";
    if (syncMode === "synced") {
      syncEl.textContent = `🌐 synced${suffix}`;
      // keep visible while others are around; otherwise tuck (index.html convention)
      if (presenceCount <= 1) syncTuckTimer = window.setTimeout(() => syncEl.classList.add("tucked"), 3000);
    } else if (syncMode === "offline") {
      syncEl.textContent = `💾 offline${suffix}`;
    } else {
      syncEl.textContent = `🌐 connecting…${suffix}`;
    }
  }

  return hud;
}
