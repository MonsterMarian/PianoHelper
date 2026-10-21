// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { noteName, onsetGroups } from '../web/js/music.js';
import { estimateGrid, matchChord, detectKey } from '../web/js/analysis.js';
import { fingerHand } from '../web/js/fingering.js';
import { splitHands, rebalanceHands } from '../web/js/hands.js';
import { arrange } from '../web/js/arrange.js';

const seq = (ps, dt = 0.3) => ps.map((p, i) => ({ p, s: i * dt, e: i * dt + dt * 0.9 }));
const fingers = (ps, hand = 'R') => fingerHand(seq(ps), hand).map((n) => n.f).join('');
const chord = (ps, hand) => fingerHand(ps.map((p) => ({ p, s: 0, e: 1 })), hand).sort((a, b) => a.p - b.p).map((n) => n.f).join('');

test('nazvy not', () => {
  assert.equal(noteName(60, 'intl', true), 'C4');
  assert.equal(noteName(71, 'intl'), 'B');
  assert.equal(noteName(71, 'cz'), 'H');
  assert.equal(noteName(70, 'cz'), 'B');
  assert.equal(noteName(67, 'solfege'), 'Sol');
});

test('prstoklad: stupnice podle ucebnic', () => {
  assert.equal(fingers([60, 62, 64, 65, 67, 69, 71, 72]), '12312345');           // C dur nahoru PR
  assert.equal(fingers([72, 71, 69, 67, 65, 64, 62, 60]), '54321321');           // C dur dolu PR
  assert.equal(fingers([48, 50, 52, 53, 55, 57, 59, 60], 'L'), '54321321');      // C dur nahoru LR
  assert.equal(fingers([60, 59, 57, 55, 53, 52, 50, 48], 'L'), '12312345');      // C dur dolu LR
  assert.equal(fingers([67, 69, 71, 72, 74, 76, 78, 79]), '12312345');           // G dur
  assert.equal(fingers([62, 64, 66, 67, 69, 71, 73, 74]), '12312345');           // D dur
  assert.equal(fingers([65, 67, 69, 70, 72, 74, 76, 77]), '12341234');           // F dur (palec mimo B)
  assert.equal(fingers([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84]), '123123412312345');
});

test('prstoklad: poloha, akordy, opakovani', () => {
  assert.equal(fingers([60, 62, 64, 65, 67]), '12345');
  assert.equal(fingers([64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62]), '334554321123322');   // Oda na radost
  assert.equal(chord([60, 64, 67], 'R'), '135');
  assert.equal(chord([48, 52, 55], 'L'), '531');
  assert.equal(chord([60, 72], 'R'), '15');
  assert.equal(fingers([67, 67, 67, 67]).length, 4);
  assert.ok(new Set(fingers([67, 67, 67, 67])).size === 1, 'opakovany ton = stejny prst');
});

test('mrizka dob: tempo, metrum, prvni doba', () => {
  // 3/4, 90 BPM, prvni takt 1.0 s, bas na 1. dobe, akordy na 2. a 3., dlouhe minuty
  const beat = 60 / 90, notes = [];
  for (let bar = 0; bar < 24; bar++) {
    const t = 1.0 + bar * 3 * beat;
    notes.push({ p: 43, s: t, e: t + beat * 0.9 });
    for (const k of [1, 2]) for (const p of [59, 62, 67]) notes.push({ p, s: t + k * beat, e: t + (k + 0.5) * beat });
    notes.push({ p: 74, s: t, e: t + beat * 2.5 });
  }
  const g = estimateGrid(notes);
  assert.ok(Math.abs(g.beat - beat) < 0.002, `doba ${g.beat}`);
  assert.equal(g.meter, 3);
  const off = ((g.downbeat - 1.0) / (3 * beat)) % 1;
  assert.ok(Math.min(Math.abs(off), Math.abs(1 - Math.abs(off))) < 0.02, `prvni doba ${g.downbeat}`);

  // 4/4, 120 BPM, osminy v prave ruce, bas na 1. a 3. dobe, s chvenim +-15 ms (snimky videa)
  const n2 = [];
  let r = 1;
  const jitter = () => ((r = (r * 16807) % 2147483647) / 2147483647 - 0.5) * 0.03;
  for (let i = 0; i < 32 * 8; i++) {
    const t = 0.5 + i * 0.25 + jitter();
    n2.push({ p: 72 + (i % 5), s: t, e: t + 0.2 });
    if (i % 4 === 0) n2.push({ p: i % 8 === 0 ? 48 : 43, s: t, e: t + 0.9 });
  }
  const g2 = estimateGrid(n2);
  assert.ok(Math.abs(g2.beat - 0.5) < 0.002, `doba ${g2.beat}`);
  assert.equal(g2.meter, 4);
});

