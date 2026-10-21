// Citelny nazev skladby z nazvu YouTube videa: "[full] Jujutsu Kaisen OP - "Kaikai Kitan" - EASY Piano
// Tutorial & Sheet Music" -> { name: 'Kaikai Kitan', series: 'Jujutsu Kaisen OP' }.
const NOISE = [
  /\[\s*full\s*\]/gi, /\bEASY\b.*$/i, /\bpiano tutorial\b.*$/i, /&\s*sheet music/gi, /\bsheet music\b/gi,
  /\(\s*official.*?\)/gi, /\btutorial\b/gi, /\bpiano cover\b.*$/i,
];

export function parseTitle(title) {
  let t = String(title || '').trim();
  for (const re of NOISE) t = t.replace(re, ' ');
  t = t.replace(/\s*[|–-]\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
  let series = '';
  const from = t.match(/\(from ([^)]+)\)/i);
  if (from) { series = from[1]; t = t.replace(from[0], '').trim(); }
  const quoted = t.match(/["“„](.+?)["”“]/);
  if (quoted) {
    const before = t.slice(0, quoted.index).replace(/[-–:|\s]+$/, '').trim();
    return { name: quoted[1].trim(), series: [before, series].filter(Boolean).join(' · ') };
  }
  const paren = t.match(/^(.+?)\s*\(([^)]+)\)\s*$/);           // "Oda na radost (Beethoven)"
  if (paren && !series) return { name: paren[1].trim(), series: paren[2].trim() };
  const dash = t.split(/\s+[-–]\s+/);
  if (dash.length >= 2) return { name: dash.slice(1).join(' – ').trim(), series: [dash[0].trim(), series].filter(Boolean).join(' · ') };
  return { name: t || String(title), series };
}

export function youtubeId(url) {
  const m = String(url || '').match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}
