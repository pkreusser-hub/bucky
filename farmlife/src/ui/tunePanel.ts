import { Tune, TUNE_META, saveTune, resetTune, type NumericTuneKey } from "../tune";

// Collapsible slider panel (Farm Kart convention). Toggle with T (desktop) or
// a ⚙ button (mobile). Persists to localStorage fl_tune_v1 on every change.
// Uses CSS transitions (not @keyframes — those stall in headless Chrome).

export interface TunePanel {
  root: HTMLElement;
  toggle(): void;
  isOpen(): boolean;
  /** Re-sync the mute checkbox to the audio state (e.g. after the M shortcut). */
  syncAudio?(): void;
}

/** Audio controls the panel exposes (mute row + SFX volume slider). Optional so
 * the panel still builds without audio (tests / editor). */
export interface AudioControls {
  isMuted(): boolean;
  setMuted(m: boolean): void;
  getVolume(): number;
  setVolume(v: number): void;
}

export function buildTunePanel(
  tune: Tune,
  onChange: () => void,
  audio?: AudioControls,
  onFastGrow?: (on: boolean) => void
): TunePanel {
  const style = document.createElement("style");
  style.textContent = `
    #fl-tune { position: fixed; top: 8px; right: 8px; z-index: 40; width: 232px;
      max-width: calc(100vw - 16px); background: rgba(24,32,24,.92); color: #eaf3e0;
      border: 1px solid rgba(255,255,255,.15); border-radius: 12px; padding: 10px 12px;
      font: 12px system-ui, sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.35);
      transform: translateY(-8px); opacity: 0; transition: transform .16s, opacity .16s;
      pointer-events: none; }
    #fl-tune.open { transform: translateY(0); opacity: 1; pointer-events: auto; }
    #fl-tune h4 { margin: 0 0 6px; font-size: 12px; letter-spacing: .04em; color: #b7e59a; }
    #fl-tune .row { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
    #fl-tune .row label { flex: 0 0 78px; color: #cfe0c0; }
    #fl-tune .row input[type=range] { flex: 1; }
    #fl-tune .row .val { flex: 0 0 40px; text-align: right; font-variant-numeric: tabular-nums; }
    #fl-tune .foot { display: flex; justify-content: space-between; margin-top: 8px; }
    #fl-tune button { background: #3a6b3a; color: #fff; border: 0; border-radius: 7px;
      padding: 5px 10px; font: 12px system-ui; cursor: pointer; }
    #fl-cog { position: fixed; top: 8px; right: 8px; z-index: 41; width: 40px; height: 40px;
      border-radius: 50%; border: 0; background: rgba(24,32,24,.85); color: #fff;
      font-size: 20px; display: none; align-items: center; justify-content: center; cursor: pointer; }
    body.fl-mobile #fl-cog { display: flex; }
  `;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "fl-tune";
  root.innerHTML = "<h4>⚙ TUNE (press T)</h4>";

  for (const key of Object.keys(TUNE_META) as NumericTuneKey[]) {
    const meta = TUNE_META[key];
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("label");
    label.textContent = meta.label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(meta.min);
    input.max = String(meta.max);
    input.step = String(meta.step);
    input.value = String(tune[key]);
    input.dataset.key = key;
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = tune[key].toFixed(2);
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      (tune[key] as number) = v;
      val.textContent = v.toFixed(2);
      saveTune(tune);
      onChange();
    });
    row.append(label, input, val);
    root.appendChild(row);
  }

  // ---- 🌱 Fast grow (testing) toggle — NOT a slider (boolean tune key) -------
  {
    const fgRow = document.createElement("div");
    fgRow.className = "row";
    const fgLabel = document.createElement("label");
    fgLabel.textContent = "🌱 Fast grow";
    fgLabel.title = "TESTING ONLY: every crop matures in ~60s. Turn OFF for real timings.";
    const fgBtn = document.createElement("button");
    fgBtn.id = "fl-tune-fastgrow";
    fgBtn.style.flex = "1";
    const paintFg = () => {
      fgBtn.textContent = tune.fastGrow ? "🌱 ON (test)" : "OFF";
      fgBtn.style.background = tune.fastGrow ? "#7a5a1f" : "#3a6b3a";
    };
    paintFg();
    fgBtn.addEventListener("click", () => {
      tune.fastGrow = !tune.fastGrow;
      paintFg();
      saveTune(tune);
      onFastGrow?.(tune.fastGrow);
    });
    fgRow.append(fgLabel, fgBtn);
    root.appendChild(fgRow);
    // keep the toggle label correct after a Reset (which restores defaults).
    root.addEventListener("fl-tune-reset", paintFg);
  }

  // ---- audio row: 🔊 mute toggle + SFX volume slider ------------------------
  let syncAudio: (() => void) | undefined;
  if (audio) {
    const sep = document.createElement("div");
    sep.style.cssText = "border-top:1px solid rgba(255,255,255,.12);margin:8px 0 4px";
    root.appendChild(sep);

    const muteRow = document.createElement("div");
    muteRow.className = "row";
    const muteLabel = document.createElement("label");
    muteLabel.textContent = "🔊 Audio";
    const muteBtn = document.createElement("button");
    muteBtn.id = "fl-tune-mute";
    muteBtn.style.flex = "1";
    const paintMute = () => {
      muteBtn.textContent = audio.isMuted() ? "🔇 Muted" : "🔊 On";
      muteBtn.style.background = audio.isMuted() ? "#6b3a3a" : "#3a6b3a";
    };
    paintMute();
    muteBtn.addEventListener("click", () => {
      audio.setMuted(!audio.isMuted());
      paintMute();
    });
    muteRow.append(muteLabel, muteBtn);
    root.appendChild(muteRow);
    syncAudio = paintMute;

    const volRow = document.createElement("div");
    volRow.className = "row";
    const volLabel = document.createElement("label");
    volLabel.textContent = "SFX vol";
    const vol = document.createElement("input");
    vol.type = "range";
    vol.id = "fl-tune-vol";
    vol.min = "0";
    vol.max = "1";
    vol.step = "0.05";
    vol.value = String(audio.getVolume());
    const volVal = document.createElement("span");
    volVal.className = "val";
    volVal.textContent = audio.getVolume().toFixed(2);
    vol.addEventListener("input", () => {
      const v = parseFloat(vol.value);
      audio.setVolume(v);
      volVal.textContent = v.toFixed(2);
    });
    volRow.append(volLabel, vol, volVal);
    root.appendChild(volRow);
  }

  const foot = document.createElement("div");
  foot.className = "foot";
  const reset = document.createElement("button");
  reset.textContent = "Reset";
  reset.addEventListener("click", () => {
    resetTune(tune);
    root.querySelectorAll("input[type=range]").forEach((el) => {
      const inp = el as HTMLInputElement;
      const key = inp.dataset.key as keyof Tune;
      inp.value = String(tune[key]);
      const v = inp.nextElementSibling as HTMLElement;
      if (v) v.textContent = (tune[key] as number).toFixed(2);
    });
    root.dispatchEvent(new Event("fl-tune-reset")); // repaint the fast-grow toggle
    onChange();
    onFastGrow?.(tune.fastGrow); // re-apply the restored (default) fast-grow state
  });
  const close = document.createElement("button");
  close.textContent = "Close";
  foot.append(reset, close);
  root.appendChild(foot);
  document.body.appendChild(root);

  const cog = document.createElement("button");
  cog.id = "fl-cog";
  cog.textContent = "⚙";
  document.body.appendChild(cog);

  let open = false;
  const panel: TunePanel = {
    root,
    isOpen: () => open,
    toggle() {
      open = !open;
      root.classList.toggle("open", open);
      cog.style.display = open ? "none" : "";
    },
    syncAudio,
  };
  close.addEventListener("click", () => panel.toggle());
  cog.addEventListener("click", () => panel.toggle());
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "t" && !e.repeat) panel.toggle();
  });

  return panel;
}
