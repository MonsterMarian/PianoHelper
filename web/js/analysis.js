// Hudebni analyza: mrizka dob (tempo), metrum, akordy, tonina.
// Teorie a zdroje: teorie/01-analyza.md
import { onsetGroups } from './music.js';

// Soudrznost nastupu s periodou T: 1 = vsechny nastupy lezi na mrizce.
function coherence(events, T) {
  let re = 0, im = 0, sum = 0;
  for (const { t, w } of events) {
    const a = (2 * Math.PI * t) / T;
    re += w * Math.cos(a);
    im += w * Math.sin(a);
    sum += w;
  }
  return { c: Math.hypot(re, im) / (sum || 1), phase: (((Math.atan2(im, re) / (2 * Math.PI)) * T) % T + T) % T };
}

/**
 * Zpresni periodu a fazi mrizky metodou nejmensich ctvercu: kazdy nastup se priradi
 * k nejblizsi dobe mrizky a prolozi se primka t = faze + n * T. Okno se postupne
 * rozsiruje, aby se pri drobne chybe periody neprirazovaly nastupy ke spatne dobe.
 */
export function refineGrid(onsets, T, phase) {
  const t0 = onsets[0];
  for (const span of [20, 40, 80, 160, 320, 640, Infinity]) {
    for (let iter = 0; iter < 2; iter++) {
      let sn = 0, st = 0, snn = 0, snt = 0, k = 0;
      for (const t of onsets) {
        if (t - t0 > span) break;
        const n = Math.round((t - phase) / T);
        if (Math.abs(t - phase - n * T) > 0.25 * T) continue;      // mimo mrizku (napr. triola)
        sn += n; st += t; snn += n * n; snt += n * t; k++;
      }
      const den = k * snn - sn * sn;
      if (k < 4 || den === 0) break;
      T = (k * snt - sn * st) / den;
      phase = (st - T * sn) / k;
    }
  }
  return { T, phase: ((phase % T) + T) % T };
}

const tempoPrior =(beat) => Math.exp(-0.5 * (Math.log2(beat / 0.6) / 0.7) ** 2);

/**
 * Odhad mrizky dob.
 * 1) "tatum" = nejdelsi perioda, na kterou padaji skoro vsechny nastupy,
 * 2) doba = nasobek tatumu, na kterem lezi prizvuky (basy, akordy, dlouhe noty),
 * 3) takt = 3 nebo 4 doby podle toho, kde jsou prizvuky soudrznejsi.
 */
export function estimateGrid(notes) {
  const groups = onsetGroups(notes);
  if (groups.length < 8) return { beat: 0.5, phase: groups[0]?.t ?? 0, meter: 4, downbeat: groups[0]?.t ?? 0, confidence: 0 };

  const plain = groups.map((g) => ({ t: g.t, w: 1 }));
  const accents = groups.map((g) => {
    const longest = Math.max(...g.notes.map((n) => n.e - n.s));
    const low = Math.min(...g.notes.map((n) => n.p));
    return { t: g.t, w: g.notes.length + Math.min(2, longest * 2) + (low < 60 ? 1.5 : 0) };
  });

  // 1) tatum - hledani na zacatku skladby (kratke okno = siroky vrchol, krok 2 ms staci)
  const head = plain.filter((e) => e.t - plain[0].t <= 30);
  const win = head.length >= 16 ? head : plain.slice(0, 16);
  let tatum = null;
  const cands = [];
  for (let T = 0.12; T <= 1.2; T += 0.002) cands.push({ T, ...coherence(win, T) });
  const maxC = Math.max(...cands.map((c) => c.c));
  for (let i = cands.length - 1; i >= 0; i--) {
    const c = cands[i];
    const isPeak = (i === 0 || c.c >= cands[i - 1].c) && (i === cands.length - 1 || c.c >= cands[i + 1].c);
    if (isPeak && c.c >= 0.85 * maxC) { tatum = c; break; }
  }
  tatum = refineGrid(plain.map((e) => e.t), tatum.T, tatum.phase);
  const onGrid = plain.filter(({ t }) => Math.abs(((t - tatum.phase) / tatum.T) - Math.round((t - tatum.phase) / tatum.T)) < 0.2).length;

  // 2) doba = k * tatum; faze doby = posun po tatumech, na ktery padne nejvic prizvuku
  let best = null;
  for (const k of [1, 2, 3, 4, 6, 8]) {
    const beat = tatum.T * k;
    if (beat < 0.3 || beat > 1.5) continue;
    const score = coherence(accents, beat).c * tempoPrior(beat);
    if (!best || score > best.score) best = { beat, score };
  }
  if (!best) best = { beat: tatum.T };
  best.phase = bestOffset(accents, best.beat, tatum.T, tatum.phase).ph;

  // 3) metrum + prvni doba taktu: zmeny akordu (a basy) padaji nejcasteji na prvni dobu
  const t0 = groups[0].t;
  const end = Math.max(...notes.map((n) => n.e));
  const beatGrid = { beat: best.beat, downbeat: best.phase - Math.ceil((best.phase - t0) / best.beat) * best.beat };
  // jen zmena zakladniho tonu (G -> G7 nebo G5 -> G neni zmena harmonie)
  const changes = chordTrack(notes, beatGrid, end)
    .filter((c, i, all) => i === 0 || all[i - 1].root !== c.root)
    .map((c) => ({ t: c.s, w: 4 }));
  const meterEvents = [...accents, ...changes];
  // skore = o kolik vic vahy pada na prvni dobu nez pri rovnomernem rozlozeni (share * m - 1)
  const opts = [3, 4].map((m) => ({ m, ...bestOffset(meterEvents, best.beat * m, best.beat, best.phase) }));
  opts.forEach((o) => { o.score = o.share * o.m - 1; });
  let pick = opts[0].score > opts[1].score ? opts[0] : opts[1];
  if (pick.score < 0.03) pick = opts[1];             // nejasne -> 4/4 (nejcastejsi)
  const meter = pick.m;
  let downbeat = pick.ph;
  const bar = best.beat * meter;
  downbeat -= Math.ceil((downbeat - t0) / bar - 1e-6) * bar;   // prvni takt pred prvni notou
  return { beat: best.beat, phase: best.phase, meter, downbeat, confidence: onGrid / plain.length };
}