test('akordy a tonina', () => {
  const prof = (pcs) => { const p = new Array(12).fill(0); pcs.forEach((x) => { p[x] += 1; }); return p; };
  assert.equal(matchChord(prof([0, 4, 7])).name, 'C');
  assert.equal(matchChord(prof([9, 0, 4])).name, 'Am');
  assert.equal(matchChord(prof([7, 11, 2, 5])).name, 'G7');
  assert.equal(matchChord(prof([4, 7, 11]), 4).name, 'Em');
  const scale = [60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60, 55, 60].map((p, i) => ({ p, s: i, e: i + (p === 60 ? 2 : 1) }));
  assert.equal(detectKey(scale).name, 'C dur');
});

test('rozdeleni rukou bez barev', () => {
  const notes = [];
  for (let i = 0; i < 16; i++) {
    notes.push({ p: 72 + (i % 5), s: i * 0.5, e: i * 0.5 + 0.4, h: '' });
    if (i % 2 === 0) notes.push({ p: 48, s: i * 0.5, e: i * 0.5 + 0.9, h: '' }, { p: 55, s: i * 0.5, e: i * 0.5 + 0.9, h: '' });
  }
  splitHands(notes);
  assert.ok(notes.filter((n) => n.p >= 72).every((n) => n.h === 'R'));
  assert.ok(notes.filter((n) => n.p <= 55).every((n) => n.h === 'L'));
});

test('prehozeni noty do druhe ruky, kdyz je akord moc siroky', () => {
  const notes = [{ p: 50, s: 0, e: 1, h: 'R' }, { p: 67, s: 0, e: 1, h: 'R' }, { p: 72, s: 0, e: 1, h: 'R' }, { p: 43, s: 0, e: 1, h: 'L' }];
  rebalanceHands(notes);
  assert.equal(notes[0].h, 'L');
  assert.ok(notes[0].moved);
});

// skladba pro aranzma: melodie + akordy ve 4/4
function song() {
  const beat = 0.5, notes = [];
  const chords = [[48, 52, 55], [53, 57, 60], [55, 59, 62], [48, 52, 55]];
  const mel = [76, 74, 72, 74, 76, 76, 76, 77, 74, 74, 74, 77, 76, 79, 79, 72];
  mel.forEach((p, i) => {
    notes.push({ p, s: i * beat, e: i * beat + beat * 0.9, h: 'R' });
    notes.push({ p: p - 4, s: i * beat, e: i * beat + beat * 0.9, h: 'R' });    // druhy hlas pod melodii
    notes.push({ p: p - 4, s: i * beat + 0.25, e: i * beat + 0.3, h: 'R' });    // kratky vyplnovy ton
  });
  chords.forEach((c, b) => c.forEach((p) => notes.push({ p, s: b * 4 * beat, e: (b + 1) * 4 * beat - 0.05, h: 'L' })));
  return { notes, mel };
}
const sounding = (notes, h, t) => notes.filter((n) => n.h === h && n.s <= t + 0.03 && n.e > t + 0.03);

test('uroven 1: jen melodie, jedna nota naraz', () => {
  const { notes, mel } = song();
  const out = arrange(notes, 1);
  assert.ok(out.every((n) => n.h === 'R'));
  assert.deepEqual(out.map((n) => n.p), mel);
  assert.ok(onsetGroups(out).every((g) => g.notes.length === 1));
  assert.ok(out.every((n) => n.f >= 1 && n.f <= 5));
});

test('uroven 2 a 3: leva ruka zjednodusena, pod melodii', () => {
  const { notes } = song();
  for (const level of [2, 3]) {
    const out = arrange(notes, level);
    const lh = out.filter((n) => n.h === 'L');
    assert.ok(lh.length >= 4, `L${level}: ${lh.length}`);
    for (const n of lh) assert.ok(sounding(out, 'L', n.s).length <= (level === 2 ? 1 : 2));
    const melodyLow = Math.min(...out.filter((n) => n.h === 'R').map((n) => n.p));
    assert.ok(Math.max(...lh.map((n) => n.p)) < melodyLow);
    assert.deepEqual(lh.filter((n) => n.s === 0).map((n) => n.p % 12).sort(), level === 2 ? [0] : [0, 7]);   // C dur: C (+ G)
    assert.ok(out.every((n) => n.f >= 1 && n.f <= 5));
  }
});

test('uroven 4 = original, uroven 5 = original + pridane noty', () => {
  const { notes } = song();
  const four = arrange(notes, 4);
  assert.equal(four.length, notes.length);
  const five = arrange(notes, 5);
  const key = (n) => `${n.p}@${n.s.toFixed(3)}`;
  const fiveKeys = new Set(five.map(key));
  // vsechny noty prave ruky zustanou, leva ruka se rozlozi do osmin
  assert.ok(notes.filter((n) => n.h === 'R').every((n) => fiveKeys.has(key(n))));
  assert.ok(five.length > notes.length);
  assert.ok(five.some((n) => n.added));
  for (const g of onsetGroups(five)) {
    for (const h of ['L', 'R']) {
      const ps = sounding(five, h, g.t).map((n) => n.p);
      if (ps.length) assert.ok(Math.max(...ps) - Math.min(...ps) <= 12, `rozpeti ${h} @${g.t}: ${ps}`);
    }
  }
});
