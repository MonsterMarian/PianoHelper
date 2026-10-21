// Upravy skladby na ruzne obtiznosti. Teorie: teorie/04-aranzovani.md
//
// 1 Zacatecnik  - zjednodusena melodie pravou rukou: nejvys jeden ton na dobu, hlavni tony
// 2 Snadne      - cela melodie + levou rukou jeden basovy ton na takt
// 3 Original    - presne podle videa (stred skaly: 2 urovne snazsi, 2 tezsi)
// 4 Pokrocile   - original + leva ruka rozlozene akordy + pod dlouhe tony melodie ton akordu
// 5 Mistr       - jako 4 + oktavy v melodii
import { onsetGroups, clone, songEnd } from './music.js';
import { estimateGrid, chordTrack, beatTimes } from './analysis.js';
import { splitHands, rebalanceHands, MAX_SPAN } from './hands.js';
import { fingerAll } from './fingering.js';

export const LEVELS = [
  { id: 1, name: 'Začátečník', hint: 'Jen hlavní tóny melodie, nejvýš jeden na dobu' },
  { id: 2, name: 'Snadné', hint: 'Celá melodie + basový tón na takt' },
  { id: 3, name: 'Originál', hint: 'Přesně podle videa' },
  { id: 4, name: 'Pokročilé', hint: 'Rozložené akordy vlevo + harmonie pod melodií' },
  { id: 5, name: 'Mistr', hint: 'Jako pokročilé + oktávy v melodii' },
];

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
    for (const n of melody) {
      if (n.s < a || n.s >= b) continue;
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

// Basovy ton pro okno: nejnizsi puvodni nota leve ruky, pokud patri do akordu, jinak zaklad
// akordu v oktave nejbliz predchozimu basu (ruka se zbytecne nepresouva).
function bassFor(notes, chord, a, b, ceiling, prev) {
  const low = notes.filter((n) => n.h === 'L' && n.s < b && n.e > a).sort((x, y) => x.p - y.p)[0];
  if (low && chord.tones.includes(low.p % 12) && low.p <= ceiling) return low.p;
  return placeInRange(chord.root, 36, Math.min(ceiling, 59), prev ?? (low ? low.p : 48));
}

function leftHandSimple(notes, melody, grid, end) {
  const chords = chordTrack(notes, grid, end);
  const beats = beatTimes(grid, end);
  const out = [];
  // ton na kazdy takt + zmena akordu delsi nez 2 doby.
  // Doby jsou pole casu (tempo se muze menit), beats[0] je prvni doba taktu.
  const unit = grid.meter;
  let prevBass = null;
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
      const bass = bassFor(notes, ch, a, b, ceiling, prevBass);
      if (bass === null) continue;
      const dur = Math.max(0.1, b - a - 0.02);
      out.push({ p: bass, s: a, e: a + dur, h: 'L' });
      prevBass = bass;
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

  // 1) leva ruka: drzena nota (>= 2 doby) -> osminy zaklad, kvinta, oktava, kvinta
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
    times.forEach((t, k) => {
      const p = pattern[k % 4];
      const next = times[k + 1] ?? n.e;
      if (p === null) return;
      if (k > 0 && others.some((o) => o.p === p && o.s < next && o.e > t)) return;
      result.push({ p, s: t, e: t + (next - t) * 0.95, h: 'L', added: k > 0, fixF: FINGERS[k % 4] });
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
 * Vrati noty pro danou uroven, kazda s rukou (h), prstem (f) a pripadne moved/added.
 * Vstupni noty se nemeni.
 */
export function arrange(notes, level, grid = null) {
  const base = splitHands(clone(notes));
  const end = songEnd(base);
  grid = grid || estimateGrid(base);
  let out;
  if (level === 1) out = simplifyMelody(extractMelody(base, grid), grid, end);
  else if (level === 2) {
    const melody = extractMelody(base, grid);
    out = [...melody, ...leftHandSimple(base, melody, grid, end)];
  } else if (level === 4 || level === 5) out = advanced(base, grid, end, { octaves: level === 5 });
  else out = base;
  out.sort((a, b) => a.s - b.s || a.p - b.p);
  rebalanceHands(out);
  fingerAll(out);
  return out;
}
