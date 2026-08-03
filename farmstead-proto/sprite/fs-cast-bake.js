/* fs-cast-bake.js — FORK B production sprite baker.
 *
 * Fork B = the game camera is YAW-LOCKED (classic Settlers fixed view, pan +
 * zoom only). That single decision is what makes this pipeline possible:
 *
 *   - the atlas is indexed by the unit's ABSOLUTE facing, not by
 *     (cameraYaw - unitYaw), so ONE frame no longer has to serve every
 *     (facing, camera) pair with the same difference;
 *   - therefore the sun can be WORLD-FIXED. The bake camera stands still at
 *     the locked yaw and the MODEL turns. Every cell is lit by the same
 *     world sun the 3D game uses, from the correct side. (The orbiting-camera
 *     demo could not do this — see VIABILITY.md "Lighting cohesion".)
 *   - only ONE pitch row is needed: the game's resting pitch.
 *
 * THE COMBINATORICS PROBLEM AND ITS SOLUTION
 * The procedural minifig bakes a merged geometry per (job, player): 23 jobs x
 * 4 players = 92 serf sheets, x 5 ranks x 4 players for knights. Impossible.
 * The source geometry decomposes cleanly, so this baker splits it:
 *
 *   1. BASE SHEET   one neutral serf body + one neutral knight body. No hat,
 *                   no tool, no pack, no rank pips. Team/rank regions are baked
 *                   with a WHITE albedo and NO emissive lift.
 *   2. MASK SHEET   the same cells re-rendered unlit, R = team region,
 *                   G = knight rank-trim region. Half resolution (the regions
 *                   are chunky; bilinear gives a free antialiased boundary).
 *   3. OVERLAYS     hat / pack / each tool / rank pip baked as their OWN small
 *                   cells on the SAME azimuth grid and POSED ON THE BODY, so
 *                   perspective and lighting match exactly.
 *   4. ANCHORS      while baking each body cell the 3D mount points (hat, tool
 *                   hand, pack mount, carry, rank pips) are PROJECTED into cell
 *                   pixel coordinates and written to the manifest. Composition
 *                   is then "put the overlay's pivot pixel on the body's anchor
 *                   pixel" — generated, never hand-authored.
 *
 * ONE LOCKED WORLD SCALE. Every cell in every sheet — bodies and overlays —
 * shares one px-per-camera-unit. Overlay cells are simply a smaller window on
 * the same projection, so the anchor arithmetic is exact by construction and
 * nothing is fitted per frame.
 *
 * POSE SOURCE. Every transform below is copied out of the frozen pre-cast
 * fs-render.js (drawSerf / pushLegs / serfSwing+swingShape / knightVisual /
 * duelPose). Nothing here invents a gait.
 */
