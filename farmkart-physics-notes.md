# Mario Kart Wii physics — extracted from Kinoko (vabold/Kinoko, decomp-derived reimpl)

Source: https://github.com/vabold/Kinoko, branch `main`, files under `source/game/kart/`
(mainly `KartMove.cc`/`.hh`, `KartBoost.cc`/`.hh`, `KartParam.hh`, `KartState.hh`).
**License: MIT** (not GPL — checked `LICENSE` directly, "Copyright (c) 2022-2026 vabold").
We take formulas/constants as reference for an ORIGINAL implementation; no Kinoko code is copied.
Per-kart numeric stat tables (speed, accelerationStandardA/T, driftOutsideTargetAngle, etc.)
are data-driven from `KartParam.bin`/`driverParam.bin`, NOT hardcoded in source — so exact
per-vehicle numbers aren't in the repo. Secondary source for typical stat ranges: Custom Mario
Kart wiki (wiki.tockdom.com) via WebSearch, cited inline below.

## Executive summary — 3 changes that would most move our prototype toward true MKW feel

1. **Steering is a low-pass filter on stick input, not raw input.** MKW never rotates the kart
   directly from stickX; it exponentially smooths a `weightedTurn` toward stickX at a
   `reactivity` rate (~0.1replaced per-frame blend), THEN scales that by a speed curve. Our
   `theta += steer*steerRate*sqrt(speed/maxSpeed)*dt` skips the smoothing step entirely —
   add an exponential-lerp of the raw steer input before applying it to theta. This alone
   is why real MKW steering feels "weighted"/analog instead of twitchy.
2. **Turn rate vs speed is NOT a simple sqrt(speed/maxSpeed) — it's flat-then-tapering.**
   Real curve: full turn rate below 20 speed-units (actually ramps UP as speed *decreases*
   from 20→0), an inverse taper from 20→70 (`turn *= 0.5, then += (1-(speed-20)/50)*turn`),
   and roughly constant beyond 70. Low-speed turning should be strong/tight, not weak.
3. **Drift angle is target-seeking with a HARD outer clamp and asymmetric charge, not a
   spring.** The outside drift angle marches toward ±`driftOutsideTargetAngle` at a FIXED
   rate (`150 * driftManualTightness` deg/frame while under target, `2`/frame decay past
   it) and is hard-clamped to ±60° absolute. It is driven by discrete hop-direction state
   (`m_hopStickX ∈ {-1,0,1}`), not a continuous steer value — so re-tapping the opposite
   direction snaps the target, it doesn't reverse smoothly. Our lerp-the-arc-by-steer model
   should snap its *target* angle on direction change rather than continuously following
   analog steer.

Minor but easy wins: MT charge rate is asymmetric by stick position (leaning INTO the drift
charges slower/normal, leaning OUT or centered gives a flat +3 bonus per frame on top of the
+2 base — i.e. charging is roughly stick-agnostic once past a small deadzone, contrary to the
"hold away from the drift to charge faster" folk belief); boost is a flat `+20%` speed
multiplier + `115` speed-limit override + `3.0` accel bonus for a duration in FRAMES equal to
the `miniTurbo` stat (SMT = 3x that duration), not a ramped/decaying kick.

---

## 1. Drift model

### Hop / drift initiation
`KartMove::canHop()` (KartMove.hh, inline):
```cpp
virtual bool canHop() const {
    if (status.offAnyBit(HopStart, TouchingGround)) return false;
    if (status.onBit(InAction)) return false;
    return true;
}
```
`KartMove::canStartDrift()` (KartMove.hh):
```cpp
bool canStartDrift() const {
    return m_speed >= MINIMUM_DRIFT_THRESOLD * m_baseSpeed;   // MINIMUM_DRIFT_THRESOLD = 0.55f
}
```
So drift/hop requires **speed ≥ 55% of base (top) speed**, touching ground, hop already
started (stick held past a threshold), and not mid-action.

