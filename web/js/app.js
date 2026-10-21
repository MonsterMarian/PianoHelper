import { arrange, LEVELS } from './arrange.js';
import { estimateGrid, chordTrack, detectKey } from './analysis.js';
import { Player } from './audio.js';
import { draw, drawOverview, drawBars, drawKeyMap, layoutKeys, keyRange, HANDLE } from './render.js';
import { barTimes, barAt, loopBars, loopFromTimes, shiftLoop } from './loop.js';
import { songEnd, noteName, isBlack } from './music.js';
import { toMusicXML } from './musicxml.js';
import { keyboardInput, midiInput } from './input.js';

const $ = (id) => document.getElementById(id);
const player = new Player();
window.pianoHelper = { player };          // pro ladeni v konzoli a testy

// Nastaveni uzivatele (jen pohodli; bez localStorage vse funguje s vychozimi hodnotami)
const prefs = (() => { try { return JSON.parse(localStorage.getItem('pianohelper') || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('pianohelper', JSON.stringify(prefs)); } catch { /* soukrome okno */ } };

const state = {
  title: '', file: '', base: [], grid: null, chords: [], key: null, level: prefs.level ?? 4,
  notes: [], cache: new Map(), duration: 0, lo: 48, hi: 84, loop: null, loopOn: false,
  library: [], pressed: new Map(), octave: prefs.octave ?? 4,
  range: prefs.range ?? '61', custom: prefs.custom ?? null, songLo: 60, songHi: 72, bars: [0, 1],
};

window.pianoHelper.state = state;

const fmt = (t) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
function message(text) {
  $('message').hidden = !text;
  if (text) $('message-text').textContent = text;
}

// ── Knihovna ────────────────────────────────────────────────────────────────
async function loadIndex(select) {
  try { state.library = await (await fetch('songs/index.json', { cache: 'no-store' })).json(); } catch { state.library = []; }
  renderLibrary();
  // prvni navsteva: demo, at je hned co hrat
  const pick = select || prefs.song || state.library.find((s) => s.file === 'oda-na-radost.json')?.file || state.library[0]?.file;
  if (pick && state.library.some((s) => s.file === pick)) await loadSongFile(pick);
  else if (!state.base.length) message('Knihovna je prázdná. Otevři MIDI soubor, nebo převeď video z YouTube.');
}

function renderLibrary() {
  const list = $('song-list');
  list.innerHTML = '';
  if (!state.library.length) {
    list.innerHTML = '<li class="empty-row">Zatím tu nic není.</li>';
    return;
  }
  for (const s of state.library) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-current', String(s.file === state.file));
    b.innerHTML = '<span class="t"></span><span class="n"></span><span class="d"></span>';
    b.querySelector('.t').textContent = s.title;
    b.querySelector('.n').textContent = `${s.notes} not`;
    b.querySelector('.d').textContent = fmt(s.duration);
    b.addEventListener('click', () => { $('library').close(); loadSongFile(s.file); });
    li.append(b);
    list.append(li);
  }
}

async function loadSongFile(file) {
  try {
    const song = await (await fetch(`songs/${encodeURIComponent(file)}`)).json();
    prefs.song = file; savePrefs();
    state.file = file;
    setSong(song.title, song.notes);
    renderLibrary();
  } catch (e) { message(`Skladbu se nepodařilo načíst: ${e.message}`); }
}

function setSong(title, notes) {
  player.pause();
  state.title = title;
  state.base = notes.map((n) => ({ p: n.p, s: n.s, e: n.e, h: n.h || '' })).filter((n) => n.e > n.s);
  if (!state.base.length) { message('Skladba neobsahuje žádné noty.'); return; }
  state.grid = estimateGrid(state.base);
  state.chords = chordTrack(state.base, state.grid, songEnd(state.base));
  state.cache.clear();
  state.loop = null; state.loopOn = false;
  state.key = detectKey(state.base);
  $('title').textContent = title;
  $('m-key').textContent = state.key.name;
  $('m-bpm').textContent = `${Math.round(60 / state.grid.beat)}`;
  $('m-meter').textContent = `${state.grid.meter}/4`;
  document.title = `${title} — PianoHelper`;
  message('');
  applyLevel();
  player.seek(Math.max(0, state.base[0].s - 1));
  updateLoopUi();
  syncPlay();
}

function applyLevel() {
  if (!state.base.length) return;
  if (!state.cache.has(state.level)) state.cache.set(state.level, arrange(state.base, state.level, state.grid));
  state.notes = state.cache.get(state.level);
  player.setNotes(state.notes);
  const ps = state.notes.map((n) => n.p);
  state.songLo = Math.min(...ps); state.songHi = Math.max(...ps);
  updateRange();
  state.duration = songEnd(state.notes);
  state.bars = barTimes(state.grid, Math.max(state.duration, songEnd(state.base)));
  if (state.loop) setLoop(state.loop.from, state.loop.to, state.loopOn);
  for (const b of $('levels').children) b.setAttribute('aria-pressed', String(Number(b.dataset.level) === state.level));
}

// Viditelny vyrez klaviatury (61 klaves jako ve videich, nebo co si uzivatel zvoli)
function updateRange() {
  [state.lo, state.hi] = keyRange(state.range, state.songLo, state.songHi, state.custom);
  $('range').value = state.range;
}
$('range').addEventListener('change', () => {
  state.range = $('range').value;
  if (state.range === 'custom' && !state.custom) state.custom = { lo: state.lo, hi: state.hi };
  prefs.range = state.range; savePrefs();
  updateRange();
});

// minimapa: tazeni = posun vyrezu, tazeni za okraj = velikost, klik vedle = skok
const km = $('keymap');
let kmDrag = null;
const kmPitch = (ev) => {
  const r = km.getBoundingClientRect();
  const x = ev.clientX - r.left;
  for (const [p, k] of layoutKeys(21, 108, r.width).keys) if (!k.black && x >= k.x && x < k.x + k.w) return p;
  return x < 0 ? 21 : 108;
};
const snap = (lo, hi) => {
  lo = Math.max(21, Math.min(lo, 96)); hi = Math.min(108, Math.max(hi, lo + 12));
  while (isBlack(lo)) lo--;
  while (isBlack(hi)) hi++;
  return { lo, hi };
};
km.addEventListener('pointerdown', (ev) => {
  const p = kmPitch(ev);
  const { lo, hi } = state;
  if (Math.abs(p - lo) <= 1) kmDrag = { mode: 'lo' };
  else if (Math.abs(p - hi) <= 1) kmDrag = { mode: 'hi' };
  else {
    if (p < lo || p > hi) {                                           // klik vedle -> vyrez se tam presune
      const w = hi - lo;
      const nlo = Math.max(21, Math.min(108 - w, p - Math.round(w / 2)));
      state.custom = snap(nlo, nlo + w);
      state.range = 'custom';
      updateRange();
    }
    kmDrag = { mode: 'pan', grab: p - state.lo, width: state.hi - state.lo };
  }
  km.setPointerCapture(ev.pointerId);
});
km.addEventListener('pointermove', (ev) => {
  if (!kmDrag) return;
  const p = kmPitch(ev);
  let { lo, hi } = state;
  if (kmDrag.mode === 'lo') lo = Math.min(p, hi - 12);
  else if (kmDrag.mode === 'hi') hi = Math.max(p, lo + 12);
  else { lo = Math.max(21, Math.min(108 - kmDrag.width, p - kmDrag.grab)); hi = lo + kmDrag.width; }
  state.custom = snap(lo, hi);
  state.range = 'custom';
  updateRange();
});
km.addEventListener('pointerup', () => {
  if (!kmDrag) return;
  kmDrag = null;
  prefs.range = state.range; prefs.custom = state.custom; savePrefs();
});

// ── Import .mid / .json ─────────────────────────────────────────────────────
function midiToNotes(buf) {
  if (!window.Midi) throw new Error('knihovna pro MIDI se nenačetla (chybí internet?)');
  const midi = new window.Midi(buf);
  const tracks = midi.tracks.filter((t) => t.notes.length && t.channel !== 9);
  const avg = (t) => t.notes.reduce((a, n) => a + n.midi, 0) / t.notes.length;
  const hand = (t) => (/left|lev|\blh\b|bass/i.test(t.name) ? 'L' : /right|prav|\brh\b|melod/i.test(t.name) ? 'R' : '');
  let hands = tracks.map(hand);
  if (hands.every((h) => !h) && tracks.length === 2) hands = avg(tracks[0]) >= avg(tracks[1]) ? ['R', 'L'] : ['L', 'R'];
  return tracks.flatMap((t, i) => t.notes.map((n) => ({ p: n.midi, s: n.time, e: n.time + n.duration, h: hands[i] || '' })));
}

$('file').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  $('library').close();
  try {
    state.file = '';
    if (/\.json$/i.test(f.name)) {
      const song = JSON.parse(await f.text());
      setSong(song.title || f.name, song.notes);
    } else {
      setSong(f.name.replace(/\.midi?$/i, ''), midiToNotes(await f.arrayBuffer()));
    }
    renderLibrary();
  } catch (e) { message(`Soubor nejde otevřít: ${e.message}`); }
  ev.target.value = '';
});

