// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { noteName, onsetGroups } from '../web/js/music.js';
import { estimateGrid, matchChord, detectKey, chordTrack } from '../web/js/analysis.js';
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

// zivy prednes: tempo zrychluje 84 -> 132 BPM a navic "dycha" (rubato +-4 %)
function rubatoSong(bars = 20) {
  const beats = [];
  let t = 0.7;
  for (let i = 0; i < bars * 4 + 1; i++) {
    beats.push(t);
    const bpm = 84 + (48 * i) / (bars * 4);
    t += (60 / bpm) * (1 + 0.04 * Math.sin(i / 3));
  }
  const notes = [];
  for (let i = 0; i < bars * 4; i++) {
    const [a, b] = [beats[i], beats[i + 1]];
    if (i % 4 === 0) notes.push({ p: 43 + ((i / 4) % 2) * 5, s: a, e: b * 0.98 + a * 0.02, h: 'L' });
    else notes.push({ p: 55, s: a, e: a + (b - a) * 0.8, h: 'L' }, { p: 59, s: a, e: a + (b - a) * 0.8, h: 'L' });
    notes.push({ p: 72 + (i % 5), s: a, e: a + (b - a) * 0.45, h: 'R' });
    notes.push({ p: 74 + (i % 3), s: (a + b) / 2, e: (a + b) / 2 + (b - a) * 0.45, h: 'R' });
  }
  return { notes, beats: beats.slice(0, -1) };
}

test('mrizka dob sleduje zmenu tempa (rubato, zrychleni)', () => {
  const { notes, beats } = rubatoSong();
  const g = estimateGrid(notes);
  assert.equal(g.meter, 4);
  const err = beats.map((b) => Math.min(...g.beats.map((x) => Math.abs(x - b))));
  const ok = err.filter((e) => e < 0.03).length / err.length;
  assert.ok(ok >= 0.95, `doby trefene: ${(ok * 100).toFixed(0)} %`);
  // prvni doby taktu = kazda 4. skutecna doba od zacatku
  const downbeats = g.beats.filter((_, i) => i % g.meter === 0);
  for (let bar = 0; bar < 20; bar++) assert.ok(downbeats.some((d) => Math.abs(d - beats[bar * 4]) < 0.03), `takt ${bar}`);
});

