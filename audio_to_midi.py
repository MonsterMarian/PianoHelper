"""
audio_to_midi.py - Alternativni cesta: extrakce audia z videa a prevod na MIDI.

Podporuje dve metody pitch detection:
1. basic-pitch (Spotify) — polyfonni, presnejsi, doporuceno
2. librosa pyin — monofonni, rychlejsi, ale mene presne

Audio extrakce z videa pres ffmpeg (pokud je dostupny) nebo yt-dlp.
"""
import os
import subprocess
import tempfile
import numpy as np
from typing import List, Optional
from note_detector import DetectedNote


def extract_audio_from_video(video_path: str, audio_path: str, sample_rate: int = 22050) -> str:
    """
    Extrahuje audio z videa do WAV souboru.

    Zkusi ffmpeg, pokud selze, zkusi yt-dlp (pro YouTube URL).
    Pro lokalni soubory bez ffmpeg vrati prazdny string.

    Args:
        video_path: Cesta k video souboru
        audio_path: Cesta pro ulozeni WAV
        sample_rate: Pozadovany sample rate

    Returns:
        Cesta k ulozenemu WAV, nebo prazdny string pri selhani
    """
    os.makedirs(os.path.dirname(audio_path) if os.path.dirname(audio_path) else '.', exist_ok=True)

    # Metoda 1: ffmpeg (nejspolehlivejsi)
    if _ffmpeg_available():
        try:
            cmd = [
                'ffmpeg', '-y', '-i', video_path,
                '-vn',                    # zadne video
                '-acodec', 'pcm_s16le',   # WAV format
                '-ar', str(sample_rate),  # sample rate
                '-ac', '1',               # mono
                audio_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode == 0 and os.path.exists(audio_path):
                print(f"  Audio extrahovano (ffmpeg): {audio_path}")
                return audio_path
            else:
                print(f"  ffmpeg selhal: {result.stderr[:200] if result.stderr else 'neznama chyba'}")
        except subprocess.TimeoutExpired:
            print("  ffmpeg timeout")
        except Exception as e:
            print(f"  ffmpeg chyba: {e}")

    # Metoda 2: yt-dlp extrakce audia (pro URL-like vstupy)
    if _ytdlp_available():
        try:
            cmd = [
                'python', '-m', 'yt_dlp',
                '-x', '--audio-format', 'wav',
                '-o', audio_path,
                '--no-playlist',
                video_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode == 0:
                # yt-dlp muze ulozit s jinou priponou
                for ext in ['.wav', '.mp3', '.m4a', '.opus']:
                    candidate = audio_path.rsplit('.', 1)[0] + ext
                    if os.path.exists(candidate):
                        if candidate != audio_path:
                            # Prekonvertovat na WAV pokud je treba
                            if _ffmpeg_available() and ext != '.wav':
                                conv_cmd = [
                                    'ffmpeg', '-y', '-i', candidate,
                                    '-acodec', 'pcm_s16le', '-ar', str(sample_rate),
                                    '-ac', '1', audio_path
                                ]
                                subprocess.run(conv_cmd, capture_output=True, timeout=120)
                                os.remove(candidate)
                                if os.path.exists(audio_path):
                                    print(f"  Audio extrahovano (yt-dlp + ffmpeg): {audio_path}")
                                    return audio_path
                            else:
                                print(f"  Audio extrahovano (yt-dlp): {candidate}")
                                return candidate
        except Exception as e:
            print(f"  yt-dlp chyba: {e}")

    print("  Audio extrakce selhala — instaluj ffmpeg: https://ffmpeg.org/download.html")
    return ""


def audio_file_to_midi(
    audio_path: str,
    output_midi_path: str,
    sample_rate: int = 22050,
    tempo: int = 120,
    method: str = 'auto'
) -> List[DetectedNote]:
    """
    Prevede audio WAV soubor na MIDI pomoci pitch detection.

    Metody:
        'basic-pitch' — Spotify basic-pitch, polyfonni, doporuceno
        'librosa'     — librosa pyin, monofonni, rychlejsi
        'auto'        — zkusit basic-pitch, fallback na librosa

    Args:
        audio_path: Cesta k WAV souboru
        output_midi_path: Cesta pro MIDI vystup
        sample_rate: Sample rate audia
        tempo: Tempo v BPM
        method: Metoda detekce ('basic-pitch', 'librosa', 'auto')

    Returns:
        Seznam detekovanych not
    """
    if not os.path.exists(audio_path):
        print(f"  Audio soubor neexistuje: {audio_path}")
        return []

    notes = []

    # Zkusit basic-pitch (doporuceno)
    if method in ('auto', 'basic-pitch'):
        notes = _detect_with_basic_pitch(audio_path, sample_rate)
        if notes:
            print(f"  Detekce (basic-pitch): {len(notes)} not")
            _save_midi(notes, output_midi_path, tempo)
            return notes
        elif method == 'basic-pitch':
            print("  basic-pitch selhal nebo neni nainstalovan")
            return []

    # Fallback: librosa
    if method in ('auto', 'librosa'):
        notes = _detect_with_librosa(audio_path, sample_rate)
        if notes:
            print(f"  Detekce (librosa): {len(notes)} not")
            _save_midi(notes, output_midi_path, tempo)
            return notes
        elif method == 'librosa':
            print("  librosa selhala nebo neni nainstalovana")
            return []

    print("  Zadna metoda detekce neni dostupna.")
    print("  Instaluj: pip install basic-pitch  (doporuceno)")
    print("  Nebo:     pip install librosa")
    return []


def _detect_with_basic_pitch(audio_path: str, sample_rate: int) -> List[DetectedNote]:
    """Pitch detection pomoci Spotify basic-pitch (polyfonni)."""
    try:
        from basic_pitch.inference import predict
        from basic_pitch import ICASSP_2022_MODEL_PATH
    except ImportError:
        print("  basic-pitch neni nainstalovan (pip install basic-pitch)")
        return []

    try:
        print("  Analyzuji audio (basic-pitch)...")
        model_output, midi_data, note_events = predict(
            audio_path,
            onset_threshold=0.5,
            frame_threshold=0.3,
            minimum_note_length=58,  # ms
            minimum_frequency=65.0,   # C2
            maximum_frequency=2100.0, # C7
            multiple_pitch_classes_allowed=True,
        )

        notes = []
        for event in note_events:
            start_time = event.start_time_seconds
            end_time = event.end_time_seconds
            midi_note = event.pitch_midi
            amplitude = event.amplitude if hasattr(event, 'amplitude') else 0.5
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


def _detect_with_librosa(audio_path: str, sample_rate: int) -> List[DetectedNote]:
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
    """Ulozi noty do MIDI souboru."""
    if not notes:
        return
    from midi_generator import notes_to_midi
    notes_to_midi(notes, output_path, tempo=tempo, title="Audio to MIDI")


def _ffmpeg_available() -> bool:
    """Zkontroluje dostupnost ffmpeg."""
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _ytdlp_available() -> bool:
    """Zkontroluje dostupnost yt-dlp."""
    try:
        subprocess.run(['python', '-m', 'yt_dlp', '--version'],
                      capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def check_dependencies() -> dict:
    """Zkontroluje dostupnost vsech zavislosti pro audio->MIDI."""
    status = {}

    status['ffmpeg'] = _ffmpeg_available()
    status['yt-dlp'] = _ytdlp_available()

    try:
        import librosa
        status['librosa'] = True
        status['librosa_version'] = librosa.__version__
    except ImportError:
        status['librosa'] = False

    try:
        from basic_pitch.inference import predict
        status['basic-pitch'] = True
    except ImportError:
        status['basic-pitch'] = False

    return status


if __name__ == '__main__':
    import sys

    print("Audio to MIDI converter")
    print("=" * 40)

    deps = check_dependencies()
    print("\nZavislosti:")
    for name, available in deps.items():
        icon = "OK" if available else "CHYBI"
        print(f"  [{icon}] {name}")

    print(f"\nPouziti:")
    print(f"  python audio_to_midi.py <audio.wav> [method]")
    print(f"  method: auto (default), basic-pitch, librosa")

    if len(sys.argv) > 1:
        audio_file = sys.argv[1]
        method = sys.argv[2] if len(sys.argv) > 2 else 'auto'
        if os.path.exists(audio_file):
            output = audio_file.rsplit('.', 1)[0] + '.mid'
            notes = audio_file_to_midi(audio_file, output, method=method)
            print(f"\nVysledek: {len(notes)} not -> {output}")
        else:
            print(f"Soubor neexistuje: {audio_file}")
