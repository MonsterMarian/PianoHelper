# 🎹 PianoHelper

**Převod videí a audia na notový zápis, MIDI soubor a textový seznam not.**

![Python](https://img.shields.io/badge/Python-3.9+-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## Funkce

- 🎬 **Video detekce not** — OpenCV analýza videí s klavírem (Synthesia styl i reálné piano)
- 🎵 **Audio→MIDI** — Spotify basic-pitch (polyfonní) nebo librosa pyin (monofonní)
- 🎼 **Notový zápis** — Automatické generování PNG notových listů
- 📊 **MIDI export** — Standardní .mid soubory kompatibilní s MuseScore, FL Studio, atd.
- 🖥️ **Webové rozhraní** — Streamlit GUI s drag-and-drop a přehráváním
- 🎚️ **Source separation** — Izolace nástrojů z mixu (Demucs/Spleeter)
- 🎹 **Multi-instrument** — Podpora pro piano, kytaru, vokály a další nástroje
- 📈 **Adaptivní detekce** — Multi-frame consensus, adaptivní thresholdy, velocity z velikosti not

## Podporované typy videí

- **Synthesia styl** — Padající barevné noty na klávesnici
- **Reálné piano** — Video skutečného klavíru (detekce stisku kláves ze změny jasu)
- **Tutorial styl** — Noty/text nahoře, klávesnice dole (PianoGen apod.)
- **Obecné** — Barevné objekty nad klávesnicí
- **Audio soubory** — WAV/MP3 bez videa (pouze audio→MIDI)

## Rychlý start

```bash
# 1. Nainstalovat závislosti
pip install -r requirements.txt

# 2. Zpracovat YouTube video (Synthesia styl)
python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI

# 3. Reálné piano video (auto-detekce)
python main.py --local piano_video.mp4 --mode auto

# 4. Audio→MIDI s izolací piana
python main.py --local song.mp4 --audio --isolate-piano

# 5. Nebo spustit GUI
streamlit run app.py
```

## Instalace

### Povinné závislosti

```bash
pip install -r requirements.txt
```

### Volitelné závislosti

```bash
# Audio→MIDI (doporučeno)
pip install basic-pitch

# Audio extrakce z videa
# Windows: https://ffmpeg.org/download.html
# macOS: brew install ffmpeg
# Linux: sudo apt install ffmpeg

# Source separation (izolace nástrojů)
pip install demucs
# nebo
pip install spleeter

# Monofonní pitch detection (fallback)
pip install librosa

# Webové rozhraní
pip install streamlit

# Pokročilý notový zápis (potřebuje MuseScore/LilyPond)
pip install music21

# Bandpass filtr (fallback pro izolaci)
pip install scipy soundfile
```

## Použití

### CLI

```bash
# YouTube video (Synthesia styl)
python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI

# Lokální video
python main.py --local video.mp4

# Reálné piano video (detekce stisku kláves)
python main.py --local real_piano.mp4 --mode real_piano

# Tutorial video (noty nahoře)
python main.py --local tutorial.mp4 --mode tutorial

# Audio→MIDI místo video detekce
python main.py --local video.mp4 --audio --method basic-pitch

# Audio→MIDI s izolací piana
python main.py --local song.mp4 --audio --isolate-piano

# Audio→MIDI s odstraněním vokálů
python main.py --local song.mp4 --audio --remove-vocals

# Auto-detekce dominantního nástroje
python main.py --local song.mp4 --audio --detect-instrument

# Separace audia na stopy (vocals/drums/bass/other)
python main.py --local song.mp4 --audio --separate-stems

# Vlastní nastavení
python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI \
    --output ./moje_noty \
    --title "Moje Skladba" \
    --tempo 140 \
    --frame-skip 1 \
    --min-pixels 15 \
    --notes-per-staff 20 \
    --mode synthesia
```

### Webové rozhraní

```bash
streamlit run app.py
```

Otevře se na `http://localhost:8501` s drag-and-drop rozhraním.

**GUI funkce:**
- YouTube URL nebo upload lokálního videa
- Výběr video mode (synthesia/real_piano/tutorial/generic/auto)
- Audio→MIDI pipeline s volitelnou izolací nástrojů
- Separace audia na stopy s přehráváním
- Interaktivní náhled klávesnice s detekcí
- DataFrame s detekovanými notami
- Download tlačítka pro MIDI/PNG/TXT/stems

### Parametry

| Parametr | Popis | Výchozí |
|----------|-------|---------|
| `url` | YouTube URL videa | (povinný) |
| `--local`, `-l` | Cesta k lokálnímu videu | - |
| `--output`, `-o` | Výstupní složka | `output` |
| `--title`, `-t` | Název skladby | z názvu videa |
| `--tempo` | Tempo v BPM | `120` |
| `--notes-per-staff` | Počet not na řádek | `16` |
| `--frame-skip` | Analyzovat každý N-tý snímek | `2` |
| `--min-pixels` | Minimální počet pixelů pro notu | `25` |
| `--min-duration` | Minimální délka noty (s) | `0.05` |
| `--mode` | Typ videa: `auto`, `synthesia`, `real_piano`, `tutorial`, `generic` | `auto` |
| `--preview-only` | Pouze stáhnout a ukázat náhled | - |
| `--skip-sheet` | Přeskočit generování notového zápisu | - |
| `--skip-midi` | Přeskočit generování MIDI | - |
| `--audio` | Použít audio→MIDI místo video detekce | - |
| `--method` | Metoda audio detekce (`auto`, `basic-pitch`, `librosa`) | `auto` |
| `--isolate-piano` | Izolovat piano z audio mixu | - |
| `--remove-vocals` | Odstranit vokály před detekcí | - |
| `--instrument` | Cílový nástroj pro audio detekci | - |
| `--detect-instrument` | Auto-detekovat dominantní nástroj | - |
| `--separate-stems` | Separovat audio na stopy | - |
| `--verbose`, `-v` | Detailní logování | - |

## Struktura projektu

```
Piano/
├── main.py                    # Hlavní skript s CLI
├── app.py                     # Streamlit webové rozhraní
├── video_downloader.py        # Stahování videí z YouTube (yt-dlp)
├── note_detector.py           # Detekce klávesnice a not (OpenCV)
│   ├── detect_video_mode()    # Auto-detekce typu videa
│   ├── detect_real_piano_notes()  # Detekce stisku kláves
│   └── detect_tutorial_notes()    # Tutorial styl
├── midi_generator.py          # Převod not na MIDI (mido)
├── sheet_renderer.py          # Generování notového zápisu (matplotlib)
├── audio_to_midi.py           # Audio→MIDI (basic-pitch / librosa)
│   ├── video_to_midi()        # Kompletní pipeline video→audio→MIDI
│   └── isolate_piano_from_audio()  # Izolace piana
├── instrument_separator.py    # Source separation (Demucs/Spleeter)
│   ├── isolate_piano()        # Izolace piana z mixu
│   ├── remove_instrument()    # Odstranění nástroje
│   ├── separate_stems()       # Separace na stopy
│   └── detect_dominant_instrument()  # Detekce nástroje
├── requirements.txt           # Python závislosti
└── README.md                  # Tento soubor
```

## Jak to funguje

### Video detekce (výchozí)

1. **Stažení videa** z YouTube (nebo lokální soubor)
2. **Auto-detekce typu videa** — analýza několika snímků pro určení stylu
3. **Detekce klávesnice** — multi-frame consensus algoritmus najde bílé a černé klávesy
4. **Detekce not** podle typu videa:
   - **Synthesia**: HSV filtrace barevných objektů nad klávesnicí v každém snímku
   - **Real piano**: Sledování změn jasu kláves při stisku
   - **Tutorial**: Barevné bloky v horní části + klávesnice dole
   - **Generic**: Obecné barevné objekty nad klávesnicí
5. **Tracking** — sledování aktivních not napříč snímky, výpočet začátku/konce
6. **Export** — MIDI, PNG notový zápis, textový seznam

### Audio→MIDI (`--audio`)

1. **Extrakce audia** z videa (ffmpeg)
2. **Volitelná izolace nástroje** (Demucs/Spleeter/bandpass filtr)
3. **Pitch detection** — basic-pitch (polyfonní) nebo librosa pyin (monofonní)
4. **Export** — stejný jako výše

### Source separation

- **Demucs** (Meta Research) — 4-stem separation (vocals/drums/bass/other), nejlepší kvalita
- **Spleeter** (Deezer) — 2/4/5-stem separation, rychlejší
- **Bandpass filtr** — frekvenční izolace (fallback bez ML modelů)

## Příklady použití

### Reálné piano video

```bash
# Auto-detekce (doporučeno)
python main.py --local piano_concert.mp4 --mode auto

# Manuální nastavení
python main.py --local piano_concert.mp4 --mode real_piano --frame-skip 1
```

### Video s vokály + piano

```bash
# Izolovat piano, odstranit vokály
python main.py --local song_with_vocals.mp4 --audio --isolate-piano

# Odstranit vokály a použít video detekci
python main.py --local song.mp4 --remove-vocals
```

### Multi-instrumentální skladba

```bash
# Separovat na stopy
python main.py --local orchestra.mp4 --audio --separate-stems

# Detekovat dominantní nástroj
python main.py --local orchestra.mp4 --audio --detect-instrument

# Izolovat kytaru
python main.py --local song.mp4 --audio --instrument guitar
```

### Tutorial video

```bash
# PianoGen nebo podobný styl
python main.py --local tutorial.mp4 --mode tutorial --min-pixels 20
```

## Tipy pro lepší výsledky

**Nízká přesnost?**
- Snížit `--min-pixels` na 15-20
- Snížit `--frame-skip` na 1 (analyzovat každý snímek)
- Stáhnout video ve vyšší kvalitě
- Zkusit `--mode real_piano` pro reálná videa

**Příliš mnoho falešných not?**
- Zvýšit `--min-pixels` na 40-50
- Zvýšit `--min-duration` na 0.1s
- Pro reálná videa použít `--frame-skip 3-5`

**Video bez klávesnice?**
- Program automaticky použije výchozí rozložení
- Pro lepší výsledky zkontrolujte `--notes-per-staff`

**Audio s více nástroji?**
- Použijte `--separate-stems` pro rozdělení
- Nebo `--isolate-piano` pro extrakci piana

## Otevření výstupů

**MIDI** soubory:
- [MuseScore](https://musescore.org) (zdarma)
- [Synthesia](https://synthesiagame.com)
- FL Studio, Ableton Live, GarageBand
- Online: [midi.show](https://midi.show), [flat.io](https://flat.io)

**Notový zápis** (PNG): jakýkoli prohlížeč obrázků

**Textový seznam**: jakýkoli textový editor

**Separované stopy** (WAV/MP3): jakýkoli audio přehrávač nebo DAW

## Známé limity

- Videa s velmi nízkým rozlišením (< 360p) mohou mít horší přesnost
- Videa bez klávesnice nebo s neobvyklým layoutem vyžadují manuální úpravy
- Detekce tempa je přibližná — pro přesné tempo použijte `--tempo`
- Audio→MIDI vyžaduje video s audiem (ne jen vizuální noty)
- Source separation (Demucs/Spleeter) vyžaduje ~2GB RAM a GPU pro rychlejší zpracování
- Real piano detekce funguje nejlépe s jasným osvětlením a stabilní kamerou

## Vývoj

```bash
# Vývojové prostředí
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
.venv\Scripts\activate     # Windows

pip install -r requirements.txt

# Test detekce
python note_detector.py output/video.mp4

# Test MIDI generátoru
python midi_generator.py

# Test audio→MIDI
python audio_to_midi.py audio.wav --method basic-pitch

# Test instrument separatoru
python instrument_separator.py audio.wav --mode piano

# Test instrument detection
python instrument_separator.py audio.wav --mode detect
```

## Licence

Volně k použití pro osobní i komerční účely (MIT).

## Poděkování

- [OpenCV](https://opencv.org/) — počítačové vidění
- [Spotify basic-pitch](https://github.com/spotify/basic-pitch) — polyfonní pitch detection
- [Demucs](https://github.com/facebookresearch/demucs) — source separation
- [Mido](https://github.com/olemb/mido) — MIDI knihovna
- [Streamlit](https://streamlit.io/) — webové rozhraní
