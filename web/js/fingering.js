// Prstoklad: Viterbi (dynamicke programovani) nad pravidly Parncutt et al. (1997)
// s rozsirenim na akordy (Jacobs 2001, Al Kasimi 2007). Teorie: teorie/02-prstoklad.md
//
// Prsty: 1 = palec ... 5 = malicek. Leva ruka = zrcadlo prave (vyska -> -vyska),
// barva klavesy (cerna/bila) se bere z puvodni vysky.
import { isBlack, onsetGroups } from './music.js';

// Rozpeti mezi prsty prave ruky v pultonech (Parncutt 1997, tab. 1):
// [MinPrac, MinComf, MinRel, MaxRel, MaxComf, MaxPrac]
const SPAN = {
  '1-2': [-5, -3, 1, 5, 8, 10],
  '1-3': [-4, -2, 3, 7, 10, 12],
  '1-4': [-3, -1, 5, 9, 12, 14],
  '1-5': [-1, 1, 7, 10, 13, 15],
  '2-3': [1, 1, 1, 2, 3, 5],
  '2-4': [1, 1, 3, 4, 5, 7],
  '2-5': [2, 2, 5, 6, 8, 10],
  '3-4': [1, 1, 1, 2, 2, 4],
  '3-5': [1, 1, 3, 4, 5, 7],
  '4-5': [1, 1, 1, 2, 3, 5],
};
const IMPOSSIBLE = 50;

// Cena rozpeti 'span' (pultony, smer od nizsiho prstu k vyssimu) pro dvojici prstu lo < hi.
function spanCost(lo, hi, span, { relaxed = true } = {}) {
  const [minP, minC, minR, maxR, maxC, maxP] = SPAN[`${lo}-${hi}`];
  let c = 0;
  if (span < minP || span > maxP) c += IMPOSSIBLE;
  if (span > maxC) c += 2 * (span - maxC);               // pravidlo 1: natazeni
  if (span < minC) c += 2 * (minC - span);
  if (relaxed) {
    const w = lo === 1 ? 1 : 2;
    // podklad palce (span < 0) neni "stisnena" poloha - plati ho pravidlo 12 (Jacobs 2001)
    if (span < minR && !(lo === 1 && span < 0)) c += w * (minR - span);   // pravidlo 2: male rozpeti
    if (span > maxR) c += w * (span - maxR);             // pravidlo 3: velke rozpeti
  }
  return c;
}

// Cena prechodu jedne noty na druhou (a -> b), q = zrcadlena vyska, p = puvodni.
// gap = pauza mezi tony (<= 0.06 s = legato), shape = akord -> akord (posouva se cely tvar ruky).
export function stepCost(fa, qa, pa, fb, qb, pb, gap = 0, shape = false) {
  if (fa === fb) {
    if (qa === qb) return 0;
    const d = Math.abs(qb - qa);
    if (gap <= 0.06 && !shape) return 10 + d;                           // stejny prst jinde = konec legata
    if (shape) return 1 + 0.3 * d;                                      // akordy: zvednout a presunout tvar
    // oddelene tony: radsi vymenit prst a nechat ruku na miste; po dlouhe pauze presun nevadi
    return 1 + 0.3 * d + 5 * Math.max(0, 1 - gap / 0.6);
  }
  const lo = Math.min(fa, fb), hi = Math.max(fa, fb);
  const span = fa < fb ? qb - qa : qa - qb;
  let c = spanCost(lo, hi, span);
  const bA = isBlack(pa), bB = isBlack(pb);
  if (fa === 3 && fb === 4) c += 0.5;                                     // pravidlo 8: 3 -> 4 (Parncutt: 1)
  if (((fa === 3 && fb === 4) || (fa === 4 && fb === 3)) &&
      ((fa === 3 && !bA && bB) || (fb === 3 && !bB && bA))) c += 1;       // pravidlo 9: 4 na cerne vedle 3 na bile
  if (fb === 1 && bB && !bA) c += 2;                                      // pravidlo 10: palec na cernou z bile
  if (fa === 1 && bA && !bB) c += 2;                                      //              a z cerne na bilou
  if (fb === 5 && bB && !bA) c += 2;                                      // pravidlo 11: malicek na cerne
  if (fa === 5 && bA && !bB) c += 2;
  if (lo === 1 && span < 0) {                                             // pravidlo 12: podklad/prekladani palce
    const thumbBlack = fa === 1 ? bA : bB, otherBlack = fa === 1 ? bB : bA;
    c += 0.5;                                                             // kazdy podklad je namaha -> co nejmene
    if (thumbBlack === otherBlack) c += 1;
    else if (thumbBlack) c += 3;
  }
  return c;
}

