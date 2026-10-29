// Export do MusicXML (MuseScore, Finale, Dorico...) - dve osnovy, prstoklad, takty podle mrizky dob.
// Teorie: teorie/06-notovy-zapis.md
import { beatTimes, detectKey } from './analysis.js';

const DIV = 4;                                   // dilku na dobu (= ctvrtova nota) -> nejkratsi 1/16
const TYPES = { 16: ['whole', 0], 12: ['half', 1], 8: ['half', 0], 6: ['quarter', 1], 4: ['quarter', 0], 3: ['eighth', 1], 2: ['eighth', 0], 1: ['16th', 0] };
const SHARP = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];
// predznamenani tonin (pocet krizku, zaporne = becka) podle tonicky dur
const FIFTHS_MAJOR = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Cas -> pozice v dilcich (doby nemusi byt stejne dlouhe), zaokrouhleno na 1/16.
function quantizer(beats) {
  return (t) => {
    let i = 0;
    while (i + 2 < beats.length && beats[i + 1] <= t) i++;
    const frac = (t - beats[i]) / (beats[i + 1] - beats[i]);
    return Math.max(0, Math.round((i + frac) * DIV));
  };
}

// Rozlozi delku (v dilcich) na zapisovatelne hodnoty, nejdelsi prvni.
function splitDuration(d) {
  const out = [];
  const sizes = [16, 12, 8, 6, 4, 3, 2, 1];
  while (d > 0) {
    const s = sizes.find((x) => x <= d);
    out.push(s);
    d -= s;
  }
  return out;
}

// Drzena nota, pod kterou ta sama ruka hraje dal (aspon dobu po dalsim nastupu, napr. bas pod
// rozkladem), jde do 2. hlasu osnovy - jinak by se zkratila na dalsi nastup. Vraci [hlas 1, hlas 2].
function splitVoices(notes, q) {
  const starts = [...new Set(notes.map((n) => q(n.s)))].sort((a, b) => a - b);
  const held = (n) => {
    const next = starts.find((t) => t > q(n.s));
    return next !== undefined && q(n.e) - next >= DIV;
  };
  return [notes.filter((n) => !held(n)), notes.filter(held)];
}

/**
 * Jeden hlas s akordy. Prekryvajici se noty se zkrati na zacatek dalsiho akordu (drzene noty
 * uz odebral splitVoices). Vraci udalosti [{ start, dur, notes: [{p, f}] }] vcetne pomlk (notes = []).
 */