// ── Prevod z YouTube (jen kdyz bezi server.py) ──────────────────────────────
async function initConvert() {
  try { if (!(await fetch('api/health')).ok) return; } catch { return; }
  $('convert').hidden = false;
  $('convert').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { url: $('yt').value.trim(), start_note: $('start-note').value.trim() };
    const res = await fetch('api/convert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const job = await res.json();
    if (!res.ok) { $('job').textContent = job.error || 'Chyba'; return; }
    pollJob(job.id);
  });
}

async function pollJob(id) {
  const job = await (await fetch(`api/jobs/${id}`)).json();
  $('job').textContent = job.status === 'running' ? `Převádím… ${job.last_line || ''}` : job.status === 'done' ? 'Hotovo — skladba je v knihovně.' : `Převod selhal: ${job.last_line || ''}`;
  if (job.status === 'running') setTimeout(() => pollJob(id), 1500);
  else if (job.status === 'done') loadIndex(job.song);
}

// ── Dialogy ─────────────────────────────────────────────────────────────────
const openLibrary = () => $('library').showModal();
$('library-open').addEventListener('click', openLibrary);
document.querySelectorAll('[data-open-library]').forEach((b) => b.addEventListener('click', openLibrary));
$('settings-open').addEventListener('click', () => $('settings').showModal());
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });     // klik mimo = zavrit
}

