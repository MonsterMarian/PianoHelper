// Vstup not: MIDI klavesnice (Web MIDI) a klavesnice pocitace.
// Klavesnice pocitace podle fyzicke polohy (e.code), takze funguje na QWERTY i QWERTZ:
//   W E   T Y U   O P        cerne
//  A S D F G H J K L ;       bile  (A = C, K = C o oktavu vys)
// Z / X = oktava dolu / nahoru.
const CODES = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

export function keyboardInput(onNote, { isActive, getOctave, setOctave }) {
  const down = new Map();          // code -> pitch (kvuli posunu oktavy behem drzeni)
  document.addEventListener('keydown', (e) => {
    if (!isActive() || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input[type="text"], input[type="url"], select, textarea')) return;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      setOctave(Math.max(1, Math.min(7, getOctave() + (e.code === 'KeyX' ? 1 : -1))));
      e.preventDefault();
      return;
    }
    if (!(e.code in CODES)) return;
    e.preventDefault();
    const p = (getOctave() + 1) * 12 + CODES[e.code];
    down.set(e.code, p);
    onNote(p, true, 'keys');
  });
  document.addEventListener('keyup', (e) => {
    const p = down.get(e.code);
    if (p === undefined) return;
    down.delete(e.code);
    onNote(p, false, 'keys');
  });
}

// Web MIDI (Chrome, Edge, Opera). Vraci nazvy pripojenych zarizeni (nebo prazdne pole).
export async function midiInput(onNote) {
  if (!navigator.requestMIDIAccess) return [];
  let access;
  try { access = await navigator.requestMIDIAccess(); } catch { return []; }
  const bind = () => {
    for (const port of access.inputs.values()) {
      port.onmidimessage = ({ data }) => {
        const [st, p, vel] = data;
        const cmd = st & 0xf0;
        if (cmd === 0x90 && vel > 0) onNote(p, true, 'midi');
        else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) onNote(p, false, 'midi');
      };
    }
  };
  bind();
  access.onstatechange = bind;
  return [...access.inputs.values()].map((i) => i.name);
}
