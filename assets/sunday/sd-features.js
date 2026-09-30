'use strict';
/* Sunday, part 2: key moments + highlights, team pages and settings.
   Loaded after sd-app.js and uses its globals (S, G, $, esc…). No rankings (the NFL has none)
   and no push alerts (see docs/tooling.md house rules for this port). */

/* ═════════════ Key moments ═════════════ */
// The plays that moved win probability the most. Ranked by swing, shown in game order.
function computeMoments() {
  const sum = G?.sum;
  if (!sum?.wp?.length) return [];
  if (G.moms && G.momsKey === sum.wp.length) return G.moms;
  const idx = new Map(sum.flat.map((f, i) => [f.p.id, i]));
  const out = [];
  for (let i = 1; i < sum.wp.length; i++) {
    const p = sum.byId.get(sum.wp[i].playId);
    if (!p || p.kind === 'meta' || !idx.has(p.id)) continue;
    out.push({ p, d: sum.wp[i].homeWinPercentage - sum.wp[i - 1].homeWinPercentage, fi: idx.get(p.id) });
  }
  G.moms = out.filter((m) => Math.abs(m.d) >= 0.06).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6).sort((a, b) => a.fi - b.fi);
  G.momsKey = sum.wp.length;
  return G.moms;
}
// Match a highlight clip to a play by a player's last name in the clip headline.
function clipFor(p, vids) {
  const names = p.parts.map((x) => x.athlete?.lastName || (x.athlete?.displayName || '').split(' ').pop()).filter((n) => n && n.length >= 3);
  return vids.findIndex((v) => names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '')}\\b`, 'i').test(v.headline || '')));
}
function tabMoments() {
  const ev = G.ev;
  const moms = computeMoments();
  const vids = (G.sum.raw.videos || []).filter((v) => v.links?.source?.href);
  const pc = pair(ev.away, ev.home);
  let html = '<div class="box-t">Key moments</div>';
  if (moms.length) {
    html += '<div class="box mom-box">' + moms.map((m, k) => {
      const team = m.d > 0 ? ev.home : ev.away;
      const col = m.d > 0 ? pc.hRaw : pc.aRaw;
      const ci = clipFor(m.p, vids);
      return `<div class="mom">
        <button class="mom-main" data-mom="${m.fi}" aria-label="Show key moment ${k + 1} on the field">
          <span class="mom-n">${k + 1}</span>
          <span class="mom-body"><span class="mom-k">${periodLabel(m.p.period)} ${esc(m.p.clock)}${m.p.sDD ? ` · ${esc(m.p.sDD)}` : ''}</span><span class="mom-t">${playHTML(m.p.text)}</span></span>
          <span class="swing" style="--tc:${col}"><b>+${Math.round(Math.abs(m.d) * 100)}%</b><small>${esc(team.abbr)}</small></span>
        </button>
        <div class="mom-acts"><button class="clip-btn" data-anim="${esc(m.p.id)}">${ICON.play}Animate</button>${ci >= 0 ? `<button class="clip-btn" data-vid="${ci}">${ICON.play}Watch clip</button>` : ''}</div>
      </div>`;
    }).join('') + '</div>';
  } else html += '<div class="box"><p class="muted-p">No big momentum swings yet.</p></div>';
  html += '<div class="box-t">Win probability</div>' + tabWP(moms);
  if (vids.length) {
    html += `<div class="box-t">Highlights</div><div class="vids">${vids.map((v, i) => `
      <button class="vid" data-vid="${i}"><span class="vth"><img src="${esc(v.thumbnail)}" alt="" loading="lazy"><span class="vplay">${ICON.play}</span>${v.duration ? `<span class="vdur">${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, '0')}</span>` : ''}</span><span class="vh">${esc(v.headline)}</span></button>`).join('')}</div>`;
  }
  return html;
}
function openVideo(i) {
  const v = (G?.sum?.raw.videos || []).filter((x) => x.links?.source?.href)[i];
  if (!v) return;
  const m = $('#video-modal');
  m.innerHTML = `<div class="vm-in" role="dialog" aria-modal="true" aria-label="${esc(v.headline)}">
    <video src="${esc(v.links.source.href)}" poster="${esc(v.thumbnail)}" controls autoplay playsinline></video>
    <div class="vm-cap"><span>${esc(v.headline)}</span><button class="icon-btn" data-vclose aria-label="Close video">${ICON.close}</button></div></div>`;
  m.hidden = false;
  m.querySelector('[data-vclose]').focus();
}
function closeVideo() { const m = $('#video-modal'); m.querySelector('video')?.pause(); m.hidden = true; m.innerHTML = ''; }
$('#video-modal').addEventListener('click', (e) => { if (e.target.id === 'video-modal' || e.target.closest('[data-vclose]')) closeVideo(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#video-modal').hidden) { closeVideo(); e.stopImmediatePropagation(); } }, true);
document.addEventListener('click', (e) => {
  if (!G) return;
  const mb = e.target.closest('[data-mom]');
  if (mb) { stopReplay(); setCursor(+mb.dataset.mom); $('.field-sec').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#game-view').scrollBy({ top: -56 }); return; }
  const vb = e.target.closest('[data-vid]');
  if (vb) { openVideo(+vb.dataset.vid); return; }
});
/* ═════════════ One page: the scores board ═════════════
   2026-09-27, user: "lets have Sunday replace the Scores tab in GFFL, but lets ditch the matchup and
   standings pages in Sunday. Rename it to 'Scores'." GFFL's own Matchup view has the matchups;
   showTab stays as the one place the board is shown from (route() calls it). */
S.tab = 'scores';
function showTab() {
  const changed = S.tab !== 'scores';
  S.tab = 'scores';
  if (changed) window.scrollTo(0, 0);
}

/* ═════════════ Team pages ═════════════ */
let T = null;
async function openTeamView(id) {
  if (T && T.id === id) { $('#team-view').hidden = false; return; }
  T = { id };
  const v = $('#team-view');
  v.classList.remove('closing');
  v.hidden = false;
  v.scrollTop = 0;
  document.body.classList.add('game-open');
  v.innerHTML = `<header class="g-top"><div class="g-top-row"><button class="back" id="t-back">${ICON.back}Back</button><div class="g-mini"></div><div class="g-top-sp"></div></div></header>
    <div class="g-body"><div class="t-hero" id="t-hero"><div class="skel-card" style="background:transparent;border:0"><i class="row"></i></div></div><div class="tab-body" id="t-body"></div></div>`;
  $('#t-back').onclick = goBack;
  requestAnimationFrame(() => $('#t-back')?.focus({ preventScroll: true }));
  try {
    const [info, sched] = await Promise.all([getJSON(`${API}/teams/${id}`), getJSON(`${API}/teams/${id}/schedule`)]);
    if (!T || T.id !== id) return;
    T.team = info.team;
    T.sched = sched.events || [];
    renderTeam();
  } catch { $('#t-body').innerHTML = '<div class="empty"><h3>Can’t load this team</h3><p>Check your connection and try again.</p></div>'; }
}
function closeTeamView() {
  if (!T) return;
  T = null;
  const v = $('#team-view');
  v.classList.add('closing');
  setTimeout(() => { if (!T) { v.hidden = true; v.innerHTML = ''; v.classList.remove('closing'); if (!G) document.body.classList.remove('game-open'); } }, 240);
}
function renderTeam() {
  if (!T?.team) return;
  const t = T.team;
  const tm = { id: t.id, abbr: t.abbreviation, color: hex(t.color, '#555555'), alt: hex(t.alternateColor, '#999999') };
  const col = teamInk(tm);
  const light = lum(col) <= 0.42;
  const rec = t.record?.items?.find((i) => i.type === 'total')?.summary || '';
  $('#t-hero').innerHTML = `<div class="t-hero-in ${light ? 'on-light' : 'on-dark'}" style="background:${col}">
    ${logoImg(tm, 72, 't-logo', light)}
    <div class="t-id"><h2>${esc(t.location || t.displayName)}</h2><p>${esc(t.name || '')}</p>
      <p class="t-meta">${esc(rec)}${t.standingSummary ? ` · ${esc(t.standingSummary)}` : ''}</p></div>
  </div>`;
  const live = S.events.find((e) => e.state === 'in' && (e.home.id === t.id || e.away.id === t.id));
  const rows = T.sched.map((ev) => {
    const c = ev.competitions?.[0];
    if (!c) return '';
    const me = c.competitors.find((x) => x.team.id === t.id), op = c.competitors.find((x) => x.team.id !== t.id);
    if (!me || !op) return '';
    const st = c.status?.type || ev.status?.type || {};
    const d = new Date(ev.date);
    const otm = { id: op.team.id, abbr: op.team.abbreviation, color: hex(op.team.color, '#555555') };
    const ms = +(me.score?.displayValue ?? me.score) || 0, os = +(op.score?.displayValue ?? op.score) || 0;
    let right;
    if (st.state === 'post') right = `<span class="res ${me.winner ? 'w' : 'l'}">${me.winner ? 'W' : 'L'} ${ms}–${os}</span>`;
    else if (st.state === 'in') right = `<span class="res live"><i class="ldot"></i>${ms}–${os}</span>`;
    else right = `<span class="res pre">${c.timeValid === false ? 'TBA' : esc(fmtTime(d))}<small>${esc(tvShort((c.broadcasts?.[0]?.media?.shortName) || ''))}</small></span>`;
    return `<a class="lrow sched" href="#g${ev.id}"><div class="when">${esc(d.toLocaleDateString([], { month: 'short', day: 'numeric' }))}<small>${me.homeAway === 'home' ? 'Home' : c.neutralSite ? 'Neutral' : 'Away'}</small></div>
      <div class="mt"><div class="t">${logoImg(otm, 22)}<span class="nm">${me.homeAway === 'home' ? 'vs' : '@'} ${esc(op.team.location || op.team.shortDisplayName || op.team.displayName)}</span></div></div>${right}</a>`;
  }).join('');
  $('#t-body').innerHTML = `${live ? `<div class="box-t">Playing now</div><div class="grid">${liveCard(live)}</div>` : ''}
    <div class="box-t">${esc(String(T.sched[0]?.season?.year || ''))} schedule</div><div class="list">${rows || '<p class="muted-p" style="padding:14px">No games scheduled.</p>'}</div>`;
}

/* ═════════════ Settings: appearance only ═════════════ */
// No push alerts, no service worker, no api/* calls in this port — the settings sheet keeps only
// the Day/Night appearance control and a link out to the league.
// "Your GFFL team" — changing it used to live on the Matchups page. GFFL's own login (gffl_team)
// picks it on first visit; this overrides it for this device (sun.team, see sd-ffui.js).
function ffTeamPickHtml() {
  if (typeof FF === 'undefined' || !FF.teams || !FF.teams.size) return '';
  const opts = [...FF.teams.values()].map((t) => `<option value="${t.id}"${t.id === FF.myTeamId ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
  return `<h5>Your GFFL team</h5><select id="ff-team-pick" class="set-select" aria-label="Your GFFL team"><option value="">Choose…</option>${opts}</select>`;
}
function openSettings() {
  const sh = $('#week-sheet');
  const theme = isDark() ? 'dark' : 'light';
  sh.innerHTML = `<div class="sheet-in" role="dialog" aria-modal="true" aria-labelledby="set-title"><div class="sheet-hd"><h4 id="set-title">Settings</h4><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <h5>Appearance</h5><div class="seg" role="group" aria-label="Theme"><button data-theme-set="light" aria-pressed="${theme === 'light'}">Day</button><button data-theme-set="dark" aria-pressed="${theme === 'dark'}">Night</button></div>
    ${ffTeamPickHtml()}
    <h5>GFFL</h5><a class="btn ghost" href="/league.html" style="display:block;text-align:center">Open GFFL</a>
  </div>`;
  sh.hidden = false;
  S.sheetReturn = $('#settings-btn');
  S.sheetReturnSel = '#settings-btn';
  sh.querySelector('[data-close]').focus({ preventScroll: true });
}
$('#settings-btn').addEventListener('click', openSettings);
$('#week-sheet').addEventListener('click', (e) => {
  const t = e.target.closest('[data-theme-set]');
  if (t) { setTheme(t.dataset.themeSet); openSettings(); }
});
function setTheme(t) {
  store.set('theme', t);
  applyTheme();
  document.querySelectorAll('#board [data-key], #gv-side-list [data-key]').forEach((n) => { n._html = null; });
  renderBoard();
  if (G) { renderHero(); drawFieldStatic(); renderFieldView(false); renderTabBody(); }
  if (T) renderTeam();
}

// First navigation, now that every view exists.
route();
