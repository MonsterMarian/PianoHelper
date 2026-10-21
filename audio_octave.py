"""
audio_octave.py - Kalibrace oktavy podle zvuku.

Z obrazu zname nazvy not (C, D#...), ale ne oktavu. Pro kazdy posun
(-2..+2 oktavy) zmerime, jak moc pri nastupu not vzroste energie na jejich
harmonickych frekvencich. Spravna oktava ma narust na zakladni frekvenci
i vsech vyssich harmonickych; o oktavu vys chybi lichy harmonicke,
o oktavu niz chybi zakladni frekvence.
"""
from typing import Dict, List, Optional, Tuple

import numpy as np

SR = 22050
N_FFT = 8192


def load_audio(path: str, sr: int = SR) -> np.ndarray:
    """Dekoduje libovolny audio/video soubor na mono float32 (pres PyAV)."""
    import av
    chunks = []
    with av.open(path) as container:
        if not container.streams.audio:
            raise ValueError('soubor nema zvukovou stopu')
        resampler = av.AudioResampler(format='flt', layout='mono', rate=sr)
        for frame in container.decode(audio=0):
            chunks.extend(r.to_ndarray().ravel() for r in resampler.resample(frame))
        chunks.extend(r.to_ndarray().ravel() for r in resampler.resample(None))
    return np.concatenate(chunks).astype(np.float32) if chunks else np.zeros(0, np.float32)


def _spectrum(x: np.ndarray) -> np.ndarray:
    return np.log1p(np.abs(np.fft.rfft(x * np.hanning(len(x)))))


def octave_scores(notes, audio: np.ndarray, sr: int = SR,
                  shifts=(-24, -12, 0, 12, 24), max_notes: int = 400) -> Dict[int, float]:
    usable = [n for n in notes if n.end_time - n.start_time >= 0.08]
    if len(usable) > max_notes:
        usable = [usable[i] for i in np.linspace(0, len(usable) - 1, max_notes).astype(int)]
    scores = {s: 0.0 for s in shifts}
    bin_hz = sr / N_FFT
    gap = int(0.02 * sr)
    for n in usable:
        a = int(n.start_time * sr)
        if a - gap - N_FFT < 0 or a + gap + N_FFT > len(audio):
            continue
        gain = np.maximum(0, _spectrum(audio[a + gap: a + gap + N_FFT])
                          - _spectrum(audio[a - gap - N_FFT: a - gap]))
        for s in shifts:
            f0 = 440.0 * 2 ** ((n.midi_note + s - 69) / 12)
            for k in range(1, 7):
                b = int(round(k * f0 / bin_hz))
                if b + 2 >= len(gain):
                    break
                scores[s] += 0.8 ** (k - 1) * gain[b - 1: b + 2].max()
    return scores


def octave_shift(notes, audio_path: str) -> Tuple[int, Optional[Dict[int, float]]]:
    """Vrati doporuceny posun v pultonech (nasobek 12) a skore jednotlivych posunu."""
    try:
        audio = load_audio(audio_path)
    except Exception as e:           # bez zvuku nebo bez PyAV: kalibrace se preskoci
        print(f"  Kalibrace oktavy podle zvuku preskocena: {e}")
        return 0, None
    if len(audio) < SR:
        return 0, None
    scores = octave_scores(notes, audio)
    best = max(scores, key=scores.get)
    # Posouvat jen pri jasnem rozdilu, jinak verit odhadu z klavesnice.
    if best != 0 and scores[best] < 1.05 * scores[0]:
        best = 0
    return best, scores


def apply_shift(notes: List, shift: int) -> None:
    for n in notes:
        n.midi_note += shift