// ── Ovladani ────────────────────────────────────────────────────────────────
for (const l of LEVELS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.level = l.id;
  b.title = `${l.hint} (${l.id})`;
  b.innerHTML = `<b>${l.id}</b><small>${l.name}</small>`;
  b.addEventListener('click', () => setLevel(l.id));
  $('levels').append(b);
}
function setLevel(id) { state.level = id; prefs.level = id; savePrefs(); applyLevel(); }

$('export').addEventListener('click', () => {
  if (!state.notes.length) return;
  const level = LEVELS.find((l) => l.id === state.level).name;
  const xml = toMusicXML(state.notes, state.grid, `${state.title} (${level})`, state.key);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }));
  a.download = `${state.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80)} - ${level}.musicxml`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

const syncPlay = () => {
  $('play').classList.toggle('playing', player.playing);
  $('sb-play').classList.toggle('playing', player.playing);
  $('play').setAttribute('aria-label', player.playing ? 'Pauza (mezerník)' : 'Přehrát (mezerník)');
};
function togglePlay() {
  if (!state.base.length) return;
  if (player.playing) player.pause();
  else {
    const l = player.loop;
    if (l && (player.now() < l.a - l.pre - 0.01 || player.now() >= l.b)) player.seek(l.a - l.pre);
    player.play();
    setLocked(true);
  }
  syncPlay();
}
player.onEnd = syncPlay;
$('play').addEventListener('click', togglePlay);
$('restart').addEventListener('click', () => player.seek(player.loop ? player.loop.a - player.loop.pre : 0));

