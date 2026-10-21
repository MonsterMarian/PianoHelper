// Upravy skladby na ruzne obtiznosti. Teorie: teorie/04-aranzovani.md
//
// Zebrik verzi: snazsi nez original jsou jen podmnoziny jeho not (melodie a bas zustavaji nejdel,
// Nakamura et al. 2018), tezsi jsou original + pridane noty. Pet tlacitek je okno do zebriku:
// lehky original je 3. uroven, tezky 4., velmi tezky 5. (nad nim uz se nic nevymysli).
import { onsetGroups, clone, songEnd } from './music.js';
import { estimateGrid, chordTrack, beatTimes } from './analysis.js';
import { splitHands, rebalanceHands, MAX_SPAN } from './hands.js';
import { fingerAll } from './fingering.js';

export const STEPS = {
  beginner: { name: 'Začátečník', hint: 'Jen hlavní tóny melodie, nejvýš jeden na dobu' },
  easy: { name: 'Snadné', hint: 'Celá melodie + původní basové tóny' },
  core: { name: 'Střední', hint: 'Melodie + levá ruka z originálu bez rychlých výplní' },
  thin: { name: 'Skoro originál', hint: 'Originál bez ozdob a šestnáctin, akordy nejvýš 3 tóny' },
  original: { name: 'Originál', hint: 'Přesně podle videa' },
  advanced: { name: 'Pokročilé', hint: 'Originál + rozložené akordy vlevo + harmonie pod melodií' },
  master: { name: 'Mistr', hint: 'Jako pokročilé + oktávy v melodii' },
};
const LADDERS = [
  ['beginner', 'easy', 'original', 'advanced', 'master'],
  ['beginner', 'easy', 'core', 'original', 'advanced'],
  ['beginner', 'easy', 'core', 'thin', 'original'],
];
// Prahy obtiznosti originalu (p90 z D, viz difficulty): EASY tutorialy 3-9, plny cover (Levels) 18.
const HARD = 10, VERY_HARD = 14;

const levelList = (ladder) => ladder.map((key, i) => ({ id: i + 1, key, ...STEPS[key] }));
export const LEVELS = levelList(LADDERS[0]);

/**
 * Obtiznost hrani (Nakamura et al. 2018: D = D_L + D_R v 1s oknech): kazdy nastup stoji 1,
 * kazdy dalsi ton akordu 0,5, presun ruky o vic nez kvartu ~1 bod za 7 pultonu. Vraci 90. percentil.
 */
export function difficulty(notes) {
  const end = songEnd(notes);
  const mid = (g) => g.notes.reduce((a, n) => a + n.p, 0) / g.notes.length;
  const cost = ['L', 'R'].flatMap((h) => {
    const gs = onsetGroups(notes.filter((n) => (h === 'L') === (n.h === 'L')));
    return gs.map((g, i) => ({ t: g.t, v: 1 + 0.5 * (g.notes.length - 1) + (i ? Math.max(0, Math.abs(mid(g) - mid(gs[i - 1])) - 5) / 7 : 0) }));
  });
  const D = [];
  for (let t = 0; t < end; t += 0.5) {
    const v = cost.filter((x) => x.t >= t && x.t < t + 1).reduce((a, x) => a + x.v, 0);
    if (v > 0) D.push(v);
  }
  D.sort((a, b) => a - b);
  return D.length ? D[Math.floor(D.length * 0.9)] : 0;
}

/** Pet urovni pro skladbu podle obtiznosti originalu. */
export function levelsFor(notes) {
  const d = difficulty(notes.every((n) => n.h) ? notes : splitHands(clone(notes)));
  return levelList(LADDERS[d >= VERY_HARD ? 2 : d >= HARD ? 1 : 0]);
}

// Poradi kroku od nejsnazsiho - kdyz skladba ulozeny krok nema, vezme se nejblizsi.
export const STEP_ORDER = Object.keys(STEPS);

/**
 * Melodie = nejvyssi ton kazdeho nastupu prave ruky ("skyline", Uitdenbogerd & Zobel 1999).
 * Ozdoby (kratsi nez 1/4 doby, ktere hned prechazi na sousedni ton) se vynechaji.
 * Nota drzi do dalsiho tonu melodie (legato), nejdele vsak puvodni delku.
 */