`calcPreDrift()` (KartMove.cc ~L980): while grounded + not hopping/drifting, if stick is hard
left/right and drift-input button held, latches `m_hopStickX = ±1` (right stick → -1, left → 1)
and flags `SlipdriftCharge` — this is the "charge the hop" pre-state before the actual hop
apex triggers `startManualDrift()`.

`hop()` (KartMove.cc, `@addr{0x8057DA5C}`):
```cpp
void KartMove::hop() {
    status.setBit(Hop).resetBit(DriftManual);
    m_hopUp  = mainRot * ey;
    m_hopDir = mainRot * ez;
    m_driftState = NotDrifting;
    m_smtCharge = m_mtCharge = 0;
    m_hopStickX = 0; m_hopFrame = 0; m_hopPosY = 0.0f;
    m_hopGravity = dynamics()->gravity();
    m_hopVelY = m_driftingParams->hopVelY;      // per drift-type: 10.0f for ALL 3 types
    m_outsideDriftBonus = 0.0f;
    extVel.y = m_hopVelY;  totalForce.y = 0.0f;  // hop is a vertical impulse, no XZ change
}
```
`DriftingParameters` per `DriftType` (KartMove.cc, `DRIFTING_PARAMS_ARRAY`):
```cpp
{10.0f, 0.5f,  0.5f, 1.0f},   // Inside_Drift_Bike  {hopVelY, stabilizationFactor, _, boostRotFactor}
{10.0f, 0.5f,  0.5f, 0.2f},   // Outside_Drift_Bike
{10.0f, 0.22f, 0.5f, 0.2f},   // Kart
```
Kart hop vertical velocity is 10.0 units/frame regardless of type; only stabilization/boost-rot
differ (bike-specific lean, not relevant to our kart-only scope).

### Drift ANGLE evolution — target-seeking, not spring-damped
`startManualDrift()` (on hop landing, `@addr{0x8057E3F4}`): computes an instantaneous
`driftAngle` from the angle between hop-facing and current rotation-rejected-onto-up vector,
adds it into `m_outsideDriftAngle` signed by `-m_hopStickX`, and **hard clamps to ±60°**.
Then, if drift button + stick direction are valid, sets `DriftManual` + `ChargingMt` and seeds
`m_outsideDriftBonus = 0.5f * speedRatioCapped * driftManualTightness`.

Every subsequent frame, `controlOutsideDriftAngle()` (`@addr{0x8057EAB8}`, only runs if
airtime ≤ 5) drives the angle toward a **fixed target** of `±driftOutsideTargetAngle` (a
per-vehicle stat), NOT by continuously reading steer input each frame but by a discrete
direction (`m_hopStickX == -1` or `+1`, set once at hop/re-tap):
```cpp
if (m_hopStickX == -1) {              // drifting one way
    targetAngle = driftOutsideTargetAngle;
    if (angle > targetAngle) angle = max(angle - 2.0f, targetAngle);          // overshoot decay: -2 deg/frame
    else if (angle < targetAngle) {
        angle += 150.0f * driftManualTightness;                              // charge-in rate
        angle = min(angle, targetAngle);
    }
} else if (m_hopStickX == 1) {  /* mirrored, target = -driftOutsideTargetAngle */ }
```
So: **the arc closes toward the target at 150°/frame × driftManualTightness** (a per-vehicle
tightness stat, typically well under 1.0 so effective rate is a few deg/frame), and only decays
at a flat 2°/frame if it overshoots. This is a ramp-to-target with asymmetric rates, not a
critically-damped spring.

`calcAutoDrift()` (auto-transmission drift, `@addr{0x8057E0DC}`) is the "no manual drift button"
variant: requires 12 consecutive frames (`AUTO_DRIFT_START_DELAY`) of stick deflection > 0.85
to engage, then increments `m_autoDriftAngle` by a flat `30.0f * driftAutomaticTightness` per
frame while grounded, clamped to `±0.5 * driftOutsideTargetAngle` (half the manual-drift max —
auto-drift is intentionally a gentler arc).

