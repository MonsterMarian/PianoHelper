// Prehravani: lokalni vzorky pian (web/samples, licence v README) + planovac s predstihem.
// Rezim "cekej na me": cas se zastavi u akordu, dokud hrac nezahraje jeho tony.
import { onsetGroups } from './music.js';
export const PIANOS = [
  { id: 'salamander', name: 'Koncertní křídlo (Salamander)' },
  { id: 'musyng', name: 'Klavír (Musyng Kite)' },
  { id: 'fatboy', name: 'Pianino (FatBoy)' },
  { id: 'bright', name: 'Jasné piano' },
  { id: 'rhodes', name: 'Elektrické piano (Rhodes)' },
  { id: 'honkytonk', name: 'Honky-tonk' },
];
const SAMPLE_PITCHES = [];
for (let p = 21; p <= 108; p += 3) SAMPLE_PITCHES.push(p);       // A0, C1, D#1, F#1, ... C8

export class Player {
  constructor() {
    this.notes = [];
    this.position = 0;          // cas skladby, kdyz se nehraje
    this.playing = false;
    this.speed = 1;
    this.loop = null;           // { a, b, pre } nebo null (pre = predehra v s)
    this.mute = { L: false, R: false };   // ruka, kterou hraje uzivatel (nezni z reproduktoru)
    this.waitOn = false;
    this.groups = [];           // akordy, na ktere se ceka: [{ t, pitches: Set }]
    this.gi = 0;
    this.waiting = null;        // akord, na ktery se prave ceka
    this.recent = new Set();    // tony stisknute od posledniho splneneho akordu
    this.held = new Set();
    this.live = new Map();
    this.volume = 0.8;
    this.voices = new Set();
    this.samples = new Map();
    this.piano = 'salamander';
    this.onEnd = null;
  }

