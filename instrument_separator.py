"""
instrument_separator.py - Source separation pro izolaci nastroju z mixu.

Podporuje:
1. Demucs (Meta Research) — nejlepsi kvalita, 4-stem separation
2. Spleeter (Deezer) — jednodussi, rychlejsi, 2/4/5-stem

Pouziti:
    python instrument_separator.py audio.wav --mode piano
    python instrument_separator.py audio.wav --mode stems
"""
import os
import subprocess
import tempfile
import numpy as np
from typing import Optional, Tuple
from pathlib import Path


# Piano frekvencni rozsah (A0-C8)
PIANO_FREQ_MIN = 27.5    # A0
PIANO_FREQ_MAX = 4186.0  # C8

# Typicke rozsahy nastroju (Hz)
INSTRUMENT_RANGES = {
    'piano': (27.5, 4186.0),
    'vocals': (80.0, 1200.0),      # Fundamentalni frekvence
    'guitar': (82.4, 1318.5),      # E2-E6
    'bass': (41.2, 392.0),         # E1-G4
    'drums': (20.0, 15000.0),      # Siroky rozsah
    'strings': (65.4, 2093.0),     # C2-C7
    'brass': (58.3, 1174.7),       # Bb1-D6
    'woodwind': (130.8, 2093.0),   # C3-C7
}


def separate_with_demucs(
    audio_path: str,
    output_dir: str,
    model: str = 'htdemucs'
) -> dict:
    """
    Separuje audio na 4 stopy pomoci Demucs:
    - vocals (zpev)
    - drums (bubny)
    - bass (basa)
    - other (ostatni nastroje vcetne piana)

    Args:
        audio_path: Cesta k audio souboru
        output_dir: Slozka pro vystupy
        model: Demucs model ('htdemucs', 'htdemucs_ft', 'hdemucs_mmi')

    Returns:
        Dict s cestami k separatnym stopam:
        {'vocals': '...', 'drums': '...', 'bass': '...', 'other': '...'}
    """
    if not _demucs_available():
        print("  Demucs neni nainstalovan (pip install demucs)")
        return {}

    try:
        print(f"  Separuji audio (Demucs model: {model})...")

        cmd = [
            'python', '-m', 'demucs',
            '--two-stems', 'none',  # Plna separace (4 stopy)
            '-n', model,
            '--mp3',                # Ulozit jako MP3 (mensi soubory)
            '--mp3-bitrate', '320',
            '-o', output_dir,
            audio_path
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=1800  # 30 minut max
        )

        if result.returncode != 0:
            print(f"  Demucs selhal: {result.stderr[:300]}")
            return {}

        # Najit vystupni soubory
        audio_stem = Path(audio_path).stem
        stems_dir = os.path.join(output_dir, model, audio_stem)

        if not os.path.exists(stems_dir):
            print(f"  Vystupni slozka neexistuje: {stems_dir}")
            return {}

        stems = {}
        for stem_name in ['vocals', 'drums', 'bass', 'other']:
            for ext in ['.mp3', '.wav']:
                stem_path = os.path.join(stems_dir, f"{stem_name}{ext}")
                if os.path.exists(stem_path):
                    stems[stem_name] = stem_path
                    break

        print(f"  Separace hotova: {len(stems)} stopy")
        return stems

    except subprocess.TimeoutExpired:
        print("  Demucs timeout (30min)")
        return {}
    except Exception as e:
        print(f"  Demucs chyba: {e}")
        return {}