### Inside vs outside drift (karts)
Karts only ever use `DriftType::Kart` (outside-drift visual/physics model — the outer rear
wheel leads); the `Inside_Drift_Bike` branch is bike-only and explicitly skipped for karts
(`driftType != Inside_Drift_Bike` guards the whole outside-angle system, meaning karts always
run it). Not directly relevant since we're kart-only, but confirms: **kart drift = outside-
drift angle system above**, full stop.

### Steering input while drifting (arc modulation)
`calcTurn()` (KartMove.cc `@addr{0x8057A8B4}`) — the *facing* turn rate while drifting is
separate from the drift arc-angle above; it's a smoothed/blended value:
```cpp
m_rawTurn = (hop locked ? hopStickX : -stickX);
reactivity = isDrifting ? driftReactivity : handlingReactivity;
m_weightedTurn = rawTurn*reactivity + m_weightedTurn*(1-reactivity);   // EXPONENTIAL SMOOTHING
m_weightedTurn = clamp(-1,1);
m_realTurn = weightedTurn;
if (isDrifting) {
    m_realTurn = (weightedTurn + hopStickX) * 0.5f;      // blend toward the locked drift dir
    m_realTurn = m_realTurn*0.8f + 0.2f*hopStickX;        // bias toward locked direction
    m_realTurn = clamp(-1,1);
}
```
So during a drift, the driver's stick nudges `realTurn` but it's pulled 20% toward the locked
hop direction at minimum — you can widen/narrow the arc with the stick but can't fully cancel
the locked drift direction without releasing.

### Release
`releaseMt()` (`@addr{0x80582F9C}`): if `driftState >= ChargedMt` and not braking, applies a
boost via `activateBoost(AllMt, mtLength)` where `mtLength = stats.miniTurbo` (frames), tripled
(`* 3.0f`) if `driftState == ChargedSmt`. Then resets to `NotDrifting`. If drift is cancelled
BEFORE reaching `ChargedMt` (released too early / hit a wall / stopped accelerating), no boost
fires — just `resetDriftManual()` clears state to neutral, and the outside-drift angle decays
back toward 0 at `driftOutsideDecrement` deg/frame (a per-vehicle stat) once actually released.

**Maps to our prototype as:** replace the continuous "steer lerps the arc between
driftSteerMin/Max" with (a) a locked `hopStickX ∈ {-1,+1}` direction set at drift-start/re-tap,
(b) drift angle ramps toward `±driftTargetDeg` at a fixed per-frame rate (analogous to
`150*tightness`), hard-clamped to ±60°, (c) our `driftGrip` should modulate how fast velocity
direction reconciles toward heading (see §5), separate from the angle-ramp above. Steering
input during drift should bias `realTurn` (facing rotation) but stay 20% pinned toward the
locked direction, not fully free.

---

## 2. Mini-turbo (charge / tiers / boost)

### Charge accumulation
`calcMtCharge()` (`@addr{0x8057EE50}`), runs every frame while drifting (via
`controlOutsideDriftAngle`), only while airtime ≤ 5:
```cpp
MAX_MT_CHARGE = 270; MAX_SMT_CHARGE = 300;
BASE_MT_CHARGE = 2; BASE_SMT_CHARGE = 2;                 // flat +2/frame always
BONUS_CHARGE_STICK_THRESHOLD = 0.4f; EXTRA_MT_CHARGE = 3; // +3/frame bonus, conditional

if (driftState == ChargingMt) {
    m_mtCharge += 2;
    // bonus +3 unless stick is deflected > 0.4 IN the locked-drift direction (hopStickX==-1 case)
    if (-0.4 <= stickX) {
        if (stickX > 0.4 && hopStickX == -1) mtCharge += 3;
    } else if (hopStickX != -1) mtCharge += 3;

    if (mtCharge > 270) { mtCharge = 270; driftState = ChargingSmt; }   // tier-up to SMT charging
}
if (driftState == ChargingSmt) {
    smtCharge += 2;  (same conditional +3 bonus)
    if (smtCharge > 300) { smtCharge = 300; driftState = ChargedSmt; }
}
```
At **60fps this is 270 frames ≈ 4.5s** to reach blue-MT-ready, then another **300 frames ≈ 5s**
of continued drifting to reach red-SMT-ready (total ~9.5s held drift for a red MT) — the +3
bonus (roughly +150% charge rate when eligible) cuts this significantly; eligibility is stick
NOT strongly deflected toward the outer/locked side (i.e., centered or slightly countersteered
charges faster — a widely-misunderstood mechanic; the *game* rewards not fighting the drift
lock rather than holding hard into it).

