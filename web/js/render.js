// Vykresleni padajicich not a klaviatury na canvas.
import { isBlack, noteName } from './music.js';

let C = null;                        // barvy z CSS promennych (nacteno jednou)
function colors() {
  if (C) return C;
  const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  C = {
    R: v('--rh'), Rd: v('--rh-deep'), L: v('--lh'), Ld: v('--lh-deep'), stage: v('--stage'),
    accent: v('--accent'), paper: v('--paper'), ink: v('--ink-on-note'), wrong: v('--wrong'), muted: v('--muted'),
  };
  return C;
}

// Standardni klaviatury (jako ve videich): 88 = cele piano, 61 = bezny keyboard.
export const KEY_RANGES = {
  88: [21, 108],   // A0-C8
  76: [28, 103],   // E1-G7
  61: [36, 96],    // C2-C7
  49: [36, 84],    // C2-C6
};

/**
 * Viditelny rozsah klaviatury [lo, hi].
 * mode: 'auto' (podle skladby), '88' | '76' | '61' | '49', 'custom' (custom = {lo, hi}).
 * Standardni rozsah se posune o oktavy, aby skladba byla videt; kdyz je skladba sirsi, rozsiri se.
 */
export function keyRange(mode, songLo, songHi, custom) {
  if (mode === 'custom' && custom) return [Math.max(21, custom.lo), Math.min(108, custom.hi)];
  if (mode === 'auto' || !KEY_RANGES[mode]) {
    let lo = Math.min(songLo, 60) - 2, hi = Math.max(songHi, 60) + 2;      // C4 vzdy videt (orientace)
    while (hi - lo < 24) { lo--; hi++; }                                    // aspon 2 oktavy
    return [Math.max(21, lo), Math.min(108, hi)];
  }
  let [lo, hi] = KEY_RANGES[mode];
  if (songHi - songLo > hi - lo) return [Math.max(21, Math.min(lo, songLo)), Math.min(108, Math.max(hi, songHi))];
  while (songLo < lo && lo - 12 >= 21) { lo -= 12; hi -= 12; }
  while (songHi > hi && hi + 12 <= 108) { lo += 12; hi += 12; }
  return [lo, hi];
}

// Rozlozeni klaves pro rozsah [lo, hi] (zaokrouhleno na cele bile klavesy).
export function layoutKeys(lo, hi, width) {
  while (isBlack(lo)) lo--;
  while (isBlack(hi)) hi++;
  const whites = [];
  for (let p = lo; p <= hi; p++) if (!isBlack(p)) whites.push(p);
  const ww = width / whites.length;
  const keys = new Map();
  whites.forEach((p, i) => keys.set(p, { x: i * ww, w: ww, black: false }));
  for (let p = lo; p <= hi; p++) {
    if (!isBlack(p)) continue;
    const left = keys.get(p - 1);
    const bw = ww * 0.6;
    keys.set(p, { x: left.x + ww - bw / 2, w: bw, black: true });
  }
  return { lo, hi, keys, ww };
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W, H };
}

// Jiskry pri dopadu noty (jen kdyz cas bezi dopredu, ne pri skoku)
let sparks = [];
let sparked = new WeakSet();
let sparkNotes = null;
let lastNow = 0;

/**
 * opts: { now, notes, range: [lo, hi], widthFrac (0-1 sirka piana), pps (pixelu za sekundu = delka not),
 *         fallFrac (0-1 vyska padu), kbFrac (vyska klaviatury jako podil vysky sceny), showLetters, naming, showFingers, loop,
 *         mine: {L, R} (ruce, ktere hraje uzivatel), pressed: Map(p -> 'ok'|'wrong'), waiting: {pitches} | null }
 * Vraci { lookahead } - kolik sekund dopredu je videt.
 */