// ── Usek na opakovani: po taktech (from..to = indexy taktu, to exkluzivne) ──
const loopLen = () => Number($('loop-len').value) || 2;
function updateLoopUi() {
  const l = state.loop;
  $('loop').setAttribute('aria-pressed', String(state.loopOn));
  $('loop-info').textContent = l ? (l.to - l.from === 1 ? `Takt ${l.from + 1}` : `Takty ${l.from + 1}–${l.to}`) : 'Takty —';
  $('loop-info').classList.toggle('off', !state.loopOn);
  const len = l ? l.to - l.from : loopLen();
  $('loop-len').value = [1, 2, 4, 8].includes(len) ? String(len) : 'custom';
  // predehra = jedna doba pred usekem (noty pred nim nezni, je cas se pripravit)
  player.loop = state.loopOn && l ? { a: l.a, b: l.b, pre: Math.min(1.5, state.grid?.beat ?? 0.5) } : null;
}
function setLoop(from, to, on = true) {
  state.loop = loopBars(state.bars, from, to);
  state.loopOn = on;
  updateLoopUi();
}
const currentBar = () => barAt(state.bars, player.now() + 0.05);
function jumpToLoop(lock = false) {
  if (!player.loop) return;
  player.seek(player.loop.a - player.loop.pre);
  if (lock) setLocked(true);                                   // tlacitka useku: osa ukaze novy usek
}

$('loop').addEventListener('click', () => {
  if (!state.loop) { setLoop(currentBar(), currentBar() + loopLen()); jumpToLoop(true); return; }
  state.loopOn = !state.loopOn;
  updateLoopUi();
  if (state.loopOn && (player.now() < state.loop.a - 2 || player.now() >= state.loop.b)) jumpToLoop();
});
function stepLoop(dir) {
  // vypnuty (nebo zadny) usek -> novy usek tam, kde prave jsem; jinak posun o delku useku
  if (!state.loop || !state.loopOn) {
    const len = state.loop ? state.loop.to - state.loop.from : loopLen();
    setLoop(currentBar(), currentBar() + len);
    jumpToLoop(true);
    return;
  }
  const next = shiftLoop(state.bars, state.loop, dir);
  setLoop(next.from, next.to);
  jumpToLoop(true);
}
$('loop-prev').addEventListener('click', () => stepLoop(-1));
$('loop-next').addEventListener('click', () => stepLoop(1));
$('loop-len').addEventListener('change', () => {
  const from = state.loop ? state.loop.from : currentBar();
  setLoop(from, from + loopLen());
  jumpToLoop(true);
});

// ── Casova osa: prehled cele skladby + detail po taktech ────────────────────
// Detail ukazuje okno [t0, t0 + span]. Zamceno = okno jede s prehravanim (pozice ve 1/4 okna).
// Klik = skok (mimo usek usek vypne), tazeni = novy usek, uchyty = okraje, tazeni uvnitr = posun.
const tl = $('timeline');
const ov = $('overview');
const tlView = { t0: 0, span: 0, locked: true, zoomBars: null };
const avgBar = () => (state.bars.length > 1 ? (state.bars[state.bars.length - 1] - state.bars[0]) / (state.bars.length - 1) : 2);
function viewSpan() {
  // vychozi priblizeni: takt aspon ~56 px; uzivatel meni kolecko / + -
  const bars = tlView.zoomBars ?? Math.max(6, Math.round(tl.clientWidth / 56));
  return Math.min(state.duration || 1, bars * avgBar());
}
function clampView() {
  tlView.span = viewSpan();
  tlView.t0 = Math.max(0, Math.min(tlView.t0, (state.duration || 0) - tlView.span));
}
function followPlayhead(now, smooth) {
  const target = now - tlView.span * 0.25;
  tlView.t0 = smooth && Math.abs(target - tlView.t0) < tlView.span ? tlView.t0 + (target - tlView.t0) * 0.2 : target;
  clampView();
}
function setLocked(on) {
  tlView.locked = on;
  $('tl-lock').setAttribute('aria-pressed', String(on));
}
function zoom(factor, anchorX = tl.clientWidth * 0.25) {
  const tAnchor = tlView.t0 + (anchorX / tl.clientWidth) * tlView.span;
  const total = Math.max(1, state.bars.length - 1);
  const cur = tlView.zoomBars ?? Math.max(6, Math.round(tl.clientWidth / 56));
  tlView.zoomBars = Math.max(2, Math.min(total, Math.round(cur * factor) + (factor > 1 ? 1 : 0)));
  tlView.span = viewSpan();
  tlView.t0 = tAnchor - (anchorX / tl.clientWidth) * tlView.span;
  clampView();
}
$('tl-lock').addEventListener('click', () => { setLocked(!tlView.locked); if (tlView.locked) followPlayhead(player.now(), false); });
$('tl-in').addEventListener('click', () => zoom(1 / 1.5));
$('tl-out').addEventListener('click', () => zoom(1.5));
tl.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) || ev.shiftKey) {        // posun do strany = odemknout
    setLocked(false);
    tlView.t0 += ((ev.shiftKey ? ev.deltaY : ev.deltaX) / tl.clientWidth) * tlView.span;
    clampView();
  } else zoom(ev.deltaY > 0 ? 1.25 : 1 / 1.25, ev.offsetX);
}, { passive: false });