def separate_with_spleeter(
    audio_path: str,
    output_dir: str,
    stems: int = 4
) -> dict:
    """
    Separuje audio pomoci Spleeter (Deezer).

    Args:
        audio_path: Cesta k audio souboru
        output_dir: Slozka pro vystupy
        stems: Pocet stopy (2, 4, nebo 5)

    Returns:
        Dict s cestami k separatnym stopam
    """
    if not _spleeter_available():
        print("  Spleeter neni nainstalovan (pip install spleeter)")
        return {}

    try:
        print(f"  Separuji audio (Spleeter {stems}-stems)...")

        cmd = [
            'python', '-m', 'spleeter', 'separate',
            '-p', f'spleeter:{stems}stems',
            '-o', output_dir,
            audio_path
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600
        )

        if result.returncode != 0:
            print(f"  Spleeter selhal: {result.stderr[:300]}")
            return {}

        audio_stem = Path(audio_path).stem
        stems_dir = os.path.join(output_dir, audio_stem)

        if not os.path.exists(stems_dir):
            print(f"  Vystupni slozka neexistuje: {stems_dir}")
            return {}

        separated = {}
        for stem_name in ['vocals', 'accompaniment', 'drums', 'bass', 'other', 'piano']:
            for ext in ['.wav', '.mp3']:
                stem_path = os.path.join(stems_dir, f"{stem_name}{ext}")
                if os.path.exists(stem_path):
                    separated[stem_name] = stem_path
                    break

        print(f"  Separace hotova: {len(separated)} stopy")
        return separated

    except subprocess.TimeoutExpired:
        print("  Spleeter timeout")
        return {}
    except Exception as e:
        print(f"  Spleeter chyba: {e}")
        return {}


def isolate_piano(
    audio_path: str,
    output_path: str,
    method: str = 'auto'
) -> str:
    """
    Izoluje piano z audio mixu.

    Strategie:
    1. Demucs 4-stem -> 'other' stopa obsahuje piano
    2. Spleeter 2-stem -> 'accompaniment' obsahuje piano
    3. Bandpass filtr (fallback) -> frekvencni rozsah piana

    Args:
        audio_path: Cesta k audio souboru
        output_path: Cesta pro ulozeni isolovaneho piana
        method: 'demucs', 'spleeter', 'bandpass', 'auto'

    Returns:
        Cesta k isolovanemu pianu, nebo prazdny string
    """
    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else '.', exist_ok=True)

    if method in ('auto', 'demucs') and _demucs_available():
        with tempfile.TemporaryDirectory() as tmp_dir:
            stems = separate_with_demucs(audio_path, tmp_dir)
            if 'other' in stems:
                # 'other' obsahuje piano + jine nastroje
                # Konvertovat na WAV pro dalsi zpracovani
                if _ffmpeg_available():
                    cmd = [
                        'ffmpeg', '-y', '-i', stems['other'],
                        '-acodec', 'pcm_s16le', '-ar', '22050', '-ac', '1',
                        output_path
                    ]
                    result = subprocess.run(cmd, capture_output=True, timeout=120)
                    if result.returncode == 0 and os.path.exists(output_path):
                        print(f"  Piano isolovano (Demucs): {output_path}")
                        return output_path

    if method in ('auto', 'spleeter') and _spleeter_available():
        with tempfile.TemporaryDirectory() as tmp_dir:
            stems = separate_with_spleeter(audio_path, tmp_dir, stems=2)
            if 'accompaniment' in stems:
                if _ffmpeg_available():
                    cmd = [
                        'ffmpeg', '-y', '-i', stems['accompaniment'],
                        '-acodec', 'pcm_s16le', '-ar', '22050', '-ac', '1',
                        output_path
                    ]
                    result = subprocess.run(cmd, capture_output=True, timeout=120)
                    if result.returncode == 0 and os.path.exists(output_path):
                        print(f"  Piano isolovano (Spleeter): {output_path}")
                        return output_path

    # Fallback: bandpass filtr
    if method in ('auto', 'bandpass'):
        print("  Fallback: bandpass filtr (27.5-4186 Hz)")
        return bandpass_filter_piano(audio_path, output_path)

    print("  Zadna metoda separace neni dostupna")
    return ""