// Cena jedne noty (nezavisla na sousedech).
export function noteCost(f, p) {
  let c = 0;
  if (f === 4 || f === 5) c += 0.5;          // pravidlo 6: slabe prsty (Parncutt: 1; 0.5 = radsi poloha nez prekladani)
  if (f === 1 && isBlack(p)) c += 1;                                      // pravidlo 10: palec na cerne
  return c;
}

// Tri po sobe jdouci jednotlive noty (pravidla 4, 5, 7).
export function tripleCost(f1, q1, f2, q2, f3, q3) {
  let c = 0;
  if (new Set([f1, f2, f3]).size === 3 && [f1, f2, f3].every((f) => f >= 3)) c += 0.5; // pravidlo 7: 3-4-5
  if (f1 === f3) return q1 === q3 ? c : c + 1 + Math.abs(q3 - q1);       // stejny prst jinde = ruka se posunula
  const lo = Math.min(f1, f3), hi = Math.max(f1, f3);
  const span = f1 < f3 ? q3 - q1 : q1 - q3;
  const [minP, minC, , , maxC, maxP] = SPAN[`${lo}-${hi}`];
  if (span > maxC || span < minC) {
    const full = f2 === 1 && (q2 - q1) * (q3 - q2) > 0 && (span > maxP || span < minP);
    c += full ? 2 : 1;                                                    // pravidlo 4: pocet zmen polohy
    c += span > maxC ? span - maxC : minC - span;                         // pravidlo 5: velikost zmeny
  }
  return c;
}

// Vsechny prstoklady akordu: rostouci prsty pro rostouci (zrcadlene) vysky.
function chordFingerings(k) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === k) { out.push(acc); return; }
    for (let f = start; f <= 5 - (k - acc.length - 1); f++) rec(f + 1, [...acc, f]);
  };
  rec(1, []);
  return out;
}

// Ucebnicove prstoklady souzvuku (v zrcadlenych souradnicich plati pro obe ruce):
// tercie+tercie (zakladni tvar) 1-3-5, tercie+kvarta 1-2-5, kvarta+tercie 1-3-5,
// kvinta az oktava 1-5. Leva ruka tak dostane 5-3-1, 5-3-1 (1. obrat), 5-2-1 (2. obrat).
function textbook(qs) {
  const iv = qs.slice(1).map((q, i) => q - qs[i]);
  if (iv.length === 2) {
    const third = (x) => x === 3 || x === 4;
    if (third(iv[0]) && third(iv[1])) return [1, 3, 5];
    if (third(iv[0]) && iv[1] === 5) return [1, 2, 5];
    if (iv[0] === 5 && third(iv[1])) return [1, 3, 5];
  }
  if (iv.length === 1 && iv[0] >= 7 && iv[0] <= 12) return [1, 5];
  return null;
}

function verticalCost(fs, qs, ps) {
  let c = 0;
  const tb = textbook(qs);
  if (tb && tb.some((f, i) => f !== fs[i])) c += fs.length === 3 ? 2 : 1;   // jiny nez ucebnicovy tvar
  for (let i = 0; i < fs.length; i++) {
    // malicek na krajni note akordu je prirozeny (C-E-G = 1-3-5), slaby prst se pocita jen u 4
    c += noteCost(fs[i], ps[i]) - (fs.length > 1 && fs[i] === 5 ? 0.5 : 0);
    for (let j = i + 1; j < fs.length; j++) c += spanCost(fs[i], fs[j], qs[j] - qs[i], { relaxed: j === i + 1 });
  }
  return c;
}

/**
 * Prida notam jedne ruky vlastnost f (prst 1-5).
 * notes: [{p, s, e}], hand: 'L' | 'R'
 */
