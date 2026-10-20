"""
note_detector.py - Adaptivni detekce not z videa.

Podporovane styly videa:
- SYNTHESIA: Padajici barevne noty (falling bars) — vychozi
- REAL_PIANO: Realne piano video (detekce stisku klaves z jasu)
- TUTORIAL: Tutorial styl (noty nahoře, klavesnice dole)
- GENERIC: Obecne barevne objekty nad klavesnici

Dvoufazovy pristup:
1. Detekce klavesnice — multi-frame consensus, adaptivni thresholdy
2. Detekce not — sleduje pohyb barevnych objektu / stisky klaves

V2 improvements:
- Multi-frame consensus pro klavesnici (odolnejsi proti sumu)
- Adaptivni thresholdy (podle rozliseni a jasu videa)
- Velocity z velikosti noty (vetsi = hlasitejsi)
- Lepsi HSV filtrace s adaptivnim saturation/value
- Podpora vice stylu (falling bars, glow notes)
- Auto-detekce stylu videa
"""
import cv2
import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict
from enum import Enum
import os


@dataclass
class DetectedNote:
    """Reprezentuje jednu detekovanou notu."""
    midi_note: int          # MIDI cislo noty (60 = C4)
    start_time: float       # Cas zacatku v sekundach
    end_time: float         # Cas konce v sekundach
    velocity: int = 80      # MIDI velocity (hlasitost)
    color_hsv: Tuple[int, int, int] = (0, 0, 0)
    confidence: float = 0.0
    
    @property
    def duration(self) -> float:
        return self.end_time - self.start_time
    
    @property
    def note_name(self) -> str:
        names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        octave = (self.midi_note // 12) - 1
        name = names[self.midi_note % 12]
        return f"{name}{octave}"


@dataclass
class KeyInfo:
    """Informace o jedne klavese."""
    x_center: int           # X souradnice stredu klavesy
    x_left: int             # Levy okraj
    x_right: int            # Pravy okraj
    is_black: bool          # Je to cerna klavesa?
    midi_note: int          # MIDI cislo
    note_name: str          # Nazev (C4, D#5, atd.)


@dataclass
class KeyboardLayout:
    """Detekovane rozlozeni klavesnice."""
    keys: List[KeyInfo]
    keyboard_top: int       # Y souradnice horniho okraje klavesnice
    keyboard_bottom: int    # Y souradnice spodniho okraje
    total_width: int        # Sirka cele klavesnice
    white_key_width: float  # Prumerna sirka bile klavesy
    num_octaves: float      # Pocet viditelnych oktáv
    
    def get_key_by_midi(self, midi_note: int) -> Optional[KeyInfo]:
        """Najde klavesu podle MIDI cisla."""
        for key in self.keys:
            if key.midi_note == midi_note:
                return key
        return None


@dataclass
class DetectorConfig:
    """Konfigurace detektoru not."""
    # Oblast detekce klavesnice
    keyboard_zone_bottom: float = 0.95  # Spodni hranice (0.95 = spodnich 5%)
    keyboard_zone_top: float = 0.70     # Horni hranice pro hledani klavesnice
    
    # Detekce not
    frame_skip: int = 2                    # Analyzovat kazdy N-ty snimek
    min_note_pixels: int = 25              # Minimalni pocet pixelu pro notu
    color_saturation_min: int = 60         # Minimalni saturace (HSV)
    color_value_min: int = 100             # Minimalni jas (HSV)
    
    # Casovani
    min_note_duration: float = 0.05        # Minimalni delka noty (s)
    merge_gap: float = 0.10                # Sloucit noty blizsi nez X sekund
    onset_frames: int = 3                  # Kolik snimku musi byt nota aktivni
    
    # Barevna filtrace
    exclude_dark_notes: bool = True        # Ignorovat velmi tmave noty
    min_note_brightness: int = 120         # Minimalni jas pro notu (0-255)
    
    # V2: adaptivni detekce
    adaptive_thresholds: bool = True       # Adaptivni thresholdy podle videa
    multi_sample_keyboard: bool = True     # Multi-frame consensus pro klavesnici
    keyboard_samples: int = 8              # Pocet vzorku pro consensus
    velocity_from_size: bool = True        # Velocity z velikosti noty
    glow_note_support: bool = True         # Detekce "glow" stylu not
    
    # Video mode
    video_mode: str = 'auto'               # 'auto', 'synthesia', 'real_piano', 'tutorial', 'generic'


NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


class VideoMode(Enum):
    """Typ videa pro ruzne detekcni strategie."""
    SYNTHESIA = 'synthesia'       # Padajici barevne noty (falling bars)
    REAL_PIANO = 'real_piano'     # Realne piano, detekce stisku klaves
    TUTORIAL = 'tutorial'         # Noty nahoře, klavesnice dole (PianoGen apod.)
    GENERIC = 'generic'           # Obecne barevne objekty nad klavesnici


# Pattern klaves v oktave (od C): W=white, B=black
OCTAVE_PATTERN = [
    (False, 'C'),   # C  - white
    (True, 'C#'),   # C# - black
    (False, 'D'),   # D  - white
    (True, 'D#'),   # D# - black
    (False, 'E'),   # E  - white
    (False, 'F'),   # F  - white
    (True, 'F#'),   # F# - black
    (False, 'G'),   # G  - white
    (True, 'G#'),   # G# - black
    (False, 'A'),   # A  - white
    (True, 'A#'),   # A# - black
    (False, 'B'),   # B  - white
]


def _adaptive_color_thresholds(frame: np.ndarray, config: DetectorConfig) -> Tuple[int, int]:
    """
    Vypocita adaptivni saturation/value thresholdy na zaklade barevne distribuce snimku.
    
    Misto fixnich hodnot (60/100) analyzuje HSV histogram a najde
    optimalni hranici pro oddeleni barevnych not od pozadi.
    """
    h, w = frame.shape[:2]
    
    # Analyzovat horni polovinu obrazu (kde jsou noty, ne klavesnice)
    roi = frame[:h // 2, :]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    
    # Saturation histogram
    sat_hist = cv2.calcHist([hsv], [1], None, [256], [0, 256]).flatten()
    val_hist = cv2.calcHist([hsv], [2], None, [256], [0, 256]).flatten()
    
    # Najit Otsu-like threshold pro saturation
    # Pozadi ma vetsinou nizkou saturaci, noty vysokou
    total_pixels = sat_hist.sum()
    if total_pixels == 0:
        return config.color_saturation_min, config.color_value_min
    
    cumulative = np.cumsum(sat_hist)
    target = total_pixels * 0.70  # 70% pixelu je pozadi
    sat_threshold = np.searchsorted(cumulative, target)
    sat_threshold = int(np.clip(sat_threshold, 40, 150))
    
    # Value threshold - podobne
    cumulative_v = np.cumsum(val_hist)
    target_v = total_pixels * 0.60
    val_threshold = np.searchsorted(cumulative_v, target_v)
    val_threshold = int(np.clip(val_threshold, 80, 180))
    
    return sat_threshold, val_threshold


def detect_keyboard(frame: np.ndarray, config: DetectorConfig) -> Optional[KeyboardLayout]:
    """
    Detekuje klavesnici v jednom snimku videa.
    
    V2: Vylepsena detekce s adaptivnimi thresholdy a vice pristupy.
    
    Strategie:
    1. Podivat se na spodni cast obrazu
    2. Najit horizontalni linii kde je klavesnice
    3. Detekovat bile klavesy (jasne obdelniky) a jejich rozestupy
    4. Detekovat cerne klavesy mezi bilymi
    5. Namapovat na MIDI noty
    
    Returns:
        KeyboardLayout nebo None pokud klavesnici nelze detekovat
    """
    h, w = frame.shape[:2]
    
    # Oblast pro hledani klavesnice
    y_top = int(h * config.keyboard_zone_top)
    y_bottom = int(h * config.keyboard_zone_bottom)
    
    roi = frame[y_top:y_bottom, :]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    
    # Adaptivni binarizace (Otsu misto fixniho thresholdu)
    if config.adaptive_thresholds:
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        _, binary = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    else:
        _, binary = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
    
    # Najit horizontalni projekci - kde je nejvic bilych pixelu
    h_proj = np.sum(binary, axis=1)
    
    # Klavesnice je v oblasti s vysokym poctem bilych pixelu
    threshold = w * 100
    keyboard_rows = np.where(h_proj > threshold)[0]
    
    if len(keyboard_rows) == 0:
        threshold = w * 50
        keyboard_rows = np.where(h_proj > threshold)[0]
    
    if len(keyboard_rows) == 0:
        # Treti pokus - jeste nizsi threshold
        threshold = w * 30
        keyboard_rows = np.where(h_proj > threshold)[0]
    
    if len(keyboard_rows) == 0:
        return None
    
    # Najit souvisly blok
    diffs = np.diff(keyboard_rows)
    gaps = np.where(diffs > 10)[0]
    
    if len(gaps) > 0:
        start_idx = 0
        best_len = 0
        best_start = 0
        
        for gap_idx in gaps:
            length = gap_idx - start_idx
            if length > best_len:
                best_len = length
                best_start = start_idx
            start_idx = gap_idx + 1
        
        length = len(keyboard_rows) - start_idx
        if length > best_len:
            best_len = length
            best_start = start_idx
        
        keyboard_rows = keyboard_rows[best_start:best_start + best_len]
    
    if len(keyboard_rows) < 10:
        return None
    
    # Klavesnice Y rozsah
    kb_top = y_top + keyboard_rows[0]
    kb_bottom = y_top + keyboard_rows[-1]
    kb_height = kb_bottom - kb_top
    
    # Analyzovat bile klavesy
    v_proj = np.sum(binary[keyboard_rows[0]:keyboard_rows[-1], :], axis=0)
    
    # Adaptivni threshold pro bile klavesy
    if config.adaptive_thresholds:
        white_threshold = np.percentile(v_proj, 55)  # Median + trochu nahoru
    else:
        white_threshold = kb_height * 150
    
    is_white = v_proj > white_threshold
    
    # Segmentace - najit souvisle bile useky
    white_segments = []
    in_white = False
    seg_start = 0
    
    # Minimalni sirka bile klavesy zavisla na rozliseni
    min_white_width = max(5, w // 200)
    
    for x in range(w):
        if is_white[x] and not in_white:
            seg_start = x
            in_white = True
        elif not is_white[x] and in_white:
            if x - seg_start > min_white_width:
                white_segments.append((seg_start, x))
            in_white = False
    
    if in_white and w - seg_start > min_white_width:
        white_segments.append((seg_start, w))
    
    if len(white_segments) < 3:
        return None
    
    # Spocitat prumernou sirku bile klavesy (median je odolnejsi proti odlehlym)
    white_widths = [end - start for start, end in white_segments]
    avg_white_width = float(np.median(white_widths))
    
    # Detekce cernych klaves
    black_segments = []
    for i in range(len(white_segments) - 1):
        gap_start = white_segments[i][1]
        gap_end = white_segments[i + 1][0]
        gap_width = gap_end - gap_start
        
        # Adaptivni thresholdy pro cernou klavesu
        min_black_width = max(4, avg_white_width * 0.40)
        max_black_width = avg_white_width * 0.85
        
        if gap_width < min_black_width:
            continue
        if gap_width > max_black_width:
            continue
        
        # Zkontrolovat ze je opravdu tmava
        gap_region = gray[keyboard_rows[0]:keyboard_rows[-1], gap_start:gap_end]
        gap_brightness = np.mean(gap_region)
        gap_dark_ratio = np.sum(gap_region < 60) / max(1, gap_region.size)
        
        if gap_brightness < 70 and gap_dark_ratio > 0.7:
            black_segments.append((gap_start, gap_end, True))
    
    # Sestavit klavesy
    keys = []
    all_segments = []
    for start, end in white_segments:
        all_segments.append((start, end, False))
    for start, end, is_black in black_segments:
        all_segments.append((start, end, True))
    
    all_segments.sort(key=lambda s: s[0])
    
    # Namapovat na MIDI noty
    num_white_keys = len(white_segments)
    num_octaves = num_white_keys / 7.0
    
    if num_white_keys >= 50:
        start_midi = 21  # A0
        white_pattern = [0, 2, 3, 5, 7, 8, 10]
    elif num_white_keys >= 34:
        start_midi = 36  # C2
        white_pattern = [0, 2, 4, 5, 7, 9, 11]
    elif num_white_keys >= 27:
        start_midi = 48  # C3
        white_pattern = [0, 2, 4, 5, 7, 9, 11]
    elif num_white_keys >= 20:
        start_midi = 60  # C4
        white_pattern = [0, 2, 4, 5, 7, 9, 11]
    else:
        start_midi = 60
        white_pattern = [0, 2, 4, 5, 7, 9, 11]
    
    white_key_midi_pattern = white_pattern
    
    white_idx = 0
    
    for seg_start, seg_end, is_black in all_segments:
        x_center = (seg_start + seg_end) // 2
        
        if not is_black:
            octave_offset = white_idx // 7
            note_in_octave = white_idx % 7
            midi = start_midi + octave_offset * 12 + white_key_midi_pattern[note_in_octave]
            
            note_name = NOTE_NAMES[midi % 12] + str((midi // 12) - 1)
            keys.append(KeyInfo(
                x_center=x_center,
                x_left=seg_start,
                x_right=seg_end,
                is_black=False,
                midi_note=midi,
                note_name=note_name
            ))
            white_idx += 1
        else:
            prev_white = None
            for k in keys:
                if not k.is_black and k.x_center < x_center:
                    prev_white = k
            
            if prev_white is not None:
                midi = prev_white.midi_note + 1
                note_name = NOTE_NAMES[midi % 12] + str((midi // 12) - 1)
                keys.append(KeyInfo(
                    x_center=x_center,
                    x_left=seg_start,
                    x_right=seg_end,
                    is_black=True,
                    midi_note=midi,
                    note_name=note_name
                ))
    
    if not keys:
        return None
    
    keys.sort(key=lambda k: k.midi_note)
    
    return KeyboardLayout(
        keys=keys,
        keyboard_top=kb_top,
        keyboard_bottom=kb_bottom,
        total_width=w,
        white_key_width=avg_white_width,
        num_octaves=num_octaves
    )


def detect_keyboard_consensus(
    cap: cv2.VideoCapture,
    config: DetectorConfig,
    num_samples: int = 8
) -> Optional[KeyboardLayout]:
    """
    Multi-frame consensus detekce klavesnice.
    
    Odebere vice vzorku z ruznych casti videa a pouzije nejcastejsi
    (consensus) rozlozeni. Odolnejsi proti sumu a prechodnym efektum.
    
    Args:
        cap: OpenCV VideoCapture
        config: Konfigurace detekce
        num_samples: Pocet vzorku napric videem
    
    Returns:
        Nejlepsi detekovane KeyboardLayout
    """
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    # Rozlozit vzorky rovnomerne napric videem
    sample_positions = np.linspace(0, total_frames - 1, num_samples + 2)[1:-1].astype(int)
    
    candidates = []
    for frame_idx in sample_positions:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(frame_idx))
        ret, frame = cap.read()
        if not ret:
            continue
        
        kb = detect_keyboard(frame, config)
        if kb is not None and len(kb.keys) > 5:
            candidates.append(kb)
    
    if not candidates:
        return None
    
    # Vybrat nejlepsi kandidata (nejvic klaves + nejvetsi konsenzus)
    # Klavesy by mely byt konzistentni napric snimky
    key_counts = [len(kb.keys) for kb in candidates]
    
    # Najit nejcastejsi pocet klaves
    from collections import Counter
    count_freq = Counter(key_counts)
    most_common_count = count_freq.most_common(1)[0][0]
    
    # Filtrovat kandidaty s timto poctem klaves
    matching = [kb for kb in candidates if len(kb.keys) == most_common_count]
    
    # Pouzit kandidata s nejvetsi klavesnici (nejpravdepodobneji spravny)
    best = max(matching, key=lambda kb: kb.keyboard_bottom - kb.keyboard_top)
    
    return best


def detect_notes_in_frame(
    frame: np.ndarray,
    config: DetectorConfig,
    keyboard: KeyboardLayout
) -> List[Tuple[int, float, Tuple[int, int, int], int]]:
    """
    Detekuje aktivni noty nad klavesnici v jednom snimku.
    
    V2: adaptivni thresholdy, velocity z velikosti noty, glow detekce.
    
    Returns:
        [(midi_note, confidence, avg_color_hsv, pixel_count), ...]
    """
    h, w = frame.shape[:2]
    
    # Detekcni zona je NAD klavesnici
    zone_height = int(h * 0.55)
    y_zone_start = max(0, keyboard.keyboard_top - zone_height)
    y_zone_end = keyboard.keyboard_top
    
    if y_zone_end - y_zone_start < 50:
        return []
    
    roi = frame[y_zone_start:y_zone_end, :]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    
    # Adaptivni nebo fixni thresholdy
    if config.adaptive_thresholds:
        sat_thresh, val_thresh = _adaptive_color_thresholds(roi, config)
    else:
        sat_thresh = config.color_saturation_min
        val_thresh = config.color_value_min
    
    # Saturation + Value mask pro barevne noty
    sat_mask = hsv[:, :, 1] > sat_thresh
    val_mask = hsv[:, :, 2] > val_thresh
    color_mask = sat_mask & val_mask
    
    # Vyloucit velmi tmave objekty
    if config.exclude_dark_notes:
        bright_mask = hsv[:, :, 2] > config.min_note_brightness
        color_mask = color_mask & bright_mask
    
    # Morphological cleaning
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    color_mask = cv2.morphologyEx(color_mask.astype(np.uint8) * 255, cv2.MORPH_CLOSE, kernel)
    color_mask = cv2.morphologyEx(color_mask, cv2.MORPH_OPEN, kernel)
    
    # Glow note detekce (pro videa s "sviticimi" notami)
    if config.glow_note_support:
        glow_mask = _detect_glow_notes(hsv, val_thresh)
        combined_mask = cv2.bitwise_or(color_mask, glow_mask)
    else:
        combined_mask = color_mask
    
    detected = []
    
    for key in keyboard.keys:
        key_width = key.x_right - key.x_left
        x_left = max(0, key.x_left - key_width // 4)
        x_right = min(w, key.x_right + key_width // 4)
        
        key_mask = combined_mask[:, x_left:x_right]
        active_pixels = cv2.countNonZero(key_mask)
        
        if active_pixels >= config.min_note_pixels:
            # Prumerne HSV aktivnich pixelu
            key_hsv_roi = hsv[:, x_left:x_right]
            active_pixels_3d = np.stack([key_mask] * 3, axis=-1) > 0
            active_hsv_values = key_hsv_roi[active_pixels_3d[:, :, 0]]
            
            if len(active_hsv_values) > 0:
                avg_hsv = tuple(np.mean(active_hsv_values, axis=0).astype(int))
            else:
                avg_hsv = (0, 0, 0)
            
            # Confidence z poctu pixelu (normalizovano)
            key_area = (x_right - x_left) * (y_zone_end - y_zone_start)
            fill_ratio = active_pixels / max(1, key_area)
            confidence = min(1.0, active_pixels / (config.min_note_pixels * 3))
            
            detected.append((key.midi_note, confidence, avg_hsv, active_pixels))
    
    return detected


def _detect_glow_notes(hsv: np.ndarray, base_val_thresh: int) -> np.ndarray:
    """
    Detekuje "glow" style noty — vysoke value, nizka saturace,
    typicky bile/zlute/zelene sviceni.
    
    Tyto noty byvaji detekovany spatne pri standardni HSV filtraci,
    protoze maji nizkou saturaci ale vysokou intenzitu.
    """
    h_channel = hsv[:, :, 0]
    s_channel = hsv[:, :, 1]
    v_channel = hsv[:, :, 2]
    
    # Glow noty: vysoky jas, nizka/stredni saturace, zlute/zelene/modre tony
    # Hue rozsahy: zelena(35-85), zluta(15-35), modra(85-130)
    high_val = v_channel > max(180, base_val_thresh + 40)
    low_sat = s_channel > 30  # Nizsi nez obvykle, ale ne uplne sede
    med_sat = s_channel < 200  # Ne prehnane syte
    
    glow_mask = high_val & low_sat & med_sat
    
    # Cleanup
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    glow_mask = cv2.morphologyEx(glow_mask.astype(np.uint8) * 255, cv2.MORPH_CLOSE, kernel)
    
    return glow_mask


# ── Video mode auto-detection ────────────────────────────────────────────────

def detect_video_mode(video_path: str, config: DetectorConfig) -> VideoMode:
    """
    Automaticky detekuje typ videa na zaklade analyzy nekolika snimku.

    Strategie:
    - SYNTHESIA: Cerna/tmave pozadi + vysoce saturovane barevne objekty padajici shora
    - REAL_PIANO: Prirozene barvy, ruce na klavesnici, zadne padajici noty
    - TUTORIAL: Noty (text/bar) v horni casti + klavesnice v dolni casti
    - GENERIC: Barevne objekty nad klavesnici, ale ne Synthesia styl

    Returns:
        Detekovany VideoMode
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return VideoMode.SYNTHESIA  # Fallback

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    sample_positions = np.linspace(0, total_frames - 1, min(5, total_frames)).astype(int)

    synth_score = 0
    real_score = 0
    tutorial_score = 0

    for frame_idx in sample_positions:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(frame_idx))
        ret, frame = cap.read()
        if not ret:
            continue

        h, w = frame.shape[:2]
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

        # Analyza hornej poloviny (kde by byly noty)
        top_half = hsv[:h // 2, :]
        bottom_half = hsv[h // 2:, :]

        # 1. SYNTHESIA signal: tmave pozadi + vysoce saturovane barevne bloky
        dark_bg = np.mean(bottom_half[:, :, 2]) < 80  # Tmave pozadi
        high_sat_pixels = np.sum(top_half[:, :, 1] > 150) / (h * w / 4)
        if dark_bg and high_sat_pixels > 0.05:
            synth_score += 2

        # 2. REAL_PIANO signal: prirozene barvy, ruznorody jas, zadne barevne bloky
        mean_sat = np.mean(hsv[:, :, 1])
        mean_val = np.mean(hsv[:, :, 2])
        if 30 < mean_sat < 100 and 80 < mean_val < 200:
            real_score += 1

        # 3. TUTORIAL signal: text/noty v hornej casti + klavesnice v dolni
        # Hledame horizontalni struktury (notove linky, text) v hornej casti
        top_gray = cv2.cvtColor(frame[:h // 3, :], cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(top_gray, 50, 150)
        h_proj = np.sum(edges, axis=1)
        if np.max(h_proj) > w * 0.3:  # Silne horizontalni struktury
            tutorial_score += 2

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    cap.release()

    # Vyhodnoceni
    scores = {
        VideoMode.SYNTHESIA: synth_score,
        VideoMode.REAL_PIANO: real_score,
        VideoMode.TUTORIAL: tutorial_score,
    }

    best_mode = max(scores, key=scores.get)
    best_score = scores[best_mode]

    if best_score == 0:
        return VideoMode.GENERIC

    return best_mode


# ── Real piano detection ─────────────────────────────────────────────────────

def detect_real_piano_notes(
    video_path: str,
    config: DetectorConfig,
    progress_callback=None
) -> List[DetectedNote]:
    """
    Detekce not z realneho piano videa.

    Strategie: Sleduje zmeny jasu na klavesach pri stisku.
    Klavesa je "stisknuta" kdyz se jeji jas vyrazne zmeni (ztmavne/zesvetli).

    Args:
        video_path: Cesta k videu
        config: Konfigurace
        progress_callback: Progress callback

    Returns:
        Seznam DetectedNote
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Nelze otevrit video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    print(f"  Video: {width}x{height}, {fps:.1f} FPS, {total_frames} snimku")
    print(f"  Mode: REAL_PIANO (detekce stisku klaves)")

    # Faze 1: Detekce klavesnice
    print("  Faze 1: Detekce klavesnice...")
    keyboard = None
    sample_frames = np.linspace(0, total_frames - 1, min(10, total_frames)).astype(int)

    for frame_idx in sample_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(frame_idx))
        ret, frame = cap.read()
        if not ret:
            continue
        kb = detect_keyboard(frame, config)
        if kb is not None and len(kb.keys) > 5:
            keyboard = kb
            print(f"    Nalezeno {len(kb.keys)} klaves")
            break

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    if keyboard is None:
        print("    Klavesnice nedetekovana, pouzivam vychozi rozlozeni")
        keyboard = create_default_keyboard(width, height, config)

    # Faze 2: Sledovani jasu klaves
    print("  Faze 2: Detekce stisku klaves (zmeny jasu)...")

    # Vytvorit referencni obrazek klavesnice (prumer z nekolika snimku)
    reference_gray = None
    ref_count = 0
    for frame_idx in sample_frames[:3]:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(frame_idx))
        ret, frame = cap.read()
        if not ret:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if reference_gray is None:
            reference_gray = gray.astype(np.float32)
        else:
            reference_gray += gray.astype(np.float32)
        ref_count += 1

    if ref_count > 0:
        reference_gray /= ref_count
        reference_gray = reference_gray.astype(np.uint8)

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    # Sledovani kazde klavesy
    key_states = {}  # midi_note -> {'active': bool, 'start_frame': int, 'brightness_change': float}
    all_notes = []
    frame_idx = 0
    processed = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % config.frame_skip == 0 and reference_gray is not None:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            time_s = frame_idx / fps

            # Rozdil oproti referenci
            diff = cv2.absdiff(gray, reference_gray)

            detected_midi = set()

            for key in keyboard.keys:
                # Oblast klavesy
                y_top = keyboard.keyboard_top
                y_bot = keyboard.keyboard_bottom
                x_left = key.x_left
                x_right = key.x_right

                if x_right <= x_left or y_bot <= y_top:
                    continue

                # Prumerna zmena jasu v oblasti klavesy
                roi_diff = diff[y_top:y_bot, x_left:x_right]
                mean_diff = np.mean(roi_diff)

                # Threshold pro detekci stisku
                press_threshold = 25  # Vyrazna zmena jasu

                if mean_diff > press_threshold:
                    detected_midi.add(key.midi_note)

                    if key.midi_note not in key_states or not key_states[key.midi_note]['active']:
                        key_states[key.midi_note] = {
                            'active': True,
                            'start_frame': frame_idx,
                            'max_diff': mean_diff
                        }
                    else:
                        key_states[key.midi_note]['max_diff'] = max(
                            key_states[key.midi_note]['max_diff'], mean_diff
                        )

            # Ukoncit neaktivni noty
            to_remove = []
            for midi_note, state in key_states.items():
                if state['active'] and midi_note not in detected_midi:
                    end_frame = frame_idx
                    start_time = state['start_frame'] / fps
                    end_time = end_frame / fps

                    if end_time - start_time >= config.min_note_duration:
                        # Velocity z intenzity zmeny
                        velocity = int(min(127, max(40, state['max_diff'] * 3)))
                        all_notes.append(DetectedNote(
                            midi_note=midi_note,
                            start_time=start_time,
                            end_time=end_time,
                            velocity=velocity,
                            confidence=min(1.0, state['max_diff'] / 50)
                        ))
                    to_remove.append(midi_note)

            for midi_note in to_remove:
                key_states[midi_note]['active'] = False

            processed += 1
            if progress_callback and processed % 50 == 0:
                pct = (frame_idx / total_frames) * 100
                progress_callback(pct, f"Snimek {frame_idx}/{total_frames}, {len(all_notes)} not")

        frame_idx += 1

    # Dokoncit zbyvajici aktivni noty
    for midi_note, state in key_states.items():
        if state['active']:
            start_time = state['start_frame'] / fps
            end_time = total_frames / fps
            if end_time - start_time >= config.min_note_duration:
                velocity = int(min(127, max(40, state['max_diff'] * 3)))
                all_notes.append(DetectedNote(
                    midi_note=midi_note,
                    start_time=start_time,
                    end_time=end_time,
                    velocity=velocity,
                    confidence=min(1.0, state['max_diff'] / 50)
                ))

    cap.release()

    all_notes.sort(key=lambda n: n.start_time)
    all_notes = merge_close_notes(all_notes, config.merge_gap)

    print(f"  Celkem detekovano: {len(all_notes)} not (real piano)")
    return all_notes


# ── Tutorial-style detection ─────────────────────────────────────────────────

def detect_tutorial_notes(
    video_path: str,
    config: DetectorConfig,
    progress_callback=None
) -> List[DetectedNote]:
    """
    Detekce not z tutorial-style videi (PianoGen, atd.).

    Typicky: noty/text v hornej casti obrazovky, klavesnice v dolni casti.
    Noty mohou byt barevne bloky, text, nebo notace na staff.

    Strategie: Detekce barevnych bloku v hornej casti + mapovani na klavesy.

    Args:
        video_path: Cesta k videu
        config: Konfigurace
        progress_callback: Progress callback

    Returns:
        Seznam DetectedNote
    """
    # Tutorial styl je podobny Synthesia, ale noty jsou v hornej casti
    # Muzeme pouzit standardni detekci s upravenym zone
    modified_config = DetectorConfig(
        frame_skip=config.frame_skip,
        min_note_pixels=config.min_note_pixels,
        min_note_duration=config.min_note_duration,
        keyboard_zone_top=0.65,   # Klavesnice muze byt nize
        keyboard_zone_bottom=0.95,
        adaptive_thresholds=config.adaptive_thresholds,
        multi_sample_keyboard=config.multi_sample_keyboard,
        velocity_from_size=config.velocity_from_size,
        glow_note_support=config.glow_note_support,
    )

    print("  Mode: TUTORIAL (noty v hornej casti, klavesnice dole)")

    # Pouzijeme standardni pipeline s upravenym config
    return detect_notes_from_video(video_path, config=modified_config,
                                    progress_callback=progress_callback)


def detect_notes_from_video(
    video_path: str,
    config: Optional[DetectorConfig] = None,
    progress_callback=None
) -> List[DetectedNote]:
    """
    Hlavni funkce: analyzuje video a vrati seznam detekovanych not.
    
    Automaticky detekuje typ videa a pouzije odpovidajici strategii:
    - SYNTHESIA: Padajici barevne noty (falling bars) — vychozi
    - REAL_PIANO: Realne piano video (detekce stisku klaves z jasu)
    - TUTORIAL: Tutorial styl (noty nahoře, klavesnice dole)
    - GENERIC: Obecne barevne objekty nad klavesnici
    
    Args:
        video_path: Cesta k video souboru
        config: Konfigurace detekce
        progress_callback: Funkce(percent, message) pro progress
    
    Returns:
        Seznam DetectedNote serazenych podle casu
    """
    if config is None:
        config = DetectorConfig()
    
    # Auto-detect video mode
    mode = config.video_mode
    if mode == 'auto':
        print("  Detekuji typ videa...")
        detected_mode = detect_video_mode(video_path, config)
        print(f"  Detekovan mode: {detected_mode.value}")
        mode = detected_mode.value
    else:
        print(f"  Mode: {mode} (manualni)")
    
    # Dispatch podle mode
    if mode == 'real_piano':
        return detect_real_piano_notes(video_path, config, progress_callback)
    elif mode == 'tutorial':
        return detect_tutorial_notes(video_path, config, progress_callback)
    # synthesia / generic — pouzij standardni pipeline
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Nelze otevrit video: {video_path}")
    
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = total_frames / fps if fps > 0 else 0
    
    print(f"  Video: {width}x{height}, {fps:.1f} FPS, {total_frames} snimku, {duration:.1f}s")
    
    # ── FAZE 1: Detekce klavesnice ──
    print("  Faze 1: Detekce klavesnice...")
    
    keyboard = None
    
    if config.multi_sample_keyboard:
        # Multi-frame consensus (vylepsena presnost)
        print(f"    Multi-sample consensus ({config.keyboard_samples} vzorku)...")
        keyboard = detect_keyboard_consensus(cap, config, num_samples=config.keyboard_samples)
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    else:
        # Legacy: 4 sample frames
        sample_frames = [0, total_frames // 4, total_frames // 2, 3 * total_frames // 4]
        for frame_idx in sample_frames:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                continue
            kb = detect_keyboard(frame, config)
            if kb is not None and len(kb.keys) > 5:
                keyboard = kb
                break
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    
    if keyboard is not None:
        print(f"    Nalezeno {len(keyboard.keys)} klaves ({keyboard.num_octaves:.1f} oktav)")
        print(f"    Rozsah: {keyboard.keys[0].note_name} - {keyboard.keys[-1].note_name}")
        print(f"    Klavesnice Y: {keyboard.keyboard_top}-{keyboard.keyboard_bottom}")
    else:
        print("    Klavesnice nedetekovana, pouzivam vychozi rozlozeni")
        keyboard = create_default_keyboard(width, height, config)
    
    # ── FAZE 2: Detekce not ──
    print("  Faze 2: Detekce not...")
    
    active_notes = {}
    all_notes = []
    frame_idx = 0
    processed = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        if frame_idx % config.frame_skip == 0:
            time_s = frame_idx / fps
            
            detected = detect_notes_in_frame(frame, config, keyboard)
            detected_midi = set(n[0] for n in detected)
            
            # Aktualizovat aktivni noty
            for midi_note, conf, hsv, pixel_count in detected:
                if midi_note in active_notes:
                    active_notes[midi_note]['last_frame'] = frame_idx
                    active_notes[midi_note]['confidence_sum'] += conf
                    active_notes[midi_note]['frame_count'] += 1
                    active_notes[midi_note]['total_pixels'] += pixel_count
                    active_notes[midi_note]['max_pixels'] = max(
                        active_notes[midi_note]['max_pixels'], pixel_count
                    )
                else:
                    active_notes[midi_note] = {
                        'start_frame': frame_idx,
                        'last_frame': frame_idx,
                        'confidence_sum': conf,
                        'frame_count': 1,
                        'total_pixels': pixel_count,
                        'max_pixels': pixel_count,
                        'hsv': hsv
                    }
            
            # Ukoncit noty ktere uz nejsou aktivni
            to_remove = []
            for midi_note, data in active_notes.items():
                if midi_note not in detected_midi:
                    frames_since = frame_idx - data['last_frame']
                    if frames_since > config.frame_skip * 3:
                        start_time = data['start_frame'] / fps
                        end_time = data['last_frame'] / fps
                        
                        if end_time - start_time >= config.min_note_duration:
                            avg_conf = data['confidence_sum'] / data['frame_count']
                            
                            # Velocity z velikosti noty (vetsi = hlasitejsi)
                            if config.velocity_from_size:
                                max_px = data['max_pixels']
                                # Normalizovat: 25px ~ vel 50, 200px ~ vel 127
                                velocity = int(min(127, max(40, 40 + max_px * 0.5)))
                            else:
                                velocity = int(min(127, max(30, avg_conf * 127)))
                            
                            all_notes.append(DetectedNote(
                                midi_note=midi_note,
                                start_time=start_time,
                                end_time=end_time,
                                velocity=velocity,
                                color_hsv=data['hsv'],
                                confidence=avg_conf
                            ))
                        to_remove.append(midi_note)
            
            for midi_note in to_remove:
                del active_notes[midi_note]
            
            processed += 1
            
            if progress_callback and processed % 50 == 0:
                pct = (frame_idx / total_frames) * 100
                progress_callback(pct, f"Snimek {frame_idx}/{total_frames}, {len(all_notes)} not")
        
        frame_idx += 1
    
    # Dokoncit zbyvajici aktivni noty
    for midi_note, data in active_notes.items():
        start_time = data['start_frame'] / fps
        end_time = data['last_frame'] / fps
        if end_time - start_time >= config.min_note_duration:
            avg_conf = data['confidence_sum'] / data['frame_count']
            
            if config.velocity_from_size:
                max_px = data['max_pixels']
                velocity = int(min(127, max(40, 40 + max_px * 0.5)))
            else:
                velocity = int(min(127, max(30, avg_conf * 127)))
            
            all_notes.append(DetectedNote(
                midi_note=midi_note,
                start_time=start_time,
                end_time=end_time,
                velocity=velocity,
                color_hsv=data['hsv'],
                confidence=avg_conf
            ))
    
    cap.release()
    
    all_notes.sort(key=lambda n: n.start_time)
    all_notes = merge_close_notes(all_notes, config.merge_gap)
    
    print(f"  Celkem detekovano: {len(all_notes)} not")
    return all_notes


def create_default_keyboard(width: int, height: int, config: DetectorConfig) -> KeyboardLayout:
    """
    Vytvori vychozi rozlozeni klavesnice kdyz detekce selze.
    Predpoklada 88 klaves (A0-C8) rovnomerne rozlozenych.
    """
    keys = []
    num_keys = 88
    midi_start = 21  # A0
    
    num_white = 52
    white_width = width / num_white
    
    white_pattern_from_a = [9, 11, 0, 2, 4, 5, 7]
    
    white_idx = 0
    for key_idx in range(num_keys):
        midi_note = midi_start + key_idx
        note_in_octave = (key_idx + 9) % 12
        is_black = note_in_octave in [1, 3, 6, 8, 10]
        
        if not is_black:
            x_center = int((white_idx + 0.5) * white_width)
            x_left = int(white_idx * white_width)
            x_right = int((white_idx + 1) * white_width)
            white_idx += 1
        else:
            x_center = int(white_idx * white_width)
            bw = int(white_width * 0.6)
            x_left = x_center - bw // 2
            x_right = x_center + bw // 2
        
        note_name = NOTE_NAMES[midi_note % 12] + str((midi_note // 12) - 1)
        keys.append(KeyInfo(
            x_center=x_center,
            x_left=max(0, x_left),
            x_right=min(width, x_right),
            is_black=is_black,
            midi_note=midi_note,
            note_name=note_name
        ))
    
    return KeyboardLayout(
        keys=keys,
        keyboard_top=int(height * 0.80),
        keyboard_bottom=int(height * 0.95),
        total_width=width,
        white_key_width=white_width,
        num_octaves=88 / 12
    )


def merge_close_notes(notes: List[DetectedNote], gap: float) -> List[DetectedNote]:
    """Slouci noty stejneho midi ktere jsou blize nez gap sekund."""
    if not notes:
        return notes
    
    merged = []
    current = notes[0]
    
    for note in notes[1:]:
        if note.midi_note == current.midi_note and note.start_time - current.end_time < gap:
            current = DetectedNote(
                midi_note=current.midi_note,
                start_time=current.start_time,
                end_time=max(current.end_time, note.end_time),
                velocity=max(current.velocity, note.velocity),
                color_hsv=current.color_hsv,
                confidence=max(current.confidence, note.confidence)
            )
        else:
            merged.append(current)
            current = note
    
    merged.append(current)
    return merged


def preview_frame(video_path: str, output_path: str, time_s: float = 5.0, 
                  config: Optional[DetectorConfig] = None):
    """
    Ulozi nahledovy snimek z videa s vyznacenou detekci klavesnice a not.
    """
    if config is None:
        config = DetectorConfig()
    
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    target_frame = int(time_s * fps)
    
    cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
    ret, frame = cap.read()
    cap.release()
    
    if not ret:
        print("  Nepodarilo se nacist snimek")
        return
    
    h, w = frame.shape[:2]
    
    keyboard = detect_keyboard(frame, config)
    
    if keyboard:
        # Vyznacit klavesnici
        cv2.rectangle(frame, (0, keyboard.keyboard_top), 
                     (w, keyboard.keyboard_bottom), (0, 255, 0), 2)
        
        for key in keyboard.keys:
            if key.is_black:
                cv2.rectangle(frame, (key.x_left, keyboard.keyboard_top),
                            (key.x_right, keyboard.keyboard_bottom), (0, 0, 255), 1)
            else:
                cv2.rectangle(frame, (key.x_left, keyboard.keyboard_top),
                            (key.x_right, keyboard.keyboard_bottom), (255, 0, 0), 1)
            
            if key.note_name.startswith('C') and not key.is_black:
                cv2.putText(frame, key.note_name, (key.x_center - 8, keyboard.keyboard_top - 5),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 0), 1)
        
        detected = detect_notes_in_frame(frame, config, keyboard)
        for midi, conf, hsv, pixels in detected:
            key = keyboard.get_key_by_midi(midi)
            if key:
                y_zone_start = max(0, keyboard.keyboard_top - int(h * 0.6))
                cv2.rectangle(frame, (key.x_left, y_zone_start),
                            (key.x_right, keyboard.keyboard_top), (0, 255, 255), 1)
                cv2.putText(frame, f"{key.note_name} ({conf:.1f})",
                           (key.x_center - 15, y_zone_start + 20),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.3, (0, 255, 255), 1)
    
    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else '.', exist_ok=True)
    cv2.imwrite(output_path, frame)
    print(f"  Nahled ulozen: {output_path}")


if __name__ == '__main__':
    import sys
    video = sys.argv[1] if len(sys.argv) > 1 else "output/video.mp4"
    
    if os.path.exists(video):
        preview_frame(video, "output/preview.jpg", time_s=10.0)
        
        print("Spoustim detekci not...")
        config = DetectorConfig()
        notes = detect_notes_from_video(video, config=config, 
                                        progress_callback=lambda p, m: print(f"  [{p:.0f}%] {m}"))
        
        print(f"\nPrvnich 20 not:")
        for n in notes[:20]:
            print(f"  {n.note_name} (MIDI {n.midi_note}) | {n.start_time:.2f}s - {n.end_time:.2f}s | dur={n.duration:.2f}s | vel={n.velocity}")
    else:
        print(f"Video neexistuje: {video}")