let drag = null;
const tlX = (ev) => ev.clientX - tl.getBoundingClientRect().left;
const tlTime = (x) => Math.max(0, Math.min(state.duration, tlView.t0 + (x / tl.clientWidth) * tlView.span));
const tlPx = (t) => ((t - tlView.t0) / (tlView.span || 1)) * tl.clientWidth;
function hitTest(x) {
  const l = state.loop;
  if (!l) return 'none';
  if (Math.abs(x - tlPx(l.a)) <= HANDLE) return 'a';
  if (Math.abs(x - tlPx(l.b)) <= HANDLE) return 'b';
  if (x > tlPx(l.a) && x < tlPx(l.b)) return 'inside';
  return 'none';
}
tl.addEventListener('pointerdown', (ev) => {
  const x = tlX(ev);
  drag = { x0: x, t0: tlTime(x), part: hitTest(x), moved: false, from: state.loop?.from, to: state.loop?.to };
  tl.setPointerCapture(ev.pointerId);
});
tl.addEventListener('pointermove', (ev) => {
  const x = tlX(ev);
  if (!drag) {
    const part = hitTest(x);
    tl.style.cursor = part === 'a' || part === 'b' ? 'ew-resize' : part === 'inside' ? 'grab' : 'pointer';
    return;
  }
  if (!drag.moved && Math.abs(x - drag.x0) < 5) return;       // klik, ne tazeni
  if (!drag.moved) setLocked(false);                            // behem tazeni osa neujizdi
  drag.moved = true;
  const bar = barAt(state.bars, tlTime(x));
  if (drag.part === 'a') setLoop(Math.min(bar, drag.to - 1), drag.to);
  else if (drag.part === 'b') setLoop(drag.from, Math.max(bar + 1, drag.from + 1));
  else if (drag.part === 'inside') {
    const shift = bar - barAt(state.bars, drag.t0);
    const len = drag.to - drag.from;
    const from = Math.max(0, Math.min(drag.from + shift, state.bars.length - 1 - len));
    setLoop(from, from + len);
  } else {
    const l = loopFromTimes(state.bars, drag.t0, tlTime(x));
    setLoop(l.from, l.to);
  }
});
tl.addEventListener('pointerup', (ev) => {
  if (!drag) return;
  const t = tlTime(tlX(ev));
  if (drag.moved) jumpToLoop();
  else {
    if (state.loopOn && state.loop && (t < state.loop.a || t >= state.loop.b)) { state.loopOn = false; updateLoopUi(); }
    player.seek(state.bars[barAt(state.bars, t)]);               // klik na takt = skok na jeho zacatek
  }
  drag = null;
});
tl.addEventListener('pointercancel', () => { drag = null; });