(function () {
  "use strict";

  const FSC = window.FSC;
  const FSM = window.FSModels;              // the FROZEN fs-models-frozen.js
  const M = FSM.M, mergeColored = FSM.mergeColored;
  const DEG = Math.PI / 180;

  const B = {};
  window.FSCastBake = B;

  /* ==================================================================== */
  /* CONFIG — the whole pipeline is driven from here.                     */
  /* ==================================================================== */
  B.DEFAULTS = {
    source: "minifig",        // "minifig" (procedural, the shipped look) | "villager" (Tripo GLBs)
    azimuths: 12,             // 12 x 30deg divides the hex lattice's 60deg headings evenly
    cameraYaw: 0,             // the LOCKED camera yaw these sheets assume (radians)
    pitchDeg: 52,             // FSC.CAM.PITCH_START — read, not guessed
    bodyCell: 128,            // px
    overlayCell: 64,          // px
    /* Mask resolution divisor, PER SUBJECT. A serf's only tinted region is one
     * chunky sash, which survives half resolution and gets a free antialiased
     * boundary out of it. A knight's rank trim is a 2-3 px plume, crossguard and
     * shield rim sitting right against the team-coloured shield — at half res
     * the R and G regions bilinear-blend into each other and a gold rim comes
     * out pink. Knights bake their mask at full resolution. */
    maskDiv: { serf: 2, knight: 1 },
    pad: 0.06,                // transparent gutter, fraction of the tile
    /* 0 = "as many as IDLE_VARIANTS declares" (3 loops x 3 frames = 9). The
     * override exists so a suite can bake a single-frame idle and prove the
     * renderer still resolves the neutral stance. */
    idleFrames: 0,
    walkFrames: 8,
    workFrames: 6,
    fightL: [-0.34, -0.17, 0.25, 0.50, 0.75, 1.00],   // duelPose l values
    overlayCols: 24,          // overlay sheet grid width, in cells
    tools: ["axe", "saw", "scythe", "pick", "hammer", "shovel", "rod", "cleaver", "pincer", "default"],
  };

  /* ---- the game's own material constants (FSModels.vcMat("serf", 0x9a9a9a, 0.34)) */
  const SERF_EMISSIVE_OF = 0x9a9a9a, SERF_EMISSIVE_K = 0.34;
  function serfEmissive() { return new THREE.Color(SERF_EMISSIVE_OF).multiplyScalar(SERF_EMISSIVE_K); }

  /* ---- pose constants, verbatim from the frozen fs-render.js ---- */
  const LEG_SWING = 0.52;                        // pushLegs: rad at full stride
  const SERF_HIP_X = 0.075, SERF_HIP_Y = 0.255;
  const KNIGHT_HIP_X = 0.078, KNIGHT_HIP_Y = 0.255;
  const BOB_WALK = 0.052;                        // drawSerf: |cos(phase)| * 0.052
  const BOB_WORK = 0.045;                        // drawSerf: swing * 0.045
  const CARRY_Y = 0.86;                          // drawSerf: crate at y + bob + 0.86
  /* ---- ARM constants (batch #4, 2026-08-02) --------------------------------
   * Radians at the SHOULDER, about the character's left-right axis; POSITIVE
   * is forward (toward the face). armOut is a small outward swing about the
   * forward axis, so two arms held out in front are not one plank.
   *   ARM_SWING   the empty-handed walk's counter-swing against the legs
   *   ARM_CARRY   both arms out in front, holding a load on the hands
   *   ARM_WORK_*  the bottom and the top of a tool swing (negative = raised
   *               BEHIND vertical, which is where a hammer or an axe starts)
   * Deliberately BIG. A serf is ~26 px tall at play zoom, so a 10° arm move is
   * under a pixel of hand travel; these are 45-100° and read as an action.  */
  const ARM_SWING = 0.34;
  const ARM_CARRY = 1.32;                        // ~76° — hands out in front, level-ish
  const ARM_CARRY_OUT = 0.24;                    // elbows apart so the load has a shelf
  const ARM_CARRY_BEND = 0.55;                   // …and the elbows bend, or he sleepwalks (skinned rig only)
  const ARM_WORK_LO = 0.30;                      // tool low, in front of him
  const ARM_WORK_HI = 2.05;                      // ~117° — tool up and behind the shoulder
  /* ═══ ONLY THE TOOL ARM SWINGS (batch #5, 2026-08-02, user playtest) ═══════
   * Batch #4 raised BOTH arms through the whole stroke on the same scalar, so
   * every builder and every woodcutter chopped with two mirrored arms and no
   * tool in one of them. A man swinging a hammer moves the hammer arm; the
   * other one COUNTERBALANCES — it drifts a little the other way and it never
   * mirrors. armXR is the TOOL arm on both rigs (the tool and toolTip anchors
   * are taken from the side-+1 hand), so the split is: armXR keeps the whole
   * stroke, armX gets these, which top out at 14% of it. */
  const ARM_OFF_BASE = 0.06;                     // the idle hand, barely off the seam
  const ARM_OFF_SWING = 0.22;                    // …drifting forward as the tool goes back
  const ARM_OFF_OUT = 0.06;                      // and it does NOT splay with the swing
  B.LEG_SWING = LEG_SWING;
  B.SERF_HIP_X = SERF_HIP_X; B.SERF_HIP_Y = SERF_HIP_Y;
  B.KNIGHT_HIP_X = KNIGHT_HIP_X; B.KNIGHT_HIP_Y = KNIGHT_HIP_Y;
  B.BOB_WALK = BOB_WALK; B.CARRY_Y = CARRY_Y;
  B.ARM = { swing: ARM_SWING, carry: ARM_CARRY, carryOut: ARM_CARRY_OUT, workLo: ARM_WORK_LO, workHi: ARM_WORK_HI };

  /* ---- anchor points, in BODY-LOCAL space (the frame the merged body geo
   * is authored in; y = 0 is the ground the serf stands on). Taken straight
   * off the part matrices in the frozen fs-models.js. ---- */
  const ANCHOR_SERF = {
    hat:  [0, 0.766, 0],      // between the cap crown (0.772) and its brim (0.760)
    tool: [0.232, 0.335, 0.055],  // serfGeo's tool `fit` translation
    pack: [0, 0.43, -0.155],      // the carrier's pack body
    /* batch #4: where a carried good rests. Resolved from the POSED arms
     * (anchorWorld), so it follows the hands through the carry cycle; the
     * body-local value here is only the rest position, for a rig that cannot
     * offer a posed one. */
    hands: [0, 0.34, 0.20],
    /* batch #5: the OFF hand (side −1) on its own, resolved from the posed arm
     * like `tool` is. Nothing is drawn on it — it exists so a test can measure
     * how far the empty hand travels through a work stroke against how far the
     * tool hand does, which is the only way to assert "one arm swings" from
     * outside the bake. */
    offhand: [-0.187, 0.293, 0.018],
  };
  /* the minifig's shoulder joint — the pivot the arm limb hangs from. Taken
   * from the arm cylinder's own top (centre 0.40, length 0.20) and the torso's
   * shoulder line. */
  const SERF_SHOULDER = { x: 0.158, y: 0.492, z: 0.008 };
  B.SERF_SHOULDER = SERF_SHOULDER;
  const ANCHOR_KNIGHT = {
    helmTop: [0, 0.875, 0],
    pip0: [-0.055 + 0 * 0.045, 0.475, 0.125],
    pip1: [-0.055 + 1 * 0.045, 0.475, 0.125],
    pip2: [-0.055 + 2 * 0.045, 0.475, 0.125],
    pip3: [-0.055 + 3 * 0.045, 0.475, 0.125],
  };

  /* ==================================================================== */
  /* PART LISTS — the frozen minifig, decomposed.                         */
  /*   mask: 0 = plain (keeps its authored colour + the emissive lift)     */
  /*         1 = TEAM region  (baked white, emissive 0, mask R)            */
  /*         2 = RANK region  (baked white, emissive 0, mask G)            */
  /* ==================================================================== */

  /** serfGeo's tool kit, verbatim. Authored at the origin; serfGeo then fits it
   * into the hand with translate(0.232,0.335,0.055) * scale(0.6). */
  function toolParts(parts, tool, hx, hy, hz) {
    const steel = 0xc3c9d1, dark = 0x8a8f96, TOOL = FSC.COL.TOOL;
    switch (tool) {
      case "axe":
        parts.push({ geo: new THREE.BoxGeometry(0.042, 0.44, 0.042), color: TOOL, matrix: M(hx, hy, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.17, 0.15, 0.05), color: steel, matrix: M(hx + 0.05, hy + 0.22, hz, 0, 0, -0.15) });
        parts.push({ geo: new THREE.BoxGeometry(0.06, 0.17, 0.055), color: dark, matrix: M(hx - 0.02, hy + 0.22, hz) });
        break;
      case "saw":
        parts.push({ geo: new THREE.BoxGeometry(0.045, 0.16, 0.045), color: TOOL, matrix: M(hx, hy, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.40, 0.13, 0.02), color: steel, matrix: M(hx + 0.18, hy + 0.12, hz, 0, 0, 0.22) });
        break;
      case "scythe":
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.56, 0.04), color: TOOL, matrix: M(hx, hy + 0.06, hz, 0, 0, 0.10) });
        parts.push({ geo: new THREE.BoxGeometry(0.42, 0.05, 0.03), color: steel, matrix: M(hx + 0.16, hy + 0.34, hz, 0, 0, -0.42) });
        break;
      case "pick":
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.46, 0.04), color: TOOL, matrix: M(hx, hy, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.34, 0.05, 0.05), color: dark, matrix: M(hx, hy + 0.23, hz, 0, 0, 0.24) });
        break;
      case "hammer":
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.34, 0.04), color: TOOL, matrix: M(hx, hy + 0.02, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.16, 0.10, 0.10), color: dark, matrix: M(hx, hy + 0.20, hz) });
        break;
      case "shovel":
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.46, 0.04), color: TOOL, matrix: M(hx, hy, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.15, 0.18, 0.03), color: 0x9aa0a8, matrix: M(hx, hy - 0.24, hz) });
        break;
      case "rod":
        parts.push({ geo: new THREE.BoxGeometry(0.03, 0.62, 0.03), color: TOOL, matrix: M(hx, hy + 0.10, hz, -0.5, 0, 0.15) });
        parts.push({ geo: new THREE.BoxGeometry(0.012, 0.012, 0.30), color: 0xdfe6ee, matrix: M(hx + 0.06, hy + 0.36, hz + 0.16) });
        break;
      case "cleaver":
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.16, 0.04), color: TOOL, matrix: M(hx, hy, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.20, 0.16, 0.02), color: steel, matrix: M(hx + 0.06, hy + 0.16, hz) });
        break;
      case "pincer":
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.30, 0.04), color: dark, matrix: M(hx - 0.02, hy, hz, 0, 0, 0.12) });
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.30, 0.04), color: dark, matrix: M(hx + 0.02, hy, hz, 0, 0, -0.12) });
        break;
      default:
        parts.push({ geo: new THREE.BoxGeometry(0.045, 0.42, 0.045), color: TOOL, matrix: M(hx, hy, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.16, 0.09, 0.07), color: dark, matrix: M(hx, hy + 0.20, hz) });
    }
  }
  B.toolParts = toolParts;

  /** serfGeo minus hat, pack and tool. The sash keeps its geometry but is
   * flagged TEAM so it bakes white and tints at runtime. */
  function serfBodyParts() {
    const COL = FSC.COL;
    const skin = COL.SERF_SKIN, cloth = COL.SERF_CLOTH, hair = 0x6a4a2c;
    const parts = [];
    parts.push({ geo: new THREE.CylinderGeometry(0.135, 0.175, 0.27, 6), color: cloth, matrix: M(0, 0.385, 0) });
    parts.push({ geo: new THREE.SphereGeometry(0.132, 6, 3), color: cloth, matrix: M(0, 0.505, 0, 0, 0, 0, 1, 0.55, 0.86) });
    /* ═══ TEAM IS THE BELT (2026-08-01, user's colour language) ═════════════
     * The chest baldric that used to carry the team colour is GONE; the belt
     * this minifig always wore is the team region now, so both looks say the
     * same thing (villager = belt, knight = plume).
     * WIDENED, deliberately: the authored belt was 0.045 tall on a 0.79-unit
     * body = 5.7% of him = 1.5 px on the 26 px play-zoom sprite, i.e. under two
     * pixels of team colour. 0.095 is 12% of him ≈ 3.1 px, which is what the old
     * diagonal sash used to give (its roll swept ~5 px of vertical extent). It
     * is a chunky belt on a chunky toon — read it as the wrestling-championship
     * kind. Centre moved 0.262 → 0.30 so the whole band sits ON the tunic
     * (which spans 0.25..0.52) instead of hanging off its hem. */
    parts.push({ geo: new THREE.CylinderGeometry(0.174, 0.174, 0.095, 6), color: 0xffffff, matrix: M(0, 0.30, 0), mask: 1 });
    parts.push({ geo: new THREE.BoxGeometry(0.062, 0.062, 0.03), color: 0xd8b25a, matrix: M(0, 0.30, 0.158) });
    /* ═══ THE ARMS ARE THEIR OWN LIMB NOW (batch #4, 2026-08-02) ════════════
     * They used to be two more boxes inside the merged torso, which is why a
     * minifig serf could not reach for anything: the carry pose and the tool
     * swing both need a SHOULDER to rotate about. Flagged `arm: ±1` and
     * authored RELATIVE TO THEIR OWN SHOULDER PIVOT (SERF_SHOULDER), so
     * makeRig can hang them off a group and the mask/plain/tint split is
     * untouched. Geometry and colours are byte-identical to the old parts
     * once the pivot translation is folded back in — an unposed rig bakes the
     * same man he always did. */
    for (let s = -1; s <= 1; s += 2) {
      const px = s * SERF_SHOULDER.x, py = SERF_SHOULDER.y, pz = SERF_SHOULDER.z;
      parts.push({
        geo: new THREE.CylinderGeometry(0.043, 0.034, 0.20, 4), color: cloth, arm: s,
        matrix: M(s * 0.163 - px, 0.40 - py, 0.01 - pz, 0, 0, s * 0.12),
      });
      parts.push({
        geo: new THREE.SphereGeometry(0.042, 4, 3), color: skin, arm: s,
        matrix: M(s * 0.187 - px, 0.293 - py, 0.018 - pz),
      });
    }
    parts.push({ geo: new THREE.CylinderGeometry(0.045, 0.052, 0.062, 4), color: skin, matrix: M(0, 0.558, 0) });
    parts.push({ geo: new THREE.SphereGeometry(0.112, 7, 4), color: skin, matrix: M(0, 0.682, 0, 0, 0, 0, 1, 0.97, 0.95) });
    parts.push({ geo: new THREE.SphereGeometry(0.115, 6, 3), color: hair, matrix: M(0, 0.716, -0.008, 0.10, 0, 0, 1, 0.60, 1) });
    parts.push({ geo: new THREE.BoxGeometry(0.032, 0.026, 0.024), color: skin, matrix: M(0, 0.661, 0.098) });
    for (let s = -1; s <= 1; s += 2) {
      parts.push({ geo: new THREE.BoxGeometry(0.023, 0.027, 0.018), color: 0x3a2c1e, matrix: M(s * 0.037, 0.686, 0.090) });
    }
    return parts;
  }

  /** the profession cap. GEOMETRY IS IDENTICAL FOR EVERY JOB — only FSC.JOB_COLOR
   * differs — so ONE white-baked overlay tinted per job collapses 23 sheets to 1. */
  function serfHatParts() {
    return [
      { geo: new THREE.SphereGeometry(0.104, 6, 3), color: 0xffffff, matrix: M(0, 0.772, 0, 0, 0, 0, 1, 0.80, 1), mask: 1 },
      { geo: new THREE.CylinderGeometry(0.150, 0.150, 0.026, 7), color: 0xffffff, matrix: M(0, 0.760, 0.012), mask: 1 },
    ];
  }
  /** the carrier's pack (transporter / generic / sailor). Authored colours, no tint. */
  function serfPackParts() {
    const p = [
      { geo: new THREE.BoxGeometry(0.20, 0.19, 0.12), color: 0xb08a56, matrix: M(0, 0.40, -0.155) },
      { geo: new THREE.BoxGeometry(0.21, 0.045, 0.13), color: 0x6b5137, matrix: M(0, 0.46, -0.155) },
    ];
    for (let s = -1; s <= 1; s += 2) {
      p.push({ geo: new THREE.BoxGeometry(0.035, 0.20, 0.03), color: 0x6b5137, matrix: M(s * 0.075, 0.42, -0.10, 0.15, 0, 0) });
    }
    return p;
  }
  /** one fitted tool, exactly as serfGeo fits it into the hand. */
  function serfToolParts(tool) {
    const parts = [];
    toolParts(parts, tool, 0, 0, 0);
    const fit = new THREE.Matrix4().makeTranslation(0.232, 0.335, 0.055)
      .multiply(new THREE.Matrix4().makeScale(0.60, 0.60, 0.60));
    for (let i = 0; i < parts.length; i++) {
      parts[i].matrix = fit.clone().multiply(parts[i].matrix || new THREE.Matrix4());
    }
    return parts;
  }

  /** knightGeo minus the rank pips (their COUNT varies with rank, so they
   * become an anchored overlay instead). Team + rank regions flagged. */
  /* ═══ TEAM IS THE PLUME (2026-08-01, user's colour language) ═══════════════
   * The team colour left the surcoat, the shield face and the back disc and
   * moved to the helmet CREST — the one part of a knight an overhead camera can
   * never occlude. Those three former team regions now bake in their own
   * authored colours (linen surcoat, steel shield, steel disc).
   * RANK stays exactly where it was and is now the ONLY thing on mask G:
   * crossguard + shield rim + back rim, plus the rank-pip overlay. Nothing
   * couples rank to the plume any more — the plume was mask 2, it is mask 1 now.
   * The crest boxes are WIDENED (0.05 → 0.075 / 0.04 → 0.06 in x) because a
   * 0.05-wide crest is 1.6 px of team colour on the 26 px play-zoom sprite;
   * 0.075 makes it 2.5 px and it reads as a crest rather than a wire. */
  function knightBodyParts() {
    const COL = FSC.COL, steel = 0xb9bfc6, W = 0xffffff;
    /* the surcoat's own colour now that it is not the team's. Deliberately
     * between the body plate (0x8f959d) and the steel (0xb9bfc6) in value: at
     * a linen-white 0xd6ccb6 it out-shone everything and read as a blank card
     * where the team colour used to be. */
    const linen = 0xb9b09b;
    const parts = [];
    parts.push({ geo: new THREE.BoxGeometry(0.30, 0.30, 0.22), color: 0x8f959d, matrix: M(0, 0.37, 0) });
    parts.push({ geo: new THREE.BoxGeometry(0.235, 0.28, 0.235), color: linen, matrix: M(0, 0.36, 0) });   // surcoat
    parts.push({ geo: new THREE.BoxGeometry(0.32, 0.05, 0.24), color: 0x5d4a30, matrix: M(0, 0.245, 0) });
    for (let s = -1; s <= 1; s += 2) {
      parts.push({ geo: new THREE.BoxGeometry(0.10, 0.075, 0.115), color: steel, matrix: M(s * 0.195, 0.49, 0.01) });
      parts.push({ geo: new THREE.BoxGeometry(0.078, 0.21, 0.088), color: 0x8f959d, matrix: M(s * 0.195, 0.38, 0.02) });
    }
    parts.push({ geo: new THREE.BoxGeometry(0.085, 0.045, 0.09), color: COL.SERF_SKIN, matrix: M(0, 0.535, 0) });
    parts.push({ geo: new THREE.BoxGeometry(0.185, 0.17, 0.175), color: COL.SERF_SKIN, matrix: M(0, 0.625, 0) });
    parts.push({ geo: new THREE.CylinderGeometry(0.145, 0.155, 0.13, 7), color: steel, matrix: M(0, 0.685, 0) });
    parts.push({ geo: new THREE.CylinderGeometry(0.185, 0.185, 0.032, 8), color: 0xa9b0b8, matrix: M(0, 0.63, 0) });
    parts.push({ geo: new THREE.ConeGeometry(0.125, 0.13, 7), color: steel, matrix: M(0, 0.81, 0) });
    parts.push({ geo: new THREE.BoxGeometry(0.035, 0.12, 0.03), color: 0xa9b0b8, matrix: M(0, 0.635, 0.10) });
    parts.push({ geo: new THREE.BoxGeometry(0.075, 0.075, 0.20), color: W, matrix: M(0, 0.90, -0.03, 0.32, 0, 0), mask: 1 });  // plume = TEAM
    parts.push({ geo: new THREE.BoxGeometry(0.06, 0.05, 0.13), color: W, matrix: M(0, 0.94, -0.16, 0.7, 0, 0), mask: 1 });
    parts.push({ geo: new THREE.BoxGeometry(0.055, 0.50, 0.032), color: 0xd8dde3, matrix: M(0.275, 0.47, 0.07) });
    parts.push({ geo: new THREE.BoxGeometry(0.018, 0.44, 0.04), color: 0xb0b8c2, matrix: M(0.275, 0.47, 0.07) });
    parts.push({ geo: new THREE.BoxGeometry(0.18, 0.045, 0.055), color: W, matrix: M(0.275, 0.23, 0.07), mask: 2 });          // crossguard = RANK
    parts.push({ geo: new THREE.BoxGeometry(0.045, 0.10, 0.045), color: 0x6b5137, matrix: M(0.275, 0.175, 0.07) });
    parts.push({ geo: new THREE.CylinderGeometry(0.155, 0.155, 0.04, 8), color: steel, matrix: M(-0.26, 0.37, 0.09, Math.PI / 2, 0, 0) });
    parts.push({ geo: new THREE.TorusGeometry(0.155, 0.028, 3, 8), color: W, matrix: M(-0.26, 0.37, 0.10), mask: 2 });        // shield rim = RANK
    parts.push({ geo: new THREE.BoxGeometry(0.075, 0.075, 0.05), color: 0xd8dde3, matrix: M(-0.26, 0.37, 0.115) });
    parts.push({ geo: new THREE.CylinderGeometry(0.135, 0.135, 0.035, 8), color: steel, matrix: M(0, 0.40, -0.145, Math.PI / 2, 0, 0) });
    parts.push({ geo: new THREE.TorusGeometry(0.135, 0.022, 3, 8), color: W, matrix: M(0, 0.40, -0.155), mask: 2 });          // back rim = RANK
    return parts;
  }
  /** ONE rank pip. Rank r draws r of these, at anchors pip0..pip3. */
  function knightPipParts() {
    return [{ geo: new THREE.BoxGeometry(0.042, 0.042, 0.03), color: 0xffffff, matrix: M(-0.055, 0.475, 0.125), mask: 2 }];
  }

  /* ==================================================================== */
  /* MESH ASSEMBLY                                                        */
  /* ==================================================================== */

  /** Split a part list into the two base meshes (plain + tinted-white) plus
   * ONE unlit mask mesh, so per-part emissive can differ inside one rig node. */
  function buildTriplet(parts) {
    const plain = parts.filter((p) => !p.mask);
    const tint = parts.filter((p) => !!p.mask);
    const out = { plain: null, tint: null, mask: null, tris: 0 };
    const lambert = (emissive) => new THREE.MeshLambertMaterial({
      color: 0xffffff, vertexColors: true, emissive: emissive,
    });
    if (plain.length) {
      const g = mergeColored(plain.map(cloneSpec));
      out.plain = new THREE.Mesh(g, lambert(serfEmissive()));
    }
    if (tint.length) {
      /* tinted regions bake with NO emissive lift; the runtime adds the lift
       * back through `tintEmissive` so the tinted pixel is EXACT, not
       * `emissive * (1 - tint)` too dark. See the manifest's `tintFormula`. */
      const g = mergeColored(tint.map(cloneSpec));
      out.tint = new THREE.Mesh(g, lambert(new THREE.Color(0, 0, 0)));
    }
    const maskSpecs = parts.map((p) => ({
      geo: p.geo, matrix: p.matrix,
      color: p.mask === 1 ? 0xff0000 : p.mask === 2 ? 0x00ff00 : 0x000000,
    }));
    out.mask = new THREE.Mesh(mergeColored(maskSpecs.map(cloneSpec)),
      new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }));
    [out.plain, out.tint, out.mask].forEach((m) => {
      if (!m) return;
      const g = m.geometry;
      if (m !== out.mask) out.tris += g.attributes.position.count / 3;
    });
    return out;
  }
  function cloneSpec(p) { return { geo: p.geo, color: p.color, matrix: p.matrix }; }

  /** the leg pair, from the FROZEN builders — one shared geometry per kind. */
  function legMeshes(kind) {
    const geo = kind === "knight" ? FSM.knightLegGeo() : FSM.serfLegGeo();
    const lam = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, emissive: serfEmissive() });
    /* a leg carries no team/rank region, so its mask is solid black */
    const n = geo.attributes.position.count;
    const black = new THREE.BufferGeometry();
    black.setAttribute("position", geo.attributes.position);
    black.setAttribute("normal", geo.attributes.normal);
    black.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return {
      base: () => new THREE.Mesh(geo, lam),
      mask: () => new THREE.Mesh(black, new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true })),
      tris: n / 3,
    };
  }

  /**
   * The poseable rig, wired exactly like the game draws it:
   *   root -> bodyPivot(position (0,bob,0), rotation Euler(rx, az+twist, rz))
   *             -> body meshes + overlay meshes (rigid to the torso)
   *             -> hipL/hipR(position (+-hipX,hipY,0), rotation.x = a)
   *                  -> leg mesh
   * Everything below bodyPivot inherits its yaw/lean/bob for free, which is
   * precisely what pushLegs relies on.
   */
  B.makeRig = function (kind, opts) {
    opts = opts || {};
    const isKnight = kind === "knight";
    const allParts = isKnight ? knightBodyParts() : serfBodyParts();
    /* batch #4: parts flagged `arm: ±1` build their own triplet and hang off a
     * SHOULDER group, so the carry pose and the tool swing have something to
     * rotate. A part list with no arm flags (the knight) behaves exactly as it
     * always did — one triplet, no shoulders. */
    const parts = allParts.filter((p) => !p.arm);
    const armParts = { "-1": allParts.filter((p) => p.arm === -1), 1: allParts.filter((p) => p.arm === 1) };
    const trip = buildTriplet(parts);
    const legs = legMeshes(kind);
    const root = new THREE.Group();
    const bodyPivot = new THREE.Group();
    root.add(bodyPivot);
    const baseGroup = new THREE.Group(), maskGroup = new THREE.Group();
    bodyPivot.add(baseGroup); bodyPivot.add(maskGroup);
    if (trip.plain) baseGroup.add(trip.plain);
    if (trip.tint) baseGroup.add(trip.tint);
    maskGroup.add(trip.mask);
    const shoulders = [];
    let armTris = 0;
    for (const key of ["-1", "1"]) {
      if (!armParts[key].length) continue;
      const s = +key;
      const at = buildTriplet(armParts[key]);
      const sh = new THREE.Group();
      sh.position.set(s * SERF_SHOULDER.x, SERF_SHOULDER.y, SERF_SHOULDER.z);
      sh.userData.side = s;
      if (at.plain) { baseGroup.add(sh); sh.add(at.plain); }
      if (at.tint) sh.add(at.tint);
      if (at.mask) { at.mask.userData.isMask = true; sh.add(at.mask); }
      if (!sh.parent) baseGroup.add(sh);
      shoulders.push(sh);
      armTris += at.tris;
    }

    const hipX = isKnight ? KNIGHT_HIP_X : SERF_HIP_X;
    const hipY = isKnight ? KNIGHT_HIP_Y : SERF_HIP_Y;
    const hips = [];
    for (let s = -1; s <= 1; s += 2) {
      const h = new THREE.Group();
      h.position.set(s * hipX, hipY, 0);
      h.userData.side = s;
      const lb = legs.base(); baseGroup.add(h); h.add(lb);
      const lm = legs.mask(); h.add(lm); lm.userData.isMask = true;
      hips.push(h);
    }
    /* the mask pass hides base meshes and shows mask meshes (and vice versa),
     * so ONE rig produces both sheets from identical transforms. */
    const tmpW = new THREE.Vector3();
    return {
      root, bodyPivot, hips, baseGroup, maskGroup, shoulders,
      tris: Math.round(trip.tris + armTris + legs.tris * 2),
      setMask(on) {
        baseGroup.traverse((o) => { if (o.isMesh) o.visible = o.userData.isMask ? on : !on; });
        maskGroup.visible = on;
      },
      /* THE TOOL AND THE LOAD RIDE THE POSED ARMS (batch #4). Both were fixed
       * body-local points before, which was correct while the arms were welded
       * into the torso and is a hand hanging in mid-air now that they are not.
       *  · `tool`  — the hand that holds it (right arm, side +1)
       *  · `hands` — the point BETWEEN the two hands, a little in front, which
       *              is where a carried good sits
       *  · `toolTip` — one point further along the tool's own shaft, so the
       *              bake can measure the screen angle to rotate the overlay by
       */
      anchorWorld(name) {
        if (!shoulders.length) return null;
        const R = shoulders.find((s) => s.userData.side === 1);
        const L = shoulders.find((s) => s.userData.side === -1);
        /* SHOULDER-LOCAL points. `tool` is ANCHOR_SERF.tool re-expressed
         * relative to the shoulder, NOT the hand centre — at rest it therefore
         * projects to exactly the pixel it always did, so nothing about an
         * idle or walking serf's tool moves; only a posed arm carries it. */
        const toolLocal = () => new THREE.Vector3(
          ANCHOR_SERF.tool[0] - SERF_SHOULDER.x,
          ANCHOR_SERF.tool[1] - SERF_SHOULDER.y,
          ANCHOR_SERF.tool[2] - SERF_SHOULDER.z);
        const handLocal = (s) => new THREE.Vector3(
          s * 0.187 - s * SERF_SHOULDER.x, 0.293 - SERF_SHOULDER.y, 0.018 - SERF_SHOULDER.z);
        if (name === "offhand" && L) return L.localToWorld(handLocal(-1));
        if (name === "tool" && R) return R.localToWorld(toolLocal());
        if (name === "toolTip" && R) return R.localToWorld(toolLocal().add(new THREE.Vector3(0, 0.30, 0)));
        if (name === "hands" && R && L) {
          const a = R.localToWorld(handLocal(1)), b = L.localToWorld(handLocal(-1));
          // …and a little ABOVE the fists: a load rests ON the hands
          return a.add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.05, 0));
        }
        return null;
      },
      _tmpW: tmpW,
    };
  };

  /** an overlay rig: the overlay alone, parented to a body pivot that is posed
   * identically to the body's, so the overlay sees the same torso transform. */
  B.makeOverlayRig = function (parts) {
    const trip = buildTriplet(parts);
    const root = new THREE.Group();
    const bodyPivot = new THREE.Group();
    root.add(bodyPivot);
    const baseGroup = new THREE.Group(); bodyPivot.add(baseGroup);
    if (trip.plain) baseGroup.add(trip.plain);
    if (trip.tint) baseGroup.add(trip.tint);
    return { root, bodyPivot, hips: [], tris: Math.round(trip.tris), setMask() {} };
  };

  /* ==================================================================== */
  /* POSES — pure functions of the game's own animation variables          */
  /* ==================================================================== */

  /** fs-render swingShape(), for reference/verification. The bake indexes work
   * frames by the SWING VALUE (0..1) because the pose is a pure function of it. */
  B.swingShape = function (rem, period) {
    const p = period || 8;
    let w = 1 - ((rem % p) + p) % p / p;
    if (!isFinite(w)) w = 0;
    const RAISE = 0.72;
    return w < RAISE ? (w / RAISE) : Math.max(0, 1 - (w - RAISE) / (1 - RAISE));
  };

  /* ═══ IDLE VARIANTS (playtest 2026-08-02) ═══════════════════════════════
   * A settler waiting at a flag used to be one frame — a statue, and a crowd of
   * them at a busy junction read as a shop-window display. Three slow loops now
   * give the standing workforce some life:
   *
   *   0  weight shift   rock from one foot to the other
   *   1  look around    turn the torso, hold, turn back
   *   2  small stretch   ease up onto the toes and settle
   *
   * They are expressed ENTIRELY in the pose scalars both rigs already honour
   * (bob / rx / twist / rz / stride / brace), so the skinned dwarf gets them
   * from bone rotations and the rigid minifig from its hip groups with no rig
   * change on either side.
   *
   * DELIBERATELY BOLDER THAN "REALISTIC": a serf is ~26 px tall at the default
   * zoom, so a 1° lean is a third of a pixel and would read as nothing at all.
   * These are 3-5°, which moves a head by about a pixel at play zoom and reads
   * as breathing rather than as dancing — and the renderer cycles them over
   * ~4 seconds, which is what keeps it calm.
   *
   * Frame 0 of variant 0 is the ORIGINAL neutral idle, exactly, so anything
   * that wants "a serf standing still" (the film strips, a paused world, the
   * carry-height anchor) still has it at the same address it always had. */
  const IDLE_VARIANTS = [
    // weight shift: neutral · onto the left foot · onto the right foot
    [{}, { rz: 0.055, twist: 0.05, bob: -0.012 }, { rz: -0.055, twist: -0.05, bob: -0.012 }],
    // look around: neutral · turn away · turn back past centre
    [{}, { twist: 0.24, rz: 0.018 }, { twist: -0.18, rz: -0.014 }],
    // small stretch: neutral · up onto the toes, chest open · settle
    [{}, { bob: 0.045, rx: -0.075 }, { bob: 0.012, rx: 0.030 }],
  ];
  B.IDLE_VARIANTS = IDLE_VARIANTS;
  B.idleFrameCount = function () {
    let n = 0;
    for (const v of IDLE_VARIANTS) n += v.length;
    return n;
  };
  /** k -> {variant, step, pose} over the flattened idle rows */
  function idleAt(k) {
    let i = 0;
    for (let v = 0; v < IDLE_VARIANTS.length; v++) {
      for (let s = 0; s < IDLE_VARIANTS[v].length; s++, i++) {
        if (i === k) return { variant: v, step: s, p: IDLE_VARIANTS[v][s] };
      }
    }
    return { variant: 0, step: 0, p: {} };
  }
  B.idleAt = idleAt;

  /** drawSerf + pushLegs, verbatim. Returns the pose scalars for one frame. */
  function serfPose(pose, k, cfg) {
    if (pose === "idle") {
      const it = idleAt(k);
      const p = it.p;
      return {
        bob: p.bob || 0, rx: p.rx || 0, twist: p.twist || 0, rz: p.rz || 0,
        stride: p.stride || 0, brace: 0,
        meta: { variant: it.variant, step: it.step },
      };
    }
    if (pose === "walk") {
      const phase = (k / cfg.walkFrames) * Math.PI * 2;
      const step = Math.sin(phase);
      return {
        bob: Math.abs(Math.cos(phase)) * BOB_WALK,
        rx: 0.06, twist: step * 0.10, rz: -step * 0.055,
        /* the empty-handed walk keeps its arms swinging against the legs —
         * armX is the SHOULDER's forward rotation, +x = forward */
        stride: step, brace: 0, armX: -step * ARM_SWING, armXR: step * ARM_SWING,
        armOut: 0, meta: { phase: round4(phase), step: round4(step) },
      };
    }
    /* ═══ CARRY (batch #4, 2026-08-02) ═════════════════════════════════════
     * A settler hauling a good used to walk the ORDINARY walk cycle with the
     * load balanced on top of his head — hands swinging free at his sides,
     * cargo floating above his cap. He carries it in front of him now: both
     * arms out, elbows a little apart, and the good sits ON his hands.
     *
     * It is the walk cycle in every other respect (same phase, same bob, same
     * stride, same roll), so a carrier and an empty-handed serf move at the
     * same gait; only the arms and a slightly straighter back differ. The arm
     * pose is CONSTANT across the cycle — a man carrying a crate does not
     * swing it — which is also what makes the new `hands` anchor smooth.
     */
    if (pose === "carry") {
      const phase = (k / cfg.walkFrames) * Math.PI * 2;
      const step = Math.sin(phase);
      return {
        bob: Math.abs(Math.cos(phase)) * BOB_WALK,
        rx: 0.02, twist: step * 0.05, rz: -step * 0.045,
        stride: step, brace: 0,
        armX: ARM_CARRY, armXR: ARM_CARRY, armOut: ARM_CARRY_OUT, armBend: ARM_CARRY_BEND,
        meta: { phase: round4(phase), step: round4(step) },
      };
    }
    /* ═══ WORK = A TOOL SWING (batch #4, 2026-08-02) ═══════════════════════
     * The work cycle used to be the torso alone: pitch forward by swing*0.42,
     * bob, brace the legs — a man bowing at his work, with his tool welded to
     * his hip. The arms move now: they RAISE the tool overhead on the way up
     * and STRIKE down through the bottom of the arc, and the manifest carries
     * the screen-space angle of that arc per frame so the tool overlay sweeps
     * with the hand (see toolAxisWorld / the renderer's aRot attribute).
     *
     * `swing` runs 0 (tool at rest, low) → 1 (fully raised) and the renderer
     * indexes frames by it, so the RAISE occupies most of the cycle and the
     * strike is the fast return — which is exactly how serfSwing's shape
     * already drives it (RAISE 0.72 of the period, then a quick fall).
     */
    const swing = cfg.workFrames > 1 ? k / (cfg.workFrames - 1) : 0;
    return {
      bob: swing * BOB_WORK,
      /* the torso still leans, but only half as far: the arms are doing the
       * work now, and a 24° bow ON TOP of a raised tool folds him in half */
      rx: -swing * 0.21, twist: 0, rz: 0,
      stride: 0, brace: swing,
      /* THE TOOL ARM (armXR, side +1 — the hand the tool anchor comes off)
       * carries the whole stroke, backwards past vertical at the top of the
       * raise. The OFF HAND (armX) only counterbalances: it drifts the other
       * way by at most 0.28 rad against the tool arm's 2.05. Batch #4 gave
       * both arms the same scalar and the result was a man striking with two
       * mirrored empty fists. */
      armXR: -ARM_WORK_LO - swing * (ARM_WORK_HI - ARM_WORK_LO),
      armX: ARM_OFF_BASE + swing * ARM_OFF_SWING,
      /* THE TOOL ARM SPLAYS AS IT RISES, and that is not decoration. The raise
       * is a rotation in the SAGITTAL plane, so from dead ahead or dead behind
       * (azimuths 0 and 8) it is pure foreshortening and the whole swing reads
       * as a man standing still — which is exactly what the first bake's
       * contact sheet showed. Opening the elbow out as the tool goes up puts
       * lateral travel into every azimuth. The off hand stays where it is. */
      armOutR: 0.10 + swing * 0.45,
      armOut: ARM_OFF_OUT,
      meta: { swing: round4(swing) },
    };
  }

  /** knightVisual + duelPose, verbatim. */
  function knightPose(pose, k, cfg) {
    if (pose === "guard") return { bob: 0, rx: 0, twist: 0, rz: 0, stride: 0, brace: 0, meta: { l: 0 } };
    if (pose === "walk") {
      const phase = (k / cfg.walkFrames) * Math.PI * 2;
      const step = Math.sin(phase);
      return {
        bob: Math.abs(Math.cos(phase)) * BOB_WALK,
        rx: 0, twist: step * 0.09, rz: -step * 0.05,
        stride: step, brace: 0, meta: { phase: round4(phase), step: round4(step) },
      };
    }
    // fight: knightVisual with duelPose's `l`. The world-space lunge translation
    // (l * 0.34 toward the foe) is NOT baked — the integration applies it.
    const l = cfg.fightL[k];
    const lunge = l * 0.34;
    return {
      bob: Math.max(0, l) * 0.16, rx: lunge * 1.5, twist: 0, rz: -lunge * 0.45,
      stride: -l * 0.55, brace: 0, meta: { l: round4(l), lungeOffset: round4(lunge) },
    };
  }
  B.serfPose = serfPose; B.knightPose = knightPose;

  /** apply a pose + an azimuth to a rig. `az` is the unit's world facing yaw.
   * A rig may own its posing (the skinned dwarf/knight rotate BONES rather than
   * rigid hip groups); everything else about the bake is identical either way. */
  B.applyPose = function (rig, p, az) {
    if (rig.applyPose) { rig.applyPose(p, az); return; }
    rig.bodyPivot.position.set(0, p.bob, 0);
    rig.bodyPivot.rotation.set(p.rx, az + p.twist, p.rz);   // Euler XYZ, as tmpE.set()
    for (let i = 0; i < rig.hips.length; i++) {
      const s2 = rig.hips[i].userData.side;
      // pushLegs: a = stride * LEG_SWING * (s2 < 0 ? 1 : -1) + brace * 0.22 * s2
      rig.hips[i].rotation.x = p.stride * LEG_SWING * (s2 < 0 ? 1 : -1) + p.brace * 0.22 * s2;
    }
    /* batch #4: the shoulders. `armX` is the LEFT arm's forward rotation and
     * `armXR` the right's (they differ only on the walk, where they counter-
     * swing), and `armOut` rolls both a little outward so a two-armed carry is
     * not one plank. Rotation.x is forward here for the same reason the hips
     * use it: the body's local +z faces the way he does. */
    const list = rig.shoulders || [];
    for (let i = 0; i < list.length; i++) {
      const s2 = list[i].userData.side;
      const fwd = s2 < 0 ? (p.armX || 0) : (p.armXR === undefined ? (p.armX || 0) : p.armXR);
      const out = s2 < 0 ? (p.armOut || 0)
        : (p.armOutR === undefined ? (p.armOut || 0) : p.armOutR);
      /* ═══ BOTH SIGNS ARE FLIPPED HERE (batch #5, 2026-08-02) ═══════════════
       * MEASURED, not derived, the same way DK.armSignX was. This minifig
       * faces +Z and the bake's camera stands on +Z, so an arm swung the way
       * the pose MEANT by "forward" should project DOWN the cell at azimuth 0
       * and UP at azimuth 8. It did the exact opposite: the carry pose's
       * `hands` anchor peaked at 0.469 world units at azimuth 0 and bottomed
       * at 0.175 at azimuth 8 — the mirror image of the skinned dwarf, whose
       * sign batch #4 had already corrected. So on this rig every arm has
       * been swinging BEHIND him since the arms were separated: the carry held
       * its load at his back (which is why the good then had to be shoved down
       * to meet it), the walk counter-swung the wrong way, and the tool went
       * up in FRONT of the shoulder instead of over it.
       *   · rotation.x — a positive Euler-X on a limb hanging at −Y sends it
       *     to −Z, i.e. away from the face. Negate, and +armX is forward.
       *   · rotation.z — `armOut` was pulling the elbows IN (the +X arm moved
       *     toward −X). Negate, and "out" is out, as it already is on the
       *     dwarf's shoulder drop. */
      list[i].rotation.set(-fwd, 0, s2 * out);
    }
    rig.root.updateMatrixWorld(true);
  };

  function round4(v) { return Math.round(v * 1e4) / 1e4; }
  function round2(v) { return Math.round(v * 100) / 100; }
  /** a copy of a pose with every ARM scalar zeroed (the overlay bake's frame) */
  function noArms(p) {
    return Object.assign({}, p, { armX: 0, armXR: 0, armOut: 0, armOutR: 0, armBend: 0 });
  }
  B.noArms = noArms;

  /** the pose plan for a subject: [{ pose, frames:[{k, meta}] }] */
  B.poseList = function (kind, cfg) {
    if (kind === "knight") {
      return [
        { pose: "guard", n: 1 },
        { pose: "walk", n: cfg.walkFrames },
        { pose: "fight", n: cfg.fightL.length },
      ];
    }
    return [
      /* idle is a BLOCK of variants now (see IDLE_VARIANTS); frame 0 is still
       * the original neutral stance, at the same row it has always been. */
      { pose: "idle", n: cfg.idleFrames || B.idleFrameCount() },
      { pose: "walk", n: cfg.walkFrames },
      { pose: "work", n: cfg.workFrames },
      /* CARRY goes LAST on purpose (batch #4): every existing row keeps the
       * address it has always had, so an old manifest and a new one agree on
       * every idle/walk/work row and only the sheet grows. */
      { pose: "carry", n: cfg.walkFrames },
    ];
  };

  /* ==================================================================== */
  /* THE BAKE                                                             */
  /* ==================================================================== */

  /* ═══ THE KEY LIGHT IS CAMERA-RELATIVE (2026-08-01, yaw unlocked) ════════
   * The camera turns again, so a cell is indexed by (facing − cameraYaw) and one
   * cell must serve EVERY (facing, camera) pair with that difference. A
   * Δ-indexed atlas provably cannot carry a world-fixed sun (VIABILITY.md said
   * so before Fork B ever locked the yaw), so the key is declared in CAMERA
   * space and the manifest says `mode:"camera-relative"`.
   *
   * WHY THE DIRECTION IS WHAT IT IS. The bake camera stands still at
   * `cameraYaw` while the MODEL turns, so any world-fixed light is already
   * fixed relative to the camera — re-deriving it in camera space is a
   * declaration, not a pixel change, and that is the point: the shipped
   * direction is the world sun's OWN camera-space direction at yaw 0. The cast
   * therefore lights EXACTLY like the terrain and the buildings at the home
   * yaw, and drifts from them as you turn — a 2.5D compromise, bounded by the
   * horizontal share of the sun vector (|h| = 0.546 of a unit sun here; the
   * vertical share and the whole hemisphere are yaw-invariant by construction).
   * KEY_YAW_MIX is the lever if that drift ever reads badly: 0 flattens the key
   * to straight overhead (no contradiction at any yaw, flatter form), 1 keeps
   * the world sun's full lateral throw. Measured before shipping — see the
   * CLAUDE.md entry for the sprite-vs-mesh sweep across 8 camera yaws.
   */
  const KEY_YAW_MIX = 1.0;
  function keyDirCamera(cfg) {
    /* the world sun, expressed in the bake camera's own frame (which is the
     * frame every cell is drawn in). Undo the camera yaw about Y, keep the
     * elevation, then scale the horizontal throw by KEY_YAW_MIX. */
    const d = new THREE.Vector3(0.55, 1.0, 0.35);
    const az = cfg.cameraYaw;
    const c = Math.cos(-az), s = Math.sin(-az);
    const x = d.x * c + d.z * s, z = -d.x * s + d.z * c;
    return new THREE.Vector3(x * KEY_YAW_MIX, d.y, z * KEY_YAW_MIX);
  }
  /** the game's lighting rig, with the KEY (and its fill) pinned to the camera. */
  function makeLights(scene, cfg) {
    const V = FSC.VIS;
    const hemi = new THREE.HemisphereLight(V.HEMI_SKY, V.HEMI_GND, V.HEMI_I);
    scene.add(hemi);
    const k = keyDirCamera(cfg || { cameraYaw: 0 });
    const sun = new THREE.DirectionalLight(V.SUN_COL, V.SUN_I);
    sun.position.copy(k).multiplyScalar(100);
    scene.add(sun);
    const f = new THREE.Vector3(-0.6, 0.45, -0.55);
    const fill = new THREE.DirectionalLight(V.FILL_COL, V.FILL_I);
    fill.position.set(f.x * KEY_YAW_MIX, f.y, f.z * KEY_YAW_MIX).multiplyScalar(100);
    scene.add(fill);
    return { hemi, sun, fill, keyDir: [round4(k.x), round4(k.y), round4(k.z)] };
  }
  B.KEY_YAW_MIX = KEY_YAW_MIX;
  B.keyDirCamera = keyDirCamera;

  /** the ONE bake camera: fixed at the locked yaw + the game's resting pitch. */
  function makeCamera(cfg) {
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    const pitch = cfg.pitchDeg * DEG, az = cfg.cameraYaw, R = 6;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    cam.position.set(Math.sin(az) * cp * R, sp * R, Math.cos(az) * cp * R);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    return cam;
  }

  /**
   * EXACT camera-space silhouette bounds of an object.
   *
   * The obvious implementation — Box3.setFromObject then project the 8 corners
   * — is badly wrong for a subject that ROTATES through the azimuth grid: the
   * world AABB of a yawed knight is a square of side 2*maxRadius, and its
   * corners are empty air. Projecting them inflated the shared frustum by ~70%
   * and left the serf filling 40% of his cell. Projecting the real vertices
   * costs ~1400 points per pose and is exact.
   */
  const _inv = new THREE.Matrix4(), _pv = new THREE.Vector3(), _mm = new THREE.Matrix4();
  /* TWO READING RULES, both learned the hard way and both load-bearing:
   *  · getX/getY/getZ, never raw `.array` indexing. An externally-authored GLB
   *    can INTERLEAVE POSITION+NORMAL+TEXCOORD into one bufferView (byteStride
   *    32), and THREE parses that into an InterleavedBufferAttribute whose
   *    `.array` is the whole interleaved run — `arr[i*3]` then reads a
   *    cascading mix of position/normal/uv floats. It silently blew the locked
   *    scale out ~3.4× in the 2026-08-01 look test. getX/Y/Z are stride-aware
   *    on every BufferAttribute subtype.
   *  · a SkinnedMesh's position attribute is the BIND pose. Bounds for a posed
   *    skinned body have to go through boneTransform, or an arms-down villager
   *    measures as a T-posed starfish. */
  function camBox(cam, obj, acc) {
    _inv.copy(cam.matrixWorld).invert();
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh || o.visible === false) return;
      const pos = o.geometry.attributes.position;
      if (!pos) return;
      _mm.multiplyMatrices(_inv, o.matrixWorld);
      const skinned = o.isSkinnedMesh && o.skeleton && o.boneTransform;
      for (let i = 0; i < pos.count; i++) {
        if (skinned) { _pv.set(pos.getX(i), pos.getY(i), pos.getZ(i)); o.boneTransform(i, _pv); _pv.applyMatrix4(_mm); }
        else _pv.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(_mm);
        if (_pv.x < acc.xmin) acc.xmin = _pv.x; if (_pv.x > acc.xmax) acc.xmax = _pv.x;
        if (_pv.y < acc.ymin) acc.ymin = _pv.y; if (_pv.y > acc.ymax) acc.ymax = _pv.y;
      }
    });
    return acc;
  }
  function newAcc() { return { xmin: 1e9, xmax: -1e9, ymin: 1e9, ymax: -1e9 }; }

  /** project a WORLD point to camera space (x right, y up, both in world units) */
  function camPoint(cam, v, out) {
    _inv.copy(cam.matrixWorld).invert();
    out.copy(v).applyMatrix4(_inv);
    return out;
  }

  /* ---------------------------------------------------------------- */
  /**
   * bakeAll(renderer, cfg) -> { manifest, sheets: {name: {w,h,rgba}} }
   * Synchronous for `source:"minifig"`; the villager path is async and returns
   * a promise (see B.bakeAllAsync).
   */
  B.bakeAll = function (renderer, userCfg) {
    const cfg = Object.assign({}, B.DEFAULTS, userCfg || {});
    if (cfg.source !== "minifig") {
      throw new Error("bakeAll: source '" + cfg.source + "' is async — call FSCastBake.bakeAllAsync()");
    }
    const t0 = performance.now();
    const A = cfg.azimuths;
    const cam = makeCamera(cfg);
    const scene = new THREE.Scene();
    scene.background = null;
    const lights = makeLights(scene, cfg);

    /* ---- subjects ------------------------------------------------------
     * Everything below is driven off cfg.subjectKinds / cfg.rigFactory, which
     * is the whole model-agnostic switch: re-point those two and the azimuth
     * grid, the locked scale, the pose maths, the anchor projection and the
     * manifest all carry over unchanged. */
    const kinds = cfg.subjectKinds || ["serf", "knight"];
    const makeSubjectRig = cfg.rigFactory || B.makeRig;
    const bodies = kinds.map((k) => ({ kind: k, rig: makeSubjectRig(k, cfg) }));
    const overlays = [];
    if (cfg.bakeOverlays !== false) {
      /* A different body wants the SAME overlay geometry at a different size —
       * a cap cut for the minifig's 0.112-radius skull is a beanie on a cartoon
       * dwarf's head. Scaling is done ABOUT THE OVERLAY'S OWN PIVOT so the
       * anchor arithmetic downstream is untouched: only the drawn size changes,
       * never where it hangs. */
      const os = cfg.overlayScale || {};
      const fitOv = (parts, pivot, k) => {
        if (!k || k === 1) return parts;
        const T = new THREE.Matrix4().makeTranslation(pivot[0], pivot[1], pivot[2])
          .multiply(new THREE.Matrix4().makeScale(k, k, k))
          .multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
        return parts.map((p) => Object.assign({}, p, { matrix: T.clone().multiply(p.matrix || new THREE.Matrix4()) }));
      };
      const PV = Object.assign({ hat: ANCHOR_SERF.hat, pack: ANCHOR_SERF.pack, tool: ANCHOR_SERF.tool, pip: ANCHOR_KNIGHT.pip0 },
        cfg.overlayPivots || {});
      overlays.push({ id: "hat", tint: "job", rig: B.makeOverlayRig(fitOv(serfHatParts(), PV.hat, os.hat)), pivot: PV.hat, host: "serf" });
      overlays.push({ id: "pack", tint: null, rig: B.makeOverlayRig(fitOv(serfPackParts(), PV.pack, os.pack)), pivot: PV.pack, host: "serf" });
      for (const t of cfg.tools) {
        overlays.push({ id: "tool_" + t, tint: null, rig: B.makeOverlayRig(fitOv(serfToolParts(t), PV.tool, os.tool)), pivot: PV.tool, host: "serf" });
      }
      overlays.push({ id: "pip", tint: "rank", rig: B.makeOverlayRig(fitOv(knightPipParts(), PV.pip, os.pip)), pivot: PV.pip, host: "knight" });
    }

    /* ---- ONE LOCKED WORLD SCALE ----------------------------------------
     * Union of every body's camera-space AABB over every pose x azimuth
     * (overlays are inside the bodies' envelope by construction, but they are
     * measured too so nothing can ever fall outside). */
    const acc = newAcc();
    for (const b of bodies) {
      for (const row of B.poseList(b.kind, cfg)) {
        for (let k = 0; k < row.n; k++) {
          const p = b.kind === "knight" ? knightPose(row.pose, k, cfg) : serfPose(row.pose, k, cfg);
          for (let a = 0; a < A; a++) {
            B.applyPose(b.rig, p, (a / A) * Math.PI * 2);
            camBox(cam, b.rig.root, acc);
          }
        }
      }
    }
    let cx = (acc.xmin + acc.xmax) / 2, cy = (acc.ymin + acc.ymax) / 2;
    let S = Math.max(acc.xmax - acc.xmin, acc.ymax - acc.ymin) / 2;
    S = S / (1 - 2 * cfg.pad);
    /* A SECOND look baked into the SAME frustum as the first composes with the
     * first look's overlay sheet and needs no renderer changes at all: same
     * px-per-unit, same footPx, same anchor arithmetic. Fitting is then an
     * ASSERTION rather than a measurement — if the new bodies do not fit the
     * inherited frustum the bake must fail loudly, not silently clip a plume. */
    let fitReport = null;
    if (cfg.lockFrustum) {
      const L = cfg.lockFrustum;
      const overflow = Math.max(
        (L.cx - L.halfSpan) - acc.xmin, acc.xmax - (L.cx + L.halfSpan),
        (L.cy - L.halfSpan) - acc.ymin, acc.ymax - (L.cy + L.halfSpan));
      fitReport = {
        locked: true, wouldHaveBeen: { cx: round4(cx), cy: round4(cy), halfSpan: round4(S) },
        overflowUnits: round4(overflow), fillFrac: round4(Math.max(acc.xmax - acc.xmin, acc.ymax - acc.ymin) / (2 * L.halfSpan)),
      };
      if (overflow > 0) throw new Error("lockFrustum: subject overflows the inherited frustum by " +
        overflow.toFixed(4) + " camera units — rebake with its own fit or shrink the model");
      cx = L.cx; cy = L.cy; S = L.halfSpan;
    }
    const pxPerUnit = cfg.bodyCell / (2 * S);     // THE locked scale, px per camera-space unit

    /* where the ground point (world origin) lands inside a body cell — constant
     * for every cell by construction, which is the "fixed feet baseline row". */
    const gp = camPoint(cam, new THREE.Vector3(0, 0, 0), new THREE.Vector3());
    const footPx = {
      x: round2((gp.x - (cx - S)) * pxPerUnit),
      y: round2(cfg.bodyCell - (gp.y - (cy - S)) * pxPerUnit),   // PNG rows run downward
    };

    /* ---- sheet allocation ------------------------------------------ */
    const sheets = {};
    function newSheet(name, w, h) {
      sheets[name] = { w, h, rgba: null, rt: null };
      return sheets[name];
    }
    const mdiv = (k) => (typeof cfg.maskDiv === "number" ? cfg.maskDiv : (cfg.maskDiv[k] || 1));
    const mCellOf = (k) => cfg.bodyCell / mdiv(k);
    const rowsOf = {};
    for (const k of kinds) {
      rowsOf[k] = countRows(B.poseList(k, cfg));
      newSheet(k + "-body", A * cfg.bodyCell, rowsOf[k] * cfg.bodyCell);
      newSheet(k + "-mask", A * mCellOf(k), rowsOf[k] * mCellOf(k));
    }

    /* overlays: a flat cell allocator (cols x rows of overlayCell), because a
     * per-kind block layout wastes space the moment kinds differ in row count */
    const ovRows = 1 + cfg.workFrames;      // "hold" (idle+walk share it) + work/fight
    const ovCells = overlays.length * A * ovRows;
    const ovCols = cfg.overlayCols;
    const ovRowsTotal = Math.max(1, Math.ceil(ovCells / ovCols));
    if (overlays.length) newSheet("overlays", ovCols * cfg.overlayCell, ovRowsTotal * cfg.overlayCell);

    /* ---- render ---------------------------------------------------- */
    const saved = pushRendererState(renderer);
    const manifest = {
      schema: "farmstead-cast-sprites/1",
      generated: new Date().toISOString().slice(0, 19) + "Z",
      sourceModel: cfg.source,
      note: "FREE-YAW camera (2026-08-01). Frame index = RELATIVE azimuth: unit facing yaw " +
        "MINUS the LIVE camera yaw, plus the bake's own cameraYaw. The key light is baked " +
        "CAMERA-RELATIVE, which is what makes one cell legal for every (facing, camera) pair " +
        "that shares a difference.",
      bake: {
        azimuths: A,
        azimuthStepDeg: round4(360 / A),
        azimuthOrder: "index a = round(wrap(facingYaw - cameraYawLive + cameraYaw) / (2PI/A)) mod A; a=0 faces the camera",
        cameraYaw: round4(cfg.cameraYaw),
        pitchDeg: cfg.pitchDeg,
        pitchSource: "FSC.CAM.PITCH_START",
        projection: "orthographic",
        pxPerCameraUnit: round2(pxPerUnit),
        bodyCell: cfg.bodyCell,
        overlayCell: cfg.overlayCell,
        maskDiv: { serf: mdiv("serf"), knight: mdiv("knight") },
        pad: cfg.pad,
        frustum: { cx: round4(cx), cy: round4(cy), halfSpan: round4(S) },
        lighting: {
          /* the field the runtime ASSERTS against (fs-render): a free-yaw camera
           * may only draw camera-relative sheets, and a locked-yaw one may only
           * draw world-fixed sheets. Getting this wrong is silent and looks like
           * an art bug, so it is a contract, not a comment. */
          mode: "camera-relative",
          keyYawMix: KEY_YAW_MIX,
          hemi: { sky: FSC.VIS.HEMI_SKY, ground: FSC.VIS.HEMI_GND, intensity: FSC.VIS.HEMI_I },
          sun: { color: FSC.VIS.SUN_COL, intensity: FSC.VIS.SUN_I,
            dirWorld: [0.55, 1.0, 0.35], dirCamera: lights.keyDir },
          fill: { color: FSC.VIS.FILL_COL, intensity: FSC.VIS.FILL_I, dir: [-0.6, 0.45, -0.55] },
          emissive: { of: SERF_EMISSIVE_OF, k: SERF_EMISSIVE_K },
        },
      },
      /* the ONE number every consumer needs: cells are PNG-space, origin top-left */
      footPx: footPx,
      tintFormula: "rgb = base.rgb * mix(vec3(1.0), tint, mask) + tintEmissive * mask;  alpha = base.a",
      tintEmissive: [round4(serfEmissive().r), round4(serfEmissive().g), round4(serfEmissive().b)],
      palettes: {
        team: FSC.PLAYER_COLORS,
        rank: FSC.RANK_COLOR,
        job: FSC.JOB_COLOR,
      },
      sheets: {},
      subjects: {},
      overlays: {},
    };

    /* body + mask sheets */
    for (const b of bodies) {
      const rows = B.poseList(b.kind, cfg);
      const poses = {};
      let rowIdx = 0;
      /* which 3D mount points this subject projects into every cell. Overridable
       * so a different source model can declare its own (or none). */
      const byKind = cfg.anchorsByKind || { serf: ANCHOR_SERF, knight: ANCHOR_KNIGHT };
      const anchorDefs = Object.assign({}, byKind[b.kind] || {});
      for (const row of rows) {
        const frames = [];
        for (let k = 0; k < row.n; k++) {
          const p = b.kind === "knight" ? knightPose(row.pose, k, cfg) : serfPose(row.pose, k, cfg);
          const cells = [];
          const pRest = noArms(p);
          for (let a = 0; a < A; a++) {
            /* THE TOOL ANGLE IS MEASURED AGAINST THIS RIG'S OWN REST ARMS, not
             * against an assumed "the tool points up the body's +Y" (batch #4,
             * and the first cut of it got this wrong). The overlay sheet is
             * baked with the arms at REST, so what the runtime must rotate by
             * is exactly the difference between the posed arm's shaft and the
             * rest arm's shaft — and on the skinned dwarf the rest forearm
             * points DOWN, which made the naive body-local reference come out
             * a constant 155-180° off and swung every axe upside down. */
            let restH = null, restT = null;
            if (b.rig.anchorWorld) {
              B.applyPose(b.rig, pRest, (a / A) * Math.PI * 2);
              const rh = b.rig.anchorWorld("tool", pRest), rt = b.rig.anchorWorld("toolTip", pRest);
              if (rh && rt) {
                restH = projectWorld(cam, rh, cx, cy, S, pxPerUnit, cfg.bodyCell);
                restT = projectWorld(cam, rt, cx, cy, S, pxPerUnit, cfg.bodyCell);
              }
            }
            B.applyPose(b.rig, p, (a / A) * Math.PI * 2);
            const anchors = {};
            for (const name in anchorDefs) {
              /* A rig may resolve an anchor from the POSED SKELETON instead of a
               * fixed body-local point — the tool hand is the one that has to,
               * because the arms move and a static hand anchor would leave the
               * axe hanging in the air beside him. Everything the pose does not
               * move (hat, pack, pips, helm top) stays a body-local point. */
              const w = b.rig.anchorWorld && b.rig.anchorWorld(name, p);
              anchors[name] = w
                ? projectWorld(cam, w, cx, cy, S, pxPerUnit, cfg.bodyCell)
                : projectLocal(cam, b.rig.bodyPivot, anchorDefs[name], cx, cy, S, pxPerUnit, cfg.bodyCell);
            }
            /* the carried good rides in ROOT space (drawSerf puts the crate at
             * world y + bob + 0.86, yaw only — it does NOT follow the torso) */
            anchors.carry = projectWorld(cam, new THREE.Vector3(0, p.bob + CARRY_Y, 0), cx, cy, S, pxPerUnit, cfg.bodyCell);
            const cellOut = { col: a, anchors: anchors };
            /* ═══ THE TOOL'S SCREEN ANGLE (batch #4, 2026-08-02) ════════════
             * The per-job tool overlays are baked ONCE per work frame with the
             * torso's pose and the arms at REST, because re-baking a whole
             * tool sheet per arm angle would multiply the overlay sheet by the
             * frame count. Instead the manifest carries, per cell, the angle
             * the renderer must rotate that overlay quad by ABOUT THE HAND so
             * the tool follows the posed arm — measured here, from the two
             * projections the runtime cannot do for itself:
             *   posed  — hand → a point along the shaft of the tool the POSED
             *            arm is holding;
             *   baked  — the same axis with the arms at rest, which is exactly
             *            what the overlay cell contains.
             * Positive = clockwise on screen (from screen-up toward screen-
             * right), which is the convention the shader's aRot applies. */
            if (b.rig.anchorWorld && restH && restT) {
              const hw = b.rig.anchorWorld("tool", p), tw = b.rig.anchorWorld("toolTip", p);
              if (hw && tw) {
                const ph = projectWorld(cam, hw, cx, cy, S, pxPerUnit, cfg.bodyCell);
                const pt = projectWorld(cam, tw, cx, cy, S, pxPerUnit, cfg.bodyCell);
                const aPosed = Math.atan2(pt.x - ph.x, -(pt.y - ph.y));
                const aRest = Math.atan2(restT.x - restH.x, -(restT.y - restH.y));
                let d = aPosed - aRest;
                while (d > Math.PI) d -= Math.PI * 2;
                while (d < -Math.PI) d += Math.PI * 2;
                if (Math.abs(d) > 1e-4) cellOut.toolAngle = round4(d);
              }
            }
            cells.push(cellOut);
          }
          frames.push(Object.assign({ row: rowIdx, cells: cells }, p.meta));
          rowIdx++;
        }
        poses[row.pose] = { rows: row.n, frames: frames };
      }
      manifest.subjects[b.kind] = {
        sheet: b.kind + "-body",
        mask: b.kind + "-mask",
        tris3d: b.rig.tris,
        poses: poses,
        anchorNames: Object.keys(anchorDefs).concat(["carry"]),
      };
    }

    /* ---- actually render the body + mask cells ---- */
    for (const b of bodies) {
      const sheet = sheets[b.kind + "-body"];
      const msheet = sheets[b.kind + "-mask"];
      sheet.rt = makeRT(sheet.w, sheet.h);
      msheet.rt = makeRT(msheet.w, msheet.h);
      scene.add(b.rig.root);
      const rows = B.poseList(b.kind, cfg);
      // base pass
      b.rig.setMask(false);
      beginPass(renderer, sheet.rt);
      renderRows(renderer, scene, cam, b, rows, cfg, A, cfg.bodyCell, sheet.h, cx, cy, S);
      // mask pass (unlit, possibly reduced resolution)
      b.rig.setMask(true);
      beginPass(renderer, msheet.rt);
      renderRows(renderer, scene, cam, b, rows, cfg, A, mCellOf(b.kind), msheet.h, cx, cy, S);
      b.rig.setMask(false);
      scene.remove(b.rig.root);
    }

    /* ---- overlays -------------------------------------------------- */
    const ovSheet = sheets.overlays;
    if (ovSheet) {
      ovSheet.rt = makeRT(ovSheet.w, ovSheet.h);
      beginPass(renderer, ovSheet.rt);
    }
    let cellNo = 0;
    const ovHalf = cfg.overlayCell / (2 * pxPerUnit);   // same locked scale, smaller window
    let maxOvFill = 0;
    /* DEPTH-ONLY HOST BODIES. An overlay baked alone has no idea the torso is
     * in the way, so a tool held on the far side would draw straight through
     * the man. Rendering the host body first with colorWrite off leaves its
     * depth in the buffer, and the overlay cell comes out already occluded —
     * which is also what makes it safe to draw overlays slightly in front of
     * the body quad at runtime. */
    const occluders = {};
    for (const kind of (overlays.length ? kinds : [])) {
      const oc = (cfg.occluderFactory || makeSubjectRig)(kind, cfg);
      oc.root.traverse((o) => {
        if (!o.isMesh) return;
        /* skinning:true or the depth-only stand-in freezes in bind pose and
         * occludes the overlay against the WRONG silhouette */
        o.material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, skinning: !!o.isSkinnedMesh });
        o.renderOrder = -1;
      });
      oc.root.renderOrder = -1;
      occluders[kind] = oc;
    }
    for (const ov of overlays) {
      scene.add(ov.rig.root);
      const occ = occluders[ov.host];
      scene.add(occ.root);
      const hostRows = B.poseList(ov.host, cfg);
      /* OVERLAY POSE ROWS: idle + all 8 walk frames share ONE "hold" cell.
       * Justification, not laziness: the torso twist across a walk cycle is
       * +-0.10 rad = 5.7deg, a fifth of one 30deg azimuth bin, so the overlay's
       * APPEARANCE is constant across walk — only its ANCHOR moves, and the
       * anchor is per-frame. The work/fight rows DO change the overlay (the
       * torso pitches up to -0.42 rad = 24deg) so they get their own cells. */
      const rowsSpec = [{ pose: "hold", host: hostRows[0].pose, k: 0 }];
      const workRow = hostRows[2];
      for (let k = 0; k < workRow.n; k++) rowsSpec.push({ pose: workRow.pose, host: workRow.pose, k: k });
      const entry = { tint: ov.tint, host: ov.host, pivot: ov.pivot, rows: {} };
      for (const rs of rowsSpec) {
        /* ARMS AT REST for the overlay pass (batch #4). An overlay rig has no
         * arms, so the tool bakes at the rest hand whatever the pose says —
         * and the OCCLUDER has to agree, or a raised arm would carve its
         * silhouette out of a tool image drawn down at the hip. The runtime
         * rotates the finished cell about the hand instead (aRot). */
        const p = noArms(ov.host === "knight" ? knightPose(rs.host, rs.k, cfg) : serfPose(rs.host, rs.k, cfg));
        const cells = [];
        for (let a = 0; a < A; a++) {
          B.applyPose(ov.rig, p, (a / A) * Math.PI * 2);
          B.applyPose(occ, p, (a / A) * Math.PI * 2);      // the occluder follows exactly
          const acc2 = camBox(cam, ov.rig.root, newAcc());
          const ocx = (acc2.xmin + acc2.xmax) / 2, ocy = (acc2.ymin + acc2.ymax) / 2;
          maxOvFill = Math.max(maxOvFill, (acc2.xmax - acc2.xmin) * pxPerUnit, (acc2.ymax - acc2.ymin) * pxPerUnit);
          const col = cellNo % ovCols, rowI = Math.floor(cellNo / ovCols);
          setFrustum(cam, ocx, ocy, ovHalf);
          const gx = col * cfg.overlayCell;
          const gy = ovSheet.h - (rowI + 1) * cfg.overlayCell;   // GL rows run upward
          renderer.setViewport(gx, gy, cfg.overlayCell, cfg.overlayCell);
          renderer.setScissor(gx, gy, cfg.overlayCell, cfg.overlayCell);
          renderer.render(scene, cam);
          /* the overlay's pivot, in ITS OWN cell — composition puts this pixel
           * on the body cell's matching anchor pixel */
          const pv = projectLocal(cam, ov.rig.bodyPivot, ov.pivot, ocx, ocy, ovHalf, pxPerUnit, cfg.overlayCell);
          cells.push({ cell: cellNo, col: col, row: rowI, pivotPx: pv });
          cellNo++;
        }
        entry.rows[rs.pose === "hold" ? "hold" : rs.pose + ":" + rs.k] = cells;
      }
      manifest.overlays[ov.id] = entry;
      scene.remove(ov.rig.root);
      scene.remove(occ.root);
    }
    setFrustum(cam, cx, cy, S);

    /* ---- read back ------------------------------------------------- */
    popRendererState(renderer, saved);
    for (const name in sheets) {
      const s = sheets[name];
      const buf = new Uint8Array(s.w * s.h * 4);
      renderer.readRenderTargetPixels(s.rt, 0, 0, s.w, s.h, buf);
      s.rgba = flipRows(buf, s.w, s.h);      // GL bottom-up -> PNG top-down
      const subj = name.replace(/-(body|mask)$/, "");
      manifest.sheets[name] = {
        file: name + ".png", w: s.w, h: s.h,
        cell: name === "overlays" ? cfg.overlayCell : (name.endsWith("-mask") ? mCellOf(subj) : cfg.bodyCell),
        cols: name === "overlays" ? ovCols : A,
        rows: name === "overlays" ? ovRowsTotal : rowsOf[subj],
        origin: "top-left",
        kind: name === "overlays" ? "overlay" : (name.endsWith("-mask") ? "mask (R=team, G=rank)" : "colour"),
      };
    }
    /* Flag overlay cells the host body completely hides (a pack seen from the
     * front, a chest pip seen from behind). The bake occludes them on purpose;
     * stamping the count here lets the integration skip ~12% of overlay draws
     * instead of submitting fully transparent quads. */
    if (sheets.overlays) {
      const os = sheets.overlays, cell = cfg.overlayCell;
      let empties = 0;
      for (const id in manifest.overlays) {
        const ov = manifest.overlays[id];
        for (const rk in ov.rows) {
          for (const c of ov.rows[rk]) {
            let n = 0;
            for (let y = 0; y < cell; y++) {
              const base = ((c.row * cell + y) * os.w + c.col * cell) * 4 + 3;
              for (let x = 0; x < cell; x++) if (os.rgba[base + x * 4] > 128) n++;
            }
            c.px = n;
            if (n < 8) { c.empty = true; empties++; }
          }
        }
      }
      manifest.bake.overlayEmptyCells = empties;
    }
    renderer.getContext().finish();

    manifest.bake.ms = Math.round(performance.now() - t0);
    manifest.bake.overlayMaxFillPx = round2(maxOvFill);
    manifest.bake.overlayCells = cellNo;
    manifest.bake.totalCells = cellNo + kinds.reduce((n, k) => n + rowsOf[k], 0) * A * 2;
    B.last = { manifest, sheets, cfg, cam, pxPerUnit, S, cx, cy };
    return { manifest, sheets };
  };

  function countRows(list) { let n = 0; for (const r of list) n += r.n; return n; }

  function renderRows(renderer, scene, cam, b, rows, cfg, A, cell, sheetH, cx, cy, S) {
    setFrustum(cam, cx, cy, S);
    let rowIdx = 0;
    for (const row of rows) {
      for (let k = 0; k < row.n; k++) {
        const p = b.kind === "knight" ? knightPose(row.pose, k, cfg) : serfPose(row.pose, k, cfg);
        for (let a = 0; a < A; a++) {
          B.applyPose(b.rig, p, (a / A) * Math.PI * 2);
          const gx = a * cell;
          const gy = sheetH - (rowIdx + 1) * cell;
          renderer.setViewport(gx, gy, cell, cell);
          renderer.setScissor(gx, gy, cell, cell);
          renderer.render(scene, cam);
        }
        rowIdx++;
      }
    }
  }

  function setFrustum(cam, cx, cy, S) {
    cam.left = cx - S; cam.right = cx + S; cam.bottom = cy - S; cam.top = cy + S;
    cam.updateProjectionMatrix();
  }

  const _wp = new THREE.Vector3();
  /** project a BODY-LOCAL point through the posed pivot into cell pixels */
  function projectLocal(cam, pivot, local, cx, cy, S, pxPerUnit, cell) {
    _wp.set(local[0], local[1], local[2]);
    pivot.localToWorld(_wp);
    return projectWorld(cam, _wp, cx, cy, S, pxPerUnit, cell);
  }
  const _cp = new THREE.Vector3();
  /** project a WORLD point into cell pixels (PNG convention: origin top-left) */
  function projectWorld(cam, v, cx, cy, S, pxPerUnit, cell) {
    camPoint(cam, v, _cp);
    return {
      x: round2((_cp.x - (cx - S)) * pxPerUnit),
      y: round2(cell - (_cp.y - (cy - S)) * pxPerUnit),
    };
  }

  function makeRT(w, h) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, generateMipmaps: false, encoding: THREE.LinearEncoding,
    });
  }

  /* THE BAKE MUST RUN AT PIXEL RATIO 1 — setViewport/setScissor take LOGICAL
   * pixels and multiply by the renderer's pixelRatio. On a dPR-2 display every
   * tile lands at 2x offset and 2x size, and the naive restore then leaves the
   * WHOLE page rendering into one magnified quadrant. (The impostor demo lost
   * its longest debugging session to exactly this; see VIABILITY.md.) */
  function pushRendererState(renderer) {
    const s = {
      rt: renderer.getRenderTarget(),
      auto: renderer.autoClear,
      clear: renderer.getClearColor(new THREE.Color()),
      alpha: renderer.getClearAlpha(),
      scissorTest: renderer.getScissorTest(),
      pr: renderer.getPixelRatio(),
      vp: renderer.getViewport(new THREE.Vector4()),
      sc: renderer.getScissor(new THREE.Vector4()),
    };
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    return s;
  }
  function popRendererState(renderer, s) {
    renderer.setScissorTest(s.scissorTest);
    renderer.autoClear = s.auto;
    renderer.setRenderTarget(s.rt);
    renderer.setClearColor(s.clear, s.alpha);
    renderer.setPixelRatio(s.pr);
    renderer.setViewport(s.vp);
    renderer.setScissor(s.sc);
  }
  function beginPass(renderer, rt) {
    renderer.setRenderTarget(rt);
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    renderer.setScissorTest(true);
  }

  /** GL reads bottom-up; PNGs are written top-down. */
  function flipRows(buf, w, h) {
    const out = new Uint8Array(buf.length);
    const stride = w * 4;
    for (let y = 0; y < h; y++) {
      out.set(buf.subarray((h - 1 - y) * stride, (h - y) * stride), y * stride);
    }
    return out;
  }

  /** RGBA -> a data: PNG, via canvas. (sharp's native binding is broken in this
   * environment — canvas.toDataURL is the supported export path here.) */
  B.toPNG = function (sheet) {
    const c = document.createElement("canvas");
    c.width = sheet.w; c.height = sheet.h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(sheet.w, sheet.h);
    img.data.set(sheet.rgba);
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  };

  /* ==================================================================== */
  /* MODEL-AGNOSTIC SWITCH — the Tripo villager GLBs                       */
  /* ==================================================================== */
  /**
   * The villager has no separable hat / tool / pack, so it bakes BODY + MASK
   * only (no overlays, no team region until the asset gains one). Everything
   * else — pose maths, azimuth grid, locked scale, anchors, manifest — is
   * shared, which is the point of the switch.
   */
  B.bakeAllAsync = async function (renderer, userCfg) {
    const cfg = Object.assign({}, B.DEFAULTS, userCfg || {});
    if (cfg.source === "minifig") return B.bakeAll(renderer, cfg);
    if (cfg.source === "dwarfknight") return B.bakeDwarfKnight(renderer, cfg);
    if (cfg.source !== "villager") throw new Error("unknown source: " + cfg.source);
    if (!window.SpriteImpostor) throw new Error("villager source needs sprite-impostor.js loaded");
    const parts = await window.SpriteImpostor.loadVariant(cfg.villagerVariant || "-lo-vc");
    B.villagerParts = parts;
    const out = B.bakeAll(renderer, Object.assign({}, cfg, {
      source: "minifig",                    // the synchronous path; overridden below
      subjectKinds: ["serf"],               // no knight sculpt exists for this asset
      bakeOverlays: false,                  // …and nothing separable to overlay
      anchorsByKind: { serf: {} },          // only the root-space `carry` anchor applies
      rigFactory: () => B.makeVillagerRig(parts),
      maskDiv: 2,
    }));
    out.manifest.sourceModel = "villager";
    out.manifest.note = "Tripo villager: body + mask only. The asset has no separable " +
      "hat/tool/pack, so the overlay+anchor half of the pipeline is inert for it; " +
      "everything else (azimuth grid, locked scale, pose maths, manifest) is shared.";
    out.manifest.bake.villagerVariant = cfg.villagerVariant || "-lo-vc";
    return out;
  };

  /**
   * A villager rig with the SAME interface B.makeRig returns, so the whole
   * baker works on it unchanged. The leg GLBs are authored at their own hip, so
   * parenting them to empties at the measured hips reconstructs the source pose
   * (the hips are the impostor demo's measured values).
   */
  /* ==================================================================== */
  /* SOURCE "dwarfknight" — the user's two Tripo-studio sculpts, SKINNED     */
  /* ==================================================================== */
  /**
   * The 2026-08-01 look test baked these two by SPLITTING them into rigid
   * body/legL/legR parts, and said so honestly: the dwarf's tunic survived it,
   * the knight's mail hem tore away from his greaves at stride because plate
   * armour has no cloth give to hide a rigid seam. A sprite bake photographs a
   * mesh, and a mesh can be SKINNED — so both bodies now carry a real skin
   * (tools/_fs_dk_rig.py: the dwarf's own Tripo v1.0 biped, landmark-fitted onto
   * the knight and bound with Blender's automatic weights) and every frame is a
   * POSED SKELETON, photographed. No seams to open, because there are no parts.
   *
   * Everything else is deliberately the production pipeline: the same azimuth
   * grid, the same pose maths (serfPose/knightPose, untouched), the same mask
   * and overlay and anchor machinery, and — via cfg.lockFrustum — the SAME
   * frustum as the minifig sheets, so px-per-unit and footPx match and the
   * renderer needs no per-look arithmetic.
   */
  const DK_BASE = "../../assets/farmstead/cast/dwarfknight/";
  const DK = {
    /* the rest-shape arm drop: both sculpts ship in a T-pose, and a T-pose bakes
     * to a starfish that fills ~15% of its cell because the ARM SPAN, not the
     * standing height, drives the frustum. Applied as a POSE on the shoulder
     * bones (so the shoulder deforms) rather than a rigid vertex rotation. */
    armDown: 1.2566,            // 72°
    elbow: 0.22,                // a little bend, so the arms are not planks
    /* the arms counter-swing on the SAME sin(phase) scalar the legs already use
     * — no new animation clock, no new state. A sculpt with visible arms reads
     * as sliding without it; the minifig had no separable arms so the question
     * never came up. */
    armSwing: 0.30,
    /* ═══ THE SHOULDER'S FORWARD AXIS IS MIRRORED ON THIS RIG (batch #4) ════
     * MEASURED, not derived: baking the carry pose (armX +1.32, "both arms out
     * in front") put this dwarf's arms straight UP in a V while the minifig's
     * went forward off the identical scalar. The Tripo skeleton's model-space
     * X runs the other way relative to the way the sculpt faces, so a positive
     * rotation about it raises the arm behind him instead of swinging it
     * forward. One sign, applied where the pose meets the bone.
     * IT ALSO MEANS THE WALK'S COUNTER-SWING HAS BEEN BACKWARDS ON THIS LOOK
     * since it was written — 17° on a 26 px sprite, which is why nobody saw
     * it. It is correct now for the same reason the carry is. */
    armSignX: -1,
    /* armour swings less than cloth: the fauld is a rigid skirt and a full
     * 0.52 rad stride reads as a man kicking through his own plate. */
    strideMul: { serf: 1.0, knight: 0.62 },
    /* ═══ TEAM = BELT, RANK = PLUME→TRIM (2026-08-01, user's colour language) ══
     * Regions are fractions of the body's OWN measured torso span (crotch → arm
     * line) so they sit right on either sculpt without hand-tuned heights.
     *
     * TEAM (mask R):
     *  · serf — the dwarf's OWN DRAWN BELT, found by measurement, not guessed:
     *    binning torso texture colour against this same fraction shows a
     *    saturated leather band at f 0.16..0.32 (mean rgb 91,68,48 / 82,61,42,
     *    R−B ≈ 40) against a neutral grey tunic everywhere else (105,99,92,
     *    R−B ≈ 13). The band ships WIDER than the leather — [0.10, 0.40],
     *    centred 0.25 on the belt's 0.24 — because the drawn belt alone is 6.1%
     *    of his height = 1.6 px on the 26 px play-zoom sprite. 0.30 of the span
     *    is 11.5% ≈ 3.0 px, the same read the old sash had. The SHOULDER YOKE is
     *    gone: team is the belt and only the belt.
     *  · knight — the PLUME, by texture colour (below). Not a band at all.
     * RANK (mask G):
     *  · knight — the armour's waist trim, [0.30, 0.44], centred on the dark
     *    leather/fauld line the same profile finds at f 0.34..0.42 (rgb 64,39,10
     *    at its darkest) below the white breastplate (luma ~136 from f 0.46 up).
     *    NARROWED from [0.24, 0.50] after looking at the bake: the fauld FLARES,
     *    so a band that is 9% of his height by the numbers covers a good deal
     *    more surface than that, and a whole gold skirt competes with the plume
     *    for "which colour is this man's identity". A trim stripe does not. The
     *    rank PIPS remain the primary rank read either way.
     *  · serf — none (a serf has no rank).
     */
    bands: {
      serf: [[0.10, 0.40]],                      // the belt he already wears
      knight: [[0.30, 0.44]],                    // rank trim at the fauld line
    },
    torsoBones: /^(Hip|Pelvis|Waist|Spine01|Spine02|NeckTwist01|NeckTwist02|L_Clavicle|R_Clavicle)$/,
  };

  function dkLoadGLB(url) {
    return new Promise((res, rej) => new THREE.GLTFLoader().load(url, (g) => res(g.scene), undefined, rej));
  }

  /** the house flat-Lambert conversion. `skinning:true` is REQUIRED in r128 or a
   * SkinnedMesh renders frozen in bind pose; the map stays LinearEncoding
   * because this renderer sets no outputEncoding — raw IS the world's space
   * (the same measurement the villager's `cast.srgb=false` came from). */
  function dkStyle(mesh, emissiveK) {
    const src = mesh.material;
    const map = src && src.map ? src.map : null;
    if (map) { map.encoding = THREE.LinearEncoding; map.needsUpdate = true; }
    return new THREE.MeshLambertMaterial({
      color: 0xffffff, map: map, skinning: true,
      emissive: new THREE.Color(SERF_EMISSIVE_OF).multiplyScalar(emissiveK === undefined ? SERF_EMISSIVE_K : emissiveK),
    });
  }

  /** read one vertex's dominant bone name */
  function dkDominant(geo, bones, i) {
    const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    if (!si) return "";
    let bj = -1, bw = -1;
    const idx = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)];
    const w = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)];
    for (let k = 0; k < 4; k++) if (w[k] > bw) { bw = w[k]; bj = idx[k]; }
    const b = bones[bj];
    return b ? b.name : "";
  }

  /** sample the base-colour texture at a vertex's UV, 0..1 rgb */
  function dkTexSampler(map) {
    const img = map && map.image;
    if (!img || !img.width) return null;
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    return function (u, v) {
      const px = Math.min(c.width - 1, Math.max(0, Math.round(u * (c.width - 1))));
      /* the sheets are authored top-left; glTF v runs the same way here */
      const py = Math.min(c.height - 1, Math.max(0, Math.round(v * (c.height - 1))));
      const o = (py * c.width + px) * 4;
      return [d[o] / 255, d[o + 1] / 255, d[o + 2] / 255];
    };
  }

  /**
   * Split ONE skinned geometry into three index groups — plain / team / rank —
   * and hand back the material arrays for the colour and the mask pass. This is
   * exactly the production `buildTriplet` idea (a tinted region bakes WHITE with
   * no emissive lift so the runtime tint lands EXACTLY, not emissive*(1−tint)
   * dark) applied to a single textured mesh instead of a part list: same
   * geometry, same skin, three index ranges.
   */
  function dkMaskGroups(mesh, kind, span, report) {
    const geo = mesh.geometry;
    const bones = mesh.skeleton ? mesh.skeleton.bones : [];
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const idx = geo.index;
    const N = pos.count;
    const cls = new Uint8Array(N);
    const bands = DK.bands[kind];
    const sample = kind === "knight" ? dkTexSampler(mesh.material.map) : null;
    let team = 0, rank = 0;
    for (let i = 0; i < N; i++) {
      const y = pos.getY(i);
      const dom = dkDominant(geo, bones, i);
      /* TEAM (knights): the crest. Found by TEXTURE COLOUR — the plume is the
       * only strongly red thing on a white-armour sculpt, and picking it by
       * colour is robust where a geometric "above and behind the helm" rule
       * would also catch the helmet's own back. (It carried RANK until
       * 2026-08-01; the channel swapped, the test did not.) */
      if (sample && uv) {
        const c = sample(uv.getX(i), uv.getY(i));
        if (c[0] > 0.22 && c[0] > c[1] * 1.7 && c[0] > c[2] * 1.7) { cls[i] = 1; team++; continue; }
      }
      if (!DK.torsoBones.test(dom)) continue;      // never the face, hands, legs or boots
      const f = (y - span.lo) / (span.hi - span.lo);
      /* a serf's band is TEAM, a knight's band is his RANK TRIM (his team is the
       * plume above) — one band list per kind, one channel per kind */
      const ch = kind === "knight" ? 2 : 1;
      for (const b of bands) {
        if (f < b[0] || f > b[1]) continue;
        cls[i] = ch;
        if (ch === 1) team++; else rank++;
        break;
      }
    }
    /* per-TRIANGLE vote, then reorder the index so the three classes are
     * contiguous groups. Per-vertex would melt each band's hem into a gradient
     * and read as a stain (the villager's castPaint learned the same thing). */
    const src = idx ? idx.array : null;
    const tri = src ? src.length / 3 : N / 3;
    const buckets = [[], [], []];
    for (let f = 0; f < tri; f++) {
      const a = src ? src[f * 3] : f * 3, b = src ? src[f * 3 + 1] : f * 3 + 1, c = src ? src[f * 3 + 2] : f * 3 + 2;
      const n = [0, 0, 0];
      n[cls[a]]++; n[cls[b]]++; n[cls[c]]++;
      let best = 0;
      if (n[1] > n[best]) best = 1;
      if (n[2] > n[best]) best = 2;
      buckets[best].push(a, b, c);
    }
    const order = buckets[0].concat(buckets[1], buckets[2]);
    geo.setIndex(new THREE.BufferAttribute(
      new (order.length > 65535 ? Uint32Array : Uint16Array)(order), 1));
    geo.clearGroups();
    let at = 0;
    for (let g = 0; g < 3; g++) { geo.addGroup(at, buckets[g].length, g); at += buckets[g].length; }
    report[kind] = {
      teamVerts: team, rankVerts: rank,
      teamTris: buckets[1].length / 3, rankTris: buckets[2].length / 3, plainTris: buckets[0].length / 3,
    };
    const white = () => new THREE.MeshLambertMaterial({ color: 0xffffff, skinning: true, emissive: new THREE.Color(0, 0, 0) });
    const flat = (hex) => new THREE.MeshBasicMaterial({ color: hex, skinning: true });
    return { colour: [dkStyle(mesh), white(), white()], mask: [flat(0x000000), flat(0xff0000), flat(0x00ff00)] };
  }

  /** measure the anchor points this body can actually offer, off its own mesh */
  function dkMeasure(mesh, kind) {
    const geo = mesh.geometry, pos = geo.attributes.position;
    const bones = mesh.skeleton ? mesh.skeleton.bones : [];
    const byName = {};
    for (const b of bones) byName[b.name] = b;
    const acc = { headY: -1e9, headR: 0, backZ: 1e9, frontZ: -1e9, torsoR: 0, lo: 1e9, hi: -1e9 };
    /* pass 1: the torso, which also gives the scale the head test needs */
    for (let i = 0; i < pos.count; i++) {
      const dom = dkDominant(geo, bones, i);
      if (!DK.torsoBones.test(dom)) continue;
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      acc.backZ = Math.min(acc.backZ, z);
      acc.frontZ = Math.max(acc.frontZ, z);
      acc.torsoR = Math.max(acc.torsoR, Math.abs(x));
      acc.lo = Math.min(acc.lo, y); acc.hi = Math.max(acc.hi, y);
    }
    /* pass 2: the head — the SKULL only. A knight's crest is Head-dominant too,
     * and it sweeps up and back, so an unfiltered max would report a head half a
     * metre wide whose "top" is the tip of a feather. Keep the near-midline,
     * not-behind-the-shoulders part. */
    for (let i = 0; i < pos.count; i++) {
      const dom = dkDominant(geo, bones, i);
      if (dom !== "Head" && dom !== "NeckTwist02") continue;
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (Math.abs(x) > acc.torsoR || z < acc.backZ) continue;
      acc.headY = Math.max(acc.headY, y);
      acc.headR = Math.max(acc.headR, Math.abs(x));
    }
    return { acc, byName, span: { lo: acc.lo, hi: acc.hi } };
  }

  /** load + build one skinned rig with the interface B.makeRig returns */
  B.makeDwarfKnightRig = function (kind, src, maskReport) {
    const root = new THREE.Group();
    const bodyPivot = new THREE.Group();
    root.add(bodyPivot);
    const model = src.scene;
    bodyPivot.add(model);
    let mesh = null;
    model.traverse((o) => { if (o.isSkinnedMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count)) mesh = o; });
    if (!mesh) throw new Error("dwarfknight: " + kind + " has no SkinnedMesh — the rig export lost its skin");
    root.updateMatrixWorld(true);
    const M = dkMeasure(mesh, kind);
    const mats = dkMaskGroups(mesh, kind, M.span, maskReport);
    mesh.material = mats.colour;
    mesh.frustumCulled = false;

    const B2 = M.byName;
    const rest = {};
    for (const n in B2) rest[n] = B2[n].quaternion.clone();
    const _ax = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion();
    /** rotate ONE bone about a MODEL-space axis, on top of its rest pose. The
     * Tripo skeleton carries rotations on every joint, so "rotate about local X"
     * is not "rotate about the character's left-right axis" — the axis has to be
     * pulled into the parent's frame first. */
    function boneRot(name, axis, ang) {
      const b = B2[name];
      if (!b || !ang) { if (b) b.quaternion.copy(rest[name]); return; }
      b.parent.getWorldQuaternion(_pq);
      _ax.copy(axis).applyQuaternion(bodyPivot.getWorldQuaternion(_q)).applyQuaternion(_pq.invert());
      b.quaternion.copy(_q.setFromAxisAngle(_ax.normalize(), ang)).multiply(rest[name]);
    }
    const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
    const sm = DK.strideMul[kind] === undefined ? 1 : DK.strideMul[kind];
    /* WHICH SIDE IS "L"? Read it off the skeleton, never off the name. This rig
     * puts L_ on +X, the mirror of the minifig's own convention (pushLegs keys
     * its stride sign on the hip's x SIGN, where side −1 is the −x leg), so
     * trusting the prefix silently swaps which leg leads at a given gait phase.
     * `sideOf` returns exactly what pushLegs means by `s`. */
    const sideOf = {};
    for (const side of ["L", "R"]) {
      const b = B2[side + "_Thigh"] || B2[side + "_Upperarm"];
      sideOf[side] = b && b.getWorldPosition(new THREE.Vector3()).x < 0 ? -1 : 1;
    }

    const rig = {
      root, bodyPivot, hips: [], mesh: mesh, kind: kind,
      tris: Math.round((mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3),
      measured: { headTopY: round4(M.acc.headY), headR: round4(M.acc.headR), backZ: round4(M.acc.backZ),
        frontZ: round4(M.acc.frontZ), torsoR: round4(M.acc.torsoR), torsoSpan: [round4(M.span.lo), round4(M.span.hi)] },
      setMask(on) { mesh.material = on ? mats.mask : mats.colour; },
      applyPose(p, az) {
        bodyPivot.position.set(0, p.bob, 0);
        bodyPivot.rotation.set(p.rx, az + p.twist, p.rz);
        bodyPivot.updateMatrixWorld(true);
        for (const side of ["L", "R"]) {
          const s = sideOf[side];
          /* pushLegs, verbatim, on bones: a = stride·LEG_SWING·(s<0?1:−1) + brace·0.22·s */
          boneRot(side + "_Thigh", X, (p.stride * LEG_SWING * (s < 0 ? 1 : -1) + p.brace * 0.22 * s) * sm);
          /* T-pose → arms at the sides. A +x arm rotates about +Z by a NEGATIVE
           * angle to come down; the mirror goes the other way.
           * batch #4: `armOut` lifts them back OUT of the side-drop a little,
           * which is what gives a carried load a shelf to sit on.
           * batch #5: PER SIDE — the tool arm (side +1) splays through a work
           * swing and the off hand does not, so the two can no longer share
           * one scalar. `armOutR` falls back to `armOut` when a pose sets only
           * the one, which every pose but `work` does. */
          const out = s < 0 ? (p.armOut || 0)
            : (p.armOutR === undefined ? (p.armOut || 0) : p.armOutR);
          boneRot(side + "_Upperarm", Z, -(DK.armDown - out) * s);
          /* the elbow bends more when he is carrying: a straight-armed carry
           * reads as a sleepwalker, and the load wants to come in to the chest */
          boneRot(side + "_Forearm", X, DK.elbow + (p.armBend || 0));
        }
        /* THE SHOULDER SWING, on top of the drop. Batch #4 moved this off
         * `stride` and onto armX/armXR — ONE convention shared with the
         * minifig's shoulder groups (positive = forward), so the walk's
         * counter-swing, the carry hold and the tool arc all come from the
         * pose rather than from three different places. serfPose's walk
         * reproduces the old counter-swing exactly, at 0.34 rad instead of
         * DK.armSwing's 0.30. */
        for (const side of ["L", "R"]) {
          const s = sideOf[side], b = B2[side + "_Upperarm"];
          if (!b) continue;
          const ang = (s < 0 ? (p.armX || 0) : (p.armXR === undefined ? (p.armX || 0) : p.armXR))
            * sm * DK.armSignX;
          if (!ang) continue;
          b.parent.getWorldQuaternion(_pq);
          _ax.copy(X).applyQuaternion(bodyPivot.getWorldQuaternion(_q)).applyQuaternion(_pq.invert());
          b.quaternion.premultiply(_q.setFromAxisAngle(_ax.normalize(), ang));
        }
        root.updateMatrixWorld(true);
      },
      /* batch #4: the same three posed anchors the minifig offers, off the
       * skeleton's own hand bones. `sideOf` is read from the SKELETON, never
       * the name — this rig puts L_ on +X — so "the right hand" here means the
       * same hand the minifig's `arm: +1` limb is. */
      anchorWorld(name) {
        const bySide = (want) => {
          for (const side of ["L", "R"]) if (sideOf[side] === want) return B2[side + "_Hand"];
          return null;
        };
        if (name === "offhand") {                       // batch #5, see ANCHOR_SERF
          const h = bySide(-1);
          return h ? h.getWorldPosition(new THREE.Vector3()) : null;
        }
        if (name === "tool") {
          const h = bySide(1) || B2.L_Hand || B2.R_Hand;
          return h ? h.getWorldPosition(new THREE.Vector3()) : null;
        }
        if (name === "toolTip") {
          const h = bySide(1) || B2.L_Hand || B2.R_Hand;
          if (!h) return null;
          const w = h.getWorldPosition(new THREE.Vector3());
          /* along the forearm, extended past the hand: hand − elbow, normalised */
          const el = bySide(1) === B2.L_Hand ? B2.L_Forearm : B2.R_Forearm;
          const e = (el || h.parent).getWorldPosition(new THREE.Vector3());
          const d = w.clone().sub(e);
          if (d.lengthSq() < 1e-8) d.set(0, -1, 0);
          return w.add(d.normalize().multiplyScalar(0.30));
        }
        if (name === "hands") {
          const a = bySide(1), b2 = bySide(-1);
          if (!a || !b2) return null;
          return a.getWorldPosition(new THREE.Vector3())
            .add(b2.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5)
            .add(new THREE.Vector3(0, 0.05, 0));      // a load rests ON the hands
        }
        return null;
      },
    };
    rig.applyPose({ bob: 0, rx: 0, twist: 0, rz: 0, stride: 0, brace: 0 }, 0);
    return rig;
  };

  B.bakeDwarfKnight = async function (renderer, userCfg) {
    const cfg = Object.assign({}, B.DEFAULTS, userCfg || {});
    const maskReport = {};
    const files = { serf: "dwarf-rigged.glb", knight: "knight-rigged.glb" };
    const loaded = {}, occ = {};
    for (const k of ["serf", "knight"]) {
      loaded[k] = await dkLoadGLB(DK_BASE + files[k]);
      /* the depth-only occluder is a SECOND load on purpose: a plain .clone() of
       * a SkinnedMesh shares the skeleton and poses the original with it, and
       * SkeletonUtils is not vendored on this page */
      occ[k] = await dkLoadGLB(DK_BASE + files[k]);
    }
    const rigs = {}, occRigs = {};
    for (const k of ["serf", "knight"]) {
      rigs[k] = B.makeDwarfKnightRig(k, { scene: loaded[k] }, maskReport);
      occRigs[k] = B.makeDwarfKnightRig(k, { scene: occ[k] }, {});
    }
    /* Anchors, measured off each body rather than transcribed from the minifig.
     * The hat rule reproduces the minifig exactly when fed the minifig's own
     * numbers (head centre 0.682 + 0.75·0.112 = 0.766 = its authored hat pivot),
     * which is what makes it a fit and not a fudge. */
    const S = rigs.serf.measured, K = rigs.knight.measured;
    const anchorsByKind = {
      serf: {
        /* the cap sits a quarter of a skull-radius down from the crown. Feed the
         * minifig its own numbers (crown 0.794, radius 0.112) and this returns
         * 0.766 — its authored hat pivot exactly — which is what makes it a fit
         * rather than a fudge. Anchoring off the Head BONE instead put the cap
         * inside the dwarf's skull: on this rig that joint is the neck, not the
         * centre of the head. */
        hat: [0, S.headTopY - 0.25 * S.headR, 0],
        tool: ANCHOR_SERF.tool,                        // overridden per-frame by anchorWorld
        pack: [0, (S.torsoSpan[0] + S.torsoSpan[1]) * 0.52, S.backZ + 0.02],
        /* batch #4: where a carried good rests. Always resolved from the posed
         * hand BONES (anchorWorld); this rest value only exists so the key is
         * in anchorDefs at all. */
        hands: ANCHOR_SERF.hands,
        offhand: ANCHOR_SERF.offhand,                  // batch #5 (posed, see anchorWorld)
      },
      knight: {
        helmTop: [0, K.headTopY, 0],
        pip0: [-0.055 + 0 * 0.045, K.torsoSpan[0] + (K.torsoSpan[1] - K.torsoSpan[0]) * 0.70, K.frontZ - 0.01],
        pip1: [-0.055 + 1 * 0.045, K.torsoSpan[0] + (K.torsoSpan[1] - K.torsoSpan[0]) * 0.70, K.frontZ - 0.01],
        pip2: [-0.055 + 2 * 0.045, K.torsoSpan[0] + (K.torsoSpan[1] - K.torsoSpan[0]) * 0.70, K.frontZ - 0.01],
        pip3: [-0.055 + 3 * 0.045, K.torsoSpan[0] + (K.torsoSpan[1] - K.torsoSpan[0]) * 0.70, K.frontZ - 0.01],
      },
    };
    const out = B.bakeAll(renderer, Object.assign({}, cfg, {
      source: "minifig",                    // the synchronous path; relabelled below
      subjectKinds: ["serf", "knight"],
      rigFactory: (k) => rigs[k],
      occluderFactory: (k) => occRigs[k],
      anchorsByKind: anchorsByKind,
      overlayScale: {
        hat: round4(S.headR / 0.112),       // the minifig skull the cap was cut for
        pack: round4(S.torsoR / 0.175),     // …and the minifig torso the pack sat on
        tool: 1, pip: 1,
      },
    }));
    out.manifest.sourceModel = "dwarfknight";
    out.manifest.note = "Fork B, DWARF+KNIGHT look. Two Tripo-studio sculpts, SKINNED and posed " +
      "per frame (no rigid part split — armour has no cloth give to hide a seam). Same azimuth " +
      "grid, pose maths, mask/overlay/anchor machinery and FRUSTUM as the minifig sheets, so " +
      "px-per-unit and footPx are identical and the renderer needs no per-look arithmetic.";
    out.manifest.bake.dwarfknight = {
      rigging: "skeleton transfer (tools/_fs_dk_rig.py) — the dwarf's Tripo v1.0-20240301 41-joint " +
        "biped, piecewise-height-fitted to the knight's measured landmarks, Blender automatic weights",
      posedBones: ["L_Thigh", "R_Thigh", "L_Upperarm", "R_Upperarm", "L_Forearm", "R_Forearm"],
      armDownRad: DK.armDown, elbowRad: DK.elbow, armSwingRad: DK.armSwing,
      strideMul: DK.strideMul, bands: DK.bands,
      measured: { serf: S, knight: K },
      maskRegions: maskReport,
      overlayScale: { hat: round4(S.headR / 0.112), pack: round4(S.torsoR / 0.175) },
      tris: { serf: rigs.serf.tris, knight: rigs.knight.tris },
    };
    return out;
  };

  B.makeVillagerRig = function (parts) {
    const HIP = [{ x: 0.127, y: 0.256, z: 0.031 }, { x: -0.120, y: 0.254, z: 0.025 }];
    const root = new THREE.Group();
    const bodyPivot = new THREE.Group();
    root.add(bodyPivot);
    bodyPivot.add(parts.body.clone(true));
    const hips = [];
    /* side -1 must be the LEFT leg, matching pushLegs' (s2 < 0 ? 1 : -1) sign */
    [{ h: HIP[1], leg: parts.legR, side: 1 }, { h: HIP[0], leg: parts.legL, side: -1 }].forEach((e) => {
      const g = new THREE.Group();
      g.position.set(e.h.x, e.h.y, e.h.z);
      g.userData.side = e.side;
      g.add(e.leg.clone(true));
      bodyPivot.add(g);
      hips.push(g);
    });
    const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const real = [];
    root.traverse((o) => { if (o.isMesh) real.push({ o: o, m: o.material }); });
    return {
      root, bodyPivot, hips, tris: parts.tris,
      /* the villager carries no team or rank region yet, so its mask is a solid
       * black silhouette — the tint path reads 0 everywhere and does nothing */
      setMask(on) { for (const r of real) r.o.material = on ? black : r.m; },
    };
  };
})();