export function draw(canvas, opts) {
  const { ctx, W: fullW, H } = fitCanvas(canvas);
  const c = colors();
  const { now, notes, range, widthFrac = 1, pps = 160, fallFrac = 1, kbFrac = 0.22, showLetters, naming, showFingers, loop, mine, pressed, waiting } = opts;
  const W = Math.round(fullW * widthFrac);                   // sirka piana (zuzene piano je uprostred)
  const ox = Math.round((fullW - W) / 2);
  const layout = layoutKeys(range[0], range[1], W);
  const kbH = Math.round(Math.min(260, Math.max(50, H * kbFrac)));
  const hitY = H - kbH;
  const fallTop = Math.round(hitY - (hitY - 8) * fallFrac);   // odsud noty padaji
  const lookahead = (hitY - fallTop) / pps;
  const t = performance.now() / 1000;
  const someMine = mine.L || mine.R;

  ctx.fillStyle = c.stage;
  ctx.fillRect(0, 0, fullW, H);
  ctx.save();
  ctx.translate(ox, 0);
  if (ox > 0) {                                               // okraje mimo piano
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(-1, 0, 1, H);
    ctx.fillRect(W, 0, 1, H);
  }

  // drahy cernych klaves a cary u C
  for (const [p, k] of layout.keys) {
    if (k.black) {
      ctx.fillStyle = 'rgba(255,255,255,0.022)';
      ctx.fillRect(k.x, 0, k.w, hitY);
    } else if (p % 12 === 0) {
      ctx.fillStyle = 'rgba(239,233,220,0.07)';
      ctx.fillRect(Math.round(k.x), 0, 1, hitY);
      ctx.fillStyle = 'rgba(239,233,220,0.28)';
      ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(noteName(p, naming, true), k.x + 5, 8);
    }
  }

  // zare nad linii dopadu
  const glow = ctx.createLinearGradient(0, hitY - 90, 0, hitY);
  glow.addColorStop(0, 'rgba(255,79,31,0)');
  glow.addColorStop(1, 'rgba(255,79,31,0.12)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, hitY - 90, W, 90);

  // smycka: ztmavit cas mimo usek
  if (loop) {
    const yA = hitY - (loop.a - now) * pps, yB = hitY - (loop.b - now) * pps;
    ctx.fillStyle = 'rgba(8,7,6,0.6)';
    if (yB > 0) ctx.fillRect(0, 0, W, Math.min(hitY, yB));
    if (yA < hitY) ctx.fillRect(0, Math.max(0, yA), W, hitY - Math.max(0, yA));
    ctx.fillStyle = c.accent;
    for (const y of [yA, yB]) if (y > 0 && y < hitY) ctx.fillRect(0, y - 0.5, W, 1);
  }

  if (sparkNotes !== notes || now < lastNow - 0.05 || now - lastNow > 0.5) { sparked = new WeakSet(); sparkNotes = notes; }
  const forward = now >= lastNow && now - lastNow < 0.5;

  const active = new Map();
  const visible = notes.filter((n) => n.e >= now - 0.05 && n.s <= now + lookahead);
  visible.sort((a, b) => isBlack(a.p) - isBlack(b.p));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const n of visible) {
    const k = layout.keys.get(n.p);
    const hand = n.h === 'L' ? 'L' : 'R';
    if (!k) {
      // nota mimo zvoleny vyrez klaviatury -> znacka na okraji (at se na ni nezapomene)
      const yb = Math.min(hitY, hitY - (n.s - now) * pps), yt = hitY - (n.e - now) * pps;
      const left = n.p < layout.lo;
      ctx.fillStyle = c[hand];
      ctx.globalAlpha = 0.85;
      ctx.fillRect(left ? 0 : W - 4, yt, 4, Math.max(3, yb - yt));
      ctx.beginPath();
      const ax = left ? 6 : W - 6, dir = left ? -1 : 1;
      ctx.moveTo(ax + dir * 6, yb - 6);
      ctx.lineTo(ax, yb - 12);
      ctx.lineTo(ax, yb);
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    const yBottom = Math.min(hitY, hitY - (n.s - now) * pps);
    const yTop = hitY - (n.e - now) * pps;
    const h = Math.max(3, yBottom - yTop - 2);
    const pad = k.black ? 0.5 : Math.max(1.5, k.w * 0.09);
    const x = k.x + pad, w = k.w - 2 * pad;
    const isActive = n.s <= now && n.e > now;
    if (isActive) active.set(n.p, n);
    const outside = loop && (n.s >= loop.b - 1e-3 || n.e <= loop.a + 1e-3);   // mimo opakovany usek
    const dim = (someMine && !mine[hand]) || outside;

    ctx.globalAlpha = outside ? 0.2 : dim ? 0.32 : 1;
    const g = ctx.createLinearGradient(0, yBottom - h, 0, yBottom);
    g.addColorStop(0, c[hand + 'd']);
    g.addColorStop(1, k.black ? c[hand + 'd'] : c[hand]);
    if (isActive && !dim) { ctx.shadowColor = c[hand]; ctx.shadowBlur = 18; }
    ctx.fillStyle = g;
    roundRect(ctx, x, yBottom - h, w, h, Math.min(5, w / 3));
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.28)';                     // svetla hrana nahore
    ctx.fillRect(x + 2, yBottom - h + 1, Math.max(0, w - 4), 1);
    if (n.moved) {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = c.paper;
      ctx.lineWidth = 1.5;
      roundRect(ctx, x, yBottom - h, w, h, Math.min(5, w / 3));
      ctx.stroke();
      ctx.restore();
    }

    // pismeno u spodni hrany, nad nim prst v krouzku
    const size = Math.min(w * 0.6, 15);
    if (size >= 7 && !dim) {
      let y = yBottom - size * 0.85;
      if (showLetters && h >= size * 1.5) {
        ctx.fillStyle = c.ink;
        ctx.font = `700 ${size}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillText(noteName(n.p, naming).replace('♯', '#'), x + w / 2, y);
        y -= size * 1.45;
      }
      if (showFingers && n.f && h >= size * (showLetters ? 2.9 : 1.5)) {
        ctx.beginPath();
        ctx.arc(x + w / 2, y, size * 0.62, 0, Math.PI * 2);
        ctx.fillStyle = c.paper;
        ctx.fill();
        ctx.fillStyle = c.ink;
        ctx.font = `700 ${size * 0.8}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillText(String(n.f), x + w / 2, y + 0.5);
      }
    }
    ctx.globalAlpha = 1;

    if (forward && isActive && now - n.s < 0.12 && !sparked.has(n) && !dim) {
      sparked.add(n);
      for (let i = 0; i < 7; i++) {
        sparks.push({ x: x + Math.random() * w, y: hitY, vx: (Math.random() - 0.5) * 70, vy: -60 - Math.random() * 110, t0: t, color: c[hand] });
      }
    }
  }
  lastNow = now;

  // jiskry
  sparks = sparks.filter((s) => t - s.t0 < 0.55);
  for (const s of sparks) {
    const age = t - s.t0;
    ctx.globalAlpha = 1 - age / 0.55;
    ctx.fillStyle = s.color;
    ctx.fillRect(s.x + s.vx * age, s.y + s.vy * age + 90 * age * age, 2, 2);
  }
  ctx.globalAlpha = 1;

  // linie dopadu + plstena paska
  ctx.fillStyle = '#1b0f0b';
  ctx.fillRect(0, hitY, W, 6);
  ctx.fillStyle = c.accent;
  ctx.fillRect(0, hitY, W, 1.5);

  // klaviatura
  const top = hitY + 6, kh = kbH - 6;
  for (const pass of [false, true]) {
    for (const [p, k] of layout.keys) {
      if (k.black !== pass) continue;
      const n = active.get(p);
      const input = pressed.get(p);
      const down = n || input;
      const depth = down ? 2 : 0;
      const h = (k.black ? kh * 0.62 : kh) - (k.black ? depth : 0);
      const color = input === 'wrong' ? c.wrong : n ? c[(n.h === 'L' ? 'L' : 'R') + (k.black ? 'd' : '')] : input ? c.R : null;
      if (k.black) {
        const g = ctx.createLinearGradient(0, top, 0, top + h);
        g.addColorStop(0, color || '#2c2824');
        g.addColorStop(1, color || '#0d0b09');
        ctx.fillStyle = g;
        roundRect(ctx, k.x, top - 2, k.w, h + 2, 3);
        ctx.fill();
        if (!color) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(k.x + 2, top + h - 7, k.w - 4, 2); }
      } else {
        const g = ctx.createLinearGradient(0, top, 0, top + h);
        g.addColorStop(0, color || '#e9e3d5');
        g.addColorStop(0.08, color || '#f7f3ea');
        g.addColorStop(1, color || '#ebe5d7');
        ctx.fillStyle = g;
        roundRect(ctx, k.x + 0.5, top - 2, k.w - 1, h + 2 - depth, 4);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(Math.round(k.x + k.w) - 0.5, top, 1, h - 4);
        if (p % 12 === 0) {
          ctx.fillStyle = color ? c.ink : '#9b9384';
          ctx.font = `500 ${Math.min(11, k.w * 0.4)}px "JetBrains Mono", ui-monospace, monospace`;
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(noteName(p, naming, true), k.x + k.w / 2, top + h - 8);
          ctx.textBaseline = 'middle';
        }
        if (p === 60) {                                       // stred klaviatury (C4) - tecka pro orientaci
          ctx.beginPath();
          ctx.arc(k.x + k.w / 2, top + h - Math.max(26, kh * 0.25), Math.max(2.5, Math.min(4.5, k.w * 0.13)), 0, Math.PI * 2);
          ctx.fillStyle = color ? c.ink : '#2a2520';
          ctx.fill();
        }
      }
      // ceka se na tuto klavesu -> pulzujici krouzek
      if (waiting && waiting.pitches.has(p) && !input) {
        const r = Math.min(k.w * 0.42, 12) * (1 + 0.15 * Math.sin(t * 6));
        ctx.beginPath();
        ctx.arc(k.x + k.w / 2, top + h * (k.black ? 0.7 : 0.62), r, 0, Math.PI * 2);
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (n && showFingers && n.f) {
        ctx.fillStyle = k.black ? c.paper : c.ink;
        ctx.font = `700 ${Math.min(15, k.w * 0.55)}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillText(String(n.f), k.x + k.w / 2, top + h * (k.black ? 0.72 : 0.5));
      }
    }
  }

  // vyska padu: nad ni noty nejsou videt, prechod je jemne rozmazany
  if (fallTop > 8) {
    ctx.fillStyle = c.stage;
    ctx.fillRect(-ox, 0, fullW, fallTop - 24);
    const fade = ctx.createLinearGradient(0, fallTop - 24, 0, fallTop + 8);
    fade.addColorStop(0, c.stage);
    fade.addColorStop(1, 'rgba(12,11,9,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(-ox, fallTop - 24, fullW, 32);
    ctx.fillStyle = 'rgba(239,233,220,0.12)';
    ctx.fillRect(0, fallTop, W, 1);
  }
  ctx.restore();
  return { lookahead };
}

// Minimapa celeho piana (88 klaves): viditelny vyrez + rozsah skladby.
export function drawKeyMap(canvas, { lo, hi, songLo, songHi }) {
  const { ctx, W, H } = fitCanvas(canvas);
  const c = colors();
  ctx.clearRect(0, 0, W, H);
  const map = layoutKeys(21, 108, W);
  for (const pass of [false, true]) {
    for (const [p, k] of map.keys) {
      if (k.black !== pass) continue;
      const inside = p >= lo && p <= hi;
      ctx.fillStyle = k.black ? (inside ? '#0c0b09' : '#24211c') : (inside ? c.paper : '#4a453c');
      ctx.fillRect(k.x + (k.black ? 0 : 0.5), 0, k.w - (k.black ? 0 : 1), k.black ? H * 0.6 : H);
      if (p === 60) { ctx.fillStyle = c.accent; ctx.fillRect(k.x + k.w / 2 - 1, H - 6, 2, 3); }
    }
  }
  const x0 = map.keys.get(lo)?.x ?? 0;
  const kh = map.keys.get(hi);
  const x1 = kh ? kh.x + kh.w : W;
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + 1, 1, x1 - x0 - 2, H - 2);
  // rozsah skladby
  const s0 = map.keys.get(songLo), s1 = map.keys.get(songHi);
  if (s0 && s1) {
    ctx.fillStyle = c.accent;
    ctx.fillRect(s0.x, H - 2, s1.x + s1.w - s0.x, 2);
  }
  return map;
}

// Casova osa: takty, nahled not, usek s uchyty, pozice.
export const HANDLE = 7;                  // sirka uchytu useku v px (i pro klikani)
export function drawTimeline(canvas, { notes, duration, now, loop, loopOn, bars, lo, hi }) {
  const { ctx, W, H } = fitCanvas(canvas);
  const c = colors();
  ctx.clearRect(0, 0, W, H);
  const x = (t) => (t / (duration || 1)) * W;
  const range = Math.max(1, hi - lo);
  const top = 13;                         // nahore cisla taktu, pod nimi noty

  // takty: carka u kazdeho, cislo tak husto, jak se vejde
  if (bars?.length) {
    const every = [1, 2, 4, 8, 16, 32, 64].find((k) => (x(bars[Math.min(k, bars.length - 1)]) - x(bars[0])) >= 26) || 64;
    ctx.font = '500 9px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (let i = 0; i < bars.length - 1; i++) {
      const bx = Math.round(x(bars[i])) + 0.5;
      const major = i % every === 0;
      ctx.fillStyle = major ? 'rgba(239,233,220,0.22)' : 'rgba(239,233,220,0.07)';
      ctx.fillRect(bx, major ? 0 : top, 1, major ? H : H - top);
      if (major) { ctx.fillStyle = c.muted || '#7a7366'; ctx.fillText(String(i + 1), bx + 3, 2); }
    }
  }

  for (const n of notes) {
    ctx.fillStyle = n.h === 'L' ? c.L : c.R;
    ctx.globalAlpha = n.s < now ? 0.95 : 0.35;
    ctx.fillRect(x(n.s), H - 4 - ((n.p - lo) / range) * (H - top - 8), Math.max(1, x(n.e) - x(n.s)), 1.5);
  }
  ctx.globalAlpha = 1;

  if (loop) {
    const xa = x(loop.a), xb = x(loop.b);
    ctx.fillStyle = loopOn ? 'rgba(255,79,31,0.16)' : 'rgba(239,233,220,0.06)';
    ctx.fillRect(xa, 0, xb - xa, H);
    ctx.fillStyle = loopOn ? c.accent : 'rgba(239,233,220,0.45)';
    for (const hx of [xa, xb]) {                              // uchyty
      ctx.fillRect(hx - 1, 0, 2, H);
      ctx.fillRect(hx - HANDLE / 2, H / 2 - 9, HANDLE, 18);
    }
    ctx.fillStyle = loopOn ? '#1a0b05' : '#0c0b09';
    for (const hx of [xa, xb]) { ctx.fillRect(hx - 1.5, H / 2 - 4, 1, 8); ctx.fillRect(hx + 0.5, H / 2 - 4, 1, 8); }
  }
  ctx.fillStyle = c.paper;
  ctx.fillRect(x(now) - 0.75, 0, 1.5, H);
}
