# 🎹 PianoHelper

**Převod YouTube videí s padajícími notami (Synthesia styl) na notový zápis, MIDI soubor a textový seznam not.**

![Python](https://img.shields.io/badge/Python-3.9+-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## Funkce

- 🎬 **Video detekce not** — OpenCV analýza Synthesia-style videí s padajícími notami
- 🎵 **Audio→MIDI** — Spotify basic-pitch (polyfonní) nebo librosa pyin (monofonní)
- 🎼 **Notový zápis** — Automatické generování PNG notových listů
- 📊 **MIDI export** — Standardní .mid soubory kompatibilní s MuseScore, FL Studio, atd.
- 🖥️ **Webové rozhraní** — Streamlit GUI s drag-and-drop a přehráváním
- 📈 **Adaptivní detekce** — Multi-frame consensus, adaptivní thresholdy, velocity z velikosti not

## Rychlý start

```bash
# 1. Nainstalovat závislosti
pip install -r requirements.txt

# 2. Zpracovat YouTube video
python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI

# 3. Nebo spustit GUI
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

# Monofonní pitch detection (fallback)
pip install librosa

# Webové rozhraní
pip install streamlit

# Pokročilý notový zápis (potřebuje MuseScore/LilyPond)
pip install music21
```

## Použití

### CLI

```bash
# YouTube video
python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI

# Lokální video
python main.py --local video.mp4

# Pouze náhled (bez zpracování)
python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI --preview-only

# Audio→MIDI místo video detekce
python main.py --local video.mp4 --audio --method basic-pitch

# Vlastní nastavení
python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI \
    --output ./moje_noty \
    --title "Moje Skladba" \
    --tempo 140 \
    --frame-skip 1 \
    --min-pixels 15 \
    --notes-per-staff 20
```

### Webové rozhraní

```bash
streamlit run app.py
```

Otevře se na `http://localhost:8501` s drag-and-drop rozhraním.

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
| `--preview-only` | Pouze stáhnout a ukázat náhled | - |
| `--skip-sheet` | Přeskočit generování notového zápisu | - |
| `--skip-midi` | Přeskočit generování MIDI | - |
| `--audio` | Použít audio→MIDI místo video detekce | - |
| `--method` | Metoda audio detekce (`auto`, `basic-pitch`, `librosa`) | `auto` |
| `--verbose`, `-v` | Detailní logování | - |

## Struktura projektu

```
Piano/
├── main.py                # Hlavní skript s CLI
├── app.py                 # Streamlit webové rozhraní
├── video_downloader.py    # Stahování videí z YouTube (yt-dlp)
├── note_detector.py       # Detekce klávesnice a not (OpenCV)
├── midi_generator.py      # Převod not na MIDI (mido)
├── sheet_renderer.py      # Generování notového zápisu (matplotlib)
├── audio_to_midi.py       # Audio→MIDI (basic-pitch / librosa)
├── requirements.txt       # Python závislosti
└── README.md              # Tento soubor
```

## Jak to funguje

### Video detekce (výchozí)

1. **Stažení videa** z YouTube (nebo lokální soubor)
2. **Detekce klávesnice** — multi-frame consensus algoritmus najde bílé a černé klávesy
3. **Detekce not** — HSV filtrace barevných objektů nad klávesnicí v každém snímku
4. **Tracking** — sledování aktivních not napříč snímky, výpočet začátku/konce
5. **Export** — MIDI, PNG notový zápis, textový seznam

### Audio→MIDI (`--audio`)

1. **Extrakce audia** z videa (ffmpeg)
2. **Pitch detection** — basic-pitch (polyfonní) nebo librosa pyin (monofonní)
3. **Export** — stejný jako výše

## Podporované typy videí

Program je optimalizovaný pro **Synthesia-style** videa:

- ✅ Padající barevné noty na klávesnici
- ✅ Černé pozadí s barevnými klávesami
- ✅ Standardní piano layout (A0-C8 nebo menší)
- ✅ "Glow" styl not (svítící, nízká saturace)
- ⚠️ Jiné styly mohou vyžadovat úpravu parametrů

## Tipy pro lepší výsledky

**Nízká přesnost?**
- Snížit `--min-pixels` na 15-20
- Snížit `--frame-skip` na 1 (analyzovat každý snímek)
- Stáhnout video ve vyšší kvalitě

**Příliš mnoho falešných not?**
- Zvýšit `--min-pixels` na 40-50
- Zvýšit `--min-duration` na 0.1s

**Video bez klávesnice?**
- Program automaticky použije výchozí rozložení
- Pro lepší výsledky zkontrolujte `--notes-per-staff`

## Otevření výstupů

**MIDI** soubory:
- [MuseScore](https://musescore.org) (zdarma)
- [Synthesia](https://synthesiagame.com)
- FL Studio, Ableton Live, GarageBand
- Online: [midi.show](https://midi.show), [flat.io](https://flat.io)

**Notový zápis** (PNG): jakýkoli prohlížeč obrázků

**Textový seznam**: jakýkoli textový editor

## Známé limity

- Videa s velmi nízkým rozlišením (< 360p) mohou mít horší přesnost
- Videa bez klávesnice nebo s neobvyklým layoutem vyžadují manuální úpravy
- Detekce tempa je přibližná — pro přesné tempo použijte `--tempo`
- Audio→MIDI vyžaduje video s audiem (ne jen vizuální noty)

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
python audio_to_midi.py audio.wav basic-pitch
```

## Licence

Volně k použití pro osobní i komerční účely (MIT).
