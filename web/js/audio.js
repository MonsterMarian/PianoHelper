// Prehravani: vzorky klaviru Salamander (CC-BY 3.0, Alexander Holm) + planovac s predstihem.
const SAMPLE_URL = 'https://tonejs.github.io/audio/salamander/';
const SAMPLE_PITCHES = [];
for (let p = 21; p <= 108; p += 3) SAMPLE_PITCHES.push(p);       // A0, C1, D#1, F#1, ... C8
const FILE = (p) => ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'][p % 12] + (Math.floor(p / 12) - 1);

export class Player {
  constructor() {
    this.notes = [];
    this.position = 0;          // cas skladby, kdyz se nehraje
    this.playing = false;
    this.speed = 1;
    this.loop = null;           // { a, b } nebo null
    this.mute = { L: false, R: false };
    this.volume = 0.8;
    this.voices = new Set();
    this.samples = new Map();
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

  async loadSamples() {
    await Promise.all(SAMPLE_PITCHES.map(async (p) => {
      try {
        const res = await fetch(`${SAMPLE_URL}${FILE(p)}.mp3`);
        this.samples.set(p, await this.ctx.decodeAudioData(await res.arrayBuffer()));
      } catch { /* bez vzorku se pouzije syntezator */ }
    }));
  }

  setNotes(notes) {
    if (this.playing) this.position = this.now();
    this.notes = [...notes].sort((a, b) => a.s - b.s);
    if (this.playing) this.restart();
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
  }

  tick() {
    let t = this.now();
    const end = this.loop ? this.loop.b : (this.notes.length ? this.notes[this.notes.length - 1].e + 0.5 : 0);
    if (t >= end) {
      if (this.loop) { this.position = this.loop.a; this.restart(); t = this.position; }
      else { this.pause(); this.position = 0; this.onEnd?.(); return; }
    }
    const horizon = t + 0.15 * this.speed;
    while (this.next < this.notes.length && this.notes[this.next].s < horizon) {
      const n = this.notes[this.next++];
      if (this.mute[n.h === 'L' ? 'L' : 'R'] || (this.loop && n.s >= this.loop.b)) continue;
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