### Tiers
- `ChargingMt` (0-270 charge) → reaching 270 flips to `ChargingSmt` (does NOT yet grant a
  boost — must release while `driftState >= ChargedMt`... but note `ChargedMt` isn't set by
  `calcMtCharge` in the excerpted code path — the tier that grants blue MT is effectively
  "charge complete, still drifting", captured elsewhere as `driftState==ChargedMt` before
  `ChargingSmt` supersedes it. Practically: release between reaching charge-complete and before
  charging SMT to fully = blue MT; hold through to `ChargedSmt` (300 more charge) = red SMT.
- `ChargedSmt` charge stops accumulating further (early-return guard at top of function).

### Boost strength & duration per tier
From `releaseMt()` + `KartBoost::calc()` (KartBoost.cc):
```cpp
mtLength = stats.miniTurbo;              // per-vehicle stat, in FRAMES (1/60s units)
if (driftState == ChargedSmt) mtLength *= 3.0f;   // red MT = 3x blue duration
activateBoost(Type::AllMt, mtLength);
```
`KartBoost::calc()` boost EFFECT while `AllMt` active (index 0 of 3 boost types
AllMt/MushroomAndBoostPanel/TrickAndZipper):
```
MULTIPLIERS = {0.2f, 0.4f, 0.3f};      // AllMt: speed *= 1.2  (item boost 1.4, trick/zipper 1.3)
ACCELERATIONS = {3.0f, 7.0f, 6.0f};    // AllMt: flat accel = 3.0/frame while active
LIMITS = {-1.0f, 115.0f, -1.0f};       // AllMt: no extra speed-limit override (uses normal cap)
```
So an MT boost is **flat**: `+20% max-speed multiplier` and `accel forced to 3.0/frame` for the
whole duration (a countdown timer, decremented every `calc()`), THEN cuts off — it is not a
ramped/tapering kick, it's a step function that ends abruptly when the timer hits 0.
`activate()` only re-triggers/extends if the new duration exceeds remaining timer (stacking
multiple boosts doesn't add, it takes the max remaining time).

### Decay after boost ends
There is no explicit "decay" curve — `KartBoost::calc()` simply stops applying the multiplier
the frame the timer expires (`m_active[i]=false`), and speed then falls under normal drag
(`m_speed *= 0.98f`/`0.95f` coast-down multipliers from `calcVehicleSpeed()`, §4) like regular
driving. The "decay" players feel is just the normal accel/speed-limit curve re-engaging.

**Maps to our prototype as:** charge to 2 tiers using a flat/frame accumulation (not
steer-proportional — mostly stick-agnostic past a small deadzone, with a *bonus* for not
countersteering hard); tier 1 ~4-5s held, tier 2 ~+5s more; boost = flat `maxSpeed *= 1.2`
+ forced high acceleration for `durationFrames` (tier2 = 3x tier1 duration), then hard cutoff
back to normal accel curve — no separate "ramped kick" needed, a boolean boost-active flag
with a countdown timer reproduces this faithfully.

---

## 3. Steering / handling

### Turn-rate formula vs speed (`calcRotation`, `@addr{0x8057C69C}`)
Base turn value picked by state:
```cpp
turn = drifting ? (autoDrift ? driftAutomaticTightness : driftManualTightness)
                : (autoDrift ? handlingAutomaticTightness : handlingManualTightness);
if (drifting && !insideBike) { m_outsideDriftBonus *= 0.99f; turn += m_outsideDriftBonus; }
turn *= m_realTurn;   // apply the smoothed input from calcTurn(), see below
```
Then the **speed-dependent taper** (only while not drifting, moving forward, no wall collision,
|speed| ≥ 1):
```cpp
if (m_speed >= 20.0f) {
    turn *= 0.5f;
    if (m_speed < 70.0f) turn += (1.0f - (m_speed - 20.0f) / 50.0f) * turn;
    // i.e. at speed=20: turn*=0.5 then turn+=1.0*turn => turn back to full (1.0x)
    // at speed=70: turn*=0.5, +0*turn => turn stays at 0.5x (half rate)
    // linear interpolation from 1.0x @ 20 speed down to 0.5x @ 70 speed
} else {
    turn = (turn * 0.4f) + (m_speed / 20.0f) * (turn * 0.6f);
    // at speed=0: turn = 0.4*turn (40% floor, never fully zero)
    // at speed=20: turn = 0.4*turn + 0.6*turn = full turn
    // linear ramp 40%→100% as speed goes 0→20
}
```
**Shape: turn rate is 40% at a dead stop, ramps linearly to 100% at speed=20, then decays
linearly from 100% down to 50% as speed climbs 20→70, and holds at 50% above 70** (constant
past the taper window — the code has no further speed dependence beyond 70).

Extra modifiers stacked after the base/speed curve:
- Hop apex bonus: `if (Hop && hopPosY>0) turn *= 1.4f` (turn is boosted mid-hop).
- Standstill-SMT charging: `turn = realTurn * 0.04f` (steering almost locked out while doing a
  stationary snake/SSMT charge).
- Zero-turn deadzone: if not moving (|speed|<1) and no wall collision and not hopping, `turn=0`
  entirely (prevents in-place spinning at a standstill).
- Zipper boost: `turn *= 2.0f` if `ZipperBoost` active and not drift-manual (sharper turning
  under a zipper speed boost, kart-only relevant if we ever add zippers — otherwise ignore).
- Auto-drift stick-scaling: if `autoDrift` and `|stickX| > 0.3`, adds a bonus scaled by
  `(stickX-0.3)/0.7 * turn * (drifting?0.2:0.5) * speedRatioCapped` — auto-drift assist lets
  large stick deflections add extra turn on top of the base curve.
- Airborne falloff: `airtime≥70 → turn=0`; `airtime∈[30,70) → turn *= max(0, 1-(airtime-30)*0.025)`
  (turning authority fades out over ~1.7s of airtime, fully gone past 70 frames ≈ 1.17s).
- Facing-vs-velocity-divergence clamp (drift/trick related): if the angle between kart forward
  and `m_dir` (velocity heading) exceeds 60°, `turn *= max(0, 1-(angle-60)/40)` — turning
  authority drops off if you're already sliding sideways more than 60°, zero past 100°.

### Smoothing on stick input (`calcTurn`, already shown in §1)
`weightedTurn = rawTurn*reactivity + weightedTurn*(1-reactivity)` — a standard one-pole
low-pass/exponential smoothing filter, `reactivity` = `driftReactivity` or `handlingReactivity`
(per-vehicle stat, higher = snappier/less smoothing). This runs BEFORE the turn-rate curve
above, so raw stick taps never instantly snap the effective turn value — everything is
smoothed first, then scaled by the speed-dependent curve.

**Maps to our prototype as:** replace `theta += steer*steerRate*sqrt(speed/maxSpeed)*dt` with
a 2-stage pipeline: (1) exponential-smooth the raw steer axis toward a `weightedTurn` state
variable at a `reactivity` rate, (2) multiply the smoothed value by a piecewise speed curve —
40%→100% ramp from 0→20 units, 100%→50% linear taper 20→70, flat 50% above 70 — instead of a
single sqrt curve. This reproduces MKW's "tight at low speed, loosens at speed, floor never
zero" handling feel much better than a monotonic sqrt.

---

## 4. Speed / acceleration

### Accel curve shape (`calcVehicleAcceleration`, `@addr{0x8057B868}`)
Piecewise-linear interpolation over per-vehicle stat arrays, keyed by **speed ratio**
(`m_speed / m_softSpeedLimit`), separate tables for drifting vs standard:
```cpp
as/ts = isDrifting ? (accelerationDriftA[2], accelerationDriftT[1])
                    : (accelerationStandardA[4], accelerationStandardT[3]);
// walk t-breakpoints; interpolate linearly between (t_prev, a[i-1]) and (t[i], a[i])
// past the last breakpoint, acceleration = as.back() (constant tail)
```
So it's a **lookup-table + lerp** system (4 accel points / 3 ratio-breakpoints for standard
driving, 2 points / 1 breakpoint while drifting — drift acceleration is a simpler 2-segment
curve), not a closed-form formula; exact numbers are per-vehicle (loaded from `KartParam.bin`,
not in source). Shape is universally: **high acceleration near ratio=0 (starting from a
stop), tapering down as speed ratio approaches 1.0 (top speed)** — classic diminishing-returns
accel curve. Community-documented typical shape (Custom Mario Kart wiki, secondary source):
karts interpolate across roughly 5 points from ~0 ratio (steep initial accel) down through
mid-ratios to a shallow tail near ratio 1 (https://wiki.tockdom.com/wiki/Mario_Kart_Wii_Deluxe/Vehicle_Stats).

### Coast-down / drag when not accelerating
From `calcVehicleSpeed()` (`@addr{0x8057AB68}`):
```cpp
if (offBit(Brake) || onBit(DisableBackwardsAccel, SomethingWallCollision))
    m_speed *= (m_speed > 0.0f ? 0.98f : 0.95f);   // coast: 2%/frame drag fwd, 5%/frame drag reverse-recovery
```
Airborne/no-input drag multipliers: `0.999f` generic airborne-or-zipper drag, `0.99f` on a
jump-pad without accelerating — i.e. **very light drag while airborne** (mostly preserves
speed), heavier active-coast drag (2%/frame) while grounded and not accelerating.

Off-road handling isn't a separate multiplier system in `KartMove` proper — it flows through
`m_kclSpeedFactor` (surface-type speed factor, populated from `stats.kclSpeed[32]` — a
per-vehicle table indexed by 32 possible KCL terrain-type codes, i.e. **off-road penalty is a
per-vehicle-tunable multiplier looked up by ground material**, applied directly into the soft
speed-limit calc in `calcAcceleration()`:
```cpp
speedLimit *= scaleMultiplier * (wheelieBonus * m_kclSpeedFactor);
```
So off-road isn't a flat "50% speed on grass" constant — it scales the effective soft speed CAP
(you can still be going faster than the new cap and decelerate toward it), not an instant speed
cut, and the factor is per-vehicle/per-surface data-driven.

### Turning bleeds speed
Also in `calcVehicleSpeed()`, while not boosting/drifting/auto-drifting:
```cpp
f32 x = 1.0f - abs(m_weightedTurn) * m_speedRatioCapped;
m_speed *= stats.turningSpeed + (1.0f - stats.turningSpeed) * x;
```
Sharper turns at higher speed ratio bleed more speed (turningSpeed stat sets the floor
multiplier at full-turn-full-speed; at zero turn, multiplier is always 1.0 — no bleed).

**Maps to our prototype as:** keep a simple lookup-curve for accel-vs-speed-ratio (a handful of
{ratio, accel} points lerped, steep near 0 tapering to shallow near 1) rather than a smooth
formula; apply light drag (~0.1-0.3%/frame) while airborne, heavier drag (~2%/frame) while
grounded-and-coasting; make offroad multiply the effective **speed cap** (soft limit) rather
than instantly slash current speed, so a fast entry onto grass decelerates smoothly toward the
lower cap; optionally bleed a few % of speed per frame proportional to `|steer| * speedRatio`
during hard turns for extra feel.

---

## 5. Feel-critical details / grip-slip model

### Velocity direction vs facing direction are DECOUPLED, reconciled gradually
This is the single biggest "arcade clones get wrong" item. MKW kart velocity is NOT
`facingDir * speed`. Internal velocity direction is `m_vel1Dir` (their approximation of our "v
rotated toward heading at rate grip"), reconciled toward the up-vector/turn cross product each
frame in `calcAcceleration()`:
```cpp
crossVec = m_smoothedUp.cross(m_dir);           // m_dir = current velocity heading, not facing!
if (m_speed < 0) crossVec = -crossVec;
rotationScalar = onBoostRamp ? 4.0f : (airborne ? 0.2f : 0.5f);   // degrees-equivalent rotation rate
local_90.setAxisRotation(DEG2RAD * rotationScalar, crossVec);
m_vel1Dir = local_90 * m_vel1Dir;               // ROTATE the velocity-direction vector toward crossVec-implied heading
```
So velocity direction is itself rotated toward the target heading at a small fixed angular
step per frame (0.5° baseline grounded, 0.2° airborne, 4° on a boost ramp) — this IS their
grip/slip model: **a slowly-turning velocity vector chasing a faster-turning facing/heading**,
which is exactly the "v rotated toward heading*|v| at rate grip" idea in our spec, except MKW's
rate is a small FIXED angular step per frame (not proportional to the angle gap, i.e. linear
angular velocity, not an exponential spring) and is itself modulated by ground contact and
ramp/boost state. Facing direction (`m_dir`, separately maintained via `calcDirs()`, not shown
above) turns faster than this — the gap between the two IS the visible drift/slide.

### Distinct "hop" vs "drift lock" state machine, not a single flag
Many arcade clones treat drift as one boolean once the button is held. MKW separates: `Hop`
(vertical impulse + no turn lock yet) → `SlipdriftCharge` (pre-drift charge while stick held) →
`DriftManual` (actual locked drift, direction fixed via `m_hopStickX`) → `ChargingMt` →
`ChargingSmt` → `ChargedSmt`. Direction re-lock only happens on a fresh hop, not by continuously
reading the stick — this is why re-flicking the stick during a drift can "reset" the arc rather
than smoothly re-aim it.

### Turning bleeds speed AND speed limits turning — bidirectional coupling
Already covered in §3/§4 but worth flagging together: turn rate depends on speed (§3's curve),
AND speed is reduced by turning (§4's `turningSpeed` bleed) — a feedback loop that makes fast
tight turns cost real speed, discouraging both "handbrake mini-drift spam" and "infinite tight
circles" without needing an explicit friction/traction-loss system.

### Deadzone / minimum-turn floor prevents in-place spin
`if (|speed| < 1.0 && no wall collision && not hopping) turn = 0` — completely zeroes turning
at a standstill (except while airborne-hopping), preventing the classic arcade-kart bug of
spinning in place with no forward speed.

**Maps to our prototype as:** don't just rotate velocity to match heading every frame at a
constant "grip" fraction of the angle gap (exponential/spring-like) — consider instead rotating
`v`'s direction toward the target heading by a small FIXED angular step per frame (linear, not
proportional to gap size), with the step size modulated by ground/air state (bigger step
grounded, smaller airborne). This produces MKW's characteristic "velocity lags behind facing
during a fast turn, catches up at a steady rate" feel rather than a smooth exponential settle.
Also worth stealing cheaply: zero-out turn input below a speed threshold, and let turning
itself bleed a little speed at high turn-rate × high speed-ratio.