// prehled: tazeni okna = posun detailu (odemkne), klik vedle = skok
let ovDrag = null;
const ovTime = (ev) => Math.max(0, Math.min(1, (ev.clientX - ov.getBoundingClientRect().left) / ov.clientWidth)) * state.duration;
ov.addEventListener('pointerdown', (ev) => {
  const t = ovTime(ev);
  if (t >= tlView.t0 && t <= tlView.t0 + tlView.span && tlView.span < state.duration) {
    ovDrag = { grab: t - tlView.t0 };
    setLocked(false);
    ov.setPointerCapture(ev.pointerId);
  } else {
    if (state.loopOn && state.loop && (t < state.loop.a || t >= state.loop.b)) { state.loopOn = false; updateLoopUi(); }
    player.seek(t);
    followPlayhead(t, false);
  }
});
ov.addEventListener('pointermove', (ev) => {
  if (!ovDrag) return;
  tlView.t0 = ovTime(ev) - ovDrag.grab;
  clampView();
});
ov.addEventListener('pointerup', () => { ovDrag = null; });

// ── Pohled: sirka piana, delka not, vyska padu (jen vizualni) ──────────────
const VIEW_DEFAULT = { width: 100, pps: 160, fall: 100, kb: 22 };
const view = { ...VIEW_DEFAULT, ...(prefs.view || {}) };
function syncView() {
  $('piano-width').value = view.width;
  $('pps').value = view.pps;
  $('fall').value = view.fall;
  $('kb-height').value = view.kb;
  $('kb-out').textContent = `${view.kb} %`;
  $('width-out').textContent = `${view.width} %`;
  $('pps-out').textContent = `${view.pps} px/s`;
  $('fall-out').textContent = `${view.fall} %`;
}
for (const [id, key] of [['piano-width', 'width'], ['pps', 'pps'], ['fall', 'fall'], ['kb-height', 'kb']]) {
  $(id).addEventListener('input', () => { view[key] = Number($(id).value); prefs.view = view; savePrefs(); syncView(); });
}
$('view-reset').addEventListener('click', () => { Object.assign(view, VIEW_DEFAULT); prefs.view = view; savePrefs(); syncView(); });
const toggleView = () => {
  const open = $('view-panel').hidden;
  $('view-panel').hidden = !open;
  $('view-open').setAttribute('aria-expanded', String(open));
};
$('view-open').addEventListener('click', toggleView);
// rezim jeviste = cela obrazovka + schovane ovladani (funguje i kdyz prohlizec fullscreen nedovoli)
function setStageMode(on) {
  document.body.classList.toggle('stage-mode', on);
  if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
const toggleFullscreen = () => setStageMode(!document.body.classList.contains('stage-mode'));
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) document.body.classList.remove('stage-mode'); });
$('fullscreen').addEventListener('click', toggleFullscreen);
$('sb-exit').addEventListener('click', () => setStageMode(false));
$('sb-play').addEventListener('click', togglePlay);
syncView();

const bindCheck = (id, key, def, fn) => {
  const el = $(id);
  el.checked = prefs[key] ?? def;
  el.addEventListener('change', () => { prefs[key] = el.checked; savePrefs(); fn?.(); });
  fn?.();
};
bindCheck('letters', 'letters', true);
bindCheck('fingers', 'fingers', false);
bindCheck('echo', 'echo', true);
bindCheck('mine-r', 'mineR', false, () => player.setMute('R', $('mine-r').checked));
bindCheck('mine-l', 'mineL', false, () => player.setMute('L', $('mine-l').checked));
bindCheck('wait', 'wait', false, () => player.setWait($('wait').checked));
$('naming').value = prefs.naming || 'intl';
$('naming').addEventListener('change', () => { prefs.naming = $('naming').value; savePrefs(); });
$('volume').addEventListener('input', () => player.setVolume(Number($('volume').value)));
$('speed').addEventListener('input', () => {
  const s = Number($('speed').value);
  player.setSpeed(s);
  $('speed-out').textContent = `${Math.round(s * 100)} %`;
});