export function extractMelody(notes, grid) {
  const rh = notes.filter((n) => n.h !== 'L');
  const tops = onsetGroups(rh).map((g) => g.notes.reduce((a, b) => (b.p > a.p ? b : a)));
  const kept = [];
  for (let i = 0; i < tops.length; i++) {
    const n = tops[i], next = tops[i + 1];
    const isOrnament = next && n.e - n.s < grid.beat / 4 && next.s - n.s < grid.beat / 4 && Math.abs(next.p - n.p) <= 2;
    if (isOrnament) continue;
    // ton, ktery zacne pod jeste znejici vyssi notou melodie, je doprovod (vnitrni hlas)
    const prev = kept[kept.length - 1];
    if (prev && prev.e > n.s + 0.05 && prev.p > n.p) continue;
    kept.push(n);
  }
  // legato: ton drzi do dalsiho tonu melodie, nejvys vsak puvodni delku (a aspon 0.1 s)
  return kept.map((n, i) => {
    const next = kept[i + 1];
    const e = next ? Math.max(n.s + 0.1, Math.min(n.e, next.s)) : n.e;
    return { p: n.p, s: n.s, e, h: 'R' };
  });
}

/**
 * Zjednodusena melodie (uroven 1): v kazde dobe jen jeden ton - ten, ktery zacina na dobe a je
 * nejdelsi (hlavni ton); rychle behy, prirazy a synkopy mezi dobami zmizi. Ton drzi do dalsiho.
 */
export function simplifyMelody(melody, grid, end) {
  const beats = beatTimes(grid, end);
  const T = grid.beat;
  // u rychlych skladeb jeden ton na pul taktu / takt: mezi tony aspon 0.6 s
  let step = 1;
  while (step < grid.meter && step * T < 0.6) step = grid.meter % 2 === 0 && step * 2 <= grid.meter ? step * 2 : grid.meter;
  const kept = [];
  for (let i = 0; i + step < beats.length; i += step) {
    const a = beats[i] - 0.15 * T, b = beats[i + step] - 0.15 * T;
    let best = null;
    const prev = kept[kept.length - 1];
    for (const n of melody) {
      if (n.s < a || n.s >= b) continue;
      // dlouhy ton na konci predchoziho okna + ton na zacatku tohoto = dva tony tesne po sobe
      if (prev && n.s - prev.s < Math.max(0.55, 0.75 * step * T)) continue;
      const score = (Math.abs(n.s - beats[i]) < 0.15 * T ? 1 : 0) + Math.min(n.e, beats[i + step]) - n.s;
      if (!best || score > best.score) best = { n, score };
    }
    if (best) kept.push(best.n);
  }
  return kept.map((n, i) => {
    const next = kept[i + 1];
    const e = next ? Math.max(n.s + 0.1, Math.min(Math.max(n.e, n.s + T * step * 0.9), next.s - 0.02)) : n.e;
    return { p: n.p, s: n.s, e, h: 'R' };
  });
}

// Ton akordu v rozsahu [lo, hi] co nejbliz cili.
function placeInRange(pc, lo, hi, target) {
  let best = null;
  for (let p = lo; p <= hi; p++) if (p % 12 === pc && (best === null || Math.abs(p - target) < Math.abs(best - target))) best = p;
  return best;
}

/**
 * Stredni: cela melodie + leva ruka z originalu, ale jen nastupy aspon pul doby od sebe
 * (rychle vyplne pryc) a nejvys 2 tony naraz (nejnizsi + nejvyssi = bas a tvar akordu).
 */
function core(notes, grid) {
  const melody = extractMelody(notes, grid);
  const lh = [];
  let last = -Infinity;
  for (const g of onsetGroups(notes.filter((n) => n.h === 'L'))) {
    if (g.t - last < grid.beat / 2 - 0.03) continue;
    const ns = [...g.notes].sort((a, b) => a.p - b.p);
    lh.push(...new Set([ns[0], ns[ns.length - 1]]));
    last = g.t;
  }
  return [...melody, ...lh.map((n) => ({ ...n }))];
}

/**
 * Skoro original: original bez ozdob (ton kratsi nez 1/4 doby tesne pred sousednim tonem), bez
 * sestnactin (nastupy v ruce aspon 1/3 doby od sebe - osminy a trioly zustanou) a akordy nejvys
 * 3 tony v ruce - zustane melodie (nahore v prave), bas (dole v leve) a tony nejblize k nim.
 */
