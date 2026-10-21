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
| Padající noty s **písmenem** na notě | „Písmena“; názvy C D E F G A B, česky (H) nebo Do Re Mi (nastavení) |
| **5 obtížností** | Snazší verze = jen tóny originálu, těžší = celý originál + přidané noty. Začátečník (hlavní tóny melodie) · Snadné (melodie + původní bas) · Střední (+ levá ruka bez výplní) · Skoro originál (bez ozdob, akordy ≤ 3 tóny) · **Originál** · Pokročilé (+ rozklady, harmonie) · Mistr (+ oktávy). Originál je na 3, u těžkých skladeb na 4 nebo 5 (tlačítko s rumělkovou linkou). Klávesy 1–5 |
| **Úsek** na opakování — po taktech | „Opakovat“ (L) = úsek od aktuálního taktu; ‹ › nebo `[` `]` = předchozí/další úsek; délka 1/2/4/8 taktů. Na časové ose: klik / tažení = jen posun v čase, úchyty = okraje úseku, klik mimo úsek = konec opakování. **„Vybrat úsek…“** (nebo dvojklik na osu) otevře velké okno se všemi takty — tažením nebo Shift+klikem vybereš takty. Každé opakování začne o dobu dřív (předehra) |
| **Časová osa** | nahoře přehled celé skladby (táhni okno), pod ním přiblížené takty, které jedou s hudbou (🔒). Kolečko = přiblížit/oddálit, Shift+kolečko = posun (odemkne), přehrání nebo ‹ › osu zase zamkne |
| **Pohled** (V) | kolik piana je vidět (klaviatura + minimapa), šířka piana, délka not (jen vzhled — kratší noty padají pomaleji, tempo hudby se nemění), výška pádu, výška klaviatury |
| **Režim jeviště** (F) | celá obrazovka jen pro noty, malý ovladač nahoře, Esc = konec |
| **Prstoklad** | „Prsty“ (P): číslo prstu na notě i na stisknuté klávese |
| **Čekej na mě** | přehrávač počká, až zahraješ správné tóny — MIDI klavír nebo klávesnice počítače (A W S E D F T G Y H U J K = C…C, Z/X oktáva) |
| Nácvik po rukou | „Hraju já: Pravá / Levá“ — tu ruku hraješ sám, druhá zní a je ztlumená |
| **Kolik piana je vidět** | Pohled → „Klaviatura“: 88 / 76 / 61 (výchozí, jako ve videích) / 49 kláves / podle skladby; v minimapě táhni výřez, za okraj měníš velikost. Noty mimo výřez ukazuje šipka na okraji |
| **Kam dát prsty** | „Ruce“ (R, i v nastavení): číslo prstu přímo na klávese, kterou zahraje; kruh kolem čísla se plní jako odpočet. Předstih (0,5–5 s) v nastavení |
| **Jen jedna ruka** | „Zobrazit: Obě / P / L“ — skryje noty, prsty i osu druhé ruky (zvuk se nemění) |
| **Zvuk piana** | Nastavení: 6 zvuků (koncertní křídlo Salamander = výchozí, Musyng Kite, FatBoy, jasné piano, Rhodes, honky-tonk), uložené v `web/samples` — funguje i offline |
| Barvy not, názvy | Nastavení: barva pravé a levé ruky, názvy not zap/vyp, české/mezinárodní/Do-Re-Mi; ♯ / ♭ podle tóniny |
| Přepínání skladeb | ‹ Knihovna › v hlavičce (K); knihovna má náhledy z YouTube, název + série (anime/film) a hledání |
| **Rozsah skladby** | pod notami pruh, které klávesy skladba potřebuje; když je část mimo zobrazenou klaviaturu, objeví se „⚠ N not mimo klaviaturu“ a tlačítko „Zobrazit celé“ |
| Orientace | tečka na C4, popisky C3/C4/C5, velký název akordu na scéně |
| **Notový zápis** s prstokladem | Nastavení → „Stáhnout notový zápis (MusicXML)“ → MuseScore |
| Tempo 25–150 %, hlasitost | posuvníky; ←/→ = takt zpět/vpřed |

Přehrávač je statický web (HTML + JS moduly bez buildu). Zvuky pian jsou v `web/samples` (licence tamtéž), takže zvuk funguje i offline. Bez `server.py` funguje také (např. GitHub Pages), jen bez převodu z YouTube.

## Jak to funguje

1. **Detekce z videa** (`note_detector.py`): medián snímků → klávesnice → vzor černých kláves
   určí názvy → rozsvícené klávesy po snímcích = noty → barva = ruka. Oktáva se ověří podle
   zvuku (`audio_octave.py`). Podrobně: [teorie/05-detekce-videa.md](teorie/05-detekce-videa.md).
2. **Hudební analýza** (`web/js/analysis.js`): sledování dob (i proměnné tempo), takt, akordy
   (Viterbi), tónina.
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
- Tempo se sleduje i při zrychlování/zpomalování, ale náhlé zlomy (fermata) se chvíli
  hledají znovu.
- Převedené skladby jsou jen pro osobní nácvik; do repozitáře se necommitují (`.gitignore`).

## Licence

MIT. Vzorky pian: viz `web/samples/README.md` (CC BY 3.0 / CC BY-SA 3.0).
