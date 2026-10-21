import { arrange, LEVELS, levelsFor, STEP_ORDER } from './arrange.js';
import { estimateGrid, chordTrack, detectKey } from './analysis.js';
import { Player, PIANOS } from './audio.js';
import { draw, drawOverview, drawBars, drawKeyMap, drawBarGrid, layoutKeys, keyRange, HANDLE, resetColors } from './render.js';
import { barTimes, barAt, loopBars, loopFromTimes, shiftLoop } from './loop.js';
import { songEnd, noteName, isBlack, usesFlats } from './music.js';
import { toMusicXML } from './musicxml.js';
import { keyboardInput, midiInput } from './input.js';
import { fingerTargets } from './hands.js';
import { parseTitle, youtubeId } from './titles.js';

const $ = (id) => document.getElementById(id);
const player = new Player();
window.pianoHelper = { player };          // pro ladeni v konzoli a testy

// Nastaveni uzivatele (jen pohodli; bez localStorage vse funguje s vychozimi hodnotami)
const prefs = (() => { try { return JSON.parse(localStorage.getItem('pianohelper') || '{}'); } catch { return {}; } })();
// obtiznosti 2.0: originál je uroven 3 (driv 4) - prevest ulozenou volbu
if (prefs.level && !prefs.levels2) { prefs.level = { 1: 1, 2: 2, 3: 2, 4: 3, 5: 5 }[prefs.level] || 3; }
prefs.levels2 = true;
// obtiznosti 3.0: uklada se krok zebriku (napr. 'original'), cislo urovne zavisi na skladbe
if (!prefs.step) prefs.step = LEVELS[(prefs.level || 3) - 1].key;
delete prefs.level;
const savePrefs = () => { try { localStorage.setItem('pianohelper', JSON.stringify(prefs)); } catch { /* soukrome okno */ } };

const state = {
  title: '', file: '', base: [], grid: null, chords: [], key: null, level: 3, levels: LEVELS,
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
  const q = $('song-filter').value.trim().toLowerCase();
  list.innerHTML = '';
  const songs = state.library.filter((s) => !q || s.title.toLowerCase().includes(q));
  if (!songs.length) {
    list.innerHTML = `<li class="empty-row">${state.library.length ? 'Nic nenalezeno.' : 'Zatím tu nic není.'}</li>`;
    return;
  }
  for (const s of songs) {
    const { name, series } = parseTitle(s.title);
    const id = youtubeId(s.source);
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'song-card';
    b.innerHTML = '<span class="thumb"><span class="dur"></span></span><span class="name"></span><span class="series"></span>';
    const thumb = b.querySelector('.thumb');
    if (id) {
      const img = document.createElement('img');
      img.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;   // nahled z videa, ze ktereho jsou noty
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.remove();
      thumb.prepend(img);
    } else {
      thumb.insertAdjacentHTML('afterbegin', `<span class="initial">${name.slice(0, 1)}</span>`);
    }
    if (s.file === state.file) thumb.insertAdjacentHTML('beforeend', '<span class="now">Hraje</span>');
    b.querySelector('.dur').textContent = fmt(s.duration);
    b.querySelector('.name').textContent = name;
    b.querySelector('.series').textContent = series || `${s.notes} not`;
    b.title = s.title;
    b.addEventListener('click', () => { $('library').close(); loadSongFile(s.file); });
    li.append(b);
    list.append(li);
  }
}
$('song-filter').addEventListener('input', renderLibrary);

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
  state.levels = levelsFor(state.base);
  // ulozeny krok (nebo nejblizsi, ktery skladba ma - tezka skladba nema "Mistr")
  const want = STEP_ORDER.indexOf(prefs.step);
  state.level = state.levels.reduce((b, l) => (Math.abs(STEP_ORDER.indexOf(l.key) - want) < Math.abs(STEP_ORDER.indexOf(b.key) - want) ? l : b)).id;
  renderLevels();
  const parsed = parseTitle(title);
  $('title').textContent = parsed.name;
  $('title').title = title;
  $('title-series').textContent = parsed.series || 'Skladba';
  $('m-key').textContent = state.key.name;
  $('m-bpm').textContent = `${Math.round(60 / state.grid.beat)}`;
  $('m-meter').textContent = `${state.grid.meter}/4`;
  document.title = `${parsed.name} — PianoHelper`;
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
  $('level-name').textContent = state.levels[state.level - 1].name;
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
$('library-btn').addEventListener('click', openLibrary);
function stepSong(dir) {
  const list = state.library;
  if (!list.length) return;
  const i = list.findIndex((x) => x.file === state.file);
  loadSongFile(list[(i + dir + list.length) % list.length].file);
}
$('song-prev').addEventListener('click', () => stepSong(-1));
$('song-next').addEventListener('click', () => stepSong(1));
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
  b.innerHTML = `<b>${l.id}</b>`;
  b.addEventListener('click', () => setLevel(l.id));
  $('levels').append(b);
}
// Popisky podle skladby: u tezke skladby je originál 4 nebo 5 (pod nim jen zjednoduseni).
function renderLevels() {
  for (const b of $('levels').children) {
    const l = state.levels[Number(b.dataset.level) - 1];
    b.title = `${l.name} — ${l.hint} (${l.id})`;
    b.setAttribute('aria-label', `${l.id} ${l.name}: ${l.hint}`);
    b.classList.toggle('orig', l.key === 'original');
  }
}
function setLevel(id) { state.level = id; prefs.step = state.levels[id - 1].key; savePrefs(); applyLevel(); }