function thin(notes, grid) {
  const q = grid.beat / 4;
  const out = [];
  for (const h of ['L', 'R']) {
    const gs = onsetGroups(notes.filter((n) => (h === 'L') === (n.h === 'L')));
    let last = -Infinity;
    gs.forEach((g, i) => {
      const next = gs[i + 1], n0 = g.notes[0];
      const ornament = g.notes.length === 1 && next && next.t - g.t < q && n0.e - n0.s < q &&
        next.notes.some((n) => Math.abs(n.p - n0.p) <= 2);
      if (ornament || g.t - last < grid.beat / 3 - 0.03) return;
      last = g.t;
      out.push(...[...g.notes].sort((a, b) => (h === 'R' ? b.p - a.p : a.p - b.p)).slice(0, 3));
    });
  }
  return out.map((n) => ({ ...n }));
}

// Basovy ton pro okno: nejnizsi puvodni nota leve ruky pod stropem, ktera v okne zacina (kousek
// pred dobou se pocita). Zadny vymysleny ton - kde original bas nema, nema ho ani snadna verze.
function bassFor(notes, a, b, ceiling, tol) {
  return notes.filter((n) => n.h === 'L' && n.s >= a - tol && n.s < b - tol && n.p <= ceiling)
    .sort((x, y) => x.p - y.p)[0] ?? null;
}

function leftHandSimple(notes, melody, grid, end) {
  const chords = chordTrack(notes, grid, end);
  const beats = beatTimes(grid, end);
  const out = [];
  // ton na kazdy takt + zmena akordu delsi nez 2 doby.
  // Doby jsou pole casu (tempo se muze menit), beats[0] je prvni doba taktu.
  const unit = grid.meter;
  for (const ch of chords) {
    const ei = beats.indexOf(ch.e);
    const slots = [ch.si];
    for (let i = ch.si + 1; i < ei; i++) if (i % unit === 0) slots.push(i);
    for (let k = 0; k < slots.length; k++) {
      const a = beats[slots[k]], b = k + 1 < slots.length ? beats[slots[k + 1]] : ch.e;
      // kratka zmena akordu uprostred taktu je pro zacatecnika zbytecna
      if (k === 0 && ch.si % unit !== 0 && ei - ch.si < 2) continue;
      // leva ruka nesmi prekryt melodii: strop = nejnizsi melodicky ton v okne - 3
      const mel = melody.filter((m) => m.s < b && m.e > a).map((m) => m.p);
      const ceiling = (mel.length ? Math.min(...mel) : 72) - 3;
      const bass = bassFor(notes, a, b, ceiling, 0.25 * grid.beat);
      if (!bass || out.some((o) => o.s === bass.s)) continue;
      out.push({ p: bass.p, s: bass.s, e: Math.max(bass.e, bass.s + 0.1), h: 'L' });
    }
  }
  // preskocena kratka zmena akordu nesmi nechat diru: ton drzi do dalsiho basu, nejdele takt
  const bar = grid.beat * grid.meter;
  const starts = [...new Set(out.map((n) => n.s))].sort((x, y) => x - y);
  for (const n of out) {
    const next = starts.find((t) => t > n.s + 1e-6) ?? Infinity;
    n.e = Math.max(n.e, Math.min(next - 0.02, n.s + bar, end));
  }
  return out;
}

// Osminy (puldoby) v useku [a, b): doby + stredy mezi nimi; zacina vzdy v a.
function eighthsIn(beats, a, b) {
  const pts = [];
  for (let i = 0; i + 1 < beats.length; i++) pts.push(beats[i], (beats[i] + beats[i + 1]) / 2);
  const step = (beats[1] - beats[0]) / 2;
  const out = pts.filter((t) => t > a + 0.25 * step && t < b - 0.5 * step);
  return [a, ...out];
}

