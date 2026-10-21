// Rozdeleni not mezi ruce. Teorie: teorie/03-ruce.md
import { onsetGroups } from './music.js';

export const MAX_SPAN = 12;   // pohodlny rozsah jedne ruky (oktava)
const MAX_NOTES = 5;

const spanOf = (ps) => (ps.length ? Math.max(...ps) - Math.min(...ps) : 0);

/**
 * Noty bez ruky (h = '') rozdeli na levou/pravou.
 * Kazda ruka ma "teziste", ktere sleduje jeji posledni noty; akord se rozdeli
 * v miste, ktere minimalizuje vzdalenost od tezist a nepretahne rozpeti ruky.
 */
export function splitHands(notes) {
  if (notes.every((n) => n.h)) return notes;
  let cL = 48, cR = 67;
  for (const g of onsetGroups(notes)) {
    const free = g.notes.filter((n) => !n.h).sort((a, b) => a.p - b.p);
    if (!free.length) continue;
    const fixedL = g.notes.filter((n) => n.h === 'L').map((n) => n.p);
    const fixedR = g.notes.filter((n) => n.h === 'R').map((n) => n.p);
    let best = null;
    for (let k = 0; k <= free.length; k++) {
      const L = [...fixedL, ...free.slice(0, k).map((n) => n.p)];
      const R = [...fixedR, ...free.slice(k).map((n) => n.p)];
      let cost = L.reduce((a, p) => a + Math.abs(p - cL), 0) + R.reduce((a, p) => a + Math.abs(p - cR), 0);
      cost += 10 * Math.max(0, spanOf(L) - MAX_SPAN) + 10 * Math.max(0, spanOf(R) - MAX_SPAN);
      cost += 20 * (Math.max(0, L.length - MAX_NOTES) + Math.max(0, R.length - MAX_NOTES));
      if (L.length && R.length && Math.max(...L) > Math.min(...R)) cost += 20;   // ruce se nekrizi
      if (!best || cost < best.cost) best = { k, cost };
    }
    free.forEach((n, i) => { n.h = i < best.k ? 'L' : 'R'; });
    const avg = (h) => { const ps = g.notes.filter((n) => n.h === h).map((n) => n.p); return ps.length ? ps.reduce((a, b) => a + b) / ps.length : null; };
    const aL = avg('L'), aR = avg('R');
    if (aL !== null) cL = 0.6 * cL + 0.4 * aL;
    if (aR !== null) cR = 0.6 * cR + 0.4 * aR;
    if (cR - cL < 7) { const m = (cL + cR) / 2; cL = m - 3.5; cR = m + 3.5; }
  }
  return notes;
}

// Noty dane ruky, ktere zni v case t (vcetne drzenych).
const soundingAt = (notes, h, t) => notes.filter((n) => n.h === h && n.s <= t + 0.035 && n.e > t + 0.035);

/**
 * Kdyz je akord v jedne ruce moc siroky (> oktava) nebo ma > 5 not,
 * presune krajni noty do druhe ruky, pokud je volna a noty se ji vejdou.
 * Presunute noty dostanou moved = true (UI ukaze "hraj druhou rukou").
 */
export function rebalanceHands(notes) {
  for (const g of onsetGroups(notes)) {
    for (const [from, to] of [['R', 'L'], ['L', 'R']]) {
      for (let guard = 0; guard < 4; guard++) {
        const own = soundingAt(notes, from, g.t);
        const ps = own.map((n) => n.p);
        if (spanOf(ps) <= MAX_SPAN && own.length <= MAX_NOTES) break;
        // kandidat = krajni nota smerem k druhe ruce, ktera prave zacina
        const starting = g.notes.filter((n) => n.h === from).sort((a, b) => a.p - b.p);
        const cand = from === 'R' ? starting[0] : starting[starting.length - 1];
        if (!cand) break;
        const other = soundingAt(notes, to, g.t).map((n) => n.p);
        const after = [...other, cand.p];
        if (spanOf(after) > MAX_SPAN || after.length > MAX_NOTES) break;
        cand.h = to;
        cand.moved = true;
      }
    }
  }
  return notes;
}

// ── Poloha rukou (pro ukazatel na klaviature) ───────────────────────────────
// Bile klavesy cislujeme absolutne (C0 = 0, D0 = 1, ...); cerna klavesa = bila pod ni + 0.5.
const WHITE_OF = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
export const whiteIndex = (p) => Math.floor(p / 12) * 7 + WHITE_OF[((p % 12) + 12) % 12];
const isBlackPc = (p) => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);

// Kde je palec, kdyz se nota hraje prstem f (prava: palec vlevo od prstu, leva: vpravo).
export function thumbOf(n, hand) {
  const x = whiteIndex(n.p) + (isBlackPc(n.p) ? 0.5 : 0);
  return Math.floor(hand === 'L' ? x + (n.f - 1) : x - (n.f - 1));
}

/**
 * Petiprstova poloha kazde ruky v case now: { L: { cur, next }, R: { cur, next } }.
 * cur/next = bila klavesa pod palcem (absolutni index) nebo null; next = poloha, na kterou
 * se ruka brzy presune (do 1.2 s), jinak null. Prava ruka pokryva palec..palec+4, leva palec-4..palec.
 */
export function handWindows(notes, now) {
  const out = {};
  for (const hand of ['L', 'R']) {
    const own = notes.filter((n) => (n.h === 'L' ? 'L' : 'R') === hand && n.f >= 1 && n.f <= 5);
    const thumbAt = (group) => {
      const ts = group.map((n) => thumbOf(n, hand)).sort((a, b) => a - b);
      return ts[Math.floor(ts.length / 2)];
    };
    const active = own.filter((n) => n.s <= now && n.e > now);
    let prev = null, next = null;
    for (const n of own) {
      if (n.s <= now) { if (!prev || n.s >= prev.s) prev = n; }
      else if (!next || n.s < next.s) next = n;
    }
    const groupAt = (s) => own.filter((n) => Math.abs(n.s - s) < 0.035);
    let cur = null;
    if (active.length) cur = thumbAt(active);
    else if (prev && now - prev.e < 0.6) cur = thumbAt(groupAt(prev.s));
    else if (next && next.s - now < 2) cur = thumbAt(groupAt(next.s));
    else if (prev) cur = thumbAt(groupAt(prev.s));
    let upcoming = null;
    if (next && next.s - now < 1.2) {
      const t = thumbAt(groupAt(next.s));
      if (t !== cur) upcoming = t;
    }
    out[hand] = { cur, next: upcoming };
  }
  return out;
}
