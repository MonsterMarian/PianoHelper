// Upravy skladby na ruzne obtiznosti. Teorie: teorie/04-aranzovani.md
//
// 1 Melodie     - jen melodie pravou rukou (bez ozdob)
// 2 Snadne      - melodie + levou rukou jeden basovy ton na kazdy takt / zmenu akordu
// 3 Stredni     - melodie + leva ruka bas + ton akordu (vedeni hlasu) na kazdou pulku taktu
// 4 Original    - presne podle videa
// 5 Pokrocile   - original + oktavy v melodii + leva ruka rozlozene akordy
import { onsetGroups, clone, songEnd } from './music.js';
import { estimateGrid, chordTrack, beatTimes } from './analysis.js';
import { splitHands, rebalanceHands, MAX_SPAN } from './hands.js';
import { fingerAll } from './fingering.js';

export const LEVELS = [
  { id: 1, name: 'Melodie', hint: 'Jen melodie pravou rukou' },
  { id: 2, name: 'Snadné', hint: 'Melodie + basový tón na takt' },
  { id: 3, name: 'Střední', hint: 'Melodie + dvojhlas v levé ruce' },
  { id: 4, name: 'Originál', hint: 'Přesně podle videa' },
  { id: 5, name: 'Pokročilé', hint: 'Oktávy v melodii + rozložené akordy' },
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

// Horni ton leve ruky (uroven 3): ton akordu 3-12 pultonu nad basem, co nejbliz predchozimu
// hornimu tonu (vedeni hlasu); bez predchoziho kvinta. Kvinta ma malou prednost.
function upperFor(chord, bass, ceiling, prev) {
  let best = null;
  for (let p = bass + 3; p <= Math.min(bass + 12, ceiling); p++) {
    if (!chord.tones.includes(p % 12)) continue;
    const isFifth = (p - chord.root + 120) % 12 === 7;
    const cost = (prev === null ? 0 : Math.abs(p - prev)) - (isFifth ? 0.5 : 0) + (prev === null && !isFifth ? 5 : 0);
    if (!best || cost < best.cost) best = { p, cost };
  }
  return best ? best.p : null;
}

function leftHandSimple(notes, melody, grid, end, { fifths, perBar }) {
  const chords = chordTrack(notes, grid, end);
  const beats = beatTimes(grid, end);
  const out = [];
  // Snadne: ton na kazdy takt; Stredni: na kazdou pulku taktu (ve 3/4 na takt). Plus kazda zmena akordu.
  // Doby jsou pole casu (tempo se muze menit), beats[0] je prvni doba taktu.
  const unit = perBar || grid.meter % 2 ? grid.meter : 2;
  let prevBass = null, prevUpper = null;
  for (const ch of chords) {
    const ei = beats.indexOf(ch.e);
    const slots = [ch.si];
    for (let i = ch.si + 1; i < ei; i++) if (i % unit === 0) slots.push(i);
    for (let k = 0; k < slots.length; k++) {
      const a = beats[slots[k]], b = k + 1 < slots.length ? beats[slots[k + 1]] : ch.e;
      // kratka zmena akordu uprostred taktu je pro zacatecnika zbytecna
      if (perBar && k === 0 && ch.si % unit !== 0 && ei - ch.si < 2) continue;
      // leva ruka nesmi prekryt melodii: strop = nejnizsi melodicky ton v okne - 3
      const mel = melody.filter((m) => m.s < b && m.e > a).map((m) => m.p);
      const ceiling = (mel.length ? Math.min(...mel) : 72) - 3;
      const bass = bassFor(notes, ch, a, b, ceiling - (fifths ? 3 : 0), prevBass);
      if (bass === null) continue;
      const dur = Math.max(0.1, b - a - 0.02);
      out.push({ p: bass, s: a, e: a + dur, h: 'L' });
      prevBass = bass;
      if (!fifths) continue;
      const upper = upperFor(ch, bass, ceiling, prevUpper);
      if (upper !== null) { out.push({ p: upper, s: a, e: a + dur, h: 'L' }); prevUpper = upper; }
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

// Pokrocile: oktavove zdvojeni melodie na dlouhych tonech + rozlozene akordy v leve ruce.
function advanced(notes, grid, end) {
  const out = clone(notes);
  const melody = extractMelody(notes, grid);
  const melodySet = new Set(melody.map((m) => `${m.p}@${m.s.toFixed(3)}`));
  for (const n of notes) {
    if (n.h === 'L' || !melodySet.has(`${n.p}@${n.s.toFixed(3)}`) || n.e - n.s < grid.beat * 0.9) continue;
    const others = notes.filter((o) => o !== n && o.h !== 'L' && o.s < n.e && o.e > n.s).map((o) => o.p);
    const low = n.p - 12;
    if (others.some((p) => p < low) || others.some((p) => p === low)) continue;
    if (others.length && Math.max(n.p, ...others) - low > MAX_SPAN) continue;
    out.push({ p: low, s: n.s, e: n.e, h: 'R', added: true });
  }

  // drzene noty leve ruky (>= 2 doby) -> rozlozeny akord v osminach: zaklad, kvinta, oktava, kvinta
  const chords = chordTrack(notes, grid, end);
  const beats = beatTimes(grid, end);
  const result = [];
  for (const n of out) {
    if (n.h !== 'L' || n.e - n.s < grid.beat * 2 || n.added) { result.push(n); continue; }
    const others = out.filter((o) => o !== n && o.h === 'L' && o.s < n.e && o.e > n.s);
    if (others.some((o) => o.p < n.p)) { result.push(n); continue; }   // jen nejnizsi (basovy) ton
    const ch = chords.find((c) => c.s <= n.s + 0.05 && c.e > n.s + 0.05);
    if (!ch || !ch.tones.includes(n.p % 12)) { result.push(n); continue; }
    const top = Math.min(...out.filter((o) => o.h !== 'L' && o.s < n.e && o.e > n.s).map((o) => o.p), 84);
    const fifthPc = (ch.root + 7) % 12;
    const fifth = placeInRange(fifthPc, n.p + 1, n.p + 11, n.p + 7);
    const pattern = [n.p, fifth, n.p + 12, fifth].map((p) => (p !== null && p < top - 2 ? p : null));
    const times = eighthsIn(beats, n.s, n.e);
    times.forEach((t, k) => {
      const p = pattern[k % 4];
      const next = times[k + 1] ?? n.e;
      if (p === null) return;
      if (k > 0 && others.some((o) => o.p === p && o.s < next && o.e > t)) return;
      result.push({ p, s: t, e: t + (next - t) * 0.95, h: 'L', added: k > 0 });
    });
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
  if (level === 1) out = extractMelody(base, grid);
  else if (level === 2 || level === 3) {
    const melody = extractMelody(base, grid);
    out = [...melody, ...leftHandSimple(base, melody, grid, end, { fifths: level === 3, perBar: level === 2 })];
  } else if (level === 5) out = advanced(base, grid, end);
  else out = base;
  out.sort((a, b) => a.s - b.s || a.p - b.p);
  rebalanceHands(out);
  fingerAll(out);
  return out;
}
