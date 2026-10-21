// Zakladni hudebni pomucky sdilene vsemi moduly.

export const BLACK = new Set([1, 3, 6, 8, 10]);
export const isBlack = (p) => BLACK.has(((p % 12) + 12) % 12);

const NAMES = {
  // mezinarodni: B = si
  intl: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
  // cesky: H = si, B = si-bemol
  cz: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B', 'H'],
  solfege: ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'],
};

export function noteName(p, system = 'intl', withOctave = false) {
  const n = NAMES[system][((p % 12) + 12) % 12];
  return withOctave ? n + (Math.floor(p / 12) - 1) : n;
}

// Seskupi noty do "udalosti" = noty, ktere zacinaji (skoro) soucasne.
export function onsetGroups(notes, tol = 0.035) {
  const sorted = [...notes].sort((a, b) => a.s - b.s || a.p - b.p);
  const groups = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    if (g && n.s - g.t <= tol) g.notes.push(n);
    else groups.push({ t: n.s, notes: [n] });
  }
  return groups;
}

export const clone = (notes) => notes.map((n) => ({ ...n }));
export const songEnd = (notes) => notes.reduce((m, n) => Math.max(m, n.e), 0);