// Pokrocile / Mistr: drzene basy v leve ruce -> rozlozene akordy; pak v prave ruce pod dlouhe
// tony melodie ton akordu (tercie/sexta), u Mistra navic oktava - jen nad levou rukou, at se ruce nesrazi.
function advanced(notes, grid, end, { octaves }) {
  const chords = chordTrack(notes, grid, end);
  const beats = beatTimes(grid, end);
  const chordAt = (t) => chords.find((c) => c.s <= t + 0.05 && c.e > t + 0.05);

  // 1) leva ruka: drzena nota (>= 2 doby) zustane cela (original, malicek ji drzi)
  //    a v osminach se prida kvinta, oktava, kvinta (prsty 2-1-2)
  const result = [];
  for (const n of notes) {
    if (n.h !== 'L' || n.e - n.s < grid.beat * 2) { result.push({ ...n }); continue; }
    const others = notes.filter((o) => o !== n && o.h === 'L' && o.s < n.e && o.e > n.s);
    if (others.some((o) => o.p < n.p)) { result.push({ ...n }); continue; }   // jen nejnizsi (basovy) ton
    const ch = chordAt(n.s);
    if (!ch || !ch.tones.includes(n.p % 12)) { result.push({ ...n }); continue; }
    const top = Math.min(...notes.filter((o) => o.h !== 'L' && o.s < n.e && o.e > n.s).map((o) => o.p), 84);
    const fifth = placeInRange((ch.root + 7) % 12, n.p + 1, n.p + 11, n.p + 7);
    const pattern = [n.p, fifth, n.p + 12, fifth].map((p) => (p !== null && p < top - 2 ? p : null));
    const times = eighthsIn(beats, n.s, n.e);
    const FINGERS = [5, 2, 1, 2];                                  // ucebnicovy rozklad leve ruky
    result.push({ ...n, fixF: 5 });
    times.forEach((t, k) => {
      const p = pattern[k % 4];
      const next = times[k + 1] ?? n.e;
      if (p === null || k % 4 === 0) return;
      if (others.some((o) => o.p === p && o.s < next && o.e > t)) return;
      result.push({ p, s: t, e: t + (next - t) * 0.95, h: 'L', added: true, fixF: FINGERS[k % 4] });
    });
  }

  // 2) prava ruka: harmonie (a oktava) pod dlouhe tony melodie
  const melody = extractMelody(notes, grid);
  const melodySet = new Set(melody.map((m) => `${m.p}@${m.s.toFixed(3)}`));
  for (const n of notes) {
    if (n.h === 'L' || !melodySet.has(`${n.p}@${n.s.toFixed(3)}`) || n.e - n.s < grid.beat * 0.9) continue;
    const others = result.filter((o) => o.p !== n.p && o.h !== 'L' && o.s < n.e && o.e > n.s).map((o) => o.p);
    const lhTop = Math.max(-1, ...result.filter((o) => o.h === 'L' && o.s < n.e && o.e > n.s).map((o) => o.p));
    const fits = (p) => p > lhTop + 2 && !others.includes(p) && !others.some((o) => o < p && o > n.p - 13) &&
      Math.max(n.p, ...others) - Math.min(p, ...others) <= MAX_SPAN;
    const ch = chordAt(n.s);
    if (ch) {
      const cand = [n.p - 3, n.p - 4, n.p - 8, n.p - 9, n.p - 5].find((p) => ch.tones.includes(((p % 12) + 12) % 12) && fits(p));
      if (cand !== undefined) { result.push({ p: cand, s: n.s, e: n.e, h: 'R', added: true }); others.push(cand); }
    }
    if (octaves && fits(n.p - 12)) result.push({ p: n.p - 12, s: n.s, e: n.e, h: 'R', added: true });
  }
  return result;
}

/**
 * Vrati noty pro danou uroven (1-5 podle levelsFor), kazda s rukou (h), prstem (f)
 * a pripadne moved/added. Vstupni noty se nemeni.
 */
export function arrange(notes, level, grid = null) {
  const base = splitHands(clone(notes));
  const end = songEnd(base);
  grid = grid || estimateGrid(base);
  const step = levelsFor(base)[level - 1].key;
  let out;
  if (step === 'beginner') out = simplifyMelody(extractMelody(base, grid), grid, end);
  else if (step === 'easy') {
    const melody = extractMelody(base, grid);
    out = [...melody, ...leftHandSimple(base, melody, grid, end)];
  } else if (step === 'core') out = core(base, grid);
  else if (step === 'thin') out = thin(base, grid);
  else if (step === 'advanced' || step === 'master') out = advanced(base, grid, end, { octaves: step === 'master' });
  else out = base;
  out.sort((a, b) => a.s - b.s || a.p - b.p);
  rebalanceHands(out);
  fingerAll(out);
  return out;
}