export function fingerHand(notes, hand) {
  if (!notes.length) return notes;
  const mirror = hand === 'L' ? -1 : 1;
  const events = onsetGroups(notes).map((g) => {
    let ns = [...g.notes].sort((a, b) => mirror * (a.p - b.p));
    if (ns.length > 5) {                    // vic nez 5 not jedna ruka nezahraje - prsty jen 5 nejblizsim
      ns.slice(5).forEach((n) => { n.f = 0; });
      ns = ns.slice(0, 5);
    }
    const qs = ns.map((n) => mirror * n.p), ps = ns.map((n) => n.p);
    const opts = chordFingerings(ns.length).map((fs) => ({ fs, cost: verticalCost(fs, qs, ps) }));
    return { t: g.t, end: Math.max(...ns.map((n) => n.e)), ns, qs, ps, opts };
  });

  // Prechod mezi udalostmi A -> B: kazda nota B se porovna s notou A, ktera ma stejny prst,
  // jinak s nejblizsi vyskou. Pauza mezi udalostmi dava ruce cas se presunout -> levnejsi.
  const trans = (A, fa, B, fb) => {
    let c = 0;
    for (let j = 0; j < B.ns.length; j++) {
      let i = fa.indexOf(fb[j]);
      if (i < 0) {
        i = 0;
        for (let k = 1; k < A.ns.length; k++) if (Math.abs(A.qs[k] - B.qs[j]) < Math.abs(A.qs[i] - B.qs[j])) i = k;
      }
      const gap = B.t - A.ns[i].e;
      c += stepCost(fa[i], A.qs[i], A.ps[i], fb[j], B.qs[j], B.ps[j], gap, A.ns.length > 1 && B.ns.length > 1);
    }
    c /= B.ns.length;
    const rest = B.t - A.end;
    const ioi = B.t - A.t;
    const factor = rest > 0.1 ? Math.max(0.15, 1 - rest / 0.8) : ioi > 1.5 ? 0.5 : 1;
    return c * factor;
  };

  // Viterbi druheho radu: stav = (prstoklad predchozi udalosti, prstoklad aktualni).
  const m = events.length;
  let dp = events[0].opts.map((o) => [o.cost]);                 // dp[j][i]: j = predchozi (zde jen 1 sloupec)
  const back = [];
  if (m > 1) {
    const B = events[1], A = events[0];
    dp = A.opts.map((oa) => B.opts.map((ob) => oa.cost + ob.cost + trans(A, oa.fs, B, ob.fs)));
  }
  for (let n = 2; n < m; n++) {
    const P = events[n - 2], A = events[n - 1], B = events[n];
    const mono = P.ns.length === 1 && A.ns.length === 1 && B.ns.length === 1;
    const next = A.opts.map(() => B.opts.map(() => Infinity));
    const bk = A.opts.map(() => B.opts.map(() => 0));
    for (let i = 0; i < A.opts.length; i++) {
      for (let k = 0; k < B.opts.length; k++) {
        const base = B.opts[k].cost + trans(A, A.opts[i].fs, B, B.opts[k].fs);
        for (let j = 0; j < P.opts.length; j++) {
          let c = dp[j][i] + base;
          if (mono && B.t - P.t < 1.5) {
            c += tripleCost(P.opts[j].fs[0], P.qs[0], A.opts[i].fs[0], A.qs[0], B.opts[k].fs[0], B.qs[0]);
          }
          if (c < next[i][k]) { next[i][k] = c; bk[i][k] = j; }
        }
      }
    }
    back.push(bk);
    dp = next;
  }

  // Zpetny pruchod
  const choice = new Array(m);
  if (m === 1) {
    choice[0] = dp.reduce((bi, row, i) => (row[0] < dp[bi][0] ? i : bi), 0);
  } else {
    let bi = 0, bk = 0;
    dp.forEach((row, i) => row.forEach((v, k) => { if (v < dp[bi][bk]) { bi = i; bk = k; } }));
    choice[m - 1] = bk;
    choice[m - 2] = bi;
    for (let n = m - 1; n >= 2; n--) choice[n - 2] = back[n - 2][choice[n - 1]][choice[n]];
  }
  events.forEach((ev, n) => ev.ns.forEach((note, i) => { note.f = ev.opts[choice[n]].fs[i]; }));
  return notes;
}

export function fingerAll(notes) {
  fingerHand(notes.filter((n) => n.h !== 'L'), 'R');
  fingerHand(notes.filter((n) => n.h === 'L'), 'L');
  return notes;
}
