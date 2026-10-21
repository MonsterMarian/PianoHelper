// Vykresleni padajicich not a klaviatury na canvas.
import { isBlack, noteName } from './music.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

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
    const bw = ww * 0.62;
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

/**
 * opts: { now, notes, layout, lookahead (s), showLetters, naming, showFingers, loop, mute }
 */
export function draw(canvas, opts) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const { now, notes, layout, lookahead, showLetters, naming, showFingers, loop, mute } = opts;
  const kbH = Math.min(140, Math.max(70, H * 0.2));
  const hitY = H - kbH;
  const pps = hitY / lookahead;                       // pixelu za sekundu
  const colors = {
    R: css('--rh'), Rd: css('--rh-dark'), L: css('--lh'), Ld: css('--lh-dark'),
    bg: css('--stage'), line: css('--stage-line'), text: css('--note-text'), muted: css('--muted-note'),
  };

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);

  // vodici cary u kazdeho C a F
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  for (const [p, k] of layout.keys) {
    if (k.black || (p % 12 !== 0 && p % 12 !== 5)) continue;
    ctx.beginPath();
    ctx.moveTo(Math.round(k.x) + 0.5, 0);
    ctx.lineTo(Math.round(k.x) + 0.5, hitY);
    ctx.stroke();
  }

  // smyccka: ztmavit cas mimo interval
  if (loop) {
    const yA = hitY - (loop.a - now) * pps, yB = hitY - (loop.b - now) * pps;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    if (yB > 0) ctx.fillRect(0, 0, W, Math.min(hitY, yB));
    if (yA < hitY) ctx.fillRect(0, Math.max(0, yA), W, hitY - Math.max(0, yA));
    ctx.fillStyle = css('--accent');
    for (const y of [yA, yB]) if (y > 0 && y < hitY) ctx.fillRect(0, y - 1, W, 2);
  }

  const active = new Map();
  const visible = notes.filter((n) => n.e >= now - 0.05 && n.s <= now + lookahead);
  // nejdriv bile, pak cerne (cerne jsou uzsi a maji byt navrch)
  visible.sort((a, b) => isBlack(a.p) - isBlack(b.p));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const n of visible) {
    const k = layout.keys.get(n.p);
    if (!k) continue;
    const hand = n.h === 'L' ? 'L' : 'R';
    const yBottom = hitY - (n.s - now) * pps;
    const yTop = hitY - (n.e - now) * pps;
    const h = Math.max(4, yBottom - yTop - 2);
    const pad = k.black ? 1 : Math.max(1, k.w * 0.08);
    const x = k.x + pad, w = k.w - 2 * pad;
    const isMuted = mute[hand];
    ctx.fillStyle = isMuted ? colors.muted : (k.black ? colors[hand + 'd'] : colors[hand]);
    roundRect(ctx, x, yBottom - h, w, h, Math.min(6, w / 3));
    ctx.fill();
    if (n.moved) {                                    // nota prehozena do druhe ruky
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    if (n.s <= now && n.e > now) active.set(n.p, n);

    // popisky u spodni hrany noty: pismeno, nad nim prst v krouzku
    const size = Math.min(w * 0.62, 16);
    if (size >= 7 && !isMuted) {
      let y = yBottom - size * 0.75;
      if (showLetters && h >= size * 1.3) {
        ctx.fillStyle = colors.text;
        ctx.font = `700 ${size}px system-ui, sans-serif`;
        const label = noteName(n.p, naming);
        ctx.fillText(label.length > 2 ? label.replace('♯', '#') : label, x + w / 2, y);
        y -= size * 1.35;
      }
      if (showFingers && n.f && h >= size * (showLetters ? 2.6 : 1.3)) {
        ctx.beginPath();
        ctx.arc(x + w / 2, y, size * 0.62, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();
        ctx.fillStyle = colors.text;
        ctx.font = `700 ${size * 0.85}px system-ui, sans-serif`;
        ctx.fillText(String(n.f), x + w / 2, y + 0.5);
      }
    }
  }

  // linie dopadu
  ctx.fillStyle = css('--accent');
  ctx.fillRect(0, hitY - 2, W, 2);

  // klaviatura
  for (const pass of [false, true]) {
    for (const [p, k] of layout.keys) {
      if (k.black !== pass) continue;
      const n = active.get(p);
      const kh = k.black ? kbH * 0.62 : kbH;
      if (n) ctx.fillStyle = colors[(n.h === 'L' ? 'L' : 'R') + (k.black ? 'd' : '')];
      else ctx.fillStyle = k.black ? '#111' : '#f4f4f2';
      ctx.fillRect(k.x + (k.black ? 0 : 0.5), hitY, k.w - (k.black ? 0 : 1), kh);
      if (!k.black && p % 12 === 0) {
        ctx.fillStyle = '#777';
        ctx.font = `600 ${Math.min(12, k.w * 0.45)}px system-ui, sans-serif`;
        ctx.fillText(noteName(p, naming, true), k.x + k.w / 2, hitY + kbH - 10);
      }
      if (n && showFingers && n.f) {
        ctx.fillStyle = k.black ? '#fff' : '#111';
        ctx.font = `700 ${Math.min(16, k.w * 0.6)}px system-ui, sans-serif`;
        ctx.fillText(String(n.f), k.x + k.w / 2, hitY + kh * (k.black ? 0.75 : 0.55));
      }
    }
  }
}

// Mapa skladby v casove ose (nahled vsech not + smyccka + pozice).
export function drawTimeline(canvas, { notes, duration, now, loop, lo, hi }) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = css('--surface-2');
  ctx.fillRect(0, 0, W, H);
  const x = (t) => (t / (duration || 1)) * W;
  const range = Math.max(1, hi - lo);
  for (const n of notes) {
    ctx.fillStyle = n.h === 'L' ? css('--lh') : css('--rh');
    ctx.fillRect(x(n.s), H - 3 - ((n.p - lo) / range) * (H - 6), Math.max(1, x(n.e) - x(n.s)), 2);
  }
  if (loop) {
    ctx.fillStyle = css('--accent-soft');
    ctx.fillRect(x(loop.a), 0, x(loop.b) - x(loop.a), H);
    ctx.fillStyle = css('--accent');
    ctx.fillRect(x(loop.a) - 1, 0, 2, H);
    ctx.fillRect(x(loop.b) - 1, 0, 2, H);
  }
  ctx.fillStyle = css('--text');
  ctx.fillRect(x(now) - 1, 0, 2, H);
}