def bandpass_filter_piano(
    audio_path: str,
    output_path: str,
    lowcut: float = PIANO_FREQ_MIN,
    highcut: float = PIANO_FREQ_MAX
) -> str:
    """
    Aplikuje bandpass filtr pro izolaci piano frekvenci.

    Pouziva scipy.signal pro IIR filtr (Butterworth).

    Args:
        audio_path: Vstupni audio
        output_path: Vystupni audio
        lowcut: Dolni frekvencni hranice (Hz)
        highcut: Horni frekvencni hranice (Hz)

    Returns:
        Cesta k filtrovanemu audiu
    """
    try:
        from scipy.signal import butter, filtfilt
        import soundfile as sf
    except ImportError:
        print("  scipy/soundfile neni nainstalovan (pip install scipy soundfile)")
        return ""

    try:
        # Nacist audio
        data, sample_rate = sf.read(audio_path, dtype='float32')
        if len(data.shape) > 1:
            data = np.mean(data, axis=1)  # Stereo -> mono

        print(f"  Audio: {len(data)/sample_rate:.1f}s, {sample_rate} Hz")

        # Butterworth bandpass filtr (4. rad)
        nyquist = sample_rate / 2
        low = lowcut / nyquist
        high = highcut / nyquist

        # Ochrana proti Nyquist
        low = max(0.001, low)
        high = min(0.999, high)

        b, a = butter(4, [low, high], btype='band')

        # Aplikovat filtr (forward-backward pro zero-phase)
        filtered = filtfilt(b, a, data)

        # Ulozit
        sf.write(output_path, filtered, sample_rate)
        print(f"  Bandpass filtr hotov: {output_path}")
        return output_path

    except Exception as e:
        print(f"  Bandpass filtr selhal: {e}")
        return ""


def remove_instrument(
    audio_path: str,
    output_path: str,
    instrument: str = 'vocals'
) -> str:
    """
    Odstrani specificky nastroj z mixu (napr. vocals pro instrumental-only).

    Args:
        audio_path: Vstupni audio
        output_path: Vystupni audio
        instrument: Ktery nastroj odstranit ('vocals', 'drums', 'bass')

    Returns:
        Cesta k audio bez nastroje
    """
    if not _demucs_available():
        print("  Demucs neni nainstalovan")
        return ""

    with tempfile.TemporaryDirectory() as tmp_dir:
        stems = separate_with_demucs(audio_path, tmp_dir)

        if instrument not in stems:
            print(f"  Nastroj '{instrument}' nebyl detekovan")
            return ""

        # Sectist vsechny stopy KROME odstranovaneho nastroje
        keep_stems = [k for k in stems.keys() if k != instrument]

        if not keep_stems:
            print("  Zadna stopa k sektu")
            return ""

        # Mix pomoci ffmpeg amix
        inputs = []
        for stem in keep_stems:
            inputs.extend(['-i', stems[stem]])

        cmd = ['ffmpeg', '-y'] + inputs

        # amix filtr pro secteni
        filter_str = ''.join([f'[{i}]' for i in range(len(keep_stems))])
        filter_str += f'amix=inputs={len(keep_stems)}:duration=longest'

        cmd.extend(['-filter_complex', filter_str, '-y', output_path])

        result = subprocess.run(cmd, capture_output=True, timeout=300)
        if result.returncode == 0 and os.path.exists(output_path):
            print(f"  Nastroj '{instrument}' odstranen: {output_path}")
            return output_path

    return ""


def detect_dominant_instrument(audio_path: str) -> str:
    """
    Detekuje dominantni nastroj v audiu pomoci chroma features.

    Returns:
        Nazev nastroje ('piano', 'vocals', 'guitar', atd.) nebo 'unknown'
    """
    try:
        import librosa
        from sklearn.svm import SVC
    except ImportError:
        print("  librosa/sklearn neni nainstalovan")
        return 'unknown'

    try:
        y, sr = librosa.load(audio_path, sr=22050, duration=30)  # Prvnich 30s

        # Chroma features
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_mean = np.mean(chroma, axis=1)

        # Spectral centroid (jas zvuku)
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr)
        centroid_mean = np.mean(centroid)

        # Spectral rolloff
        rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr)
        rolloff_mean = np.mean(rolloff)

        # ZCR (zero-crossing rate) - perkusivni nastroje
        zcr = librosa.feature.zero_crossing_rate(y)
        zcr_mean = np.mean(zcr)

        # Jednoducha heuristika (bez ML modelu)
        # Piano: vyvazene chroma, stredni centroid, nizky ZCR
        # Vocals: silne chroma v C-E-F-G, vysoky centroid
        # Guitar: chroma v E-A-D-G-B-E, stredni centroid
        # Drums: velmi vysoky ZCR, nizke chroma

        if zcr_mean > 0.15:
            return 'drums'
        elif centroid_mean > 3000:
            return 'vocals'
        elif np.std(chroma_mean) < 0.3:  # Vyvazene chroma = piano/strings
            if rolloff_mean < 4000:
                return 'piano'
            else:
                return 'strings'
        else:
            # Najit nejvyssi chroma pitch class
            max_chroma_idx = np.argmax(chroma_mean)
            pitch_classes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
            dominant_pitch = pitch_classes[max_chroma_idx]

            # Guitar typicky ma silne E, A, D
            if dominant_pitch in ['E', 'A', 'D']:
                return 'guitar'
            elif dominant_pitch in ['C', 'G']:
                return 'piano'
            else:
                return 'unknown'

    except Exception as e:
        print(f"  Detekce nastroje selhala: {e}")
        return 'unknown'


