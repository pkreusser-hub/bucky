/* FARMSTEAD fs-net.js — PHASE M: 2-player co-op over deterministic command lockstep.
 *
 * Plan §16. Both browsers run the SAME deterministic sim; only player commands
 * travel the wire. Host = seat 0 = the time authority; guest = seat 1 follows the
 * host's tick clock and never runs ahead of it.
 *   SHARED KINGDOM   seats [0,0] — both seats command player 0
 *   SEPARATE KINGDOMS seats [0,1] — seat i commands player i, allied (same team)
 *
 * DETERMINISM: this file may use Date.now() for NETWORK timing only (heartbeats,
 * timeouts, transfer measurements). It never feeds a sim decision: sim advance is
 * driven by the page's accumulator, commands carry an explicit exec tick, and the
 * two hash-neutral command types (speed, ping — neither is read by FSSim.hash)
 * are the only ones allowed to land on a slightly different tick per machine.
 *
 * TRANSPORTS (adapters, one object shape):
 *   localws  — native WebSocket to ?mpws=ws://host:port relay (the suite's wire)
 *   playroom — Playroom Kit 0.0.96 UMD, lazy-injected only when hosting/joining
 * Both degrade to "stay solo + friendly note", never to a blank page.
 */
(function () {
  "use strict";

  const FSC = window.FSC, FSSim = window.FSSim;
  const FSNet = {};
  const NOW = function () { return Date.now(); };   // NETWORK timing only (see header)

  /* ───────────────────── wire identity (peer latching) ──────────────────────
   * Neither transport hands us a trustworthy per-socket id on every frame (the
   * localws relay fans a room out and its control frames carry only a role), so
   * identity lives in the PROTOCOL: this page stamps every frame it sends with
   * its own random pid, and each side LATCHES its partner's pid the first time
   * that partner is seated. Frames from any other pid are dropped — a third tab
   * that knows the room code can neither take the seat, nor be handed the
   * world, nor evict the real partner when it leaves.
   * Math.random here is a wire/UI id and never a sim input (see header).      */
  const MY_PID = (function () {
    let s = "";
    for (let i = 0; i < 4; i++) s += (Math.floor(Math.random() * 0x10000) + 0x10000).toString(36);
    return s;
  })();

  /* ─────────────────────────── wire input bounds ────────────────────────────
   * Everything that arrives from the wire is hostile until proven otherwise:
   * bounded in SIZE and SHAPE before it can reach the sim, the page's memory or
   * a save file. Suites assert against these names, never against literals.   */
  const LIM = {
    CMD_FRAME: 4096,                 // bytes of one wire command frame
    ARG_DEPTH: 4,                    // nesting allowed inside command args
    ARG_ENTRIES: 128,                // keys/elements per object/array (road path ≤ ROAD_MAX_LEN+1)
    ARG_STR: 512,                    // characters in any one string value
    NAME: 40,                        // characters of a peer's display name
    CMD_BUF: 2048,                   // commands a guest buffers while syncing
    STATE_BYTES: 32 * 1024 * 1024,   // biggest world transfer we will ever accept
    STATE_CHUNKS: Math.ceil((32 * 1024 * 1024) / FSC.NET_CHUNK),
    PEER_LEAVE_MS: 1200,             // grace before an UNATTRIBUTABLE leave evicts
    SEAT_HOLD_MS: 30000,             // …and how long a stalled partner's seat is held
    STATE_MIN_MS: 2000,              // floor between full-state transfers…
    // …doubling to this ceiling while the room keeps failing. A whole farm is
    // ~130 KB, so 4 s already caps sustained repair traffic at ~32 KB/s; pushing
    // the ceiling higher only delays the transfer that actually HEALS the room.
    // What bounds a hopeless room is SYNC_GIVEUP, not an ever-growing interval.
    STATE_MAX_MS: 4000,
    SYNC_GIVEUP: 5,                  // consecutive failed resyncs → "cannot stay in sync"
    SYNC_RETRY_MS: 60000,            // …then quietly try once more
  };

  /* ───────────────────────────── state ───────────────────────────── */
  const S = {
    role: null,            // null | 'host' | 'guest'
    transport: "",         // 'localws' | 'playroom'
    status: "off",         // off|connecting|waiting|syncing|playing|hostLeft|unsynced|solo|failed
    seat: 0,
    mode: "shared",        // 'shared' | 'separate'
    code: "",
    myName: "Player",
    peerName: "",
    peerHere: false,
    connected: false,
    settings: null,
    desyncs: 0, resyncs: 0, lateCmds: 0, joins: 0, rejects: 0, checkpoints: 0,
    hostTick: 0, hostTickMs: 0,
    lastRxMs: 0,
    behind: 0, catching: false, catchT0: 0, catchFrom: 0,
    netSeq: 1,             // host: globally unique, increasing command sequence
    err: "",
    /* ── peer identity + liveness ── */
    peerPid: "",           // latched PROTOCOL id of the seated partner ("" = unidentified)
    peerSockId: "",        // latched TRANSPORT id (playroom player id), for peer join/leave only
    peerLostWhy: "",       // why the partner is not here (only "timeout" may re-acquire)
    peerLostMs: 0,
    leaveSuspectMs: 0,     // an unattributable relay peer-leave, awaiting confirming silence
    /* ── wire bounds + resync backoff ── */
    dropped: 0,            // frames refused by the input bounds
    hasWorld: false,       // guest: a full state really landed (see the host-left modal)
    awaitState: false, awaitStateMs: 0,   // guest: a repair is already on its way
    syncFails: 0,          // consecutive resyncs with no clean checkpoint between them
    giveUpMs: 0,           // when we surfaced "cannot stay in sync"
    lastStateMs: 0, stateBackoffMs: 0, stateReadyMs: 0, statePending: "", stateDefers: 0,
  };
  const STATS = {
    tx: 0, rx: 0, rxBytes: 0,
    stateBytes: 0, stateMs: 0,          // host: last serialize+send
    joinMs: 0, joinBytes: 0, joinChunks: 0,   // guest: last transfer wall time
    loadMs: 0, catchupMs: 0, catchupTicks: 0,
    resyncMs: 0,
  };

  let env = null;                 // page bridge (see FSNet.init)
  let adapter = null;             // live transport
  let timer = 0;                  // beat + hidden-tab heartbeat
  let hookInstalled = false;
  let guestReq = 0;               // guest-side request counter (diagnostics)
  let stateId = 0;
  let rx = null;                  // guest: in-flight state transfer
  let cmdBuf = [];                // guest: commands buffered while syncing
  const myHash = Object.create(null);    // tick → my hash
  const hostHash = Object.create(null);  // tick → host's hash (guest side)

  /* ───────────────────────── page bridge ────────────────────────── */
  const NOOP = function () {};
  const DEFAULT_ENV = {
    getG: function () { return null; },
    setG: NOOP,               // (G) → page swaps its G + FSRender.rebuildAll
    startWorld: NOOP,         // (settings) → page creates the host's world
    step: NOOP,               // (dtSeconds) → the page's own sim step (hidden tabs)
    notify: NOOP,             // (kind, data) → UI
    toast: NOOP,              // (msg) → UI
  };
  FSNet.init = function (e) {
    env = Object.assign({}, DEFAULT_ENV, e || {});
    return FSNet;
  };
  function G() { return env ? env.getG() : null; }
  function note(kind, data) { try { env.notify(kind, data || {}); } catch (err) { warn(err); } }
  function toast(msg) { try { env.toast(msg); } catch (err) { warn(err); } }
  function warn(err) { if (window.console && console.warn) console.warn("Farmstead net:", err); }

  /* ───────────────────── wire validators (see LIM above) ───────────────────
   * Small, allocation-free, early-out. Every one of them answers the same
   * question: "could this value have come from OUR client?" — anything else is
   * dropped and counted, never repaired.                                     */
  function isInt(x, lo, hi) {
    return typeof x === "number" && isFinite(x) && Math.floor(x) === x && x >= lo && x <= hi;
  }
  function cleanName(n) {
    return String(n === undefined || n === null ? "" : n).slice(0, LIM.NAME);
  }
  /**
   * Command args are plain data: a shallow tree of numbers/strings/booleans in
   * plain objects and arrays. Depth, fan-out and string length are all bounded,
   * so no wire frame can ever inflate the host's world (args ride into G.events
   * through cmdFail — and from there into every save and every future join).
   */
  function argsOk(a, depth) {
    if (a === undefined || a === null) return true;
    const t = typeof a;
    if (t === "number") return isFinite(a);
    if (t === "boolean") return true;
    if (t === "string") return a.length <= LIM.ARG_STR;
    if (t !== "object") return false;
    if ((depth || 0) >= LIM.ARG_DEPTH) return false;
    const keys = Object.keys(a);
    if (keys.length > LIM.ARG_ENTRIES) return false;
    if (Array.isArray(a)) {
      for (let i = 0; i < a.length; i++) if (!argsOk(a[i], (depth || 0) + 1)) return false;
      return true;
    }
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      // JSON.parse happily makes an OWN "__proto__" key — never let it through
      if (k === "__proto__" || k === "constructor" || k === "prototype") return false;
      if (k.length > LIM.ARG_STR) return false;
      if (!argsOk(a[k], (depth || 0) + 1)) return false;
    }
    return true;
  }
  /** A whole command (from `cmd` or a host's `do`) — bounded frame + args. */
  function cmdFrameOk(type, args, bytes) {
    if (FSC.CMD_TYPES.indexOf(String(type || "")) < 0) return false;
    if ((bytes || 0) > LIM.CMD_FRAME) return false;
    if (args === undefined || args === null) return true;
    return typeof args === "object" && argsOk(args, 0);
  }

  /* ─────────────────────── URL / identity helpers ────────────────── */
  function param(k) {
    try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; }
  }
  function myName() {
    let n = "";
    try { n = (localStorage.getItem("choreUser") || "").trim(); } catch (e) { n = ""; }
    return n || "Player";
  }
  /** Peek at the deep-link room code WITHOUT clearing it (boot-time UI decision). */
  FSNet.linkCode = function () {
    const m = /(?:^|&)r=([^&]+)/.exec(String(location.hash || "").slice(1));
    return m ? decodeURIComponent(m[1]) : "";
  };
  /**
   * Read AND CLEAR "#r=<code>" — house caution: Playroom reads the hash itself in
   * its own "r=R<code>" format and that read BEATS the explicit roomCode option,
   * so the hash must be gone before insertCoin() runs.
   */
  function readAndClearHash() {
    const code = FSNet.linkCode();
    if (code) { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {} }
    return code;
  }
  FSNet.shareLink = function () {
    return location.origin + location.pathname + location.search + "#r=" + (S.code || "");
  };
  function makeCode() {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];  // UI id, not sim
    return s;
  }

  /* ═══════════════════════ transports ═══════════════════════════════ */
  /* Adapter contract:  { name, send(obj), close(), isOpen() }
   * FSNet supplies onMsg/onPeer/onDown callbacks at construction.            */

  // ---- localws: one native WebSocket to a fan-out relay (the suite's wire) --
  function localwsAdapter(url, code, isHost, cb) {
    const sep = url.indexOf("?") < 0 ? "?" : "&";
    const ws = new WebSocket(url + sep + "room=" + encodeURIComponent(code) +
      "&role=" + (isHost ? "host" : "guest"));
    let open = false;
    const A = {
      name: "localws",
      isOpen: function () { return open; },
      send: function (o) {
        if (!open) return false;
        try { ws.send(JSON.stringify(o)); return true; } catch (e) { return false; }
      },
      close: function () { try { ws.close(); } catch (e) {} open = false; },
    };
    ws.onopen = function () { open = true; cb.onUp(); };
    ws.onclose = function () { open = false; cb.onDown("closed"); };
    ws.onerror = function () { if (!open) cb.onDown("error"); };
    ws.onmessage = function (ev) {
      let m = null;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m && m.__r) return cb.onPeer(m);          // relay control frame
      cb.onMsg(m, ev.data.length || 0);
    };
    return A;
  }

  // ---- playroom: house pattern, pinned UMD, lazy-injected on demand --------
  let sdkPromise = null;
  function playroomSDK() {
    const P0 = window.Playroom || window;
    if (P0 && typeof P0.insertCoin === "function") return Promise.resolve(true);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve) {
      const s = document.createElement("script");
      s.src = FSC.NET_SDK_URL;
      s.async = true;
      s.onload = function () {
        const P = window.Playroom || window;
        resolve(!!(P && typeof P.insertCoin === "function"));
      };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }
  FSNet._sdkLoaded = function () { return !!sdkPromise; };   // contract test: lazy?

  function playroomAdapter(code, isHost, cb) {
    return playroomSDK().then(function (ok) {
      const P = window.Playroom || window;
      if (!ok || !P || typeof P.insertCoin !== "function") throw new Error("playroom SDK unavailable");
      // parse + CLEAR the hash BEFORE insertCoin (house caution, see readAndClearHash)
      const linkCode = readAndClearHash();
      const room = code || linkCode || undefined;
      return Promise.resolve(P.insertCoin({
        maxPlayersPerRoom: FSC.NET_MAX_PLAYERS, skipLobby: true, roomCode: room,
      })).then(function () {
        let roomCode = room || "";
        try { roomCode = P.getRoomCode() || roomCode; } catch (e) {}
        const rpc = P.RPC || (window.RPC || null);
        if (!rpc || typeof rpc.register !== "function") throw new Error("playroom RPC unavailable");
        rpc.register("fs", function (data) {
          let m = data;
          if (typeof m === "string") { try { m = JSON.parse(m); } catch (e) { return; } }
          cb.onMsg(m, 0);
          return Promise.resolve(true);
        });
        try {
          if (typeof P.onPlayerJoin === "function") {
            P.onPlayerJoin(function (player) {
              let me = null;
              try { me = P.myPlayer(); } catch (e) {}
              if (me && player && player.id === me.id) return;
              // playroom knows exactly WHICH player joined/quit — pass the id
              // through so peer-leave never has to be guessed at (see onPeerFrame)
              const pid = player && player.id ? String(player.id) : "";
              cb.onPeer({ __r: "peer", join: true, id: pid, role: "guest",
                name: (player && player.getState && player.getState("name")) || "" });
              if (player && typeof player.onQuit === "function") {
                player.onQuit(function () { cb.onPeer({ __r: "peer", join: false, id: pid, role: "guest" }); });
              }
            });
          }
        } catch (e) { warn(e); }
        try { P.myPlayer().setState("name", S.myName, true); } catch (e) {}
        const A = {
          name: "playroom",
          isOpen: function () { return true; },
          send: function (o) {
            try {
              const mode = (rpc.Mode && rpc.Mode.OTHERS) !== undefined ? rpc.Mode.OTHERS : "others";
              const p = rpc.call("fs", o, mode);
              if (p && p.catch) p.catch(function () {});
              return true;
            } catch (e) { return false; }
          },
          close: function () { try { if (typeof P.quitGame === "function") P.quitGame(); } catch (e) {} },
          roomCode: roomCode,
        };
        cb.onUp();
        return A;
      });
    });
  }

  /* ═══════════════════════ message plumbing ═════════════════════════ */
  function send(o) {
    if (!adapter) return false;
    if (o && o.p === undefined) o.p = MY_PID;      // every frame carries our wire identity
    STATS.tx++;
    const ok = adapter.send(o);
    return ok;
  }
  const CB = {
    onUp: function () { S.connected = true; note("status", FSNet.state()); },
    onDown: function (why) { onTransportDown(why); },
    onPeer: function (m) { onPeerFrame(m); },
    onMsg: function (m, bytes) { onMessage(m, bytes); },
  };

  /**
   * A TRANSPORT control frame (relay/SDK), never a game frame.
   *   join  — only the host seats a partner, and only into an EMPTY seat.
   *   leave — attributed if we can (playroom id, or the relay's role field);
   *           otherwise it becomes a SUSPICION that the heartbeat confirms with
   *           silence, so a third tab closing can never evict the real partner.
   */
  function onPeerFrame(m) {
    if (!S.role || !m) return;
    const id = m.id ? String(m.id) : "";
    const role = typeof m.role === "string" ? m.role : "";
    if (m.join) {
      if (S.role !== "host") return;                       // only a host seats anyone
      if (S.peerHere) return;                              // the one seat is already taken
      if (S.peerSockId && id && id !== S.peerSockId) return;
      if (id) S.peerSockId = id;
      S.peerHere = true;
      S.peerName = cleanName(m.name) || S.peerName || "Partner";
      S.peerLostWhy = "";
      S.lastRxMs = NOW();
      note("peer", { here: true, name: S.peerName });
      return;
    }
    // ── a socket LEFT the room ──────────────────────────────────────────────
    if (id) {                                              // playroom: exact identity
      if (!S.peerSockId || id === S.peerSockId) onPeerGone("left");
      return;
    }
    if (S.role === "guest") {
      // the relay names the leaver's ROLE: another guest's socket is not ours
      if (role && role !== "host") return;
      onPeerGone("left");
      return;
    }
    if (role === "host") return;                           // never our partner
    if (!S.peerHere) return;
    suspectLeave();                                        // a guest left — but which one?
  }

  /** An unattributable peer-leave: mark the moment, let silence confirm it. */
  function suspectLeave() {
    if (!S.leaveSuspectMs) S.leaveSuspectMs = NOW();
  }

  function onPeerGone(why) {
    if (!S.role) return;
    why = why || "left";
    S.leaveSuspectMs = 0;
    S.peerLostWhy = why;
    S.peerLostMs = NOW();
    // A TIMEOUT is SILENCE, not a departure (a phone locking, a GC pause, a tab
    // freeze). The seat and the partner's identity are held so the very same
    // peer can walk straight back in (see onPeerBack), and the news is kept out
    // of the player's notification log — nobody actually left.
    if (why !== "timeout") { S.peerPid = ""; S.peerSockId = ""; }
    if (S.role === "host") {
      if (!S.peerHere) return;
      S.peerHere = false;
      S.status = "waiting";
      const g = G();
      if (why === "timeout") {
        toast("⌛ " + (S.peerName || "Your partner") + " went quiet — holding their seat.");
      } else {
        if (g) {
          FSSim.event(g, "netPeer", { here: false, name: S.peerName, why: why });
          FSSim.notify(g, g.seats ? g.seats[0] : 0, "Your partner left the kingdom.");
        }
        toast("👋 Your partner left — carrying on.");
      }
      note("peer", { here: false, why: why });
      lobbyUpdate({ playerCount: 1, status: "open" });
    } else {
      if (S.status === "hostLeft" || S.status === "solo") return;
      S.status = "hostLeft";
      S.peerHere = false;
      note("hostLeft", { why: why, hasWorld: !!S.hasWorld });
      note("status", FSNet.state());
    }
  }

  /**
   * The partner we wrote off is demonstrably alive again — a frame carrying the
   * LATCHED identity arrived. Re-admit symmetrically on both sides so an
   * ordinary mobile stall costs nothing more than a few frozen seconds.
   */
  function onPeerBack() {
    S.leaveSuspectMs = 0;
    S.peerLostWhy = "";
    S.peerHere = true;
    if (S.role === "host") {
      S.status = "playing";
      note("peer", { here: true, name: S.peerName, back: true });
      lobbyUpdate({ playerCount: 2, status: "started" });
      toast("🤝 " + (S.peerName || "Your partner") + " is back.");
    } else {
      const g = G();
      S.status = g ? "playing" : "connecting";
      if (!g) send({ y: "hello", name: S.myName, ver: FSC.VERSION });
      note("peerBack", { name: S.peerName });
      toast("🤝 back in step with " + (S.peerName || "your partner") + ".");
    }
    note("status", FSNet.state());
  }

  function onTransportDown(why) {
    S.connected = false;
    if (!S.role) return;
    S.leaveSuspectMs = 0;
    onPeerGone(why || "disconnected");
  }

  /** A wire frame may never fault the page (0-pageerrors is a hard standard). */
  function onMessage(m, bytes) {
    try { handleMessage(m, bytes); }
    catch (e) { S.dropped++; warn(e); }
  }

  function handleMessage(m, bytes) {
    if (!S.role || !m || typeof m !== "object" || typeof m.y !== "string") return;
    const pid = typeof m.p === "string" ? m.p : "";
    // PEER IDENTITY: once a partner is latched, only that partner is heard. A
    // third socket in the room gets one polite answer to `hello` and nothing
    // else — never a welcome, never a world.
    if (S.peerPid && pid !== S.peerPid) {
      S.dropped++;
      if (m.y === "hello" && S.role === "host") {
        S.rejects++;
        send({ y: "full", to: pid, why: "room is full" });
      }
      return;
    }
    STATS.rx++; STATS.rxBytes += bytes || 0;
    S.lastRxMs = NOW();
    S.leaveSuspectMs = 0;                      // demonstrably still here
    // LIVENESS RE-ACQUIRE: a partner written off by NET_TIMEOUT_MS is back the
    // moment one of their frames lands again — no rejoin, no lost kingdom.
    if (!S.peerHere && S.peerLostWhy === "timeout") onPeerBack();
    const g = G();
    switch (m.y) {
      // ---------------- host side ----------------
      case "hello": {
        if (S.role !== "host") return;
        if (!S.peerPid && pid) S.peerPid = pid;         // latch the seat's identity
        const was = S.peerHere;
        S.peerHere = true;
        S.peerLostWhy = "";
        S.peerName = cleanName(m.name) || "Partner";
        S.status = "playing";
        S.joins++;
        note("peer", { here: true, name: S.peerName });
        send({ y: "welcome", seat: 1, mode: S.mode, settings: S.settings,
          hostName: S.myName, tick: g ? g.tick : 0 });
        sendState("join");
        // …after the snapshot, so the guest's copy is not pre-loaded with a
        // notification about their own arrival. A RE-hello from the partner
        // already seated (a lost chunk, a reconnect storm) is a repair, not an
        // arrival — announce it once only.
        if (g && !was) {
          FSSim.event(g, "netPeer", { here: true, name: S.peerName });
          FSSim.notify(g, g.seats ? g.seats[0] : 0, S.peerName + " joined your kingdom.");
        }
        lobbyUpdate({ playerCount: 2, status: "started" });
        return;
      }
      case "cmd": {                                   // guest command request
        if (S.role !== "host" || !g) return;
        const type = String(m.type || "");
        if (FSC.CMD_TYPES.indexOf(type) < 0) {
          S.rejects++;
          send({ y: "cmdNo", rq: m.rq, why: "unknown command" });
          return;
        }
        // WIRE BOUNDS: a command frame is small by construction. An oversized or
        // oddly-shaped one is refused HERE — `args` ride into G.events through
        // cmdFail, so an unbounded arg would inflate the host's world (and every
        // save and every future join) for the rest of the game.
        if (!cmdFrameOk(type, m.args, bytes)) {
          S.rejects++; S.dropped++;
          send({ y: "cmdNo", rq: m.rq, why: "command too big" });
          return;
        }
        // seat validation: a guest command may only ever act as SEAT 1, which the
        // sim maps to its own player through G.seats (shared → 0, separate → 1).
        FSSim.issueCommand(g, { type: type, args: m.args || {}, by: 1 });
        return;
      }
      case "gbeat":
      case "back":
        return;                                        // liveness only (see above)
      case "hashOk":
        if (S.role !== "host") return;
        S.syncFails = 0;                               // verifiably in step again
        S.stateBackoffMs = LIM.STATE_MIN_MS;
        if (S.status === "unsynced") { S.status = "playing"; S.giveUpMs = 0; note("status", FSNet.state()); }
        return;
      case "desync":
        if (S.role !== "host") return;
        S.desyncs++;
        note("desync", { t: m.t, n: S.desyncs, side: "guest" });
        if (g) {
          FSSim.event(g, "netDesync", { t: isInt(m.t, 0, 0x7fffffff) ? m.t : 0, n: S.desyncs, side: "guest" });
          FSSim.notify(g, 0, "Re-syncing with your partner…");
        }
        sendState("resync");
        return;
      case "stateOk":
        if (S.role !== "host") return;
        STATS.joinMs = isInt(m.ms, 0, 0x7fffffff) ? m.ms : 0;
        note("status", FSNet.state());
        return;
      case "bye":
        onPeerGone("bye");
        return;

      // ---------------- guest side ----------------
      case "welcome":
        if (S.role !== "guest") return;
        if (!S.peerPid && pid) S.peerPid = pid;        // latch the host's identity
        S.seat = isInt(m.seat, 0, FSC.NET_MAX_PLAYERS - 1) ? m.seat : 1;
        S.mode = m.mode === "separate" ? "separate" : "shared";
        S.settings = (m.settings && typeof m.settings === "object" && !Array.isArray(m.settings))
          ? m.settings : null;
        S.peerName = cleanName(m.hostName) || "Host";
        S.peerHere = true;
        S.peerLostWhy = "";
        S.status = "syncing";
        note("peer", { here: true, name: S.peerName });
        note("status", FSNet.state());
        return;
      case "stateBegin":
        if (S.role !== "guest") return;
        // a wire-supplied length allocates an array: bound it before it can
        // throw (RangeError) or eat the tab's memory
        if (!isInt(m.total, 1, LIM.STATE_CHUNKS)) { S.dropped++; return; }
        rx = { id: m.id, total: m.total, parts: new Array(m.total), got: 0,
          tick: isInt(m.tick, 0, 0x7fffffff) ? m.tick : 0,
          seq: isInt(m.seq, 0, 0x7fffffff) ? m.seq : 0,
          hash: m.hash, bytes: isInt(m.bytes, 0, LIM.STATE_BYTES) ? m.bytes : 0,
          why: typeof m.why === "string" ? m.why.slice(0, LIM.NAME) : "", t0: NOW() };
        S.status = "syncing";
        note("status", FSNet.state());
        return;
      case "stateChunk": {
        if (!rx || rx.id !== m.id) return;
        // the index is a WIRE value: an out-of-range or non-numeric one used to
        // throw straight out of onmessage AND corrupt the `got` accounting, so a
        // transfer could "complete" with real chunks missing
        const i = m.i;
        if (!isInt(i, 0, rx.total - 1) || typeof m.s !== "string" || m.s.length > FSC.NET_CHUNK) {
          S.dropped++;
          return;
        }
        if (rx.parts[i] === undefined) rx.got++;       // duplicates never double-count
        rx.parts[i] = m.s;
        return;
      }
      case "stateEnd":
        if (!rx || rx.id !== m.id) return;
        applyState(rx);
        return;
      case "do": {
        if (S.role !== "guest") return;
        const c = m.c;
        if (!c || typeof c !== "object" || !cmdFrameOk(c.type, c.args, bytes)) { S.dropped++; return; }
        if (S.status === "syncing") {
          if (cmdBuf.length < LIM.CMD_BUF) cmdBuf.push(c); else S.dropped++;
          return;
        }
        applyCmd(c);
        return;
      }
      case "cmdNo":
        S.rejects++;
        note("cmdNo", { rq: m.rq, why: m.why });
        return;
      case "full":
        // the host says its seat is taken. Addressed to ONE pid and only heard
        // while we are still knocking, so on a fan-out relay it can neither be
        // aimed at a bystander nor kick a guest that is already seated.
        if (S.role !== "guest" || S.status !== "connecting" || m.to !== MY_PID) return;
        S.err = "the room is full";
        toast("🌾 That co-op room already has two players.");
        teardown("failed");                 // stop knocking; leave a usable title
        note("status", FSNet.state());
        return;
      case "noSync":
        if (S.role !== "guest") return;
        giveUpSync("host");
        return;
      case "beat":
        // ONLY a guest follows someone else's clock. Without this guard any
        // socket in the room could stop the host's world, and the host would
        // re-broadcast the poison to the whole room.
        if (S.role !== "guest") return;
        if (!isInt(m.t, 0, 0x7fffffff)) return;
        S.hostTick = m.t; S.hostTickMs = NOW();
        // speed is hash-neutral: mirroring it keeps pacing right even if a speed
        // command was ever lost (the checkpoint hash cannot see it either way).
        // It is still a WIRE value — only FSC.SPEEDS may reach the sim clock.
        if (g && S.status === "playing" && FSC.SPEEDS.indexOf(m.sp) >= 0 && g.speed !== m.sp) {
          g.speed = m.sp;
        }
        return;
      case "hash":
        if (S.role !== "guest") return;
        if (!isInt(m.t, 0, 0x7fffffff) || typeof m.h !== "number" || !isFinite(m.h)) return;
        hostHash[m.t] = m.h >>> 0;
        trimHashes();
        compareHash(m.t);
        return;
      default:
        return;
    }
  }

  /* ═══════════════════════ command lockstep ═════════════════════════ */
  /**
   * The single sim seam (fs-sim FSSim.netHook). Every command — UI, __FS__,
   * suite, or sim-internal — passes through here while a room is live.
   */
  const HOOK = {
    delay: function (type, g) {
      // speed/ping never enter FSSim.hash, so a 1-tick lead is safe for them and
      // keeps them responsive even while the game is paused (issueCommand's own
      // pump only reaches t ≤ tick+1). Everything else gets the lockstep lead —
      // scaled by the sim speed so the lead is always the same amount of REAL
      // time (CMD_DELAY_MP ticks at 1× = 400 ms; a flat 4 ticks would shrink to
      // 100 ms at 4× and leave no room for the wire).
      if (FSC.CMD_HASH_NEUTRAL.indexOf(type) >= 0) return FSC.CMD_DELAY;
      return FSC.CMD_DELAY_MP * Math.max(1, (g && g.speed) || 1);
    },
    route: function (g, c) {
      if (S.role === "guest") {
        // a guest never queues its own command: it asks the host, and the host's
        // broadcast comes back stamped with the tick BOTH machines will run it on
        guestReq++;
        send({ y: "cmd", type: c.type, args: c.args, rq: guestReq });
        return true;                       // consumed
      }
      if (S.role === "host") {
        c.seq = S.netSeq++;                // globally unique, increasing
        send({ y: "do", c: { t: c.t, seq: c.seq, by: c.by, type: c.type, args: c.args } });
        return false;                      // also runs locally, same tick
      }
      return false;
    },
  };

  function installHook() {
    if (hookInstalled) return;
    FSSim.netHook = HOOK;
    hookInstalled = true;
  }
  function removeHook() {
    if (FSSim.netHook === HOOK) FSSim.netHook = null;
    hookInstalled = false;
  }

  function applyCmd(c) {
    const g = G();
    if (!g || !c) return;
    if (c.t <= g.tick) S.lateCmds++;   // arrived past its tick — the next hash checkpoint heals it
    FSSim.issueCommand(g, { t: c.t, seq: c.seq, by: c.by, type: c.type, args: c.args, net: true });
  }

  /* ═══════════════════════ state transfer ═══════════════════════════ */
  /**
   * "We cannot stay in sync." Surfaced instead of looping full-world transfers
   * for ever. The world keeps RUNNING (a frozen screen is worse than a drifting
   * one for a family game) and the machinery quietly tries once more after
   * LIM.SYNC_RETRY_MS, so a passing storm still heals itself.
   */
  function giveUpSync(side) {
    if (S.status === "unsynced") return;
    S.giveUpMs = NOW();
    S.status = "unsynced";
    S.statePending = "";
    if (S.role === "host") send({ y: "noSync", n: S.syncFails });
    note("noSync", { side: side || S.role, n: S.syncFails });
    note("status", FSNet.state());
    toast("⚠ Can't keep both kingdoms in step — leave and rejoin to fix it.");
  }

  /**
   * BACKOFF: a full world is the most expensive thing on this wire, and one
   * peer frame used to be able to demand one at any rate. At most one transfer
   * per window, and the window doubles (LIM.STATE_MIN_MS → LIM.STATE_MAX_MS)
   * while the room keeps failing, so a divergence that reproduces can never
   * become an unbounded transfer loop. A deferred send is COALESCED — however
   * many times the peer asks, it gets exactly one world when the window opens.
   */
  function sendState(why) {
    const g = G();
    if (!g || S.role !== "host") return;
    why = why || "join";
    const now = NOW();
    if (!S.stateBackoffMs) S.stateBackoffMs = LIM.STATE_MIN_MS;
    // a JOIN only ever waits the floor — the escalation is for a room that keeps
    // failing to stay in sync, not for a partner walking in the door
    const floor = why === "resync" ? S.stateBackoffMs : LIM.STATE_MIN_MS;
    if (S.lastStateMs && (now - S.lastStateMs) < floor) {
      S.statePending = why;
      S.stateReadyMs = S.lastStateMs + floor;
      S.stateDefers++;
      note("stateDeferred", { why: why, inMs: Math.max(0, S.stateReadyMs - now) });
      return;
    }
    if (why === "resync") {
      if (S.syncFails >= LIM.SYNC_GIVEUP) { giveUpSync("host"); return; }
      S.syncFails++;
      S.stateBackoffMs = Math.min(LIM.STATE_MAX_MS, S.stateBackoffMs * 2);
      if (S.syncFails >= LIM.SYNC_GIVEUP) { giveUpSync("host"); return; }
    } else {
      S.stateBackoffMs = LIM.STATE_MIN_MS;
    }
    S.lastStateMs = now;
    S.statePending = "";
    const t0 = NOW();
    const str = FSSim.serialize(g);
    const id = ++stateId;
    const total = Math.max(1, Math.ceil(str.length / FSC.NET_CHUNK));
    send({ y: "stateBegin", id: id, total: total, bytes: str.length, tick: g.tick,
      seq: S.netSeq, hash: FSSim.hash(g), why: why || "", mode: S.mode, settings: S.settings });
    for (let i = 0; i < total; i++) {
      send({ y: "stateChunk", id: id, i: i, s: str.substr(i * FSC.NET_CHUNK, FSC.NET_CHUNK) });
    }
    send({ y: "stateEnd", id: id });
    STATS.stateBytes = str.length;
    STATS.stateMs = NOW() - t0;
    if (why === "resync") S.resyncs++;
    note("sentState", { why: why, bytes: str.length, ms: STATS.stateMs, chunks: total });
  }

  function applyState(r) {
    const t0 = NOW();
    let g2 = null;
    try {
      if (r.got !== r.total) throw new Error("lost " + (r.total - r.got) + " of " + r.total + " chunks");
      g2 = FSSim.deserialize(r.parts.join(""));
    } catch (e) {
      // a dropped chunk must never strand the guest: ask again (mid-game) or let
      // the next checkpoint re-trigger the resync (we still hold a playable world)
      warn(e);
      rx = null;
      S.err = String((e && e.message) || e);
      S.syncFails++;                       // a broken transfer counts toward the give-up
      S.awaitState = false;
      if (S.syncFails >= LIM.SYNC_GIVEUP) { giveUpSync("guest"); return; }
      if (G()) {
        S.status = "playing";
        S.awaitState = true; S.awaitStateMs = NOW();
        send({ y: "desync", t: G().tick, h: 0 });
      } else send({ y: "hello", name: S.myName, ver: FSC.VERSION });
      note("status", FSNet.state());
      return;
    }
    STATS.joinBytes = r.bytes; STATS.joinChunks = r.total;
    STATS.joinMs = NOW() - r.t0;
    S.hasWorld = true;                   // there is now something to "continue solo" WITH
    env.setG(g2);
    STATS.loadMs = NOW() - t0;
    if (r.why === "resync") STATS.resyncMs = STATS.joinMs;
    S.hostTick = Math.max(S.hostTick, r.tick);
    S.hostTickMs = NOW();
    // replay every command the host broadcast AFTER the snapshot was taken
    const buf = cmdBuf; cmdBuf = [];
    for (let i = 0; i < buf.length; i++) if ((buf[i].seq | 0) >= (r.seq | 0)) applyCmd(buf[i]);
    for (const k in myHash) delete myHash[k];
    for (const k in hostHash) delete hostHash[k];
    rx = null;
    S.status = "playing";
    S.awaitState = false;                // the repair landed
    S.catchT0 = NOW(); S.catchFrom = g2.tick;
    FSSim.event(g2, "netResync", { t: g2.tick, bytes: r.bytes, why: r.why });
    FSSim.notify(g2, g2.seats ? g2.seats[S.seat] : 0,
      r.why === "resync" ? "Back in step with your partner." : "Joined your partner's kingdom.");
    send({ y: "stateOk", t: g2.tick, h: FSSim.hash(g2), ms: STATS.joinMs });
    note("loaded", { tick: g2.tick, bytes: r.bytes, ms: STATS.joinMs, why: r.why });
    note("status", FSNet.state());
  }

  /* ═══════════════════════ hash checkpoints ═════════════════════════ */
  function trimHashes() {
    const keys = Object.keys(hostHash);
    if (keys.length <= FSC.NET_HASH_KEEP) return;
    keys.map(Number).sort(function (a, b) { return a - b; })
      .slice(0, keys.length - FSC.NET_HASH_KEEP)
      .forEach(function (k) { delete hostHash[k]; });
  }
  function compareHash(t) {
    // "unsynced" keeps COMPARING (that is how the room notices it healed) but
    // never raises another repair until the give-up cooldown lifts.
    if (S.role !== "guest" || (S.status !== "playing" && S.status !== "unsynced")) return;
    const mine = myHash[t], theirs = hostHash[t];
    if (mine === undefined || theirs === undefined) return;
    delete myHash[t]; delete hostHash[t];
    S.checkpoints++;                       // checkpoints actually COMPARED, not just sent
    if (mine === theirs) {
      S.syncFails = 0;                     // verifiably in step — the streak is broken
      S.awaitState = false;
      if (S.status === "unsynced") { S.status = "playing"; S.giveUpMs = 0; note("status", FSNet.state()); }
      send({ y: "hashOk", t: t });
      return;
    }
    if (S.status === "unsynced") return;   // already told the player; stop looping
    // ONE repair at a time: the host's transfer backoff may hold a world back for
    // seconds, and re-reporting the same divergence every checkpoint would spam
    // both players and the wire for no gain.
    if (S.awaitState) return;
    S.desyncs++;
    S.syncFails++;
    note("desync", { t: t, n: S.desyncs, mine: mine, theirs: theirs, side: "guest" });
    const g = G();
    if (g) {
      FSSim.event(g, "netDesync", { t: t, n: S.desyncs, side: "self" });
      FSSim.notify(g, g.seats ? g.seats[S.seat] : 0, "Re-syncing with your partner…");
    }
    if (S.syncFails >= LIM.SYNC_GIVEUP) { giveUpSync("guest"); return; }
    // …and the clock keeps RUNNING while we wait. The incoming world overwrites
    // ours wholesale (and can be at most the command lead behind us), so freezing
    // the screen for the whole backoff window would cost the family a stalled
    // game to buy nothing.
    S.awaitState = true; S.awaitStateMs = NOW();
    send({ y: "desync", t: t, h: mine });
  }

  /** Called by the page after every sim tick while a room is live. */
  FSNet.afterTick = function (g) {
    if (!S.role || !g) return;
    if ((g.tick % FSC.SYNC_HASH_T) !== 0) return;
    const h = FSSim.hash(g);
    if (S.role === "host") {
      send({ y: "hash", t: g.tick, h: h });
    } else {
      myHash[g.tick] = h;
      const keys = Object.keys(myHash);
      if (keys.length > FSC.NET_HASH_KEEP) {
        keys.map(Number).sort(function (a, b) { return a - b; })
          .slice(0, keys.length - FSC.NET_HASH_KEEP)
          .forEach(function (k) { delete myHash[k]; });
      }
      compareHash(g.tick);
    }
  };

  /* ═══════════════════════ pacing ═══════════════════════════════════ */
  /**
   * FSNet.pace(G) → { limit, budget, clock, catching }
   *   host  — free running on its own accumulator (it IS the clock).
   *   guest — ticks toward the host's clock and never past it; `clock:true` tells
   *           the page to ignore its local accumulator entirely so a guest that
   *           fell behind (join, hidden tab, slow frame) can catch up in slices.
   */
  FSNet.pace = function (g) {
    if (S.role !== "guest" || !g) {
      return { limit: Infinity, budget: FSC.MAX_TICKS_PER_FRAME, clock: false, catching: false };
    }
    const live = S.status === "playing" || S.status === "unsynced";
    let target = S.hostTick;
    if (live && g.speed > 0 && S.hostTickMs) {
      // extrapolate the host's clock between beats so the world moves smoothly…
      const dtMs = Math.min(FSC.NET_EXTRAP_MS, NOW() - S.hostTickMs);
      const est = S.hostTick + Math.floor((dtMs / (FSC.TICK_S * 1000)) * g.speed);
      // …but NEVER past the last CONFIRMED host tick + the command lead, minus a
      // margin. That is the lockstep safety invariant: a command the host stamps
      // at H + lead can always reach us before we reach that tick, whatever the
      // extrapolation (or a stalled host) would otherwise let us do.
      const lead = FSC.CMD_DELAY_MP * Math.max(1, g.speed) - FSC.NET_LEAD_MARGIN;
      target = Math.min(est, S.hostTick + lead);
    }
    // syncing / host-left: frozen. "unsynced" deliberately keeps running — a
    // family game that stops dead is worse than one that drifted (see giveUpSync).
    if (!live) target = g.tick;
    const behind = target - g.tick;
    S.behind = behind;
    const catching = behind > FSC.NET_CATCHUP_SHOW;
    if (S.catching !== catching) {
      S.catching = catching;
      if (!catching && S.catchT0) {
        STATS.catchupMs = NOW() - S.catchT0;
        STATS.catchupTicks = g.tick - (S.catchFrom || 0);
        S.catchT0 = 0;
      }
      note("catchup", { on: catching, behind: behind });
    }
    return {
      limit: target,
      budget: catching ? FSC.NET_CATCHUP_TICKS : FSC.MAX_TICKS_PER_FRAME,
      clock: true, catching: catching,
    };
  };

  /* ═══════════════════════ heartbeats ═══════════════════════════════ */
  function startTimer() {
    if (timer) return;
    timer = setInterval(function () {
      const g = G();
      if (S.role === "host" && g) send({ y: "beat", t: g.tick, sp: g.speed });
      else if (S.role === "guest") {
        // a hello that raced the host into the room would otherwise be lost
        if (S.status === "connecting") send({ y: "hello", name: S.myName, ver: FSC.VERSION });
        // a partner we wrote off may only have stalled: keep announcing ourselves
        // so BOTH sides can re-admit each other without anyone rejoining
        else if (S.status === "hostLeft") send({ y: "back", t: g ? g.tick : 0 });
        else if (g) send({ y: "gbeat", t: g.tick });
      }
      // hidden tabs freeze rAF — keep BOTH roles ticking on the same accumulator
      // path (house pattern). Solo keeps its pause-when-hidden behaviour.
      if (typeof document !== "undefined" && document.hidden && S.role) {
        try { env.step(FSC.NET_HIDDEN_MS / 1000); } catch (e) { warn(e); }
      }
      const now = NOW();
      // an UNATTRIBUTABLE peer-leave only counts once the partner really is silent
      if (S.leaveSuspectMs && S.peerHere) {
        if (S.lastRxMs > S.leaveSuspectMs) S.leaveSuspectMs = 0;
        else if ((now - S.leaveSuspectMs) > LIM.PEER_LEAVE_MS) onPeerGone("left");
      }
      if (S.peerHere && S.lastRxMs && (now - S.lastRxMs) > FSC.NET_TIMEOUT_MS) onPeerGone("timeout");
      // a seat held open for a stalled partner is released eventually, so the
      // room can never be locked shut by a peer that will not come back
      if (!S.peerHere && S.peerLostWhy === "timeout" && (now - S.peerLostMs) > LIM.SEAT_HOLD_MS) {
        S.peerPid = ""; S.peerSockId = ""; S.peerLostWhy = "";
        note("status", FSNet.state());
      }
      // a repair request that was never answered (a lost frame) must not silence
      // the guest's checkpoints for ever — release it and let the next one re-ask
      if (S.awaitState && (now - S.awaitStateMs) > LIM.STATE_MAX_MS * 3) S.awaitState = false;
      // a full-state transfer the backoff deferred
      if (S.statePending && now >= S.stateReadyMs) {
        const w = S.statePending; S.statePending = "";
        sendState(w);
      }
      // …and the "cannot stay in sync" cooldown: try once more, quietly
      if (S.giveUpMs && (now - S.giveUpMs) > LIM.SYNC_RETRY_MS) {
        S.giveUpMs = 0; S.syncFails = 0; S.stateBackoffMs = LIM.STATE_MIN_MS;
        if (S.status === "unsynced") S.status = S.role === "host" && !S.peerHere ? "waiting" : "playing";
        note("status", FSNet.state());
      }
    }, FSC.NET_BEAT_MS);
  }
  function stopTimer() { if (timer) { clearInterval(timer); timer = 0; } }

  /* ═══════════════════════ public API ═══════════════════════════════ */
  FSNet.available = function () { return true; };
  FSNet.active = function () { return !!S.role; };
  FSNet.role = function () { return S.role; };
  FSNet.isHost = function () { return S.role === "host"; };
  FSNet.isGuest = function () { return S.role === "guest"; };
  FSNet.stats = function () { return Object.assign({}, STATS); };
  FSNet.state = function () {
    return {
      role: S.role, mode: S.mode, seat: S.seat, transport: S.transport,
      status: S.status, code: S.code, connected: S.connected,
      peerName: S.peerName, peerHere: S.peerHere, myName: S.myName,
      desyncs: S.desyncs, resyncs: S.resyncs, lateCmds: S.lateCmds, rejects: S.rejects,
      checkpoints: S.checkpoints,
      hostTick: S.hostTick, behind: S.behind, catching: S.catching,
      settings: S.settings, joins: S.joins, err: S.err,
      /* netcode hardening surface (suites assert against these) */
      hasWorld: S.hasWorld, dropped: S.dropped, syncFails: S.syncFails,
      stateDefers: S.stateDefers, seated: !!S.peerPid,
      link: S.code ? FSNet.shareLink() : "",
    };
  };

  function pickTransport(want) {
    if (want) return want;
    return param("mpws") ? "localws" : "playroom";
  }

  function connect(isHost, code, want) {
    S.transport = pickTransport(want);
    S.myName = myName();
    if (S.transport === "localws") {
      const url = param("mpws");
      if (!url) return Promise.reject(new Error("no ?mpws= relay"));
      return new Promise(function (resolve, reject) {
        let done = false;
        const a = localwsAdapter(url, code, isHost, {
          onUp: function () { if (!done) { done = true; resolve(a); } CB.onUp(); },
          onDown: function (why) { if (!done) { done = true; reject(new Error("relay " + why)); } else CB.onDown(why); },
          onPeer: CB.onPeer, onMsg: CB.onMsg,
        });
        setTimeout(function () { if (!done) { done = true; reject(new Error("relay timeout")); } }, 6000);
      });
    }
    return playroomAdapter(code, isHost, CB);
  }

  /**
   * FSNet.host({mode,size,seed,ais,supplies,transport}) — open a room and start
   * the world. Resolves with FSNet.state(). Any transport failure resolves too:
   * the page starts the same world SOLO with a friendly note (never a blank page).
   */
  FSNet.host = function (opts) {
    opts = opts || {};
    if (S.role) FSNet.leave();
    const mode = opts.mode === "separate" ? "separate" : "shared";
    const settings = {
      seed: (opts.seed >>> 0) || 1,
      size: opts.size || "medium",
      ais: opts.ais === undefined ? 1 : opts.ais | 0,
      supplies: opts.supplies,
      mode: mode,
      humans: mode === "separate" ? 2 : 1,
      aiPlan: opts.aiPlan,        // suites park the opponents; travels inside the save too
      speed: opts.speed,
    };
    S.mode = mode; S.seat = 0; S.settings = settings;
    S.code = (opts.code || makeCode()).toUpperCase();
    S.status = "connecting"; S.err = "";
    S.peerPid = ""; S.peerSockId = ""; S.peerLostWhy = ""; S.leaveSuspectMs = 0;
    S.syncFails = 0; S.giveUpMs = 0; S.lastStateMs = 0; S.stateBackoffMs = 0; S.statePending = "";
    S.awaitState = false;
    note("status", FSNet.state());
    return connect(true, S.code, opts.transport).then(function (a) {
      adapter = a;
      if (a.roomCode) S.code = String(a.roomCode).toUpperCase();
      S.role = "host"; S.seat = 0; S.connected = true;
      S.status = "waiting"; S.netSeq = 1; S.peerHere = false;
      installHook();
      env.startWorld(settings);
      startTimer();
      if (S.transport === "playroom") lobbyEnsure();
      note("status", FSNet.state());
      return FSNet.state();
    }).catch(function (e) {
      warn(e);
      S.err = String((e && e.message) || e);
      S.role = null; S.status = "failed"; S.connected = false;
      removeHook();
      adapter = null;
      toast("🌾 Couldn't open a co-op room — playing solo.");
      // solo shape: one human, no dormant second kingdom (never a blank page)
      env.startWorld(Object.assign({}, settings, { mode: "shared", humans: 1 }));
      note("status", FSNet.state());
      return FSNet.state();
    });
  };

  /**
   * FSNet.join(code) — connect to a host and wait for the world transfer.
   * Failure → friendly toast, page stays where it was (title screen).
   */
  FSNet.join = function (code, opts) {
    opts = opts || {};
    if (S.role) FSNet.leave();
    S.code = String(code || FSNet.linkCode() || "").toUpperCase();
    if (!S.code && pickTransport(opts.transport) === "localws") {
      return Promise.resolve(fail("no room code"));
    }
    S.status = "connecting"; S.mode = "shared"; S.seat = 1; S.err = "";
    S.peerPid = ""; S.peerSockId = ""; S.peerLostWhy = ""; S.leaveSuspectMs = 0;
    S.hasWorld = false; S.syncFails = 0; S.giveUpMs = 0; S.awaitState = false;
    note("status", FSNet.state());
    return connect(false, S.code, opts.transport).then(function (a) {
      adapter = a;
      if (a.roomCode) S.code = String(a.roomCode).toUpperCase();
      S.role = "guest"; S.connected = true; S.status = "connecting";
      cmdBuf = []; rx = null;
      installHook();
      startTimer();
      send({ y: "hello", name: S.myName, ver: FSC.VERSION });
      note("status", FSNet.state());
      return FSNet.state();
    }).catch(function (e) {
      warn(e);
      return fail(String((e && e.message) || e));
    });
  };
  function fail(msg) {
    S.err = msg; S.role = null; S.status = "failed"; S.connected = false;
    removeHook(); stopTimer(); adapter = null;
    toast("🌾 Couldn't reach that co-op room.");
    note("status", FSNet.state());
    return FSNet.state();
  }

  /** Ping marker — both screens raise the same event, nothing else happens. */
  FSNet.ping = function (v) {
    const g = G();
    if (!g) return null;
    return FSSim.issueCommand(g, { type: "ping", args: { v: v | 0 } });
  };

  /**
   * FSNet.detach() — leave the wire but KEEP PLAYING. A guest whose host quit
   * carries on with the state it already holds; in separate-kingdoms mode its
   * local commands keep driving its own player (seat remap), in shared mode it
   * simply keeps commanding player 0.
   */
  FSNet.detach = function () {
    const g = G();
    if (S.role === "guest" && g && g.seats) {
      const p = g.seats[S.seat] === undefined ? 0 : g.seats[S.seat];
      FSSim.setSeats(g, [p, p]);
    }
    const was = S.role;
    teardown("solo");
    note("detached", { was: was });
    note("status", FSNet.state());
    return FSNet.state();
  };
  /** Leave the room entirely (title screen / new game). */
  FSNet.leave = function () {
    if (adapter) { try { send({ y: "bye", why: "leave" }); } catch (e) {} }
    teardown("off");
    note("status", FSNet.state());
    return FSNet.state();
  };
  function teardown(status) {
    removeHook();
    stopTimer();
    lobbyRemove();
    if (adapter) { try { adapter.close(); } catch (e) {} }
    adapter = null;
    S.role = null; S.connected = false; S.peerHere = false; S.status = status;
    S.behind = 0; S.catching = false;
    S.peerPid = ""; S.peerSockId = ""; S.peerLostWhy = ""; S.peerLostMs = 0;
    S.leaveSuspectMs = 0; S.hasWorld = false; S.syncFails = 0; S.giveUpMs = 0;
    S.awaitState = false; S.awaitStateMs = 0;
    S.lastStateMs = 0; S.stateBackoffMs = 0; S.stateReadyMs = 0; S.statePending = "";
    cmdBuf = []; rx = null;
    for (const k in myHash) delete myHash[k];
    for (const k in hostHash) delete hostHash[k];
  }

  /* ═══════════════════ family lobby (best effort) ═══════════════════
   * Registers lobbies_<familyKey>/fst_<code> so games.html's generic lobby
   * renderer shows a JOIN card. Firestore is BLOCKED in the test container and
   * by every suite, so EVERY call here is guarded: unreachable Firestore must
   * never throw, never block, never touch gameplay. Only a real (playroom) room
   * is ever advertised — the localws test wire is not shareable.
   */
  const FS_CFG = {
    apiKey: "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU",
    authDomain: "amen-farms-app.firebaseapp.com",
    projectId: "amen-farms-app",
    storageBucket: "amen-farms-app.firebasestorage.app",
    messagingSenderId: "321230755979",
    appId: "1:321230755979:web:d362c56aaf7e50b4ab5c8e",
  };
  const FAMILY_PASSWORD = "amenfarms";
  function roomId(pw) {
    let h = 0;
    for (const ch of pw.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return "fam" + h.toString(36);
  }
  function familyKey() { return param("fam") || roomId(FAMILY_PASSWORD); }
  const LOBBY = { available: false, db: null, fs: null, ref: null, beat: 0, ready: null, hooked: false };
  /** Injectable so the contract test can exercise the doc shape offline. */
  FSNet._lobbyLoader = function () {
    return Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
    ]).then(function (mods) {
      const app = mods[0].initializeApp(FS_CFG, "bucky-lobby");
      return { fs: mods[1], db: mods[1].getFirestore(app) };
    });
  };
  function lobbyReady() {
    if (LOBBY.ready) return LOBBY.ready;
    LOBBY.ready = Promise.resolve()
      .then(function () { return FSNet._lobbyLoader(); })
      .then(function (o) {
        LOBBY.fs = o.fs; LOBBY.db = o.db; LOBBY.available = true;
      })
      .catch(function (e) {
        LOBBY.available = false;
        warn("family lobby unavailable (Firestore blocked or offline) — co-op unaffected");
      });
    return LOBBY.ready;
  }
  function lobbyEnsure(o) {
    o = o || {};
    if (param("nolobby") && !o.force) return Promise.resolve(false);
    const code = o.code || S.code;
    const isHost = o.force ? true : (S.role === "host");
    return lobbyReady().then(function () {
      if (!LOBBY.available || !isHost || !code) return false;
      const fs = LOBBY.fs;
      LOBBY.ref = fs.doc(LOBBY.db, "lobbies_" + familyKey(), "fst_" + code);
      return fs.setDoc(LOBBY.ref, {
        game: "farmstead", gameName: "Farmstead", ico: "🏰",
        hostName: o.name || S.myName || "Someone", roomCode: code,
        mode: o.mode || S.mode, status: "open", playerCount: 1, maxPlayers: FSC.NET_MAX_PLAYERS,
        createdAt: NOW(), updatedAt: NOW(),
      }).then(function () {
        if (!LOBBY.beat) {
          LOBBY.beat = setInterval(function () { lobbyUpdate({}); }, FSC.NET_LOBBY_BEAT_MS);
        }
        if (!LOBBY.hooked && typeof window !== "undefined") {
          LOBBY.hooked = true;
          window.addEventListener("pagehide", function () { lobbyRemove(); });
          window.addEventListener("beforeunload", function () { lobbyRemove(); });
        }
        return true;
      }).catch(function (e) { warn(e); return false; });
    }).catch(function (e) { warn(e); return false; });
  }
  function lobbyUpdate(fields) {
    if (!LOBBY.available || !LOBBY.ref) return Promise.resolve(false);
    try {
      const p = LOBBY.fs.setDoc(LOBBY.ref, Object.assign({ updatedAt: NOW() }, fields || {}), { merge: true });
      return Promise.resolve(p).then(function () { return true; }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  function lobbyRemove() {
    if (LOBBY.beat) { clearInterval(LOBBY.beat); LOBBY.beat = 0; }
    if (!LOBBY.available || !LOBBY.ref) return Promise.resolve(false);
    const ref = LOBBY.ref; LOBBY.ref = null;
    try {
      const p = LOBBY.fs.deleteDoc(ref);
      return Promise.resolve(p).then(function () { return true; }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  FSNet._lobby = {
    ensure: lobbyEnsure, update: lobbyUpdate, remove: lobbyRemove,
    key: familyKey,
    /** test seam: forget a memoised backend so a suite can hand in a fake one */
    reset: function () {
      if (LOBBY.beat) { clearInterval(LOBBY.beat); LOBBY.beat = 0; }
      LOBBY.ready = null; LOBBY.available = false; LOBBY.ref = null;
    },
    state: function () {
      return { available: LOBBY.available, doc: LOBBY.ref ? String(LOBBY.ref.path || LOBBY.ref.id || "") : "",
        beating: !!LOBBY.beat };
    },
  };

  /* test seam: drive the wire without a transport (contract tests, replay) */
  FSNet._inject = function (m, bytes) { onMessage(m, bytes || 0); };
  FSNet._peer = function (join, name, o) {
    onPeerFrame(Object.assign({ join: !!join, name: name }, o || {}));
  };
  /** The wire bounds + this page's wire id — suites assert against these, so a
   *  tuned limit updates the suite automatically instead of breaking it. */
  FSNet._limits = function () { return Object.assign({}, LIM); };
  FSNet._pid = function () { return MY_PID; };
  /** Live view of the full-state backoff (suite + field diagnosis). */
  FSNet._sync = function () {
    return { pending: S.statePending, readyIn: S.statePending ? S.stateReadyMs - NOW() : 0,
      backoffMs: S.stateBackoffMs, sinceStateMs: S.lastStateMs ? NOW() - S.lastStateMs : -1,
      fails: S.syncFails, defers: S.stateDefers, giveUp: !!S.giveUpMs, peerPid: S.peerPid,
      awaiting: S.awaitState };
  };

  window.FSNet = FSNet;
})();