  ensureContext() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.loadSamples();
  }

  loadSamples() {
    // stejne piano se nacita jen jednou, i kdyz si o nej rekne vic mist naraz
    if (this.loading?.piano !== this.piano) this.loading = { piano: this.piano, done: this.fetchSamples() };
    return this.loading.done;
  }

  async fetchSamples() {
    const piano = this.piano;
    const loaded = new Map();
    await Promise.all(SAMPLE_PITCHES.map(async (p) => {
      try {
        const res = await fetch(`samples/${piano}/${p}.mp3`);
        loaded.set(p, await this.ctx.decodeAudioData(await res.arrayBuffer()));
      } catch { /* bez vzorku se pouzije syntezator */ }
    }));
    if (piano === this.piano) this.samples = loaded;             // mezitim mohl uzivatel prepnout
    return loaded.size;
  }

  // Jiny zvuk piana: stare vzorky hraji, dokud se nenactou nove.
  setPiano(id) {
    if (!PIANOS.some((x) => x.id === id) || id === this.piano) return Promise.resolve();
    this.piano = id;
    return this.ctx ? this.loadSamples() : Promise.resolve();
  }

  setNotes(notes) {
    if (this.playing) this.position = this.now();
    this.notes = [...notes].sort((a, b) => a.s - b.s);
    this.buildGroups();
    if (this.playing) this.restart();
  }

  // Na co se ceka: noty rukou, ktere hraje uzivatel (kdyz zadnou, tak obe).
  buildGroups() {
    const mine = this.mute.L || this.mute.R ? this.notes.filter((n) => this.mute[n.h === 'L' ? 'L' : 'R']) : this.notes;
    this.groups = onsetGroups(mine).map((g) => ({ t: g.t, pitches: new Set(g.notes.map((n) => n.p)) }));
    this.gi = this.groups.findIndex((g) => g.t >= this.position - 0.01);
    if (this.gi < 0) this.gi = this.groups.length;
  }

  setWait(on) {
    this.waitOn = on;
    this.waiting = null;
    this.recent.clear();
    this.buildGroups();
  }

  setMute(hand, on) {
    this.mute[hand] = on;
    this.buildGroups();
  }

  // Vstup z MIDI klavesnice nebo klavesnice pocitace.
  input(p, on, sound = true) {
    if (on) {
      this.held.add(p);
      this.recent.add(p);
      if (sound) this.liveOn(p);
    } else {
      this.held.delete(p);
      this.liveOff(p);
    }
  }

  now() {
    if (!this.playing) return this.position;
    return this.anchorSong + (this.ctx.currentTime - this.anchorCtx) * this.speed;
  }

  play() {
    this.ensureContext();
    this.ctx.resume();
    this.playing = true;
    this.restart();
    this.timer = setInterval(() => this.tick(), 25);
  }

  pause() {
    this.position = this.now();
    this.playing = false;
    clearInterval(this.timer);
    this.stopAll();
  }

  seek(t) {
    this.position = Math.max(0, t);
    if (this.playing) this.restart();
  }

  setSpeed(s) {
    const t = this.now();
    this.speed = s;
    this.position = t;
    if (this.playing) this.restart();
  }

  restart() {
    this.stopAll();
    this.anchorCtx = this.ctx.currentTime + 0.05;
    this.anchorSong = this.position;
    this.next = this.notes.findIndex((n) => n.s >= this.position - 1e-6);
    if (this.next < 0) this.next = this.notes.length;
    this.gi = this.groups.findIndex((g) => g.t >= this.position - 0.01);
    if (this.gi < 0) this.gi = this.groups.length;
    this.waiting = null;
  }

  tick() {
    let t = this.now();
    const end = this.loop ? this.loop.b : (this.notes.length ? this.notes[this.notes.length - 1].e + 0.5 : 0);
    if (t >= end) {
      // opakovani: zacit o predehru drive (noty pred usekem nezni), at je cas se pripravit
      if (this.loop) { this.position = this.loop.a - (this.loop.pre || 0); this.restart(); t = this.position; }
      else { this.pause(); this.position = 0; this.onEnd?.(); return; }
    }
    let horizon = t + 0.15 * this.speed;
    if (this.waitOn) {
      while (this.loop && this.groups[this.gi] && this.groups[this.gi].t < this.loop.a - 0.001) this.gi++;
      const g = this.groups[this.gi];
      // cas se zastavi 4 ms pred akordem: noty jsou na linii, ale jeste "nezni" (klavesy nesviti)
      if (g && t >= g.t - 0.005) {
        if ([...g.pitches].every((p) => this.recent.has(p))) {
          this.gi++;
          this.recent.clear();
          if (this.waiting) { this.anchorSong = g.t; this.anchorCtx = this.ctx.currentTime; t = g.t; }
          this.waiting = null;
        } else {
          // zastavit cas na akordu (anchor se posouva s hodinami -> now() stoji)
          this.waiting = g;
          this.anchorSong = g.t - 0.004;
          this.anchorCtx = this.ctx.currentTime;
          t = g.t - 0.004;
        }
      }
      const next = this.groups[this.gi];
      if (next) horizon = Math.min(horizon, next.t - 0.001);   // noty akordu zazni az po splneni
    }
    while (this.next < this.notes.length && this.notes[this.next].s < horizon) {
      const n = this.notes[this.next++];
      if (this.mute[n.h === 'L' ? 'L' : 'R'] || (this.loop && (n.s >= this.loop.b || n.s < this.loop.a - 0.001))) continue;
      const when = this.anchorCtx + (n.s - this.anchorSong) / this.speed;
      let dur = (n.e - n.s) / this.speed;
      if (this.loop) dur = Math.min(dur, (this.loop.b - n.s) / this.speed);
      this.noteOn(n.p, Math.max(this.ctx.currentTime, when), Math.max(0.05, dur), n.v ?? 0.7);
    }
  }

  noteOn(p, when, dur, vel) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.connect(this.master);
    let src;
    const sp = SAMPLE_PITCHES.reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a));
    const buf = this.samples.get(sp);
    if (buf) {
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 2 ** ((p - sp) / 12);
      gain.gain.setValueAtTime(vel, when);
    } else {
      src = ctx.createOscillator();        // nahradni zvuk, nez se nactou vzorky
      src.type = 'triangle';
      src.frequency.value = 440 * 2 ** ((p - 69) / 12);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(vel * 0.35, when + 0.01);
      gain.gain.exponentialRampToValueAtTime(vel * 0.12, when + Math.min(dur, 1));
    }
    src.connect(gain);
    const off = when + dur;
    gain.gain.setTargetAtTime(0, off, 0.08);    // uvolneni klavesy
    src.start(when);
    src.stop(off + 0.6);
    const voice = { src, gain };
    this.voices.add(voice);
    src.onended = () => { gain.disconnect(); this.voices.delete(voice); };
    return voice;
  }

  liveOn(p) {
    this.ensureContext();
    this.ctx.resume();
    this.liveOff(p);
    const v = this.noteOn(p, this.ctx.currentTime, 30, 0.75);
    this.live.set(p, v);
  }

  liveOff(p) {
    const v = this.live.get(p);
    if (!v) return;
    this.live.delete(p);
    const now = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, 0.08);
    try { v.src.stop(now + 0.6); } catch { /* uz skoncil */ }
  }

  stopAll() {
    if (!this.ctx) return;
    for (const { src, gain } of this.voices) {
      gain.gain.cancelScheduledValues(this.ctx.currentTime);
      gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      try { src.stop(this.ctx.currentTime + 0.1); } catch { /* jeste nezacal */ }
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
}
