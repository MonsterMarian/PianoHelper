import { arrange, LEVELS } from './arrange.js';
import { estimateGrid, chordTrack, detectKey } from './analysis.js';
import { Player } from './audio.js';
import { draw, drawTimeline, layoutKeys } from './render.js';
import { songEnd } from './music.js';

const $ = (id) => document.getElementById(id);
const player = new Player();

// Nastaveni uzivatele (jen pohodli; bez localStorage vse funguje s vychozimi hodnotami)
const prefs = (() => { try { return JSON.parse(localStorage.getItem('pianohelper') || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('pianohelper', JSON.stringify(prefs)); } catch { /* soukrome okno */ } };

const state = {
  title: '', base: [], grid: null, chords: [], level: prefs.level ?? 4,
  notes: [], cache: new Map(), duration: 0, lo: 48, hi: 84, loop: null, loopOn: false,
};

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function message(text) { $('message').hidden = !text; $('message').textContent = text || ''; }

// ── Knihovna ────────────────────────────────────────────────────────────────
async function loadIndex(select) {
  let list = [];
  try { list = await (await fetch('songs/index.json', { cache: 'no-store' })).json(); } catch { /* prazdna knihovna */ }
  const sel = $('song');
  sel.innerHTML = '';
  sel.append(new Option(list.length ? '— vyber skladbu —' : 'Knihovna je prázdná', ''));
  for (const s of list) sel.append(new Option(`${s.title} (${fmt(s.duration)})`, s.file));
  const pick = select || prefs.song;
  if (pick && list.some((s) => s.file === pick)) { sel.value = pick; await loadSongFile(pick); }
  else if (!state.base.length) message('Vyber skladbu z knihovny, otevři .mid soubor, nebo převeď video z YouTube.');
}

async function loadSongFile(file) {
  try {
    const song = await (await fetch(`songs/${encodeURIComponent(file)}`)).json();
    prefs.song = file; savePrefs();
    setSong(song.title, song.notes);
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
  const key = detectKey(state.base);
  $('song-info').textContent = `${key.name} · ${Math.round(60 / state.grid.beat)} BPM · ${state.grid.meter}/4`;
  message('');
  applyLevel();
  player.seek(Math.max(0, state.base[0].s - 1));
  updateLoopUi();
}

function applyLevel() {
  if (!state.base.length) return;
  if (!state.cache.has(state.level)) state.cache.set(state.level, arrange(state.base, state.level, state.grid));
  state.notes = state.cache.get(state.level);
  player.setNotes(state.notes);
  const ps = state.notes.map((n) => n.p);
  state.lo = Math.min(...ps) - 2; state.hi = Math.max(...ps) + 2;
  // aspon 2 oktavy, at nejsou klavesy obri
  while (state.hi - state.lo < 24) { state.lo--; state.hi++; }
  state.duration = songEnd(state.notes);
  for (const b of $('levels').children) b.setAttribute('aria-pressed', String(Number(b.dataset.level) === state.level));
  $('level-hint').textContent = LEVELS.find((l) => l.id === state.level).hint;
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
  try {
    if (/\.json$/i.test(f.name)) {
      const song = JSON.parse(await f.text());
      setSong(song.title || f.name, song.notes);
    } else {
      setSong(f.name.replace(/\.midi?$/i, ''), midiToNotes(await f.arrayBuffer()));
    }
    $('song').value = '';
  } catch (e) { message(`Soubor nejde otevřít: ${e.message}`); }
  ev.target.value = '';
});
$('song').addEventListener('change', (e) => e.target.value && loadSongFile(e.target.value));

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

// ── Ovladani ────────────────────────────────────────────────────────────────
for (const l of LEVELS) {
  const b = document.createElement('button');
  b.className = 'btn ghost';
  b.dataset.level = l.id;
  b.title = l.hint;
  b.innerHTML = `${l.id}<span>${l.name}</span>`;
  b.addEventListener('click', () => setLevel(l.id));
  $('levels').append(b);
}
function setLevel(id) { state.level = id; prefs.level = id; savePrefs(); applyLevel(); }

function togglePlay() {
  if (!state.base.length) return;
  if (player.playing) player.pause();
  else {
    if (state.loopOn && state.loop && (player.now() < state.loop.a || player.now() >= state.loop.b)) player.seek(state.loop.a);
    player.play();
  }
  $('play').textContent = player.playing ? '⏸' : '▶';
}
player.onEnd = () => { $('play').textContent = '▶'; };
$('play').addEventListener('click', togglePlay);
$('restart').addEventListener('click', () => player.seek(state.loopOn && state.loop ? state.loop.a : 0));

function updateLoopUi() {
  const l = state.loop;
  $('loop').setAttribute('aria-pressed', String(state.loopOn));
  $('loop-info').textContent = l ? `${fmt(l.a)}–${fmt(l.b)}` : 'žádný úsek';
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
tl.addEventListener('pointerup', (ev) => {
  if (!drag) return;
  if (drag.moved && state.loop) { setLoop(state.loop.a, state.loop.b); player.seek(state.loop.a); }
  else player.seek(drag.t0);
  drag = null;
});

const bindCheck = (id, key, def, fn) => {
  const el = $(id);
  el.checked = prefs[key] ?? def;
  el.addEventListener('change', () => { prefs[key] = el.checked; savePrefs(); fn?.(); });
};
bindCheck('letters', 'letters', true);
bindCheck('fingers', 'fingers', false);
bindCheck('play-r', 'playR', true, () => { player.mute.R = !$('play-r').checked; });
bindCheck('play-l', 'playL', true, () => { player.mute.L = !$('play-l').checked; });
player.mute.R = !$('play-r').checked;
player.mute.L = !$('play-l').checked;
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

document.addEventListener('keydown', (e) => {
  // na tlacitkach a polich ma mezernik/sipky svuj vlastni vyznam
  if (e.target.closest('input, select, button, summary, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'ArrowLeft') player.seek(player.now() - 5);
  else if (k === 'ArrowRight') player.seek(player.now() + 5);
  else if (k === '[') $('set-a').click();
  else if (k === ']') $('set-b').click();
  else if (k === 'l' || k === 'L') $('loop').click();
  else if (k >= '1' && k <= '5') setLevel(Number(k));
  else if (k === 'p' || k === 'P') $('fingers').click();
  else if (k === 'n' || k === 'N') $('letters').click();
  else return;
  $('play').textContent = player.playing ? '⏸' : '▶';
});

// ── Smycka vykreslovani ─────────────────────────────────────────────────────
function frame() {
  const now = player.now();
  const canvas = $('stage');
  if (state.notes.length) {
    draw(canvas, {
      now, notes: state.notes, layout: layoutKeys(state.lo, state.hi, canvas.clientWidth),
      lookahead: 10 / Number($('zoom').value), showLetters: $('letters').checked, naming: $('naming').value,
      showFingers: $('fingers').checked, loop: state.loopOn ? state.loop : null,
      mute: { L: !$('play-l').checked, R: !$('play-r').checked },
    });
    drawTimeline(tl, { notes: state.notes, duration: state.duration, now, loop: state.loop, lo: state.lo, hi: state.hi });
    $('time').textContent = `${fmt(now)} / ${fmt(state.duration)}`;
    const ch = state.chords.find((c) => c.s <= now && c.e > now);
    $('chord').textContent = ch ? ch.name : '';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

$('speed').value = 1;
loadIndex();
initConvert();