$('export').addEventListener('click', () => {
  if (!state.notes.length) return;
  const level = state.levels[state.level - 1].name;
  const name = parseTitle(state.title).name;                     // bez "EASY Piano Tutorial..."
  const xml = toMusicXML(state.notes, state.grid, `${name} (${level})`, state.key);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }));
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80)} - ${level}.musicxml`;
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
function jumpToLoop() {
  if (!player.loop) return;
  player.seek(player.loop.a - player.loop.pre);
  showInTimeline(player.loop.a - player.loop.pre);             // tlacitka useku: osa ukaze novy usek
}

$('loop').addEventListener('click', () => {
  if (!state.loop) { setLoop(currentBar(), currentBar() + loopLen()); jumpToLoop(); return; }
  state.loopOn = !state.loopOn;
  updateLoopUi();
  if (state.loopOn && (player.now() < state.loop.a - 2 || player.now() >= state.loop.b)) jumpToLoop();
});
function stepLoop(dir) {
  // vypnuty (nebo zadny) usek -> novy usek tam, kde prave jsem; jinak posun o delku useku
  if (!state.loop || !state.loopOn) {
    const len = state.loop ? state.loop.to - state.loop.from : loopLen();
    setLoop(currentBar(), currentBar() + len);
    jumpToLoop();
    return;
  }
  const next = shiftLoop(state.bars, state.loop, dir);
  setLoop(next.from, next.to);
  jumpToLoop();
}
$('loop-prev').addEventListener('click', () => stepLoop(-1));
$('loop-next').addEventListener('click', () => stepLoop(1));
$('loop-len').addEventListener('change', () => {
  const from = state.loop ? state.loop.from : currentBar();
  setLoop(from, from + loopLen());
  jumpToLoop();
});

// ── Casova osa: prehled cele skladby + detail po taktech ────────────────────
// Detail ukazuje okno [t0, t0 + span]. Kdyz pozice z okna uteče, osa se "prelistuje" dal
// (jako v hudebnich programech); po rucnim posunu chvili ne, at uzivatele neprepere.
// Klik = skok (mimo usek usek vypne), tazeni = novy usek, uchyty = okraje, tazeni uvnitr = posun.
const tl = $('timeline');
const ov = $('overview');
const tlView = { t0: 0, span: 0, zoomBars: null, manualUntil: 0 };
window.pianoHelper.tl = tlView;
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
function showInTimeline(t) {
  if (t < tlView.t0 || t > tlView.t0 + tlView.span * 0.95) tlView.t0 = t - tlView.span * 0.1;
  clampView();
}
const manualPan = () => { tlView.manualUntil = performance.now() + 4000; };
function zoom(factor, anchorX = tl.clientWidth * 0.25) {
  const tAnchor = tlView.t0 + (anchorX / tl.clientWidth) * tlView.span;
  const total = Math.max(1, state.bars.length - 1);
  const cur = tlView.zoomBars ?? Math.max(6, Math.round(tl.clientWidth / 56));
  tlView.zoomBars = Math.max(2, Math.min(total, Math.round(cur * factor) + (factor > 1 ? 1 : 0)));
  tlView.span = viewSpan();
  tlView.t0 = tAnchor - (anchorX / tl.clientWidth) * tlView.span;
  clampView();
}
$('tl-in').addEventListener('click', () => zoom(1 / 1.5));
$('tl-out').addEventListener('click', () => zoom(1.5));
tl.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) || ev.shiftKey) {        // posun do strany = odemknout
    manualPan();
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
  return 'none';
}
// Na ose jedno gesto = jedna vec: klik / tazeni = posun v case, uchyty = okraje useku.
// Vytvoreni a presun useku je ve velkem editoru (tlacitko "Vybrat usek" nebo dvojklik).
tl.addEventListener('pointerdown', (ev) => {
  const x = tlX(ev);
  drag = { part: hitTest(x), from: state.loop?.from, to: state.loop?.to };
  tl.setPointerCapture(ev.pointerId);
  if (drag.part === 'none') scrubTo(tlTime(x));
});
function scrubTo(t) {
  if (state.loopOn && state.loop && (t < state.loop.a - player.loop.pre || t >= state.loop.b)) { state.loopOn = false; updateLoopUi(); }
  player.seek(t);
}
tl.addEventListener('pointermove', (ev) => {
  const x = tlX(ev);
  if (!drag) {
    const part = hitTest(x);
    tl.style.cursor = part === 'none' ? 'pointer' : 'ew-resize';
    return;
  }
  manualPan();                                                  // behem tazeni osa neujizdi
  if (drag.part === 'none') { scrubTo(tlTime(x)); return; }
  const bar = barAt(state.bars, tlTime(x));
  if (drag.part === 'a') setLoop(Math.min(bar, drag.to - 1), drag.to);
  else setLoop(drag.from, Math.max(bar + 1, drag.from + 1));
});
tl.addEventListener('pointerup', () => {
  if (drag && drag.part !== 'none') jumpToLoop();
  drag = null;
});
tl.addEventListener('dblclick', () => openLoopEditor());

// ── Editor useku: vsechny takty jako dlazdice, tazenim se vybere usek ─────────
const le = { sel: null, anchor: 0, cols: 8, down: false };
const LE_CELL = 70;
function drawLoopEditor() {
  drawBarGrid($('le-grid'), { notes: viewNotes(), bars: state.bars, cols: le.cols, cellH: LE_CELL, sel: le.sel,
    cur: currentBar(), lo: state.songLo, hi: state.songHi });
  $('le-info').textContent = le.sel
    ? (le.sel.to - le.sel.from === 1 ? `Takt ${le.sel.from + 1}` : `Takty ${le.sel.from + 1}–${le.sel.to}`)
      + ` · ${fmt(state.bars[le.sel.from])}–${fmt(state.bars[le.sel.to])}`
    : 'Klikni na takt, nebo táhni přes víc taktů';
  $('le-apply').disabled = !le.sel;
}
function openLoopEditor() {
  if (!state.base.length) return;
  le.sel = state.loop ? { from: state.loop.from, to: state.loop.to } : null;
  $('loop-editor').showModal();
  requestAnimationFrame(() => {
    le.cols = Math.max(4, Math.floor($('le-grid').clientWidth / 112));
    drawLoopEditor();
    const row = Math.floor((le.sel ? le.sel.from : currentBar()) / le.cols);
    $('le-grid').parentElement.scrollTop = Math.max(0, (row - 1) * LE_CELL);
  });
}
const leBar = (ev) => {
  const r = $('le-grid').getBoundingClientRect();
  const col = Math.min(le.cols - 1, Math.max(0, Math.floor(((ev.clientX - r.left) / r.width) * le.cols)));
  const row = Math.max(0, Math.floor((ev.clientY - r.top) / LE_CELL));
  return Math.min(state.bars.length - 2, row * le.cols + col);
};
$('le-grid').addEventListener('pointerdown', (ev) => {
  const i = leBar(ev);
  if (ev.shiftKey && le.sel) le.sel = { from: Math.min(le.anchor, i), to: Math.max(le.anchor, i) + 1 };
  else { le.anchor = i; le.sel = { from: i, to: i + 1 }; }
  le.down = true;
  $('le-grid').setPointerCapture(ev.pointerId);
  drawLoopEditor();
});
$('le-grid').addEventListener('pointermove', (ev) => {
  if (!le.down) return;
  const i = leBar(ev);
  le.sel = { from: Math.min(le.anchor, i), to: Math.max(le.anchor, i) + 1 };
  drawLoopEditor();
});
$('le-grid').addEventListener('pointerup', () => { le.down = false; });
$('le-apply').addEventListener('click', () => {
  if (!le.sel) return;
  setLoop(le.sel.from, le.sel.to);
  jumpToLoop();
  $('loop-editor').close();
});
$('le-clear').addEventListener('click', () => { state.loopOn = false; updateLoopUi(); $('loop-editor').close(); });
$('loop-edit').addEventListener('click', openLoopEditor);

// ── Rozsah, ktery hudba potrebuje, vs. zobrazena klaviatura ──────────────────
let lastWarn = '';
function visibleRange() {
  let lo = state.lo, hi = state.hi;
  while (isBlack(lo)) lo--;
  while (isBlack(hi)) hi++;
  return [lo, hi];
}
function updateRangeWarning(shown) {
  const [lo, hi] = visibleRange();
  const out = shown.filter((n) => n.p < lo || n.p > hi);
  const text = out.length
    ? `⚠ ${out.length} not mimo klaviaturu (${noteName(Math.min(...out.map((n) => n.p)), 'intl', true)}–${noteName(Math.max(...out.map((n) => n.p)), 'intl', true)})`
    : '';
  if (text === lastWarn) return;
  lastWarn = text;
  $('range-warn').hidden = !text;
  $('range-warn-text').textContent = text;
}
$('range-fit').addEventListener('click', () => {
  state.custom = snap(state.songLo - 1, state.songHi + 1);
  state.range = 'custom';
  prefs.range = state.range; prefs.custom = state.custom; savePrefs();
  updateRange();
});
tl.addEventListener('pointercancel', () => { drag = null; });

// prehled: tazeni okna = posun detailu (odemkne), klik vedle = skok
let ovDrag = null;
const ovTime = (ev) => Math.max(0, Math.min(1, (ev.clientX - ov.getBoundingClientRect().left) / ov.clientWidth)) * state.duration;
ov.addEventListener('pointerdown', (ev) => {
  const t = ovTime(ev);
  if (t >= tlView.t0 && t <= tlView.t0 + tlView.span && tlView.span < state.duration) {
    ovDrag = { grab: t - tlView.t0 };
    manualPan();
    ov.setPointerCapture(ev.pointerId);
  } else {
    if (state.loopOn && state.loop && (t < state.loop.a || t >= state.loop.b)) { state.loopOn = false; updateLoopUi(); }
    player.seek(t);
    showInTimeline(t);
  }
});
ov.addEventListener('pointermove', (ev) => {
  if (!ovDrag) return;
  tlView.t0 = ovTime(ev) - ovDrag.grab;
  manualPan();
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
bindCheck('letters', 'letters', true, () => { $('letters-set').checked = $('letters').checked; });
$('letters-set').addEventListener('change', () => { $('letters').checked = $('letters-set').checked; $('letters').dispatchEvent(new Event('change')); });
bindCheck('fingers', 'fingers', false);
bindCheck('hand-pos', 'handPos', true, () => { $('hand-pos-set').checked = $('hand-pos').checked; });
$('hand-pos-set').addEventListener('change', () => { $('hand-pos').checked = $('hand-pos-set').checked; $('hand-pos').dispatchEvent(new Event('change')); });

// predstih ukazatele prstu (s)
const ahead = () => Number($('finger-ahead').value);
$('finger-ahead').value = prefs.ahead ?? 1.5;
const syncAhead = () => { $('ahead-out').textContent = `${String(ahead()).replace('.', ',')} s`; };
$('finger-ahead').addEventListener('input', () => { prefs.ahead = ahead(); savePrefs(); syncAhead(); });
syncAhead();

// barvy not (tmavsi odstin pro cerne klavesy se dopocita)
const darker = (hex, k = 0.72) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
const COLOR_DEFAULT = { R: '#f2b134', L: '#4fc4b8' };
function applyColors() {
  const col = { ...COLOR_DEFAULT, ...(prefs.colors || {}) };
  const root = document.documentElement.style;
  root.setProperty('--rh', col.R); root.setProperty('--rh-deep', darker(col.R));
  root.setProperty('--lh', col.L); root.setProperty('--lh-deep', darker(col.L));
  $('color-r').value = col.R; $('color-l').value = col.L;
  resetColors();
}
for (const [id, h] of [['color-r', 'R'], ['color-l', 'L']]) {
  $(id).addEventListener('input', () => { prefs.colors = { ...(prefs.colors || {}), [h]: $(id).value }; savePrefs(); applyColors(); });
}
$('color-reset').addEventListener('click', () => { delete prefs.colors; savePrefs(); applyColors(); });
applyColors();

// zvuk piana
for (const pn of PIANOS) $('piano').append(new Option(pn.name, pn.id));
player.piano = PIANOS.some((x) => x.id === prefs.piano) ? prefs.piano : 'salamander';
$('piano').value = player.piano;
$('piano').addEventListener('change', async () => {
  prefs.piano = $('piano').value; savePrefs();
  $('piano-status').textContent = 'Načítám zvuk…';
  player.ensureContext();
  const n = await player.setPiano(prefs.piano);
  $('piano-status').textContent = n ? 'Načteno.' : '';
});
$('piano-test').addEventListener('click', async () => {
  player.ensureContext();
  await player.ctx.resume();
  await player.loadSamples();
  const t = player.ctx.currentTime + 0.05;
  [60, 64, 67, 72].forEach((p, i) => player.noteOn(p, t + i * 0.12, 1.4 - i * 0.12, 0.7));
});

// zobrazit jen jednu ruku (jen vzhled - zvuk se nemeni)
state.showHand = prefs.showHand || 'both';
function setShowHand(h) {
  state.showHand = h; prefs.showHand = h; savePrefs();
  for (const b of $('show-hand').children) b.setAttribute('aria-pressed', String(b.dataset.hand === h));
}
for (const b of $('show-hand').children) b.addEventListener('click', () => setShowHand(b.dataset.hand));
setShowHand(state.showHand);
const viewNotes = () => (state.showHand === 'both' ? state.notes : state.notes.filter((n) => (n.h === 'L' ? 'L' : 'R') === state.showHand));
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
  else if (k === 'r') $('hand-pos').click();
  else if (k === 'm') $('wait').click();
  else if (k === 'k') openLibrary();
  else return;
  syncPlay();
});

// ── Smycka vykreslovani ─────────────────────────────────────────────────────
let lastChord = '';
// tony, ktere hudba potrebuje ted (od teto chvile do konce viditelneho padu + 3 s)
function needRange(shown, now) {
  const win = shown.filter((n) => n.e > now - 0.2 && n.s < now + (state.lookahead || 3) + 3);
  return win.length ? { lo: Math.min(...win.map((n) => n.p)), hi: Math.max(...win.map((n) => n.p)) } : null;
}

function frame() {
  const now = player.now();
  const canvas = $('stage');
  if (state.notes.length) {
    const waiting = player.waitOn && player.playing ? player.waiting : null;
    const shown = viewNotes();
    state.lookahead = draw(canvas, {
      now, notes: shown, range: [state.lo, state.hi], ahead: ahead(), flats: usesFlats(state.key),
      widthFrac: view.width / 100, pps: view.pps, fallFrac: view.fall / 100, kbFrac: view.kb / 100,
      showLetters: $('letters').checked, naming: $('naming').value,
      showFingers: $('fingers').checked, loop: state.loopOn ? state.loop : null,
      mine: { L: $('mine-l').checked, R: $('mine-r').checked }, pressed: state.pressed, waiting,
      targets: $('hand-pos').checked ? fingerTargets(shown, now, ahead()) : null,
      need: needRange(shown, now),
    }).lookahead;
    clampView();
    if (!drag && !ovDrag && performance.now() > tlView.manualUntil) showInTimeline(now);
    const t1 = tlView.t0 + tlView.span;
    updateRangeWarning(shown);
    drawBars(tl, { notes: shown, bars: state.bars, meter: state.grid.meter, t0: tlView.t0, t1, now, loop: state.loop, loopOn: state.loopOn, lo: state.songLo, hi: state.songHi });
    drawOverview(ov, { notes: shown, duration: state.duration, now, loop: state.loop, loopOn: state.loopOn, t0: tlView.t0, t1, lo: state.songLo, hi: state.songHi });
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
    if (waiting) $('wait-notes').textContent = [...waiting.pitches].sort((a, b) => a - b).map((p) => noteName(p, $('naming').value, false, usesFlats(state.key))).join(' ');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

$('speed').value = 1;
loadIndex();
initConvert();
