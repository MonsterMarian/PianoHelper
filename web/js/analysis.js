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
 * 1) "tatum" = nejdelsi perioda, na kterou padaji skoro vsechny nastupy (na zacatku skladby),
 * 2) doba = nasobek tatumu, na kterem lezi prizvuky (basy, akordy, dlouhe noty),
 * 3) sledovani dob: kazda dalsi doba se dorovna k prizvukum -> zvlada zmeny tempa,
 * 4) takt = 3 nebo 4 doby; prvni doba = kde je nejvic prizvuku a zmen harmonie.
 * Vraci { beats: [casy dob, beats[0] = prvni doba taktu], meter, beat (median), downbeat, confidence }.
 */
export function estimateGrid(notes) {
  const groups = onsetGroups(notes);
  const end = notes.reduce((m, n) => Math.max(m, n.e), 0);
  if (groups.length < 8) {
    const t0 = groups[0]?.t ?? 0, beats = [];
    for (let t = t0; t < end + 0.5; t += 0.5) beats.push(t);
    return { beats, meter: 4, beat: 0.5, downbeat: t0, confidence: 0 };
  }

  const plain = groups.map((g) => ({ t: g.t, w: 1 }));
  const accents = groups.map((g) => {
    const longest = Math.max(...g.notes.map((n) => n.e - n.s));
    const low = Math.min(...g.notes.map((n) => n.p));
    // cim hlubsi bas, tim silnejsi prizvuk (bas G2 na 1. dobe > akord G3-H3 na 2. dobe)
    return { t: g.t, w: g.notes.length + Math.min(2, longest * 2) + Math.max(0, (60 - low) / 6) };
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
  // zpresnit jen na zacatku - je to start pro sledovani, tempo se muze dal menit
  tatum = refineGrid(win.map((e) => e.t), tatum.T, tatum.phase);

  // 2) doba = k * tatum; faze doby = posun po tatumech, na ktery padne nejvic prizvuku
  let best = null;
  const headAcc = accents.slice(0, win.length);
  for (const k of [1, 2, 3, 4, 6, 8]) {
    const beat = tatum.T * k;
    if (beat < 0.3 || beat > 1.5) continue;
    const score = coherence(headAcc, beat).c * tempoPrior(beat);
    if (!best || score > best.score) best = { beat, score };
  }
  if (!best) best = { beat: tatum.T };
  const phase = bestOffset(headAcc, best.beat, tatum.T, tatum.phase).ph;

  // 3) sledovani dob
  const beats = trackBeats(accents, best.beat, phase, groups[0].t, end);

  // 4) takt: prizvuky a zmeny harmonie (jen zmena zakladniho tonu) sectene po dobach
  const T = median(beats.slice(1).map((b, i) => b - beats[i]));
  const acc = new Array(beats.length).fill(0);
  const near = (t) => {
    const i = nearestIndex(beats, t);
    return Math.abs(beats[i] - t) < 0.2 * T ? i : -1;
  };
  for (const e of accents) { const i = near(e.t); if (i >= 0) acc[i] += e.w; }
  chordTrack(notes, { beats }, end)
    .filter((c, i, all) => i === 0 || all[i - 1].root !== c.root)
    .forEach((c) => { if (c.si < acc.length) acc[c.si] += 4; });
  const total = acc.reduce((a, b) => a + b, 0) || 1;
  // skore = o kolik vic vahy pada na prvni dobu nez pri rovnomernem rozlozeni (share * m - 1)
  const opts = [3, 4].map((m) => {
    let bestJ = 0, bestS = -1;
    for (let j = 0; j < m; j++) {
      const s = acc.reduce((a, w, i) => a + (i % m === j ? w : 0), 0);
      if (s > bestS) { bestS = s; bestJ = j; }
    }
    return { m, j: bestJ, score: (bestS / total) * m - 1 };
  });
  let pick = opts[0].score > opts[1].score ? opts[0] : opts[1];
  if (pick.score < 0.03) pick = opts[1];             // nejasne -> 4/4 (nejcastejsi)
  // beats[0] ma byt prvni doba taktu: zahodit doby pred ni, nebo doplnit doby dopredu
  let out = beats.slice(pick.j);
  if (pick.j > 0 && out[0] > groups[0].t + 0.2 * T) {
    out = [...Array.from({ length: pick.m }, (_, k) => out[0] - (pick.m - k) * T), ...out];
  }
  const onGrid = plain.filter(({ t }) => near(t) >= 0).length;
  return { beats: out, meter: pick.m, beat: T, downbeat: out[0], confidence: onGrid / plain.length };
}

/**
 * Sledovani dob (jako fazovy zaves): predpoved = posledni doba + perioda; kdyz v okne
 * +-20 % periody lezi prizvuky, doba se k nim posune (80 %) a perioda se upravi (25 %).
 * Osminy a trioly lezi mimo okno, takze dobu nestrhnou.
 */
export function trackBeats(events, T0, phase, tStart, end) {
  const b0 = phase + Math.floor((tStart + 0.2 * T0 - phase) / T0) * T0;   // posledni doba <= prvni nota
  const fwd = followBeats(events, T0, b0, end + T0);
  // Start je odhadnuty z prvnich ~30 s; kdyz se tempo uz tam meni, prvni doby jsou nepresne.
  // Proto se zacatek prepocita pozpatku od doby, kde je sledovani uz ustalene.
  const anchor = Math.min(8, fwd.length - 2);
  if (anchor < 2) return fwd;
  const rev = events.map((e) => ({ t: -e.t, w: e.w })).reverse();
  const back = followBeats(rev, fwd[anchor + 1] - fwd[anchor], -fwd[anchor], -(tStart - 0.2 * T0)).map((t) => -t);
  const all = [...back.slice(1).reverse(), ...fwd.slice(anchor)];
  while (all.length > 2 && all[1] <= tStart + 0.2 * T0) all.shift();   // jen jedna doba pred prvni notou
  return all;
}

function followBeats(events, T0, b, until) {
  let T = T0;
  const beats = [b];
  let k = 0;
  while (k < events.length && events[k].t < b) k++;
  while (b < until) {
    const pred = b + T;
    while (k < events.length && events[k].t < pred - 0.2 * T) k++;
    let sw = 0, sd = 0;
    for (let i = k; i < events.length && events[i].t <= pred + 0.2 * T; i++) {
      const d = events[i].t - pred;
      const w = events[i].w * Math.exp(-((d / (0.1 * T)) ** 2));
      sw += w; sd += w * d;
    }
    if (sw > 0) {
      const err = sd / sw;
      b = pred + 0.8 * err;
      T = Math.min(T0 * 1.8, Math.max(T0 / 1.8, T + 0.25 * err));
    } else b = pred;
    beats.push(b);
  }
  return beats;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0.5; };

function nearestIndex(sorted, t) {
  let lo = 0, hi = sorted.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (sorted[m] <= t) lo = m; else hi = m; }
  return Math.abs(sorted[hi] - t) < Math.abs(sorted[lo] - t) ? hi : lo;
}

// Ze vsech posunu base + j*unit (v ramci periody) vybere ten, na ktery padne nejvic vahy udalosti.
function bestOffset(events, period, unit, base) {
  let best = null;
  for (let j = 0; j < Math.round(period / unit); j++) {
    const ph = base + j * unit;
    let s = 0;
    for (const { t, w } of events) {
      const r = (t - ph) / period;
      if (Math.abs(r - Math.round(r)) * period < unit / 3) s += w;
    }
    if (!best || s > best.s) best = { ph, s };
  }
  return best;
}

// Casy dob do konce skladby (posledni doba se prodlouzi poslednim intervalem).
export function beatTimes(grid, end) {
  const out = [...grid.beats];
  const T = out.length > 1 ? out[out.length - 1] - out[out.length - 2] : 0.5;
  while (out[out.length - 1] < end + T) out.push(out[out.length - 1] + T);
  return out;
}

const CHORDS = [
  { q: '', iv: [0, 4, 7], prior: 0.1 },
  { q: 'm', iv: [0, 3, 7], prior: 0.1 },
  { q: '7', iv: [0, 4, 7, 10], prior: 0 },
  { q: 'maj7', iv: [0, 4, 7, 11], prior: 0 },
  { q: 'm7', iv: [0, 3, 7, 10], prior: 0 },
  // sus4 a dim jsou v jednoduche hudbe vzacne; casteji jde o pruchodny ton melodie
  { q: 'dim', iv: [0, 3, 6], prior: -0.15 },
  { q: 'sus4', iv: [0, 5, 7], prior: -0.15 },
  { q: '5', iv: [0, 7], prior: -0.05 },
];
export const ROOTS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// Profil tonu (vazeny delkou) v okne [a, b). Prava ruka (melodie) ma mensi vahu,
// protoze obsahuje pruchodne tony; doprovod a bas nesou harmonii.
function profile(notes, a, b) {
  const prof = new Array(12).fill(0);
  let bass = null;
  for (const n of notes) {
    const ov = Math.min(b, n.e) - Math.max(a, n.s);
    if (ov <= 0) continue;
    prof[n.p % 12] += ov * (n.h === 'R' ? 0.6 : 1);
    if (!bass || n.p < bass.p) bass = n;
  }
  return { prof, bass: bass ? bass.p % 12 : null };
}

const CANDIDATES = [];
for (let root = 0; root < 12; root++) {
  for (const ch of CHORDS) CANDIDATES.push({ root, ch, set: new Set(ch.iv.map((i) => (root + i) % 12)) });
}

// Skore vsech 96 akordu (12 zakladu x 8 typu) pro profil tonu.
function chordScores(prof, bass) {
  const total = prof.reduce((a, b) => a + b, 0) || 1;
  return CANDIDATES.map(({ root, ch, set }) => {
    let s = 0;
    for (let pc = 0; pc < 12; pc++) s += set.has(pc) ? prof[pc] : -0.6 * prof[pc];
    s = s / total + ch.prior;
    // bas byva zaklad akordu; obrat s tercii v basu je bezny, s kvintou mene, bas mimo akord vzacny
    if (bass !== null) s += bass === root ? 0.3 : (bass - root + 12) % 12 === ch.iv[1] ? 0 : set.has(bass) ? -0.1 : -0.2;
    // chybejici tony akordu snizuji jistotu (C a G samotne nejsou jasne C dur)
    for (const i of ch.iv) if (prof[(root + i) % 12] === 0) s -= 0.12;
    return s;
  });
}

const chordOf = (k) => {
  const { root, ch, set } = CANDIDATES[k];
  return { root, quality: ch.q, tones: [...set], name: ROOTS[root] + ch.q };
};

// Nejlepsi akord pro profil; null = neni dost informaci.
export function matchChord(prof, bass = null) {
  if (prof.reduce((a, b) => a + b, 0) <= 0) return null;
  const sc = chordScores(prof, bass);
  const k = sc.indexOf(Math.max(...sc));
  return { ...chordOf(k), score: sc[k] };
}

/**
 * Akordy po dobach. Viterbi: kazda doba ma skore vsech akordu, zmena akordu stoji podle
 * metricke vahy doby: prvni doba taktu 0.15, pulka taktu 0.3, ostatni 0.6
 * (harmonie se meni hlavne na zacatku taktu). Bez znameho metra 0.45.
 * Pruchodny ton melodie (F nad akordem C) tak akord nezmeni, skutecna zmena ano.
 * Ticho (pauza, konec) retez prerusi. Vraci [{ s, e, si, root, quality, name, tones }].
 */
export function chordTrack(notes, grid, end) {
  const beats = beatTimes(grid, end);
  const out = [];
  let seg = [];                                     // [{ i, back }] pro aktualni useku bez ticha
  let V = null;
  const flush = () => {
    if (!seg.length) return;
    let k = V.indexOf(Math.max(...V));
    const picks = new Array(seg.length);
    for (let j = seg.length - 1; j >= 0; j--) { picks[j] = k; if (seg[j].back) k = seg[j].back[k]; }
    seg.forEach(({ i }, j) => {
      const ch = chordOf(picks[j]);
      const last = out[out.length - 1];
      if (last && last.name === ch.name && Math.abs(last.e - beats[i]) < 1e-6) last.e = beats[i + 1];
      else out.push({ s: beats[i], e: beats[i + 1], si: i, ...ch });
    });
    seg = [];
    V = null;
  };
  for (let i = 0; i < beats.length - 1; i++) {
    const { prof, bass } = profile(notes, beats[i], beats[i + 1]);
    // dozvuk konce noty (par ms) neni akord - chce to aspon 15 % doby zneni
    if (prof.reduce((a, b) => a + b, 0) < 0.15 * (beats[i + 1] - beats[i])) { flush(); continue; }
    const S = chordScores(prof, bass);
    if (!V) { V = S; seg.push({ i, back: null }); continue; }
    const m = grid.meter;
    const pen = !m ? 0.45 : i % m === 0 ? 0.15 : m % 2 === 0 && i % (m / 2) === 0 ? 0.3 : 0.6;
    const best = V.indexOf(Math.max(...V));
    const back = new Array(S.length);
    V = S.map((sc, c) => {
      const stay = V[c], change = V[best] - pen;
      back[c] = stay >= change ? c : best;
      return sc + Math.max(stay, change);
    });
    seg.push({ i, back });
  }
  flush();
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
