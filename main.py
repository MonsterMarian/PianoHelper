"""
main.py - YouTube Piano Note Sheet Generator
=============================================

Hlavni skript pro prevod YouTube videi s padajicimi notami (Synthesia styl)
na notovy zapis (sheet music), MIDI soubor a textovy seznam not.

Pouziti:
    python main.py <youtube_url> [volby]

Priklad:
    python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI
    python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI --preview-only
    python main.py --local video.mp4
"""
import argparse
import os
import sys
import time
from pathlib import Path


def print_banner():
    print("=" * 60)
    print("  YouTube Piano -> Sheet Music Generator")
    print("  Prevod videi s notami na notovy zapis")
    print("=" * 60)


def print_step(step_num: int, title: str):
    print(f"\n{'─' * 50}")
    print(f"  Krok {step_num}: {title}")
    print(f"{'─' * 50}")


def main():
    parser = argparse.ArgumentParser(
        description='Prevod YouTube videi s padajicimi notami na notovy zapis',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Priklady:
  python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI
  python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI --output ./moje_noty
  python main.py --local video.mp4
  python main.py --local video.mp4 --audio --method basic-pitch
  python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI --preview-only
  python main.py https://www.youtube.com/watch?v=UVnXmLGu4cI --skip-sheet

GUI:
  streamlit run app.py
        """
    )
    
    parser.add_argument('url', nargs='?', help='YouTube URL videa')
    parser.add_argument('--local', '-l', help='Cesta k lokalnimu video souboru (preskoci stahovani)')
    parser.add_argument('--output', '-o', default='output', help='Vystupni slozka (default: output)')
    parser.add_argument('--preview-only', action='store_true', help='Pouze stahnout video a ulolit nahledovy snimek')
    parser.add_argument('--preview-time', type=float, default=10.0, help='Cas nahledoveho snimku v sekundach (default: 10)')
    parser.add_argument('--skip-sheet', action='store_true', help='Preskocit generovani notoveho zapisu')
    parser.add_argument('--skip-midi', action='store_true', help='Preskocit generovani MIDI')
    parser.add_argument('--frame-skip', type=int, default=2, help='Analyzovat kazdy N-ty snimek (default: 2)')
    parser.add_argument('--min-pixels', type=int, default=25, help='Minimalni pocet pixelu pro detekci noty (default: 25)')
    parser.add_argument('--min-duration', type=float, default=0.05, help='Minimalni delka noty v sekundach (default: 0.05)')
    parser.add_argument('--title', '-t', help='Nazev skladby (default: z nazvu videa)')
    parser.add_argument('--tempo', type=int, default=120, help='Tempo v BPM (default: 120)')
    parser.add_argument('--notes-per-staff', type=int, default=16, help='Pocet not na jeden radk (default: 16)')
    parser.add_argument('--audio', action='store_true', help='Pouzit audio->MIDI misto video detekce')
    parser.add_argument('--method', choices=['auto', 'basic-pitch', 'librosa'], default='auto',
                        help='Metoda audio detekce (s --audio): auto, basic-pitch, librosa')
    parser.add_argument('--mode', choices=['auto', 'synthesia', 'real_piano', 'tutorial', 'generic'],
                        default='auto', help='Typ videa: auto, synthesia, real_piano, tutorial, generic')
    parser.add_argument('--isolate-piano', action='store_true',
                        help='Izolovat piano z audio mixu (vyzaduje demucs/spleeter)')
    parser.add_argument('--remove-vocals', action='store_true',
                        help='Odstranit vocals pred detekci')
    parser.add_argument('--instrument', type=str, default=None,
                        help='Cilovy nastroj pro audio detekci (piano, guitar, vocals, atd.)')
    parser.add_argument('--detect-instrument', action='store_true',
                        help='Auto-detekovat dominantni nastroj v audiu')
    parser.add_argument('--separate-stems', action='store_true',
                        help='Separovat audio na stopy (vocals/drums/bass/other)')
    parser.add_argument('--verbose', '-v', action='store_true', help='Detailni logovani')
    
    args = parser.parse_args()
    
    # Validace
    if not args.url and not args.local:
        parser.error('Zadejte YouTube URL nebo --local <soubor>')
    
    print_banner()
    start_time = time.time()
    
    # Importy
    from video_downloader import download_video, get_video_info
    from note_detector import detect_notes_from_video, preview_frame, DetectorConfig
    from midi_generator import notes_to_midi, notes_to_text, get_note_statistics
    from sheet_renderer import SimpleSheetRenderer
    
    # Vystupni slozka
    output_dir = os.path.abspath(args.output)
    os.makedirs(output_dir, exist_ok=True)
    print(f"\nVystupni slozka: {output_dir}")
    
    # ── KROK 1: Ziskat video ──
    print_step(1, "Ziskani videa")
    
    video_path = None
    video_title = "Piano Notes"
    
    if args.local:
        # Lokalni soubor
        video_path = os.path.abspath(args.local)
        if not os.path.exists(video_path):
            print(f"  CHYBA: Soubor neexistuje: {video_path}")
            sys.exit(1)
        video_title = Path(video_path).stem
        print(f"  Lokalni video: {video_path}")
    else:
        # Stahnout z YouTube
        try:
            info = get_video_info(args.url)
            video_title = info.get('title', 'Piano Notes')
            print(f"  Nazev: {video_title}")
            
            video_path = download_video(args.url, output_dir)
        except Exception as e:
            print(f"  CHYBA pri stahovani: {e}")
            print(f"\n  Tip: Zkuste stahnout video rucne a pouzit --local <soubor>")
            sys.exit(1)
    
    title = args.title if args.title else video_title
    safe_title = "".join(c for c in title if c.isalnum() or c in ' -_').strip()[:50]
    
    # ── KROK 2: Nahled (volitelne) ──
    print_step(2, "Nahledovy snimek")
    
    preview_path = os.path.join(output_dir, "preview.jpg")
    try:
        preview_frame(video_path, preview_path, time_s=args.preview_time)
    except Exception as e:
        print(f"  Varovani: Nahled se nepodaril: {e}")
        preview_path = None
    
    if args.preview_only:
        elapsed = time.time() - start_time
        print(f"\n{'=' * 50}")
        print(f"  Hotovo! Nahled ulozen: {preview_path}")
        print(f"  Cas: {elapsed:.1f}s")
        return
    
    # ── KROK 3: Detekce not ──
    notes = []
    
    if args.audio:
        # Audio -> MIDI cesta
        print_step(3, "Extrakce audia a detekce not (audio)")
        
        from audio_to_midi import (extract_audio_from_video, audio_file_to_midi,
                                     video_to_midi, separate_stems)
        
        # Stem separation (volitelne)
        if args.separate_stems:
            print("  Separuji audio na stopy...")
            audio_path = os.path.join(output_dir, f"{safe_title}.wav")
            audio_result = extract_audio_from_video(video_path, audio_path)
            if audio_result:
                stems_dir = os.path.join(output_dir, 'stems')
                stems = separate_stems(audio_result, stems_dir)
                print(f"  Separovano {len(stems)} stopy:")
                for name, path in stems.items():
                    print(f"    {name}: {path}")
            else:
                print("  Extrakce audia selhala, preskakuji stem separation")
        
        # Detekce nastroje (volitelne)
        detected_inst = None
        if args.detect_instrument:
            from audio_to_midi import detect_dominant_instrument
            audio_path = os.path.join(output_dir, f"{safe_title}.wav")
            audio_result = extract_audio_from_video(video_path, audio_path)
            if audio_result:
                detected_inst = detect_dominant_instrument(audio_result)
                print(f"  Detekovan nastroj: {detected_inst}")
        
        # Hlavni audio→MIDI pipeline
        audio_path = os.path.join(output_dir, f"{safe_title}.wav")
        midi_out = os.path.join(output_dir, f"{safe_title}.mid")
        
        result = video_to_midi(
            video_path, midi_out,
            output_dir=output_dir,
            tempo=args.tempo,
            method=args.method,
            isolate_piano=args.isolate_piano,
            remove_vocals=args.remove_vocals,
            instrument=args.instrument,
            detect_instrument=args.detect_instrument
        )
        
        notes = result.get('notes', [])
        if not notes:
            print("  Audio detekce nenasla zadne noty.")
        if result.get('detected_instrument'):
            print(f"  Detekovany nastroj: {result['detected_instrument']}")
    
    if not notes:
        # Fallback: video detekce (pokud audio selhalo nebo nebylo zadano)
        if args.audio:
            print("  Fallback: video detekce not...")
        
        print_step(3, "Detekce not z videa")
        
        config = DetectorConfig(
            frame_skip=args.frame_skip,
            min_note_pixels=args.min_pixels,
            min_note_duration=args.min_duration,
            video_mode=args.mode,
        )
        
        def progress(pct, msg):
            bar_len = 30
            filled = int(bar_len * pct / 100)
            bar = '█' * filled + '░' * (bar_len - filled)
            print(f"\r  [{bar}] {pct:5.1f}% | {msg}", end='', flush=True)
        
        try:
            notes = detect_notes_from_video(video_path, config=config, progress_callback=progress)
        except Exception as e:
            print(f"\n  CHYBA pri detekci: {e}")
            if args.verbose:
                import traceback
                traceback.print_exc()
            sys.exit(1)
    
    print()  # Novy radek po progress baru
    
    if not notes:
        print("\n  ZADNE NOTY NEBYLY DETEKOVANY!")
        print("  Mozne priciny:")
        print("  - Video nema Synthesia styl (padajici noty)")
        print("  - Nizke rozliseni videa - zkuste zvysit --min-pixels")
        print("  - Jiny styl notace - zkuste upravit --frame-skip")
        print(f"  - Zkuste zvysovat citlivost: --min-pixels 15 --frame-skip 1")
        sys.exit(1)
    
    # Statistiky
    stats = get_note_statistics(notes)
    print(f"\n  Statistiky detekce:")
    print(f"    Celkem not:    {stats['count']}")
    print(f"    Rozsah:        {stats['lowest_note']} - {stats['highest_note']}")
    print(f"    MIDI rozsah:   {stats['midi_min']} - {stats['midi_max']}")
    print(f"    Prumerna delka: {stats['avg_duration']:.2f}s")
    print(f"    Celkova delka: {stats['total_duration']:.1f}s")
    
    if stats.get('most_common'):
        print(f"    Nejcastejsi noty:")
        for name, count in stats['most_common'][:5]:
            print(f"      {name}: {count}x")
    
    # ── KROK 4: Export notoveho seznamu ──
    print_step(4, "Export seznamu not (text)")
    
    text_path = os.path.join(output_dir, f"{safe_title}_notes.txt")
    notes_to_text(notes, text_path, title=title)
    
    # ── KROK 5: MIDI ──
    midi_path = None
    if not args.skip_midi:
        print_step(5, "Generovani MIDI souboru")
        
        midi_path = os.path.join(output_dir, f"{safe_title}.mid")
        try:
            notes_to_midi(notes, midi_path, tempo=args.tempo, title=title)
        except Exception as e:
            print(f"  CHYBA pri generovani MIDI: {e}")
            midi_path = None
    else:
        print_step(5, "MIDI - PRESKOCENO")
    
    # ── KROK 6: Notovy zapis ──
    sheet_path = None
    if not args.skip_sheet:
        print_step(6, "Generovani notoveho zapisu")
        
        sheet_path = os.path.join(output_dir, f"{safe_title}_sheet.png")
        try:
            renderer = SimpleSheetRenderer(notes_per_staff=args.notes_per_staff)
            renderer.render(notes, sheet_path, title=title, tempo=args.tempo)
        except Exception as e:
            print(f"  CHYBA pri generovani zapisu: {e}")
            if args.verbose:
                import traceback
                traceback.print_exc()
            sheet_path = None
    else:
        print_step(6, "Notovy zapis - PRESKOCENO")
    
    # ── Zaver ──
    elapsed = time.time() - start_time
    
    print(f"\n{'=' * 50}")
    print(f"  HOTOVO!")
    print(f"{'=' * 50}")
    print(f"\n  Vystupy:")
    print(f"    Nahled:    {preview_path or 'N/A'}")
    print(f"    Seznam not: {text_path}")
    if midi_path:
        print(f"    MIDI:      {midi_path}")
    if sheet_path:
        print(f"    Notovy zapis: {sheet_path}")
    print(f"\n  Celkovy cas: {elapsed:.1f}s")
    print(f"\n  Tip: MIDI soubor muzete otevrit v:")
    print(f"    - MuseScore (zdarma: musescore.org)")
    print(f"    - Synthesia (synthesiagame.com)")
    print(f"    - FL Studio, Ableton Live, GarageBand")
    print(f"    - Online: midi.show, flat.io")


if __name__ == '__main__':
    main()
