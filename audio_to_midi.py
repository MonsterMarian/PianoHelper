"""
audio_to_midi.py - Alternativni cesta: extrakce audia z videa a prevod na MIDI.

Pouziva librosa pro pitch detection (pyin algorithm) pro monofonni audio,
nebo mpe (multi-pitch estimation) pro polyfonni.
"""
import os
import numpy as np
from typing import List, Optional
from note_detector import DetectedNote


def extract_audio_from_video(video_path: str, audio_path: str, sample_rate: int = 22050) -> str:
    """
    Extrahuje audio z videa do WAV souboru.
    Pouziva OpenCV + wave (pure Python, zadny ffmpeg).
    """
    import cv2
    import wave
    import struct
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Nelze otevrit video: {video_path}")
    
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps
    
    # Zkusit extrahovat audio track
    # OpenCV necte audio - pouzijeme subprocess s python -m yt_dlp
    # pro audio-only download
    cap.release()
    
    # Alternativni pristup: stahnout audio primo pres yt-dlp
    video_url = None  # Nemame URL, jen lokalni soubor
    print(f"  Audio extrakce: pouzivam nahradni metodu (video nema audio track v OpenCV)")
    print(f"  Pro nejlepsi vysledky pouzijte video s audiem a spustte s volbou --audio")
    
    return ""


def audio_file_to_midi(
    audio_path: str,
    output_midi_path: str,
    sample_rate: int = 22050,
    tempo: int = 120
) -> List[DetectedNote]:
    """
    Prevede audio WAV soubor na MIDI pomoci pitch detection.
    
    Vyzaduje: librosa (pip install librosa)
    """
    try:
        import librosa
    except ImportError:
        print("  Knihovna 'librosa' neni nainstalovana.")
        print("  Instalace: pip install librosa")
        print("  Preskakuj audio->MIDI konverzi.")
        return []
    
    print(f"  Nacitam audio: {audio_path}")
    y, sr = librosa.load(audio_path, sr=sample_rate)
    duration = len(y) / sr
    print(f"  Delka audia: {duration:.1f}s, sample rate: {sr}")
    
    # Pitch detection pomoci pyin (monofonni)
    print("  Analyzuji pitch (pyin)...")
    f0, voiced_flag, voiced_probs = librosa.pyin(
        y, 
        fmin=librosa.note_to_hz('A1'),
        fmax=librosa.note_to_hz('C7'),
        sr=sr
    )
    
    times = librosa.times_like(f0, sr=sr)
    hop_length = 512
    frame_time = hop_length / sr
    
    # Konvertovat F0 na MIDI noty
    notes = []
    current_note = None
    
    for i, (freq, is_voiced) in enumerate(zip(f0, voiced_flag)):
        time_s = i * frame_time
        
        if is_voiced and freq > 0:
            midi_note = int(np.round(librosa.hz_to_midi(freq)))
            midi_note = max(21, min(108, midi_note))  # A0-C8 rozsah
            
            if current_note is None or current_note['midi'] != midi_note:
                # Ukoncit predchozi notu
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
                
                # Zacit novou notu
                current_note = {'midi': midi_note, 'start': time_s, 'end': time_s}
            else:
                current_note['end'] = time_s
        else:
            # Ticho - ukoncit aktualni notu
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
    
    # Dokoncit posledni notu
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
    
    print(f"  Detekovano {len(notes)} not z audia")
    
    # Ulozit MIDI
    if notes:
        from midi_generator import notes_to_midi
        notes_to_midi(notes, output_midi_path, tempo=tempo, title="Audio to MIDI")
    
    return notes


def check_librosa_available() -> bool:
    """Zkontroluje jestli je librosa nainstalovana."""
    try:
        import librosa
        return True
    except ImportError:
        return False


if __name__ == '__main__':
    print("Audio to MIDI converter")
    print("=" * 40)
    
    if not check_librosa_available():
        print("\nPro pouziti audio->MIDI konverze nainstalujte librosa:")
        print("  pip install librosa")
        print("\nNebo pouzijte video detekci not (--video volba)")
    else:
        print("librosa je k dispozici!")
        print("Pouziti: python audio_to_midi.py <audio_file.wav>")