// Ze vsech posunu base + j*unit (v ramci periody) vybere ten, na ktery padne nejvic vahy udalosti.
function bestOffset(events, period, unit, base) {
  const total = events.reduce((a, e) => a + e.w, 0) || 1;
  let best = null;
  for (let j = 0; j < Math.round(period / unit); j++) {
    const ph = base + j * unit;
    let s = 0;
    for (const { t, w } of events) {
      const r = (t - ph) / period;
      if (Math.abs(r - Math.round(r)) * period < unit / 3) s += w;
    }
    if (!best || s > best.s) best = { ph, s, share: s / total };
  }
  return best;
}

// Casy dob od zacatku do konce skladby.
export function beatTimes(grid, end) {
  const out = [];
  for (let t = grid.downbeat; t < end + grid.beat; t += grid.beat) out.push(t);
  return out;
}

const CHORDS = [
  { q: '', iv: [0, 4, 7], prior: 0.1 },
  { q: 'm', iv: [0, 3, 7], prior: 0.1 },
  { q: '7', iv: [0, 4, 7, 10], prior: 0 },
  { q: 'maj7', iv: [0, 4, 7, 11], prior: 0 },
  { q: 'm7', iv: [0, 3, 7, 10], prior: 0 },
  { q: 'dim', iv: [0, 3, 6], prior: 0 },
  { q: 'sus4', iv: [0, 5, 7], prior: 0 },
  { q: '5', iv: [0, 7], prior: -0.05 },
];
export const ROOTS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// Profil tonu (vazeny delkou) v okne [a, b); nejnizsi tony maji vetsi vahu.
function profile(notes, a, b) {
  const prof = new Array(12).fill(0);
  let bass = null;
  for (const n of notes) {
    const ov = Math.min(b, n.e) - Math.max(a, n.s);
    if (ov <= 0) continue;
    prof[n.p % 12] += ov;
    if (!bass || n.p < bass.p) bass = n;
  }
  return { prof, bass: bass ? bass.p % 12 : null };
}

// Nejlepsi akord pro profil; null = neni dost informaci.
export function matchChord(prof, bass = null) {
  const total = prof.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let best = null;
  for (let root = 0; root < 12; root++) {
    for (const ch of CHORDS) {
      const set = new Set(ch.iv.map((i) => (root + i) % 12));
      let s = 0;
      for (let pc = 0; pc < 12; pc++) s += set.has(pc) ? prof[pc] : -0.6 * prof[pc];
      s = s / total + ch.prior + (bass === root ? 0.15 : 0);
      // chybejici tony akordu snizuji jistotu (C a G samotne nejsou jasne C dur)
      for (const i of ch.iv) if (prof[(root + i) % 12] === 0) s -= 0.12;
      if (!best || s > best.score) best = { root, quality: ch.q, tones: [...set], score: s };
    }
  }
  best.name = ROOTS[best.root] + best.quality;
  return best;
}

/**
 * Akordy po dobach, sousedni stejne slouceny.
 * Vraci [{ s, e, root, quality, name, tones }].
 */
export function chordTrack(notes, grid, end) {
  const beats = beatTimes(grid, end);
  const out = [];
  for (let i = 0; i < beats.length - 1; i++) {
    const { prof, bass } = profile(notes, beats[i], beats[i + 1]);
    let ch = matchChord(prof, bass);
    if (!ch || ch.score < 0.2) {
      if (!out.length) continue;
      out[out.length - 1].e = beats[i + 1];       // nejasna doba = pokracuje predchozi akord
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.name === ch.name && Math.abs(last.e - beats[i]) < 1e-6) last.e = beats[i + 1];
    else out.push({ s: beats[i], e: beats[i + 1], root: ch.root, quality: ch.quality, name: ch.name, tones: ch.tones });
  }
  return out;
}

// Tonina: Krumhansl-Kessler profily (1982).
const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a, b) {
  const ma = a.reduce((x, y) => x + y) / 12, mb = b.reduce((x, y) => x + y) / 12;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db || 1);
}

export function detectKey(notes) {
  const prof = new Array(12).fill(0);
  for (const n of notes) prof[n.p % 12] += n.e - n.s;
  let best = { score: -2 };
  for (let t = 0; t < 12; t++) {
    const rot = (p) => p.map((_, i) => p[(i - t + 12) % 12]);
    for (const [mode, p] of [['dur', KK_MAJ], ['moll', KK_MIN]]) {
      const score = corr(prof, rot(p));
      if (score > best.score) best = { tonic: t, mode, score, name: `${ROOTS[t]} ${mode}` };
    }
  }
  return best;
}
