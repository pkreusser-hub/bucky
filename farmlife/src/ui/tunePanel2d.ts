// ---------------------------------------------------------------------------
// tunePanel2d — the live TUNE panel, pruned to the knobs that still matter in
// the 2D build (the 3D camera knobs camDist/camHeight/camLag/camPitch/fov are
// gone — the pixel camera auto-fits). Keeps moveSpeed / runMult / turnRate /
// jumpVel / gravity / tankCapacity sliders + the fastGrow test toggle + a mute
// row. Toggle with the ` (backtick) key. Persists via saveTune.
// ---------------------------------------------------------------------------

import { type Tune, TUNE_META, saveTune, type NumericTuneKey } from "../tune";
import type { FarmAudio } from "../audio";

const KEYS: NumericTuneKey[] = ["moveSpeed", "runMult", "jumpVel", "gravity", "tankCapacity"];

export function buildTunePanel2d(tune: Tune, audio: FarmAudio, onFastGrow: (on: boolean) => void): { syncAudio(): void } {
  const style = document.createElement("style");
  style.textContent = `
    #fl-tune { position: fixed; top: 8px; right: 8px; z-index: 60; width: 210px; display: none;
      background: rgba(18,16,10,.92); border: 1px solid rgba(255,255,255,.16); border-radius: 10px;
      padding: 10px 12px; color: #eee; font: 11px system-ui, sans-serif; pointer-events: auto; }
    #fl-tune.open { display: block; }
    #fl-tune h4 { margin: 0 0 8px; font-size: 12px; color: #ffd35a; }
    #fl-tune .row { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
    #fl-tune .row label { flex: 0 0 78px; color: #cfc7ad; }
    #fl-tune .row input[type=range] { flex: 1; }
    #fl-tune .row .v { flex: 0 0 34px; text-align: right; font-variant-numeric: tabular-nums; }
    #fl-tune .toggle { display: flex; align-items: center; gap: 8px; margin-top: 8px; cursor: pointer; }
    #fl-tune .hint { margin-top: 8px; color: #8f886f; font-size: 10px; }
  `;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "fl-tune";
  root.innerHTML = `<h4>⚙ Tune (\` toggles)</h4>`;
  document.body.appendChild(root);

  for (const key of KEYS) {
    const meta = TUNE_META[key];
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<label title="${key}">${meta.label}</label>
      <input type="range" min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${tune[key]}">
      <span class="v">${(tune[key] as number).toFixed(2)}</span>`;
    const input = row.querySelector("input") as HTMLInputElement;
    const v = row.querySelector(".v") as HTMLElement;
    input.addEventListener("input", () => {
      (tune[key] as number) = parseFloat(input.value);
      v.textContent = (tune[key] as number).toFixed(2);
      saveTune(tune);
    });
    root.appendChild(row);
  }

  // fastGrow toggle (⚠ ship blocker — must be OFF for real farming timelines)
  const fg = document.createElement("label");
  fg.className = "toggle";
  fg.innerHTML = `<input type="checkbox" ${tune.fastGrow ? "checked" : ""}> 🌱 Fast grow (test)`;
  const fgInput = fg.querySelector("input") as HTMLInputElement;
  fgInput.addEventListener("change", () => {
    tune.fastGrow = fgInput.checked;
    saveTune(tune);
    onFastGrow(tune.fastGrow);
  });
  root.appendChild(fg);

  // mute toggle
  const mute = document.createElement("label");
  mute.className = "toggle";
  const muteInput = document.createElement("input");
  muteInput.type = "checkbox";
  muteInput.checked = audio.isMuted();
  mute.appendChild(muteInput);
  mute.appendChild(document.createTextNode(" 🔊 Mute (M)"));
  muteInput.addEventListener("change", () => {
    audio.resume();
    audio.setMuted(muteInput.checked);
  });
  root.appendChild(mute);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Camera auto-fits (integer pixel scale).";
  root.appendChild(hint);

  window.addEventListener("keydown", (e) => {
    if (e.key === "`" || e.key === "~") {
      e.preventDefault();
      root.classList.toggle("open");
    }
  });

  return {
    syncAudio() {
      muteInput.checked = audio.isMuted();
    },
  };
}