// ── Hrani: MIDI klavir a klavesnice pocitace ────────────────────────────────
const PIANO_CODES = /^(Key[AWSEDFTGYHUJKOLPZX]|Semicolon)$/;
function onNote(p, on, source) {
  if (on) {
    const expected = player.waiting?.pitches.has(p) || state.notes.some((n) => n.p === p && Math.abs(n.s - player.now()) < 0.4);
    state.pressed.set(p, expected || !$('wait').checked ? 'ok' : 'wrong');
  } else state.pressed.delete(p);
  player.input(p, on, $('echo').checked && (source === 'keys' || source === 'midi'));
}
keyboardInput(onNote, {
  isActive: () => $('wait').checked && !document.querySelector('dialog[open]'),
  getOctave: () => state.octave,
  setOctave: (o) => { state.octave = o; prefs.octave = o; savePrefs(); $('oct').textContent = o; },
});
$('oct').textContent = state.octave;
midiInput(onNote).then((names) => {
  $('midi-status').textContent = names.length ? `Připojeno: ${names.join(', ')}.` : '';
});

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.closest('input[type="text"], input[type="url"], select, textarea, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
  if ($('wait').checked && PIANO_CODES.test(e.code)) return;    // pismena patri klaviru
  const k = e.key.toLowerCase();
  if (k === ' ' && t.closest('button, input, summary')) return;            // mezernik tlacitko aktivuje samo
  if (k.startsWith('arrow') && t.matches('input[type="range"]')) return;   // sipky ovladaji posuvnik
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'arrowleft') {                                         // na zacatek taktu / predchozi takt
    const i = currentBar();
    player.seek(state.bars[player.now() - state.bars[i] > 0.4 ? i : Math.max(0, i - 1)]);
  }
  else if (k === 'arrowright') player.seek(state.bars[Math.min(state.bars.length - 2, currentBar() + 1)]);
  else if (k === '[') stepLoop(-1);
  else if (k === ']') stepLoop(1);
  else if (k === 'v') toggleView();
  else if (k === 'f') toggleFullscreen();
  else if (k === 'escape' && document.body.classList.contains('stage-mode')) setStageMode(false);
  else if (k === 'l') $('loop').click();
  else if (k >= '1' && k <= '5') setLevel(Number(k));
  else if (k === 'p') $('fingers').click();
  else if (k === 'n') $('letters').click();
  else if (k === 'm') $('wait').click();
  else if (k === 'k') openLibrary();
  else return;
  syncPlay();
});

// ── Smycka vykreslovani ─────────────────────────────────────────────────────
let lastChord = '';
function frame() {
  const now = player.now();
  const canvas = $('stage');
  if (state.notes.length) {
    const waiting = player.waitOn && player.playing ? player.waiting : null;
    state.lookahead = draw(canvas, {
      now, notes: state.notes, range: [state.lo, state.hi],
      widthFrac: view.width / 100, pps: view.pps, fallFrac: view.fall / 100, kbFrac: view.kb / 100,
      showLetters: $('letters').checked, naming: $('naming').value,
      showFingers: $('fingers').checked, loop: state.loopOn ? state.loop : null,
      mine: { L: $('mine-l').checked, R: $('mine-r').checked }, pressed: state.pressed, waiting,
    }).lookahead;
    if (tlView.locked && !drag) followPlayhead(now, player.playing); else clampView();
    const t1 = tlView.t0 + tlView.span;
    drawBars(tl, { notes: state.notes, bars: state.bars, meter: state.grid.meter, t0: tlView.t0, t1, now, loop: state.loop, loopOn: state.loopOn, lo: state.songLo, hi: state.songHi });
    drawOverview(ov, { notes: state.notes, duration: state.duration, now, loop: state.loop, loopOn: state.loopOn, t0: tlView.t0, t1, lo: state.songLo, hi: state.songHi });
    drawKeyMap(km, { lo: state.lo, hi: state.hi, songLo: state.songLo, songHi: state.songHi });
    $('time').firstChild.textContent = fmt(now);
    $('time').lastChild.textContent = `/ ${fmt(state.duration)}`;
    if (document.body.classList.contains('stage-mode')) {
      $('sb-time').textContent = fmt(now);
      $('sb-loop').textContent = state.loopOn ? $('loop-info').textContent : '';
    }
    const ch = state.chords.find((c) => c.s <= now && c.e > now);
    const name = ch ? ch.name : '';
    if (name !== lastChord) { $('chord').textContent = name; lastChord = name; }
    $('wait-hud').hidden = !waiting;
    if (waiting) $('wait-notes').textContent = [...waiting.pitches].sort((a, b) => a - b).map((p) => noteName(p, $('naming').value)).join(' ');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

$('speed').value = 1;
loadIndex();
initConvert();
