"""
audio_to_midi.py - Audio extrakce a prevod na MIDI.

Podporuje:
- Video s padajicimi notami (Synthesia styl) — video detekce
- Video s audiem (bez not) — audio→MIDI s volitelnou izolaci piana
- Ciste audio soubory — prime audio→MIDI
- Vice nastroju — source separation (Demucs/Spleeter) + instrument detection

Metody pitch detection:
1. basic-pitch (Spotify) — polyfonni, presne, doporuceno
2. librosa pyin — monofonni, rychlejsi

Audio extrakce z videa pres ffmpeg.
"""
import os
import subprocess
import tempfile
import numpy as np
from typing import List, Optional, Dict
from note_detector import DetectedNote


# ── Audio extrakce z videa ──────────────────────────────────────────────────

def extract_audio_from_video(
    video_path: str,
    audio_path: str,
    sample_rate: int = 22050
) -> str:
    """
    Extrahuje audio z videa do WAV souboru.

    Args:
        video_path: Cesta k video souboru
        audio_path: Cesta pro ulozeni WAV
        sample_rate: Pozadovany sample rate

    Returns:
        Cesta k ulozenemu WAV, nebo prazdny string pri selhani
    """
    os.makedirs(os.path.dirname(audio_path) if os.path.dirname(audio_path) else '.', exist_ok=True)

    if _ffmpeg_available():
        try:
            cmd = [
                'ffmpeg', '-y', '-i', video_path,
                '-vn', '-acodec', 'pcm_s16le',
                '-ar', str(sample_rate), '-ac', '1',
                audio_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode == 0 and os.path.exists(audio_path):
                print(f"  Audio extrahovano (ffmpeg): {audio_path}")
                return audio_path
            print(f"  ffmpeg selhal: {result.stderr[:200] if result.stderr else 'neznama chyba'}")
        except subprocess.TimeoutExpired:
            print("  ffmpeg timeout")
        except Exception as e:
            print(f"  ffmpeg chyba: {e}")

    if _ytdlp_available():
        try:
            cmd = [
                'python', '-m', 'yt_dlp',
                '-x', '--audio-format', 'wav',
                '-o', audio_path,
                '--no-playlist', video_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode == 0:
                for ext in ['.wav', '.mp3', '.m4a', '.opus']:
                    candidate = audio_path.rsplit('.', 1)[0] + ext
                    if os.path.exists(candidate):
                        if candidate != audio_path and _ffmpeg_available() and ext != '.wav':
                            conv_cmd = [
                                'ffmpeg', '-y', '-i', candidate,
                                '-acodec', 'pcm_s16le', '-ar', str(sample_rate),
                                '-ac', '1', audio_path
                            ]
                            subprocess.run(conv_cmd, capture_output=True, timeout=120)
                            os.remove(candidate)
                            if os.path.exists(audio_path):
                                return audio_path
                        else:
                            return candidate
        except Exception as e:
            print(f"  yt-dlp chyba: {e}")

    print("  Audio extrakce selhala — instaluj ffmpeg")
    return ""


# ── Hlavni funkce: audio→MIDI ──────────────────────────────────────────────

def audio_file_to_midi(
    audio_path: str,
    output_midi_path: str,
    sample_rate: int = 22050,
    tempo: int = 120,
    method: str = 'auto',
    isolate_piano: bool = False,
    remove_vocals: bool = False,
    instrument: Optional[str] = None
) -> List[DetectedNote]:
    """
    Prevede audio na MIDI.

    Args:
        audio_path: Cesta k audio souboru (WAV/MP3/etc.)
        output_midi_path: Cesta pro MIDI vystup
        sample_rate: Sample rate
        tempo: Tempo v BPM
        method: 'basic-pitch', 'librosa', 'auto'
        isolate_piano: True = izolovat piano z mixu pred detekci
        remove_vocals: True = odstranit vocals pred detekci
        instrument: Specificky nastroj k detekci ('piano', 'guitar', 'vocals', etc.)

    Returns:
        Seznam detekovanych not
    """
    if not os.path.exists(audio_path):
        print(f"  Audio soubor neexistuje: {audio_path}")
        return []

    working_audio = audio_path

    # Source separation pokud je pozadovano
    if isolate_piano or remove_vocals or instrument:
        working_audio = _preprocess_audio(
            audio_path,
            isolate_piano=isolate_piano,
            remove_vocals=remove_vocals,
            target_instrument=instrument
        )
        if not working_audio:
            print("  Preprocessing selhal, pokracuji s originalnim audiem")
            working_audio = audio_path

    # Detekce not
    notes = _detect_notes(working_audio, method)

    # Cleanup docasnych souboru
    if working_audio != audio_path and os.path.exists(working_audio):
        try:
            os.remove(working_audio)
        except OSError:
            pass

    if notes:
        print(f"  Detekovano: {len(notes)} not")
        _save_midi(notes, output_midi_path, tempo)

    return notes


def video_to_midi(
    video_path: str,
    output_midi_path: str,
    output_dir: Optional[str] = None,
    tempo: int = 120,
    method: str = 'auto',
    isolate_piano: bool = False,
    remove_vocals: bool = False,
    instrument: Optional[str] = None,
    detect_instrument: bool = False
) -> Dict:
    """
    Kompletni pipeline: video → audio → MIDI.

    Args:
        video_path: Cesta k videu
        output_midi_path: Cesta pro MIDI
        output_dir: Slozka pro docasne soubory
        tempo: BPM
        method: Metoda detekce
        isolate_piano: Izolovat piano
        remove_vocals: Odstranit vocals
        instrument: Cilovy nastroj
        detect_instrument: Automaticky detekovat nastroj

    Returns:
        Dict s vysledky: {'notes': [...], 'midi_path': '...', 'detected_instrument': '...'}
    """
    if not output_dir:
        output_dir = os.path.dirname(output_midi_path) or '.'
    os.makedirs(output_dir, exist_ok=True)

    result = {
        'notes': [],
        'midi_path': '',
        'audio_path': '',
        'detected_instrument': None,
        'stems': {}
    }

    # Krok 1: Extrakce audia
    audio_path = os.path.join(output_dir, 'extracted_audio.wav')
    audio_result = extract_audio_from_video(video_path, audio_path)

    if not audio_result:
        print("  Extrakce audia selhala")
        return result

    result['audio_path'] = audio_result

    # Krok 2: Detekce nastroje (volitelne)
    if detect_instrument:
        print("  Detekuji dominantni nastroj...")
        detected = detect_dominant_instrument(audio_result)
        result['detected_instrument'] = detected
        print(f"  Detekovano: {detected}")

        # Auto-nastaveni izolace
        if detected == 'piano':
            isolate_piano = False  # Piano je uz dominantni
        elif detected in ('vocals', 'drums'):
            remove_vocals = True if detected == 'vocals' else False

    # Krok 3: Source separation (volitelne)
    working_audio = audio_result
    if isolate_piano or remove_vocals:
        print("  Separuji nastroje...")
        if isolate_piano:
            piano_path = os.path.join(output_dir, 'piano_isolated.wav')
            isolated = isolate_piano_from_audio(audio_result, piano_path)
            if isolated:
                working_audio = isolated
        elif remove_vocals:
            instrumental_path = os.path.join(output_dir, 'instrumental.wav')
            no_vocals = remove_vocals_from_audio(audio_result, instrumental_path)
            if no_vocals:
                working_audio = no_vocals

    # Krok 4: Pitch detection
    notes = _detect_notes(working_audio, method)

    # Cleanup
    if working_audio != audio_result and os.path.exists(working_audio):
        try:
            os.remove(working_audio)
        except OSError:
            pass

    if notes:
        _save_midi(notes, output_midi_path, tempo)
        result['notes'] = notes
        result['midi_path'] = output_midi_path

    return result


# ── Internal helpers ────────────────────────────────────────────────────────

def _preprocess_audio(
    audio_path: str,
    isolate_piano: bool = False,
    remove_vocals: bool = False,
    target_instrument: Optional[str] = None
) -> str:
    """Preprocess audia pred detekci — izolace/filtrace."""
    output_dir = os.path.dirname(audio_path) or tempfile.gettempdir()

    if target_instrument:
        # Detekce konkretniho nastroje
        print(f"  Cilovy nastroj: {target_instrument}")
        # Pro ted pouzijeme bandpass filtr pro dany rozsah
        from instrument_separator import INSTRUMENT_RANGES, bandpass_filter_piano
        if target_instrument in INSTRUMENT_RANGES:
            low, high = INSTRUMENT_RANGES[target_instrument]
            filtered = os.path.join(output_dir, f'filtered_{target_instrument}.wav')
            result = bandpass_filter_piano(audio_path, filtered, low, high)
            if result:
                return result

    if isolate_piano:
        from instrument_separator import isolate_piano as iso_piano
        piano_out = os.path.join(output_dir, 'piano_isolated.wav')
        result = iso_piano(audio_path, piano_out)
        if result:
            return result

    if remove_vocals:
        from instrument_separator import remove_instrument
        inst_out = os.path.join(output_dir, 'no_vocals.wav')
        result = remove_instrument(audio_path, inst_out, 'vocals')
        if result:
            return result

    return audio_path


def _detect_notes(audio_path: str, method: str = 'auto') -> List[DetectedNote]:
    """Detekce not z audia."""
    notes = []

    # basic-pitch (polyfonni, doporuceno)
    if method in ('auto', 'basic-pitch'):
        notes = _detect_with_basic_pitch(audio_path)
        if notes:
            print(f"  Detekce (basic-pitch): {len(notes)} not")
            return notes
        elif method == 'basic-pitch':
            print("  basic-pitch selhal nebo neni nainstalovan")
            return []

    # librosa fallback
    if method in ('auto', 'librosa'):
        notes = _detect_with_librosa(audio_path)
        if notes:
            print(f"  Detekce (librosa): {len(notes)} not")
            return notes
        elif method == 'librosa':
            print("  librosa selhala nebo neni nainstalovana")
            return []

    print("  Zadna metoda detekce neni dostupna.")
    print("  Instaluj: pip install basic-pitch  (doporuceno)")
    print("  Nebo:     pip install librosa")
    return []


def _detect_with_basic_pitch(audio_path: str) -> List[DetectedNote]:
    """Polyfonni pitch detection pomoci Spotify basic-pitch."""
    try:
        from basic_pitch.inference import predict
    except ImportError:
        print("  basic-pitch neni nainstalovan (pip install basic-pitch)")
        return []

    try:
        print("  Analyzuji audio (basic-pitch)...")
        model_output, midi_data, note_events = predict(
            audio_path,
            onset_threshold=0.5,
            frame_threshold=0.3,
            minimum_note_length=58,
            minimum_frequency=27.5,    # A0
            maximum_frequency=4186.0,  # C8
            multiple_pitch_classes_allowed=True,
        )

        notes = []
        for event in note_events:
            start_time = event.start_time_seconds
            end_time = event.end_time_seconds
            midi_note = event.pitch_midi
            amplitude = getattr(event, 'amplitude', 0.5)
            velocity = int(min(127, max(30, amplitude * 127)))

            if end_time - start_time >= 0.05:
                notes.append(DetectedNote(
                    midi_note=midi_note,
                    start_time=start_time,
                    end_time=end_time,
                    velocity=velocity,
                    confidence=amplitude
                ))

        return sorted(notes, key=lambda n: n.start_time)

    except Exception as e:
        print(f"  basic-pitch chyba: {e}")
        return []


def _detect_with_librosa(audio_path: str, sample_rate: int = 22050) -> List[DetectedNote]:
    """Monofonni pitch detection pomoci librosa pyin."""
    try:
        import librosa
    except ImportError:
        print("  librosa neni nainstalovana (pip install librosa)")
        return []

    try:
        print(f"  Nacitam audio: {audio_path}")
        y, sr = librosa.load(audio_path, sr=sample_rate)
        duration = len(y) / sr
        print(f"  Delka audia: {duration:.1f}s, sample rate: {sr}")

        print("  Analyzuji pitch (pyin)...")
        f0, voiced_flag, voiced_probs = librosa.pyin(
            y,
            fmin=librosa.note_to_hz('A1'),
            fmax=librosa.note_to_hz('C7'),
            sr=sr
        )

        hop_length = 512
        frame_time = hop_length / sr

        notes = []
        current_note = None

        for i, (freq, is_voiced) in enumerate(zip(f0, voiced_flag)):
            time_s = i * frame_time

            if is_voiced and freq > 0:
                midi_note = int(np.round(librosa.hz_to_midi(freq)))
                midi_note = max(21, min(108, midi_note))

                if current_note is None or current_note['midi'] != midi_note:
                    if current_note is not None:
                        current_note['end'] = time_s
                        dur = current_note['end'] - current_note['start']
                        if dur >= 0.05:
                            notes.append(DetectedNote(
                                midi_note=current_note['midi'],
                                start_time=current_note['start'],
                                end_time=current_note['end'],
                                velocity=80
                            ))
                    current_note = {'midi': midi_note, 'start': time_s, 'end': time_s}
                else:
                    current_note['end'] = time_s
            else:
                if current_note is not None:
                    current_note['end'] = time_s
                    dur = current_note['end'] - current_note['start']
                    if dur >= 0.05:
                        notes.append(DetectedNote(
                            midi_note=current_note['midi'],
                            start_time=current_note['start'],
                            end_time=current_note['end'],
                            velocity=80
                        ))
                    current_note = None

        if current_note is not None:
            current_note['end'] = duration
            dur = current_note['end'] - current_note['start']
            if dur >= 0.05:
                notes.append(DetectedNote(
                    midi_note=current_note['midi'],
                    start_time=current_note['start'],
                    end_time=current_note['end'],
                    velocity=80
                ))

        return sorted(notes, key=lambda n: n.start_time)

    except Exception as e:
        print(f"  librosa chyba: {e}")
        return []


def _save_midi(notes: List[DetectedNote], output_path: str, tempo: int = 120):
    """Ulozi noty do MIDI."""
    if not notes:
        return
    from midi_generator import notes_to_midi
    notes_to_midi(notes, output_path, tempo=tempo, title="Audio to MIDI")


# ── Public API pro instrument separation ────────────────────────────────────

def isolate_piano_from_audio(audio_path: str, output_path: str) -> str:
    """Public wrapper pro piano isolation."""
    from instrument_separator import isolate_piano
    return isolate_piano(audio_path, output_path)


def remove_vocals_from_audio(audio_path: str, output_path: str) -> str:
    """Public wrapper pro vocal removal."""
    from instrument_separator import remove_instrument
    return remove_instrument(audio_path, output_path, 'vocals')


def detect_dominant_instrument(audio_path: str) -> str:
    """Public wrapper pro instrument detection."""
    from instrument_separator import detect_dominant_instrument
    return detect_dominant_instrument(audio_path)


def separate_stems(audio_path: str, output_dir: str, method: str = 'demucs') -> dict:
    """
    Separuje audio na jednotlive stopy.

    Args:
        audio_path: Vstupni audio
        output_dir: Vystupni slozka
        method: 'demucs' nebo 'spleeter'

    Returns:
        Dict {'vocals': '...', 'drums': '...', 'bass': '...', 'other': '...'}
    """
    from instrument_separator import separate_with_demucs, separate_with_spleeter

    if method == 'demucs':
        return separate_with_demucs(audio_path, output_dir)
    elif method == 'spleeter':
        return separate_with_spleeter(audio_path, output_dir)
    else:
        # Zkusit oboje
        result = separate_with_demucs(audio_path, output_dir)
        if not result:
            result = separate_with_spleeter(audio_path, output_dir)
        return result


# ── Dependency checks ────────────────────────────────────────────────────────

def _ffmpeg_available() -> bool:
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _ytdlp_available() -> bool:
    try:
        subprocess.run(['python', '-m', 'yt_dlp', '--version'],
                      capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def check_dependencies() -> dict:
    """Kompletni check vsech zavislosti."""
    status = {}

    status['ffmpeg'] = _ffmpeg_available()
    status['yt-dlp'] = _ytdlp_available()

    try:
        from basic_pitch.inference import predict
        status['basic-pitch'] = True
    except ImportError:
        status['basic-pitch'] = False

    try:
        import librosa
        status['librosa'] = True
    except ImportError:
        status['librosa'] = False

    # Instrument separator deps
    try:
        from instrument_separator import check_dependencies as sep_check
        sep_status = sep_check()
        status.update(sep_status)
    except ImportError:
        pass

    return status


if __name__ == '__main__':
    import sys

    print("Audio to MIDI converter v2")
    print("=" * 40)

    deps = check_dependencies()
    print("\nZavislosti:")
    for name, available in deps.items():
        icon = "OK" if available else "CHYBI"
        print(f"  [{icon}] {name}")

    print(f"\nPouziti:")
    print(f"  python audio_to_midi.py <audio|video> [options]")
    print(f"  Options:")
    print(f"    --method auto|basic-pitch|librosa")
    print(f"    --isolate-piano    (separovat piano z mixu)")
    print(f"    --remove-vocals    (odstranit zpev)")
    print(f"    --instrument NAME  (detekovat konkretni nastroj)")
    print(f"    --detect           (auto-detekovat nastroj)")

    if len(sys.argv) > 1:
        audio_file = sys.argv[1]
        method = 'auto'
        isolate = False
        remove_voc = False
        instrument = None
        detect = False

        i = 2
        while i < len(sys.argv):
            if sys.argv[i] == '--method' and i + 1 < len(sys.argv):
                method = sys.argv[i + 1]
                i += 2
            elif sys.argv[i] == '--isolate-piano':
                isolate = True
                i += 1
            elif sys.argv[i] == '--remove-vocals':
                remove_voc = True
                i += 1
            elif sys.argv[i] == '--instrument' and i + 1 < len(sys.argv):
                instrument = sys.argv[i + 1]
                i += 2
            elif sys.argv[i] == '--detect':
                detect = True
                i += 1
            else:
                i += 1

        if os.path.exists(audio_file):
            ext = os.path.splitext(audio_file)[1].lower()
            is_video = ext in ['.mp4', '.mkv', '.webm', '.avi', '.mov']
            output = os.path.splitext(audio_file)[0] + '.mid'

            if is_video:
                result = video_to_midi(
                    audio_file, output,
                    method=method,
                    isolate_piano=isolate,
                    remove_vocals=remove_voc,
                    instrument=instrument,
                    detect_instrument=detect
                )
                print(f"\nVysledek: {len(result['notes'])} not -> {result['midi_path']}")
                if result['detected_instrument']:
                    print(f"Detekovany nastroj: {result['detected_instrument']}")
            else:
                notes = audio_file_to_midi(
                    audio_file, output,
                    method=method,
                    isolate_piano=isolate,
                    remove_vocals=remove_voc,
                    instrument=instrument
                )
                print(f"\nVysledek: {len(notes)} not -> {output}")
        else:
            print(f"Soubor neexistuje: {audio_file}")
