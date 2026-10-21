# 🎹 PianoHelper

**YouTube video s padajícími notami → noty → přehrávač pro nácvik.** Přehrávač má písmena
na notách, 5 obtížností, opakování úseku a rady k prstokladu.

## Rychlý start

```bash
pip install -r requirements.txt
python server.py                 # → http://localhost:8000
```

V prohlížeči vlož odkaz na YouTube video (Synthesia styl), klikni **Převést** a po chvíli se
skladba objeví v knihovně. V knihovně je i demo (Óda na radost) a jde otevřít libovolný `.mid`.

Převod jde spustit i z příkazové řádky:

```bash
python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI
python main.py --local video.mp4 --start-note E2      # nejlevější bílá klávesa, když ji znáš
```

## Přehrávač (`web/`)

| funkce | jak |
|---|---|
| Padající noty s **písmenem** na notě | „Písmena na notách“; názvy C D E F G A B, česky (H) nebo Do Re Mi |
| **5 obtížností** | 1 Melodie · 2 Snadné · 3 Střední · 4 Originál · 5 Pokročilé (klávesy 1–5) |
| **Úsek** na opakování | táhni po časové ose, nebo A / B (klávesy `[` `]`), ⟲ Úsek (L) |
| **Prstoklad** | „Prstoklad“ (P): číslo prstu na notě i na stisknuté klávese |
| Nácvik po rukou | vypni zvuk pravé/levé ruky; tu ruku hraješ sám (noty zešednou) |
| Tempo 25–150 %, rychlost pádu, hlasitost | posuvníky |
| Akord, tónina, tempo, takt | nahoře v rohu |

Přehrávač je statický web (HTML + JS moduly bez buildu). Klavír zní ze vzorků
[Salamander Grand Piano](https://tonejs.github.io/audio/salamander/) (CC-BY), takže je potřeba
internet. Bez `server.py` funguje také (např. GitHub Pages), jen bez převodu z YouTube.

## Jak to funguje

1. **Detekce z videa** (`note_detector.py`): medián snímků → klávesnice → vzor černých kláves
   určí názvy → rozsvícené klávesy po snímcích = noty → barva = ruka. Oktáva se ověří podle
   zvuku (`audio_octave.py`). Podrobně: [teorie/05-detekce-videa.md](teorie/05-detekce-videa.md).
2. **Hudební analýza** (`web/js/analysis.js`): tempo, takt, akordy, tónina.
3. **Obtížnosti** (`web/js/arrange.js`): melodie, bas, kvinty, originál, oktávy a rozklady.
4. **Prstoklad** (`web/js/fingering.js`): dynamické programování nad ergonomickými pravidly
   (Parncutt 1997, Jacobs 2001).

Teorie, rozhodnutí a plán dalších kroků: **[teorie/](teorie/README.md)**.

## Výstupy `main.py`

Do `--output` (default `output/`): `*.mid` (pravá a levá ruka jako dvě stopy), `*_notes.txt`,
`*_sheet.png` (jednoduchý notový zápis), `preview.jpg` (snímek s vyznačenými klávesami).
Do knihovny přehrávače (`--library`, default `web/songs/`): `*.json`.

| parametr | popis | default |
|---|---|---|
| `url` / `--local` | YouTube odkaz / lokální video | – |
| `--start-note` | nejlevější bílá klávesa ve videu (např. `E2`); jinak odhad + zvuk | auto |
| `--frame-skip` | analyzovat každý N-tý snímek (1 = nutné pro opakované tóny) | 1 |
| `--min-duration` | kratší noty se zahodí (s) | 0.05 |
| `--library` | kam uložit skladbu pro přehrávač | `web/songs` |
| `--audio` | audio→MIDI (basic-pitch/librosa) místo videa – pro videa bez klávesnice | – |
| `--isolate-piano`, `--remove-vocals`, `--separate-stems`, … | jen s `--audio` | – |
| `--skip-midi`, `--skip-sheet`, `--preview-only`, `--title`, `--tempo` | | |

Starší Streamlit GUI (`streamlit run app.py`) je pořád k dispozici.

## Testy

```bash
python tests/test_detector.py         # syntetické video se známými notami
node --test tests/theory.test.mjs     # analýza, prstoklad, ruce, obtížnosti
```

## Struktura

```
main.py               CLI pipeline: stažení → detekce → oktáva → MIDI/TXT/PNG → knihovna
server.py             web + API pro převod z YouTube (jen localhost)
note_detector.py      detekce klávesnice a not z videa
audio_octave.py       kalibrace oktávy podle zvuku (PyAV)
video_downloader.py   yt-dlp (video H.264 ≤480p + zvuková stopa)
midi_generator.py     MIDI, text, JSON pro přehrávač
sheet_renderer.py     PNG notový zápis
audio_to_midi.py, instrument_separator.py, app.py    audio cesta a Streamlit GUI
web/                  přehrávač (index.html, style.css, js/, songs/)
teorie/               hudební teorie, algoritmy, plán
tests/                testy
```

## Omezení

- Video musí ukazovat klávesnici, která se při hraní barví (Synthesia a většina tutoriálů).
  Videa reálného klavíru zvládne jen `--audio`, a to méně přesně.
- Jedna mřížka tempa na skladbu: přesné pro videa vyrobená z MIDI, ne pro volné tempo.
- Převedené skladby jsou jen pro osobní nácvik; do repozitáře se necommitují (`.gitignore`).

## Licence

MIT. Vzorky klavíru: Salamander Grand Piano, Alexander Holm (CC-BY 3.0).
