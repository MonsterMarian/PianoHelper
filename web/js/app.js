import { arrange, LEVELS } from './arrange.js';
import { estimateGrid, chordTrack, detectKey } from './analysis.js';
import { Player } from './audio.js';
import { draw, drawTimeline, layoutKeys } from './render.js';
import { songEnd, noteName } from './music.js';
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
};

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
  state.lo = Math.min(...ps, 60) - 2; state.hi = Math.max(...ps, 60) + 2;   // C4 je vzdy videt (orientace)
  while (state.hi - state.lo < 24) { state.lo--; state.hi++; }               // aspon 2 oktavy
  state.duration = songEnd(state.notes);
  for (const b of $('levels').children) b.setAttribute('aria-pressed', String(Number(b.dataset.level) === state.level));
}

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
  $('play').setAttribute('aria-label', player.playing ? 'Pauza (mezerník)' : 'Přehrát (mezerník)');
};
function togglePlay() {
  if (!state.base.length) return;
  if (player.playing) player.pause();
  else {
    if (state.loopOn && state.loop && (player.now() < state.loop.a || player.now() >= state.loop.b)) player.seek(state.loop.a);
    player.play();
  }
  syncPlay();
}
player.onEnd = syncPlay;
$('play').addEventListener('click', togglePlay);
$('restart').addEventListener('click', () => player.seek(state.loopOn && state.loop ? state.loop.a : 0));

function updateLoopUi() {
  const l = state.loop;
  $('loop').setAttribute('aria-pressed', String(state.loopOn));
  $('loop-info').textContent = l ? `${fmt(l.a)} – ${fmt(l.b)}` : 'táhni po ose';
  player.loop = state.loopOn && l ? l : null;
}
function setLoop(a, b) {
  if (b - a < 0.3) return;
  state.loop = { a, b };
  state.loopOn = true;
  updateLoopUi();
}
$('set-a').addEventListener('click', () => {
  const t = player.now();
  setLoop(t, state.loop && state.loop.b > t + 0.3 ? state.loop.b : Math.min(state.duration, t + 8));
});
$('set-b').addEventListener('click', () => {
  const t = player.now();
  setLoop(state.loop && state.loop.a < t - 0.3 ? state.loop.a : Math.max(0, t - 8), t);
});
$('loop').addEventListener('click', () => {
  if (!state.loop) { const t = player.now(); setLoop(t, Math.min(state.duration, t + 8)); return; }
  state.loopOn = !state.loopOn;
  updateLoopUi();
});

// casova osa: klik = skok, tazeni = vyber useku
const tl = $('timeline');
let drag = null;
const tlTime = (ev) => {
  const r = tl.getBoundingClientRect();
  return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * state.duration;
};
tl.addEventListener('pointerdown', (ev) => { drag = { t0: tlTime(ev), moved: false }; tl.setPointerCapture(ev.pointerId); });
tl.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const t = tlTime(ev);
  if (Math.abs(t - drag.t0) > state.duration * 0.005) { drag.moved = true; state.loop = { a: Math.min(t, drag.t0), b: Math.max(t, drag.t0) }; state.loopOn = true; updateLoopUi(); }
});
tl.addEventListener('pointerup', () => {
  if (!drag) return;
  if (drag.moved && state.loop) { setLoop(state.loop.a, state.loop.b); player.seek(state.loop.a); }
  else player.seek(drag.t0);
  drag = null;
});

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
$('zoom').value = prefs.zoom || 3.5;
$('zoom').addEventListener('input', () => { prefs.zoom = Number($('zoom').value); savePrefs(); });
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
  else if (k === 'arrowleft') player.seek(player.now() - 5);
  else if (k === 'arrowright') player.seek(player.now() + 5);
  else if (k === '[') $('set-a').click();
  else if (k === ']') $('set-b').click();
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
    draw(canvas, {
      now, notes: state.notes, layout: layoutKeys(state.lo, state.hi, canvas.clientWidth),
      lookahead: 10 / Number($('zoom').value), showLetters: $('letters').checked, naming: $('naming').value,
      showFingers: $('fingers').checked, loop: state.loopOn ? state.loop : null,
      mine: { L: $('mine-l').checked, R: $('mine-r').checked }, pressed: state.pressed, waiting,
    });
    drawTimeline(tl, { notes: state.notes, duration: state.duration, now, loop: state.loop, lo: state.lo, hi: state.hi });
    $('time').firstChild.textContent = fmt(now);
    $('time').lastChild.textContent = `/ ${fmt(state.duration)}`;
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
