# YouTube Piano → Sheet Music Generator 🎹

Automatický převod YouTube videí s padajícími notami (Synthesia styl) na notový zápis, MIDI a textový seznam not.

## Jak to funguje

1. **Stažení videa** z YouTube pomocí `yt-dlp`
2. **Adaptivní detekce klávesnice** - automaticky najde bílé/černé klávesy a jejich rozsah
3. **Detekce not** - OpenCV analyzuje barevné obdélníky padající na klávesnici
4. **Export**:
   - 📄 **Notový zápis** (PNG) - vykreslený pomocí matplotlib
   - 🎵 **MIDI soubor** - přehratelný v jakémkoli hudebním programu
   - 📝 **Textový seznam** - čas, nota, délka, hlasitost

## Požadavky

- Python 3.8+
- Nainstalované závislosti:
```bash
pip install -r requirements.txt
```

## Použití

### Základní použití
```bash
python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI
```

### S vlastními volbami
```bash
python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI \
    --output ./moje_noty \
    --title "Moje Skladba" \
    --tempo 120 \
    --notes-per-staff 16
```

### Lokální video soubor
```bash
python main.py --local video.mp4 --output ./vystup
```

### Pouze náhled (bez detekce)
```bash
python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI --preview-only
```

### Přeskočit některé kroky
```bash
python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI --skip-sheet --skip-midi
```

## Parametry

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
| `--num-keys` | Počet kláves (88 = plné piano) | `88` |
| `--preview-only` | Pouze stáhnout a ukázat náhled | - |
| `--skip-sheet` | Přeskočit generování notového zápisu | - |
| `--skip-midi` | Přeskočit generování MIDI | - |
| `--verbose`, `-v` | Detailní logování | - |

## Struktura projektu

```
Piano/
├── main.py                # Hlavní skript s CLI
├── video_downloader.py    # Stahování videí z YouTube
├── note_detector.py       # Detekce klávesnice a not (OpenCV)
├── midi_generator.py      # Převod not na MIDI
├── sheet_renderer.py      # Generování notového zápisu
├── audio_to_midi.py       # Alternativní audio→MIDI (volitelné)
├── requirements.txt       # Python závislosti
└── README.md              # Tento soubor
```

## Podporované typy videí

Program je optimalizovaný pro **Synthesia-style** videa:
- ✅ Padající barevné noty na klávesnici
- ✅ Černé pozadí s barevnými klávesami
- ✅ Standardní piano layout (A0-C8 nebo menší)
- ⚠️ Jiné styly mohou vyžadovat úpravu parametrů

## Tipy pro lepší výsledky

1. **Nízká přesnost?** Zkuste:
   - Snížit `--min-pixels` na 15-20
   - Snížit `--frame-skip` na 1 (analyzovat každý snímek)
   - Zvýšit rozlišení videa (stáhnout v lepší kvalitě)

2. **Příliš mnoho falešných not?** Zkuste:
   - Zvýšit `--min-pixels` na 40-50
   - Zvýšit `--min-duration` na 0.1s

3. **Video nemá klávesnici?**
   - Program automaticky použije výchozí rozložení
   - Pro lepší výsledky použijte `--num-keys` s počtem kláves ve videu

## Otevření výstupů

- **MIDI** soubory otevřete v:
  - MuseScore (zdarma: musescore.org)
  - Synthesia (synthesiagame.com)
  - FL Studio, Ableton Live, GarageBand
  - Online: midi.show, flat.io

- **Notový zápis** (PNG) otevřete v jakémkoli prohlížeči obrázků

- **Textový seznam** otevřete v textovém editoru

## Příklad výstupu

```
output/
├── video.mp4                    # Stažené video
├── preview.jpg                  # Náhled s detekcí klávesnice
├── Moje_Skladba.mid             # MIDI soubor
├── Moje_Skladba_sheet.png       # Notový zápis
└── Moje_Skladba_notes.txt       # Textový seznam not
```

## Známé limity

- Videa s velmi nízkým rozlišením (< 360p) mohou mít horší přesnost
- Videa bez klávesnice nebo s neobvyklým layoutem vyžadují manuální úpravy
- Detekce tempa je přibližná - pro přesné tempo použijte `--tempo` parametr
- Černé klávesy jsou detekovány pouze pokud jsou výrazně tmavší než bílé

## Licence

Volně k použití pro osobní i komerční účely.

---

**Tip**: Pokud máte video s audiem (ne jen vizuální noty), můžete použít alternativní cestu:
```bash
pip install librosa
python audio_to_midi.py audio.wav
```