function staffEvents(notes, q, total) {
  const byStart = new Map();
  for (const n of notes) {
    const s = q(n.s);
    const e = Math.max(s + 1, q(n.e));
    if (!byStart.has(s)) byStart.set(s, []);
    byStart.get(s).push({ p: n.p, f: n.f, e });
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const events = [];
  let pos = 0;
  starts.forEach((s, i) => {
    if (s > pos) events.push({ start: pos, dur: s - pos, notes: [] });
    const group = byStart.get(s);
    const end = Math.min(Math.max(...group.map((n) => n.e)), starts[i + 1] ?? Infinity);
    events.push({ start: s, dur: end - s, notes: group.sort((a, b) => a.p - b.p) });
    pos = end;
  });
  if (pos < total) events.push({ start: pos, dur: total - pos, notes: [] });
  return events;
}

// Udalost rozdeli na casti podle taktu a zapisovatelnych hodnot (s ligaturami).
function measureChunks(events, measureLen) {
  const measures = [];
  for (const ev of events) {
    let s = ev.start, left = ev.dur, first = true;
    while (left > 0) {
      const m = Math.floor(s / measureLen);
      const room = (m + 1) * measureLen - s;
      const take = Math.min(left, room);
      const parts = splitDuration(take);
      parts.forEach((d, k) => {
        (measures[m] ||= []).push({
          dur: d, notes: ev.notes,
          tieStop: !first || k > 0, tieStart: left - take > 0 || k < parts.length - 1,
          showFinger: first && k === 0,
        });
      });
      first = false;
      s += take;
      left -= take;
    }
  }
  return measures;
}

function noteXml(chunk, staff, voice, spell) {
  const [type, dots] = TYPES[chunk.dur];
  const dotXml = dots ? '<dot/>' : '';
  if (!chunk.notes.length) {
    const hide = voice % 4 === 2 ? ' print-object="no"' : '';                 // pomlky 2. hlasu se netisknou
    return `<note${hide}><rest/><duration>${chunk.dur}</duration><voice>${voice}</voice><type>${type}</type>${dotXml}<staff>${staff}</staff></note>`;
  }
  return chunk.notes.map((n, i) => {
    const [step, alter] = spell[n.p % 12];
    const octave = Math.floor(n.p / 12) - 1;
    const ties = (chunk.tieStop ? '<tie type="stop"/>' : '') + (chunk.tieStart ? '<tie type="start"/>' : '');
    const tied = (chunk.tieStop ? '<tied type="stop"/>' : '') + (chunk.tieStart ? '<tied type="start"/>' : '');
    const finger = chunk.showFinger && n.f ? `<technical><fingering>${n.f}</fingering></technical>` : '';
    const notations = tied || finger ? `<notations>${tied}${finger}</notations>` : '';
    return `<note>${i ? '<chord/>' : ''}<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`
      + `<duration>${chunk.dur}</duration>${ties}<voice>${voice}</voice><type>${type}</type>${dotXml}<staff>${staff}</staff>${notations}</note>`;
  }).join('');
}

/**
 * notes: [{p, s, e, h, f}], grid z estimateGrid, key z detectKey (idealne z originalu, aby vsechny
 * urovne mely stejne predznamenani). Vraci text MusicXML 4.0 (partwise).
 */
export function toMusicXML(notes, grid, title = 'PianoHelper', key = detectKey(notes)) {
  const end = notes.reduce((m, n) => Math.max(m, n.e), 0);
  const beats = beatTimes(grid, end);
  const q = quantizer(beats);
  const measureLen = grid.meter * DIV;
  const total = Math.ceil(Math.max(...notes.map((n) => q(n.e)), 1) / measureLen) * measureLen;

  const tonic = key.mode === 'dur' ? key.tonic : (key.tonic + 3) % 12;          // moll -> paralelni dur
  const fifths = FIFTHS_MAJOR[tonic];
  const spell = fifths < 0 ? FLAT : SHARP;

  // osnova -> [hlas 1, hlas 2] -> takty; hlasy 1-2 v horni osnove, 5-6 v dolni (zvyk MuseScore)
  const staves = ['R', 'L'].map((h) => splitVoices(notes.filter((n) => (n.h === 'L' ? 'L' : 'R') === h), q)
    .map((vn) => measureChunks(staffEvents(vn, q, total), measureLen)));
  const nMeasures = total / measureLen;
  const bpm = Math.round(60 / grid.beat);

  let body = '';
  for (let m = 0; m < nMeasures; m++) {
    let xml = `<measure number="${m + 1}">`;
    if (m === 0) {
      xml += `<attributes><divisions>${DIV}</divisions><key><fifths>${fifths}</fifths><mode>${key.mode === 'dur' ? 'major' : 'minor'}</mode></key>`
        + `<time><beats>${grid.meter}</beats><beat-type>4</beat-type></time><staves>2</staves>`
        + '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
        + `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`;
    }
    const voices = [];
    staves.forEach((vs, s) => vs.forEach((ms, v) => {
      const chunks = ms[m] || [];
      if (v && !chunks.some((c) => c.notes.length)) return;                     // prazdny 2. hlas se nepise
      voices.push(chunks.map((c) => noteXml(c, s + 1, s * 4 + v + 1, spell)).join(''));
    }));
    xml += voices.join(`<backup><duration>${measureLen}</duration></backup>`);
    body += `${xml}</measure>`;
  }

  return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
    + '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'
    + `<score-partwise version="4.0"><work><work-title>${esc(title)}</work-title></work>`
    + '<identification><encoding><software>PianoHelper</software></encoding></identification>'
    + '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
    + `<part id="P1">${body}</part></score-partwise>\n`;
}
