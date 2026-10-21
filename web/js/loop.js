// Usek na opakovani po taktech: zacina vzdy na prvni dobe taktu a konci na zacatku dalsiho.
import { beatTimes } from './analysis.js';

// Casy zacatku taktu (posledni prvek = konec skladby zaokrouhleny na cely takt).
export function barTimes(grid, end) {
  const beats = beatTimes(grid, end);
  const bars = [];
  for (let i = 0; i < beats.length; i += grid.meter) bars.push(beats[i]);
  if (bars[bars.length - 1] < end) bars.push(beats[Math.min(beats.length - 1, Math.ceil(beats.length / grid.meter) * grid.meter)] ?? end);
  return bars;
}

// Index taktu, ve kterem lezi cas t (0 = prvni takt).
export function barAt(bars, t) {
  let lo = 0, hi = bars.length - 2;
  if (t < bars[0]) return 0;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (bars[m] <= t + 1e-6) lo = m; else hi = m - 1;
  }
  return Math.max(0, Math.min(lo, bars.length - 2));
}

// Usek z taktu [from, to) - indexy taktu, to je exkluzivni.
export function loopBars(bars, from, to) {
  const last = bars.length - 1;
  from = Math.max(0, Math.min(from, last - 1));
  to = Math.max(from + 1, Math.min(to, last));
  return { from, to, a: bars[from], b: bars[to] };
}

// Usek pokryvajici casy t0..t1 (vybrany tazenim) - cele takty.
export function loopFromTimes(bars, t0, t1) {
  const [x, y] = t0 <= t1 ? [t0, t1] : [t1, t0];
  return loopBars(bars, barAt(bars, x), barAt(bars, y) + 1);
}

// Posun useku o jeho delku (dalsi/predchozi usek), na okraji skladby se zastavi.
export function shiftLoop(bars, loop, dir) {
  const len = loop.to - loop.from;
  const last = bars.length - 1;
  const from = Math.max(0, Math.min(loop.from + dir * len, last - len));
  return loopBars(bars, from, from + len);
}
