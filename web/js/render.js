// Vykresleni padajicich not a klaviatury na canvas.
import { isBlack, noteName } from './music.js';

let C = null;                        // barvy z CSS promennych (nacteno jednou)
function colors() {
  if (C) return C;
  const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  C = {
    R: v('--rh'), Rd: v('--rh-deep'), L: v('--lh'), Ld: v('--lh-deep'), stage: v('--stage'),
    accent: v('--accent'), paper: v('--paper'), ink: v('--ink-on-note'), wrong: v('--wrong'),
  };
  return C;
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
 * opts: { now, notes, layout, lookahead (s), showLetters, naming, showFingers, loop,
 *         mine: {L, R} (ruce, ktere hraje uzivatel), pressed: Map(p -> 'ok'|'wrong'), waiting: {pitches} | null }
 */
export function draw(canvas, opts) {
  const { ctx, W, H } = fitCanvas(canvas);
  const c = colors();
  const { now, notes, layout, lookahead, showLetters, naming, showFingers, loop, mine, pressed, waiting } = opts;
  const kbH = Math.min(150, Math.max(80, H * 0.22));
  const hitY = H - kbH;
  const pps = (hitY - 8) / lookahead;
  const t = performance.now() / 1000;
  const someMine = mine.L || mine.R;

  ctx.fillStyle = c.stage;
  ctx.fillRect(0, 0, W, H);

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
    if (!k) continue;
    const hand = n.h === 'L' ? 'L' : 'R';
    const yBottom = Math.min(hitY, hitY - (n.s - now) * pps);
    const yTop = hitY - (n.e - now) * pps;
    const h = Math.max(3, yBottom - yTop - 2);
    const pad = k.black ? 0.5 : Math.max(1.5, k.w * 0.09);
    const x = k.x + pad, w = k.w - 2 * pad;
    const isActive = n.s <= now && n.e > now;
    if (isActive) active.set(n.p, n);
    const dim = someMine && !mine[hand];

    ctx.globalAlpha = dim ? 0.32 : 1;
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
}

// Casova osa: nahled vsech not, odehrana cast, smycka, pozice.
export function drawTimeline(canvas, { notes, duration, now, loop, lo, hi }) {
  const { ctx, W, H } = fitCanvas(canvas);
  const c = colors();
  ctx.clearRect(0, 0, W, H);
  const x = (t) => (t / (duration || 1)) * W;
  const range = Math.max(1, hi - lo);
  const px = x(now);
  for (const n of notes) {
    ctx.fillStyle = n.h === 'L' ? c.L : c.R;
    ctx.globalAlpha = n.s < now ? 0.95 : 0.35;
    ctx.fillRect(x(n.s), H - 4 - ((n.p - lo) / range) * (H - 8), Math.max(1, x(n.e) - x(n.s)), 1.5);
  }
  ctx.globalAlpha = 1;
  if (loop) {
    ctx.fillStyle = 'rgba(255,79,31,0.16)';
    ctx.fillRect(x(loop.a), 0, x(loop.b) - x(loop.a), H);
    ctx.fillStyle = c.accent;
    ctx.fillRect(x(loop.a) - 1, 0, 2, H);
    ctx.fillRect(x(loop.b) - 1, 0, 2, H);
  }
  ctx.fillStyle = c.paper;
  ctx.fillRect(px - 0.75, 0, 1.5, H);
}