def _demucs_available() -> bool:
    """Zkontroluje dostupnost Demucs."""
    try:
        subprocess.run(['python', '-m', 'demucs', '--help'],
                      capture_output=True, timeout=10)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _spleeter_available() -> bool:
    """Zkontroluje dostupnost Spleeter."""
    try:
        subprocess.run(['python', '-m', 'spleeter', '--help'],
                      capture_output=True, timeout=10)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def check_dependencies() -> dict:
    """Zkontroluje dostupnost vsech zavislosti."""
    status = {}

    status['demucs'] = _demucs_available()
    status['spleeter'] = _spleeter_available()

    try:
        import scipy
        status['scipy'] = True
    except ImportError:
        status['scipy'] = False

    try:
        import soundfile
        status['soundfile'] = True
    except ImportError:
        status['soundfile'] = False

    try:
        import librosa
        status['librosa'] = True
    except ImportError:
        status['librosa'] = False

    try:
        from sklearn.svm import SVC
        status['sklearn'] = True
    except ImportError:
        status['sklearn'] = False

    return status


if __name__ == '__main__':
    import sys

    print("Instrument Separator")
    print("=" * 40)

    deps = check_dependencies()
    print("\nZavislosti:")
    for name, available in deps.items():
        icon = "OK" if available else "CHYBI"
        print(f"  [{icon}] {name}")

    print(f"\nPouziti:")
    print(f"  python instrument_separator.py <audio.wav> [mode]")
    print(f"  Modes:")
    print(f"    piano    — izolovat piano")
    print(f"    stems    — separatni stopy (vocals/drums/bass/other)")
    print(f"    remove-vocals — instrumental only")
    print(f"    detect   — detekovat dominantni nastroj")

    if len(sys.argv) > 1:
        audio_file = sys.argv[1]
        mode = sys.argv[2] if len(sys.argv) > 2 else 'piano'

        if not os.path.exists(audio_file):
            print(f"\nSoubor neexistuje: {audio_file}")
            sys.exit(1)

        output_dir = os.path.join(os.path.dirname(audio_file), 'separated')
        os.makedirs(output_dir, exist_ok=True)

        if mode == 'piano':
            output = os.path.join(output_dir, Path(audio_file).stem + '_piano.wav')
            result = isolate_piano(audio_file, output)
            print(f"\nVysledek: {result}")

        elif mode == 'stems':
            stems = separate_with_demucs(audio_file, output_dir)
            if not stems:
                stems = separate_with_spleeter(audio_file, output_dir)
            print(f"\nVysledek: {len(stems)} stopy")
            for name, path in stems.items():
                print(f"  {name}: {path}")

        elif mode == 'remove-vocals':
            output = os.path.join(output_dir, Path(audio_file).stem + '_instrumental.wav')
            result = remove_instrument(audio_file, output, 'vocals')
            print(f"\nVysledek: {result}")

        elif mode == 'detect':
            instrument = detect_dominant_instrument(audio_file)
            print(f"\nDominantni nastroj: {instrument}")

        else:
            print(f"\nNeznamy mode: {mode}")