test('uroven 2 pri zmene tempa: bas sedi na dobach, kazdy takt ma bas', () => {
  const { notes, beats } = rubatoSong();
  const bass = arrange(notes, 2).filter((n) => n.h === 'L');
  for (const n of bass) assert.ok(beats.some((b) => Math.abs(b - n.s) < 0.04), `bas mimo dobu @${n.s.toFixed(2)}`);
  for (let bar = 0; bar < 20; bar++) assert.ok(bass.some((n) => Math.abs(n.s - beats[bar * 4]) < 0.04), `takt ${bar} bez basu`);
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

test('akordy se nemeni kvuli pruchodnym tonum melodie (Oda na radost)', async () => {
  const fs = await import('node:fs');
  const song = JSON.parse(fs.readFileSync(new URL('../web/songs/oda-na-radost.json', import.meta.url), 'utf8'));
  const g = estimateGrid(song.notes);
  const chords = chordTrack(song.notes, g, 39);
  // prvni 4 takty: C | G | C | G (bas C3, G2 celymi notami, melodie E E F G | G F E D | C C D E | E. D D)
  const bar = g.beat * 4;
  const at = (t) => chords.find((c) => c.s <= t + 1e-6 && c.e > t + 1e-6)?.root;
  assert.deepEqual([0, 1, 2, 3].map((b) => at(b * bar)), [0, 7, 0, 7]);
  for (let b = 0; b < 4; b++) for (const k of [1, 2, 3]) assert.equal(at(b * bar + k * g.beat), [0, 7, 0, 7][b], `takt ${b + 1}, doba ${k + 1}`);
  // uroven 2: v kazdem z prvnich 4 taktu jeden bas, drzi cely takt
  const bass = arrange(song.notes, 2, g).filter((n) => n.h === 'L' && n.s < 4 * bar - 0.1);
  assert.equal(bass.length, 4);
  for (const n of bass) assert.ok(n.e - n.s > bar * 0.9, `bas ${n.p} drzi ${(n.e - n.s).toFixed(2)} s`);
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

test('uroven 1: zjednodusena melodie - jen hlavni tony, aspon 0.6 s od sebe', () => {
  const { notes, mel } = song();
  // rychla melodie: k melodii v osminach pridat behy v sestnactinach -> uroven 1 je musi vynechat
  const fast = [...notes];
  mel.forEach((p, i) => fast.push({ p: p + 2, s: i * 0.5 + 0.125, e: i * 0.5 + 0.2, h: 'R' }, { p: p + 1, s: i * 0.5 + 0.375, e: i * 0.5 + 0.45, h: 'R' }));
  const out = arrange(fast, 1);
  assert.ok(out.every((n) => n.h === 'R'));
  // tempo 120 (doba 0.5 s) je na zacatecnika rychle -> jeden ton na pul taktu (kazda 2. doba)
  assert.deepEqual(out.map((n) => n.p), mel.filter((_, i) => i % 2 === 0));
  assert.ok(onsetGroups(out).every((g) => g.notes.length === 1));
  for (let i = 1; i < out.length; i++) assert.ok(out[i].s - out[i - 1].s > 0.9);
  assert.ok(out.every((n) => n.f >= 1 && n.f <= 5));
});

test('zacatecnik: dlouhy ton na konci okna + ton na dobe nesmi byt tesne po sobe', async () => {
  const { simplifyMelody } = await import('../web/js/arrange.js');
  const grid = { beats: Array.from({ length: 24 }, (_, i) => i * 0.5), beat: 0.5, meter: 4 };
  const mel = [[60, 0.3, 0.4], [64, 0.8, 1.6], [67, 1.0, 1.4], [65, 2.0, 2.4], [64, 3.0, 3.4]].map(([p, s, e]) => ({ p, s, e, h: 'R' }));
  const out = simplifyMelody(mel, grid, 4);
  for (let i = 1; i < out.length; i++) assert.ok(out[i].s - out[i - 1].s >= 0.55, out.map((n) => `${n.p}@${n.s}`).join(' '));
});

test('takt, kde hraje jen leva ruka (predehra), nezmizi ze snadnych verzi', () => {
  const { notes } = song();
  // 2. takt: prava mlci, leva hraje jen melodii C3 D3 E3 F3
  const bar = 2, beat = 0.5;
  const twoBars = notes.filter((n) => !(n.s >= bar && n.s < 2 * bar));
  [48, 50, 52, 53].forEach((p, i) => twoBars.push({ p, s: bar + i * beat, e: bar + i * beat + 0.45, h: 'L' }));
  for (const level of [1, 2, 3]) {
    const out = arrange(twoBars, level);
    const inBar = out.filter((n) => n.s >= bar - 0.01 && n.s < 2 * bar - 0.01);
    assert.ok(inBar.length >= (level === 1 ? 1 : 4), `L${level}: ${inBar.map((n) => n.p)}`);
    if (level === 2) for (const g of onsetGroups(out.filter((n) => n.h === 'L'))) assert.equal(g.notes.length, 1, `L2 leva ruka @${g.t}`);
  }
});

test('uroven 2: melodie + jeden bas na takt, leva ruka pod melodii', () => {
  const { notes } = song();
  const out = arrange(notes, 2);
  const lh = out.filter((n) => n.h === 'L');
  assert.ok(lh.length >= 4, `${lh.length}`);
  for (const n of lh) assert.ok(sounding(out, 'L', n.s).length <= 1);
  const melodyLow = Math.min(...out.filter((n) => n.h === 'R').map((n) => n.p));
  assert.ok(Math.max(...lh.map((n) => n.p)) < melodyLow);
  assert.deepEqual(lh.filter((n) => n.s === 0).map((n) => n.p % 12), [0]);   // C dur: C
  assert.ok(out.every((n) => n.f >= 1 && n.f <= 5));
});

test('uroven 3 = original, 4 a 5 = original + pridane noty, ruka nikdy pres oktavu', () => {
  const { notes } = song();
  assert.equal(arrange(notes, 3).length, notes.length);
  const key = (n) => `${n.p}@${n.s.toFixed(3)}`;
  const counts = [];
  for (const level of [4, 5]) {
    const out = arrange(notes, level);
    const keys = new Set(out.map(key));
    assert.ok(notes.filter((n) => n.h === 'R').every((n) => keys.has(key(n))));   // prava ruka originalu zustane
    assert.ok(out.some((n) => n.added));
    for (const g of onsetGroups(out)) {
      for (const h of ['L', 'R']) {
        const ps = sounding(out, h, g.t).map((n) => n.p);
        if (ps.length) assert.ok(Math.max(...ps) - Math.min(...ps) <= 12, `L${level} rozpeti ${h} @${g.t}: ${ps}`);
      }
    }
    counts.push(out.length);
  }
  assert.ok(counts[1] >= counts[0]);                            // mistr ma aspon tolik not jako pokrocile
});

test('urovne: snazsi = jen tony originalu, tezsi = cely original + pridane; tezka skladba ma original vys', async () => {
  const { levelsFor } = await import('../web/js/arrange.js');
  const fs = await import('node:fs');
  const ode = JSON.parse(fs.readFileSync(new URL('../web/songs/oda-na-radost.json', import.meta.url), 'utf8')).notes;
  // husta skladba: sestnactiny v obou rukou, akordy -> velmi tezka
  const dense = [];
  for (let i = 0; i < 160; i++) {
    const t = i * 0.125;
    [72 + (i % 5), 67 + (i % 3)].forEach((p) => dense.push({ p, s: t, e: t + 0.11, h: 'R' }));
    [36 + (i % 4) * 2, 48].forEach((p) => dense.push({ p, s: t, e: t + 0.11, h: 'L' }));
  }
  // stredne tezka: osminy v prave, v leve kvinty a vyplne -> original na 4
  const medium = [];
  for (let i = 0; i < 120; i++) {
    const t = i * 0.25;
    medium.push({ p: 72 + [0, 2, 4, 7][i % 4], s: t, e: t + 0.22, h: 'R' });
    if (i % 2) medium.push({ p: 60, s: t, e: t + 0.2, h: 'L' });
    else [48, 55].forEach((p) => medium.push({ p: p + (i % 8 ? 2 : 0), s: t, e: t + 0.45, h: 'L' }));
  }
  const key = (n) => `${n.p}@${n.s.toFixed(3)}`;
  for (const [name, notes, origAt] of [['oda', ode, 3], ['song', song().notes, 3], ['medium', medium, 4], ['dense', dense, 5]]) {
    const levels = levelsFor(splitHands(notes.map((n) => ({ ...n, h: n.h || '' }))));
    assert.equal(levels.findIndex((l) => l.key === 'original') + 1, origAt, name);
    const orig = new Set(notes.map(key));
    for (const l of levels) {
      const out = arrange(notes, l.id);
      const keys = new Set(out.map(key));
      if (l.id < origAt) assert.ok(out.every((n) => orig.has(key(n))), `${name} ${l.name}: ton mimo original`);
      if (l.id > origAt) assert.ok(notes.every((n) => keys.has(key(n))), `${name} ${l.name}: chybi ton originalu`);
      if (l.id < origAt && l.id > 1) assert.ok(out.length <= notes.length && out.length >= arrange(notes, l.id - 1).length, `${name} ${l.name}: pocet not`);
    }
  }
});

test('MusicXML: kazdy takt ma spravnou delku, zadna nota se neztrati', async () => {
  const { toMusicXML } = await import('../web/js/musicxml.js');
  const fs = await import('node:fs');
  const ode = JSON.parse(fs.readFileSync(new URL('../web/songs/oda-na-radost.json', import.meta.url), 'utf8')).notes;
  for (const [name, notes] of [['oda', ode], ['rubato', rubatoSong().notes]]) {
    const grid = estimateGrid(notes);
    for (const level of [1, 2, 3, 4, 5]) {
      const arranged = arrange(notes, level, grid);
      const xml = toMusicXML(arranged, grid, name);
      const measures = xml.split('<measure ').slice(1);
      assert.ok(measures.length > 0);
      for (const [i, m] of measures.entries()) {
        // kazdy zapsany hlas (horni osnova 1-2, dolni 5-6) ma presne delku taktu; hlasy 1 a 5 vzdy
        const byVoice = new Map();
        for (const x of m.matchAll(/<note[^>]*>(<chord\/>)?(?:(?!<\/note>).)*?<duration>(\d+)<\/duration>(?:(?!<\/note>).)*?<voice>(\d)<\/voice>/g)) {
          if (!x[1]) byVoice.set(x[3], (byVoice.get(x[3]) || 0) + Number(x[2]));
        }
        assert.ok(byVoice.has('1') && byVoice.has('5'), `${name} L${level} takt ${i + 1}: ${[...byVoice.keys()]}`);
        for (const [v, d] of byVoice) assert.equal(d, grid.meter * 4, `${name} L${level} takt ${i + 1} hlas ${v}`);
      }
      // hlavicky not bez navazanych ligatur = pocet not
      const heads = [...xml.matchAll(/<note>(?:(?!<\/note>).)*<pitch>(?:(?!<\/note>).)*<\/note>/g)].filter((x) => !x[0].includes('<tie type="stop"/>'));
      assert.equal(heads.length, arranged.length, `${name} L${level}`);
    }
  }
});

test('rozsah klaviatury: standardni velikosti, posun za skladbou, vlastni', async () => {
  const { keyRange, layoutKeys } = await import('../web/js/render.js');
  assert.deepEqual(keyRange('88', 60, 72), [21, 108]);
  assert.deepEqual(keyRange('61', 48, 79), [36, 96]);                 // skladba se vejde
  assert.deepEqual(keyRange('49', 60, 93), [48, 96]);                 // posun o oktavu nahoru
  assert.deepEqual(keyRange('49', 24, 70), [24, 72]);                 // posun o oktavu dolu
  assert.deepEqual(keyRange('49', 30, 95), [30, 95]);                 // skladba sirsi -> rozsirit
  assert.deepEqual(keyRange('custom', 60, 72, { lo: 48, hi: 84 }), [48, 84]);
  const [lo, hi] = keyRange('auto', 64, 67);
  assert.ok(lo <= 60 && hi >= 67 && hi - lo >= 24);                    // C4 + aspon 2 oktavy
  const whites = (r) => [...layoutKeys(r[0], r[1], 1000).keys.values()].filter((k) => !k.black).length;
  assert.equal(whites(keyRange('88', 60, 72)), 52);
  assert.equal(whites(keyRange('61', 60, 72)), 36);
});

test('usek po taktech: prichyceni, posun, okraje skladby', async () => {
  const { barTimes, barAt, loopBars, loopFromTimes, shiftLoop } = await import('../web/js/loop.js');
  const grid = { beats: Array.from({ length: 40 }, (_, i) => 1 + i * 0.5), meter: 4, beat: 0.5 };   // takt = 2 s, od 1.0 s
  const bars = barTimes(grid, 20.5);
  assert.deepEqual(bars.slice(0, 4), [1, 3, 5, 7]);
  assert.ok(bars[bars.length - 1] >= 20.5);
  assert.equal(barAt(bars, 0.2), 0);
  assert.equal(barAt(bars, 3), 1);
  assert.equal(barAt(bars, 6.9), 2);
  // tazeni 4.2 s -> 8.1 s = takty 2 az 4 (indexy 1..3), zacina/konci na hranach taktu
  assert.deepEqual(loopFromTimes(bars, 8.1, 4.2), { from: 1, to: 4, a: 3, b: 9 });
  const l = loopBars(bars, 0, 2);
  assert.deepEqual(shiftLoop(bars, l, 1), { from: 2, to: 4, a: 5, b: 9 });
  assert.deepEqual(shiftLoop(bars, l, -1), l);                            // na zacatku se nepohne
  const end = shiftLoop(bars, loopBars(bars, bars.length - 3, bars.length - 1), 1);
  assert.equal(end.to, bars.length - 1);                                   // na konci se nepohne dal
  assert.equal(loopBars(bars, 5, 5).to, 6);                                // aspon 1 takt
});

test('cile prstu: cislo prstu na klavese, kterou zahraje (i u oktav)', async () => {
  const { fingerTargets } = await import('../web/js/hands.js');
  // oktavy pravou rukou: F3+F4, pak G3+G4 -> palec na F3, malicek na F4 (ne 1-5 vedle sebe)
  const oct = [];
  [[53, 65], [55, 67]].forEach(([lo, hi], i) => {
    oct.push({ p: lo, s: i, e: i + 0.9, h: 'R', f: 1 }, { p: hi, s: i, e: i + 0.9, h: 'R', f: 5 });
  });
  const t = fingerTargets(oct, 0.1).R;
  assert.deepEqual(t.map((x) => [x.f, x.p, x.dt]), [[1, 53, 0], [5, 65, 0]]);
  // C dur nahoru: v case 0 jsou videt prsty 1 2 3 na C D E, pak podklad (1 na F se uz nepocita, palec ma cil C)
  const seq = [60, 62, 64, 65, 67].map((p, i) => ({ p, s: i * 0.5, e: i * 0.5 + 0.45, h: 'R' }));
  fingerHand(seq, 'R');
  const at0 = fingerTargets(seq, 0, 1.2).R;
  assert.deepEqual(at0.map((x) => [x.f, x.p]), [[1, 60], [2, 62], [3, 64]]);
  assert.ok(at0[2].dt > at0[0].dt);                            // vzdalenejsi nota = pozdeji
  assert.deepEqual(fingerTargets(seq, 0).L, []);               // leva nehraje
});

test('prstoklad akordu podle ucebnic: zakladni tvar a obraty, staccato = presun ruky', () => {
  // Ma Meilleure Ennemie, leva ruka: Em (E G H) - Hm/D (D F# H) - Am/C (C E A), kratke akordy s pauzou
  const prog = [[52, 55, 59], [50, 54, 59], [48, 52, 57], [52, 55, 59]];
  const notes = [];
  prog.forEach((c, i) => c.forEach((p) => notes.push({ p, s: i * 0.5, e: i * 0.5 + 0.2 })));
  fingerHand(notes, 'L');
  const fing = prog.map((c, i) => c.map((p) => notes.find((n) => n.p === p && n.s === i * 0.5).f).join(''));
  assert.deepEqual(fing, ['531', '531', '531', '531']);
  // obraty v prave ruce: C dur 1. obrat (E G C) = 1-2-5, 2. obrat (G C E) = 1-3-5
  assert.equal(chord([64, 67, 72], 'R'), '125');
  assert.equal(chord([67, 72, 76], 'R'), '135');
  // leva ruka: 2. obrat (G C E) = 5-2-1
  assert.equal(chord([55, 60, 64], 'L'), '521');
});

// ABRSM: na kterych tonech je palec (jedna oktava nahoru). Pravidlo: palec jen na bilych klavesach.
const SCALES = {   // tonika (MIDI kolem C4), palce PR, palce LR (tridy tonu 0-11)
  C: [60, [0, 5], [7, 0]], G: [55, [7, 0], [2, 7]], D: [62, [2, 7], [9, 2]], A: [57, [9, 2], [4, 9]],
  E: [64, [4, 9], [11, 4]], B: [59, [11, 4], [4, 11]], F: [65, [5, 0], [0, 5]], Bb: [58, [0, 5], [2, 9]],
  Eb: [63, [5, 0], [7, 2]], Ab: [56, [0, 5], [0, 7]], Db: [61, [5, 0], [5, 0]], Gb: [54, [11, 5], [11, 5]],
};
const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];             // jedna oktava nahoru       // dve oktavy, jak se stupnice cvici
test('prstoklad: vsech 12 durovych stupnic - palec jen tam, kde ho ma ucebnice (ABRSM), nikdy na cerne', () => {
  const bad = [];
  for (const [name, [tonic, rh, lh]] of Object.entries(SCALES)) {
    for (const [hand, exp, base] of [['R', rh, tonic], ['L', lh, tonic - 12]]) {
      const notes = fingerHand(seq(MAJOR.map((i) => base + i)), hand);
      const thumbs = [...new Set(notes.filter((n) => n.f === 1).map((n) => n.p % 12))].sort((a, b) => a - b);
      const black = notes.filter((n) => n.f === 1 && [1, 3, 6, 8, 10].includes(n.p % 12)).length;
      // palec jen tam, kam ho dava ucebnice (nekdy staci jeden podklad misto dvou), nikdy na cerne
      if (!thumbs.length || thumbs.some((t) => !exp.includes(t)) || black) bad.push(`${name} ${hand}: ${notes.map((n) => n.f).join('')}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('prstoklad jako klaviristka (Levels): ruka stoji v poloze -> palec na cerne, zadne zbytecne krizeni', () => {
  // C#6 samotne, pak E6 + G#6, dokola: palec na C#6 (ruka se nehybe)
  const a = [];
  for (let i = 0; i < 8; i++) a.push({ p: 88, s: i * 0.47, e: i * 0.47 + 0.2 }, { p: 92, s: i * 0.47, e: i * 0.47 + 0.2 }, { p: 85, s: i * 0.47 + 0.23, e: i * 0.47 + 0.43 });
  fingerHand(a, 'R');
  assert.ok(a.filter((n) => n.p === 85).slice(1, -1).every((n) => n.f === 1), a.filter((n) => n.p === 85).map((n) => n.f).join(''));
  // G#5 F#5 E5 C#5 E5 C#5: melodie se vraci v poloze -> zadny podklad ani preklad
  const m = fingerHand(seq([80, 78, 76, 73, 76, 73], 0.25), 'R');
  for (let i = 1; i < m.length; i++) assert.ok((m[i].p - m[i - 1].p) * (m[i].f - m[i - 1].f) > 0, m.map((n) => n.f).join(''));
});

test('nazvy not podle toniny: becka v b-tonina ch, krizky jinde', async () => {
  const { usesFlats } = await import('../web/js/music.js');
  assert.equal(noteName(70, 'intl', false, usesFlats({ tonic: 7, mode: 'moll' })), 'B♭');   // g moll
  assert.equal(noteName(70, 'cz', false, usesFlats({ tonic: 5, mode: 'dur' })), 'B');        // F dur, cesky B
  assert.equal(noteName(66, 'intl', false, usesFlats({ tonic: 4, mode: 'moll' })), 'F♯');   // e moll
});

test('nazvy skladeb z YouTube: bez "EASY Piano Tutorial", nazev + serie', async () => {
  const { parseTitle, youtubeId } = await import('../web/js/titles.js');
  assert.deepEqual(parseTitle('[full] Jujutsu Kaisen OP - "Kaikai Kitan" - EASY Piano Tutorial & Sheet Music'), { name: 'Kaikai Kitan', series: 'Jujutsu Kaisen OP' });
  assert.deepEqual(parseTitle('Stromae, Pomme - Ma Meilleure Ennemie (from Arcane Season 2) | EASY Piano Tutorial'), { name: 'Ma Meilleure Ennemie', series: 'Stromae, Pomme · Arcane Season 2' });
  assert.deepEqual(parseTitle('Sufjan Stevens - Fourth Of July EASY PIANO TUTORIAL'), { name: 'Fourth Of July', series: 'Sufjan Stevens' });
  assert.deepEqual(parseTitle('Óda na radost (Beethoven)'), { name: 'Óda na radost', series: 'Beethoven' });
  assert.equal(parseTitle('Jujutsu Kaisen ED 2 - "give it back" by Cö shu Nie - EASY Piano Tutorial & Sheet Music').name, 'give it back');
  assert.deepEqual(parseTitle('Avicii - Levels | Piano Cover by Pianella Piano'), { name: 'Levels', series: 'Avicii' });
  assert.equal(youtubeId('https://www.youtube.com/watch?v=_x16Gr3uJf8&list=x'), '_x16Gr3uJf8');
});

// ── Regrese z code review 2026-10-29 ─────────────────────────────────────────
const grid4 = (n) => ({ beats: Array.from({ length: n }, (_, i) => i * 0.5), beat: 0.5, meter: 4, downbeat: 0 });
const at = (out, t, h) => out.filter((n) => (h === 'L') === (n.h === 'L') && Math.abs(n.s - t) < 0.01).map((n) => n.p);

test('skoro original: sestnactinovy predtakt nevytlaci akord na dobe', async () => {
  const { levelsFor } = await import('../web/js/arrange.js');
  const notes = [];
  for (let b = 0; b < 40; b++) {
    const t0 = b * 2;
    [79, 76, 72].forEach((p) => notes.push({ p, s: t0, e: t0 + 0.9, h: 'R' }));             // akord na 1. dobe, melodie G5
    for (let i = 0; i < 4; i++) [72 + (i % 3), 67].forEach((p) => notes.push({ p, s: t0 + 1 + i * 0.125, e: t0 + 1.11 + i * 0.125, h: 'R' }));
    [74, 76, 77].forEach((p, i) => notes.push({ p, s: t0 + 1.625 + i * 0.125, e: t0 + 1.735 + i * 0.125, h: 'R' }));   // predtakt
    for (let i = 0; i < 16; i++) [36 + (i % 4) * 2, 48].forEach((p) => notes.push({ p, s: t0 + i * 0.125, e: t0 + 0.11 + i * 0.125, h: 'L' }));
  }
  const level = levelsFor(notes).findIndex((l) => l.key === 'thin') + 1;
  assert.ok(level > 0);
  const out = arrange(notes, level, grid4(170));
  for (const t of [2, 4, 6]) assert.deepEqual(at(out, t, 'R'), [72, 76, 79], `akord @${t}`);
});

test('stredni: sestnactina pred dobou nevytlaci bas na dobe', () => {
  const notes = [];
  for (let b = 0; b < 40; b++) {
    const t0 = b * 2;
    for (let i = 0; i < 8; i++) [72 + [0, 2, 4, 7][i % 4], 67].forEach((p) => notes.push({ p, s: t0 + i * 0.25, e: t0 + i * 0.25 + 0.22, h: 'R' }));
    [[36, 43], [43, 50]].forEach((ch, k) => ch.forEach((p) => notes.push({ p, s: t0 + k, e: t0 + k + 0.9, h: 'L' })));
    notes.push({ p: 38, s: t0 + 1.5, e: t0 + 1.6, h: 'L' }, { p: 40, s: t0 + 1.875, e: t0 + 1.98, h: 'L' });
  }
  const out = arrange(notes, 'core', grid4(170));
  for (const t of [2, 4, 6]) assert.deepEqual(at(out, t, 'L'), [36, 43], `bas @${t}`);
});

test('zacatecnik: ton mimo dobu (predtakt) nevytlaci hlavni tony na dobach', async () => {
  const { simplifyMelody } = await import('../web/js/arrange.js');
  const mel = [[67, 0.5, 0.95], [72, 1.0, 1.9], [71, 1.5, 1.9], [72, 2.0, 2.9], [74, 3.0, 3.9]].map(([p, s, e]) => ({ p, s, e, h: 'R' }));
  const out = simplifyMelody(mel, grid4(24), 4).map((n) => `${n.p}@${n.s}`);
  assert.deepEqual(out, ['72@1', '72@2', '74@3']);
});

test('snadne: drzeny akord leve ruky v pauze prave neni melodie - bas zustane', () => {
  const notes = [];
  [76, 74, 72, 74, 0, 0, 0, 0, 76, 76, 76, 77, 74, 74, 74, 72].forEach((p, i) => { if (p) notes.push({ p, s: i * 0.5, e: i * 0.5 + 0.45, h: 'R' }); });
  for (let b = 0; b < 4; b++) (b === 1 ? [48, 52, 55] : [43, 55]).forEach((p) => notes.push({ p, s: b * 2, e: b * 2 + 1.95, h: 'L' }));
  for (let b = 4; b < 10; b++) {
    [72, 74, 76, 77].forEach((p, i) => notes.push({ p, s: b * 2 + i * 0.5, e: b * 2 + i * 0.5 + 0.45, h: 'R' }));
    notes.push({ p: 48, s: b * 2, e: b * 2 + 1.95, h: 'L' });
  }
  assert.deepEqual(at(arrange(notes, 'easy'), 2, 'L'), [48]);
});

// takt 4 (6-8 s): prava mlci, leva hraje melodii C3 D3 E3 F3; jinde bas se zmenou akordu na 3. dobe
function lhMelodySong() {
  const notes = [];
  for (let b = 0; b < 10; b++) {
    if (b === 3) { [48, 50, 52, 53].forEach((p, i) => notes.push({ p, s: 6 + i * 0.5, e: 6.45 + i * 0.5, h: 'L' })); continue; }
    [76, 74, 72, 74].forEach((p, i) => notes.push({ p, s: b * 2 + i * 0.5, e: b * 2 + i * 0.5 + 0.45, h: 'R' }, { p: p - 4, s: b * 2 + i * 0.5, e: b * 2 + i * 0.5 + 0.45, h: 'R' }));
    [36, 43, 48].forEach((p) => notes.push({ p, s: b * 2, e: b * 2 + 0.95, h: 'L' }));
    [31, 38, 47].forEach((p) => notes.push({ p, s: b * 2 + 1, e: b * 2 + 1.95, h: 'L' }));
  }
  return notes;
}

test('melodie leve ruky se najde i kdyz odhad taktu sedi posunuty', () => {
  const shifted = { ...grid4(44), beats: Array.from({ length: 44 }, (_, i) => 1 + i * 0.5) };   // prvni doby 1, 3, 5, 7
  const out = arrange(lhMelodySong(), 'easy', shifted);
  for (const [p, t] of [[48, 6], [50, 6.5], [52, 7], [53, 7.5]]) assert.ok(at(out, t, 'L').includes(p), `${p}@${t}: ${out.filter((n) => n.s > 5 && n.s < 8).map((n) => `${n.p}@${n.s}`)}`);
});

test('snadne: bas se nedrzi pod melodii leve ruky', () => {
  const out = arrange(lhMelodySong(), 'easy', grid4(44));
  for (const n of out.filter((n) => n.h === 'L' && n.s < 6 && n.p < 48)) assert.ok(n.e <= 6.001, `bas ${n.p}@${n.s} drzi do ${n.e}`);
});

test('arrange bere klic kroku i cislo urovne', () => {
  const { notes } = song();
  const sig = (out) => out.map((n) => `${n.p}@${n.s.toFixed(3)}${n.h}${n.f}`).join(' ');
  assert.equal(sig(arrange(notes, 'easy')), sig(arrange(notes, 2)));
});

test('prstoklad: palec na cerne v akordu stoji 1 bod, v poloze 3, v melodii 5', async () => {
  const { noteCost } = await import('../web/js/fingering.js');
  assert.equal(noteCost(1, 70, true), 1);
  assert.equal(noteCost(1, 70, true, true), 1);
  assert.equal(noteCost(1, 70, false, true), 3);
  assert.equal(noteCost(1, 70), 5);
});

test('prstoklad Levels: palec na C#6 od prvni do posledni noty motivu (okraje skladby)', () => {
  const a = [];
  for (let i = 0; i < 8; i++) a.push({ p: 88, s: i * 0.47, e: i * 0.47 + 0.2 }, { p: 92, s: i * 0.47, e: i * 0.47 + 0.2 }, { p: 85, s: i * 0.47 + 0.23, e: i * 0.47 + 0.43 });
  fingerHand(a, 'R');
  assert.ok(a.filter((n) => n.p === 85).every((n) => n.f === 1), a.filter((n) => n.p === 85).map((n) => n.f).join(''));
});

test('MusicXML: drzeny bas pod rozkladem se nezkrati (2. hlas dolni osnovy)', async () => {
  const { toMusicXML } = await import('../web/js/musicxml.js');
  const grid = grid4(20);
  const notes = [{ p: 36, s: 0, e: 1.95, h: 'L', f: 5 }];                       // C2 cely takt
  [43, 48, 52, 48, 43, 48, 52, 48].forEach((p, i) => notes.push({ p, s: i * 0.25, e: i * 0.25 + 0.24, h: 'L', f: 1 }));
  [72, 74, 76, 77].forEach((p, i) => notes.push({ p, s: i * 0.5, e: i * 0.5 + 0.45, h: 'R', f: i + 1 }));
  const xml = toMusicXML(notes, grid, 'test', { tonic: 0, mode: 'dur' });
  const c2 = [...xml.matchAll(/<note>(?:(?!<\/note>).)*<step>C<\/step><octave>2<\/octave>(?:(?!<\/note>).)*<\/note>/g)].map((x) => x[0]);
  assert.equal(c2.length, 1, c2.join(' | '));
  assert.match(c2[0], /<duration>16<\/duration>.*<voice>6<\/voice>/);         // cela nota, 2. hlas dolni osnovy
});

test('pokrocile: oktava rozkladu by narazila do melodie -> jiny ton akordu, zadna dira', () => {
  // C3 drzene cely takt 2x, melodie C4 v kazde dobe: oktava C4 nejde, misto ni E3
  const notes = [];
  for (let b = 0; b < 8; b++) {
    notes.push({ p: 48, s: b * 2, e: b * 2 + 1.95, h: 'L' });
    [64, 67].forEach((p) => notes.push({ p, s: b * 2, e: b * 2 + 0.45, h: 'R' }));     // C dur v prave ruce
    [60, 60, 62, 64].forEach((p, i) => notes.push({ p, s: b * 2 + i * 0.5, e: b * 2 + i * 0.5 + 0.45, h: 'R' }));
  }
  const lhAdded = arrange(notes, 'advanced', grid4(40)).filter((n) => n.h === 'L' && n.added && n.s < 2);
  assert.deepEqual(lhAdded.map((n) => n.p), [55, 52, 55, 55, 52, 55], lhAdded.map((n) => `${n.p}@${n.s}`).join(' '));
});
