"""
note_detector.py - Adaptivni detekce padajicich not ze Synthesia-style videa.

Dvoufazovy pristup:
1. Detekce klavesnice - najde bile/cerne klavesy a jejich pozice
2. Detekce not nad klavesnici - sleduje pohyb barevnych objektu

Adaptivne se prizpusobi ruznym sirkam videa a rozsahum klavesnice.
"""
import cv2
import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict
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


NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

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


def detect_keyboard(frame: np.ndarray, config: DetectorConfig) -> Optional[KeyboardLayout]:
    """
    Detekuje klavesnici v jednom snimku videa.
    
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
    
    # Binarizace - bile klavesy jsou jasne
    _, binary = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
    
    # Najit horizontalni projekci - kde je nejvic bilych pixelu
    h_proj = np.sum(binary, axis=1)
    
    # Klavesnice je v oblasti s vysokym poctem bilych pixelu
    # Najit souvisly usek s vysokou hodnotou
    threshold = w * 100  # Alespon ~40% sirky musi byt bile
    keyboard_rows = np.where(h_proj > threshold)[0]
    
    if len(keyboard_rows) == 0:
        # Zkusit nizsi threshold
        threshold = w * 50
        keyboard_rows = np.where(h_proj > threshold)[0]
    
    if len(keyboard_rows) == 0:
        return None
    
    # Najit souvisly blok
    diffs = np.diff(keyboard_rows)
    gaps = np.where(diffs > 10)[0]
    
    if len(gaps) > 0:
        # Vznejt nejvetsi souvisly blok
        start_idx = 0
        best_len = 0
        best_start = 0
        
        for gap_idx in gaps:
            length = gap_idx - start_idx
            if length > best_len:
                best_len = length
                best_start = start_idx
            start_idx = gap_idx + 1
        
        # Posledni segment
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
    # Bile klavesy jsou vertikalni bile sloupce
    v_proj = np.sum(binary[keyboard_rows[0]:keyboard_rows[-1], :], axis=0)
    
    # Bile klavesy maji vysokou hodnotu, cerne nizkou
    white_threshold = kb_height * 150  # ~60% maximalni hodnoty
    
    # Najit prechody bile/cerna
    is_white = v_proj > white_threshold
    
    # Segmentace - najit souvisle bile useky
    white_segments = []
    in_white = False
    seg_start = 0
    
    for x in range(w):
        if is_white[x] and not in_white:
            seg_start = x
            in_white = True
        elif not is_white[x] and in_white:
            if x - seg_start > 5:  # Minimalni sirka bile klavesy
                white_segments.append((seg_start, x))
            in_white = False
    
    if in_white and w - seg_start > 5:
        white_segments.append((seg_start, w))
    
    if len(white_segments) < 3:
        return None
    
    # Spocitat prumernou sirku bile klavesy
    white_widths = [end - start for start, end in white_segments]
    avg_white_width = np.median(white_widths)
    
    # Detekce cernych klaves
    # Cerne klavesy jsou vyrazne tmave obdelniky mezi bilymi klavesami
    # Musi byt SIRSI nez jen tenka cara (mezi klavesami) a ZAROVEN opravdu cerne
    black_segments = []
    for i in range(len(white_segments) - 1):
        gap_start = white_segments[i][1]
        gap_end = white_segments[i + 1][0]
        gap_width = gap_end - gap_start
        
        # Cerna klavesa musi byt:
        # 1. Siroke alespon 50% bile klavesy (cerna je ~60% sirky bile)
        # 2. Ale ne sirsi nez 80% bile klavesy
        # 3. Opravdu TMAVA (prumerna hodnota < 60)
        # 4. Tenke cary (< 4px) ignorujeme - to jsou jen okraje
        
        if gap_width < max(4, avg_white_width * 0.50):
            continue  # Prilis uzke - jen mezera/cara
        if gap_width > avg_white_width * 0.80:
            continue  # Prilis siroke - neni to cerna klavesa
        
        # Zkontrolovat ze je opravdu tmava
        gap_region = gray[keyboard_rows[0]:keyboard_rows[-1], gap_start:gap_end]
        gap_brightness = np.mean(gap_region)
        gap_dark_ratio = np.sum(gap_region < 60) / gap_region.size
        
        # Musi byt tmava z vice nez 80% plochy a prumer < 60
        if gap_brightness < 60 and gap_dark_ratio > 0.8:
            black_segments.append((gap_start, gap_end, True))
    
    # Sestavit klavesy
    keys = []
    
    # Seznam vsech segmentu (bile + cerne) serazenych podle X
    all_segments = []
    for start, end in white_segments:
        all_segments.append((start, end, False))  # is_black=False
    for start, end, is_black in black_segments:
        all_segments.append((start, end, True))
    
    all_segments.sort(key=lambda s: s[0])
    
    # Namapovat na MIDI noty
    # Potrebujeme urcit pocatecni notu
    # Predpokladame ze prvni bila klavesa je C (nebo A v nekterych videich)
    # Zjistime to z poctu bilych klaves a poctu oktáv
    
    num_white_keys = len(white_segments)
    num_octaves = num_white_keys / 7.0  # 7 bilych klaves na oktávu
    
    # Urcit pocatecni MIDI
    # Synthesia vetsinou zobrazuje C3-C6 nebo C2-C6
    # Typicky pocet bilych klaves:
    # - 21 klaves (3 oktavy) = C4-C6 nebo C3-C5
    # - 28 klaves (4 oktavy) = C3-C6
    # - 35 klaves (5 oktáv) = C3-C7 nebo C2-C6
    # - 52 klaves = plne piano A0-C8
    
    # Urcit pocatecni MIDI a pattern podle poctu bilych klaves
    # Pattern = MIDI offsety od start_midi pro kazdou bilou klavesu v oktave
    #
    # Piano layout (bile klavesy):
    #   Od C:  C  D  E  F  G  A  B   -> offsety [0, 2, 4, 5, 7, 9, 11]
    #   Od A:  A  B  C  D  E  F  G   -> offsety [0, 2, 3, 5, 7, 8, 10]
    #
    # Standardni rozsahy:
    #   52 bilych = plne piano A0-C8 -> start A0 (MIDI 21), pattern od A
    #   36 bilych = C3-C7            -> start C3 (MIDI 48), pattern od C
    #   35 bilych = C2-C6            -> start C2 (MIDI 36), pattern od C
    #   28 bilych = C3-C6            -> start C3 (MIDI 48), pattern od C
    #   21 bilych = C4-C6            -> start C4 (MIDI 60), pattern od C
    
    if num_white_keys >= 50:
        start_midi = 21  # A0
        white_pattern = [0, 2, 3, 5, 7, 8, 10]   # A B C D E F G (offsety od A0)
    elif num_white_keys >= 34:
        start_midi = 36  # C2
        white_pattern = [0, 2, 4, 5, 7, 9, 11]   # C D E F G A B (offsety od C2)
    elif num_white_keys >= 27:
        start_midi = 48  # C3
        white_pattern = [0, 2, 4, 5, 7, 9, 11]
    elif num_white_keys >= 20:
        start_midi = 60  # C4
        white_pattern = [0, 2, 4, 5, 7, 9, 11]
    else:
        start_midi = 60  # C4
        white_pattern = [0, 2, 4, 5, 7, 9, 11]
    
    # Priradit MIDI cisla
    # Pattern v oktave: C W, C# B, D W, D# B, E W, F W, F# B, G W, G# B, A W, A# B, B W
    # Pokud zaciname na C (bila), pattern je: W B W B W W B W B W B W
    
    white_key_midi_pattern = white_pattern  # Pouzit pattern z vyse
    
    # Mapovani klaves
    current_midi = start_midi
    white_idx = 0
    
    for seg_start, seg_end, is_black in all_segments:
        x_center = (seg_start + seg_end) // 2
        
        if not is_black:
            # Bila klavesa
            # Urcit MIDI z pozice v oktave
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
            # Cerna klavesa - najit nejblizsi bilou klavesu
            # Cerna klavesa je mezi dvema bilymi
            prev_white = None
            next_white = None
            for k in keys:
                if not k.is_black and k.x_center < x_center:
                    prev_white = k
            for seg_s, seg_e, is_b in all_segments:
                if not is_b:
                    wx = (seg_s + seg_e) // 2
                    if wx > x_center:
                        next_white = (seg_s, seg_e)
                        break
            
            if prev_white is not None:
                # Cerna klavesa je +1 od predchozi bile
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
    
    # Seradit podle MIDI
    keys.sort(key=lambda k: k.midi_note)
    
    return KeyboardLayout(
        keys=keys,
        keyboard_top=kb_top,
        keyboard_bottom=kb_bottom,
        total_width=w,
        white_key_width=avg_white_width,
        num_octaves=num_octaves
    )


def detect_notes_in_frame(
    frame: np.ndarray,
    config: DetectorConfig,
    keyboard: KeyboardLayout
) -> List[Tuple[int, float, Tuple[int, int, int]]]:
    """
    Detekuje aktivni noty nad klavesnici v jednom snimku.
    
    Returns:
        [(midi_note, confidence, avg_color_hsv), ...]
    """
    h, w = frame.shape[:2]
    
    # Detekcni zona je NAD klavesnici
    y_zone_start = max(0, keyboard.keyboard_top - int(h * 0.6))
    y_zone_end = keyboard.keyboard_top
    
    if y_zone_end - y_zone_start < 50:
        return []
    
    roi = frame[y_zone_start:y_zone_end, :]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    
    # Vytvorit masku pro barevne noty
    # Noty jsou syte barvy (vysoka saturace a value)
    sat_thresh = config.color_saturation_min
    val_thresh = config.color_value_min
    
    # Saturation mask
    sat_mask = hsv[:, :, 1] > sat_thresh
    val_mask = hsv[:, :, 2] > val_thresh
    color_mask = sat_mask & val_mask
    
    # Volitelne: vyloucit velmi tmave noty
    if config.exclude_dark_notes:
        bright_mask = hsv[:, :, 2] > config.min_note_brightness
        color_mask = color_mask & bright_mask
    
    # Eroze + dilatace pro odstraneni sumu
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    color_mask = cv2.morphologyEx(color_mask.astype(np.uint8) * 255, cv2.MORPH_CLOSE, kernel)
    
    detected = []
    
    # Pro kazdou klavesu zkontrolovat jestli je nad ni nota
    for key in keyboard.keys:
        # Zona nad klavesou (sirka klavesy + maly presah)
        key_width = key.x_right - key.x_left
        x_left = max(0, key.x_left - key_width // 4)
        x_right = min(w, key.x_right + key_width // 4)
        
        key_mask = color_mask[:, x_left:x_right]
        active_pixels = cv2.countNonZero(key_mask)
        
        if active_pixels >= config.min_note_pixels:
            # Vypocitat prumerne HSV aktivnich pixelu
            key_hsv_roi = hsv[:, x_left:x_right]
            active_pixels_3d = np.stack([key_mask] * 3, axis=-1) > 0
            active_hsv_values = key_hsv_roi[active_pixels_3d[:, :, 0]]
            
            if len(active_hsv_values) > 0:
                avg_hsv = tuple(np.mean(active_hsv_values, axis=0).astype(int))
            else:
                avg_hsv = (0, 0, 0)
            
            confidence = min(1.0, active_pixels / (config.min_note_pixels * 4))
            detected.append((key.midi_note, confidence, avg_hsv))
    
    return detected


def detect_notes_from_video(
    video_path: str,
    config: Optional[DetectorConfig] = None,
    progress_callback=None
) -> List[DetectedNote]:
    """
    Hlavni funkce: analyzuje video a vrati seznam detekovanych not.
    
    Dvoufazovy pristup:
    1. Detekce klavesnice (prvnich N snimku)
    2. Detekce not nad klavesnici (cele video)
    
    Args:
        video_path: Cesta k video souboru
        config: Konfigurace detekce
        progress_callback: Funkce(percent, message) pro progress
    
    Returns:
        Seznam DetectedNote serazenych podle casu
    """
    if config is None:
        config = DetectorConfig()
    
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
    sample_frames = [0, total_frames // 4, total_frames // 2, 3 * total_frames // 4]
    
    for frame_idx in sample_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            continue
        
        kb = detect_keyboard(frame, config)
        if kb is not None and len(kb.keys) > 5:
            keyboard = kb
            print(f"    Nalezeno {len(kb.keys)} klaves ({kb.num_octaves:.1f} oktáv)")
            print(f"    Rozsah: {kb.keys[0].note_name} - {kb.keys[-1].note_name}")
            print(f"    Klavesnice Y: {kb.keyboard_top}-{kb.keyboard_bottom}")
            break
    
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    
    if keyboard is None:
        # Fallback - pouzit vychozi rozlozeni
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
            for midi_note, conf, hsv in detected:
                if midi_note in active_notes:
                    active_notes[midi_note]['last_frame'] = frame_idx
                    active_notes[midi_note]['confidence_sum'] += conf
                    active_notes[midi_note]['frame_count'] += 1
                else:
                    active_notes[midi_note] = {
                        'start_frame': frame_idx,
                        'last_frame': frame_idx,
                        'confidence_sum': conf,
                        'frame_count': 1,
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
    
    # 52 bilych klaves
    num_white = 52
    white_width = width / num_white
    
    # Pattern bilych klaves v oktave (od A): A B C D E F G
    # Ale MIDI zacina na A0=21
    white_pattern_from_a = [9, 11, 0, 2, 4, 5, 7]  # A B C D E F G offsets
    
    white_idx = 0
    for key_idx in range(num_keys):
        midi_note = midi_start + key_idx
        note_in_octave = (key_idx + 9) % 12  # +9 protoze zaciname na A
        is_black = note_in_octave in [1, 3, 6, 8, 10]
        
        if not is_black:
            x_center = int((white_idx + 0.5) * white_width)
            x_left = int(white_idx * white_width)
            x_right = int((white_idx + 1) * white_width)
            white_idx += 1
        else:
            # Cerna mezi predchozi a nasledujici bilou
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
    
    # Detekovat klavesnici
    keyboard = detect_keyboard(frame, config)
    
    if keyboard:
        # Vyznacit klavesnici
        cv2.rectangle(frame, (0, keyboard.keyboard_top), 
                     (w, keyboard.keyboard_bottom), (0, 255, 0), 2)
        
        # Vyznacit jednotlive klavesy
        for key in keyboard.keys:
            if key.is_black:
                cv2.rectangle(frame, (key.x_left, keyboard.keyboard_top),
                            (key.x_right, keyboard.keyboard_bottom), (0, 0, 255), 1)
            else:
                cv2.rectangle(frame, (key.x_left, keyboard.keyboard_top),
                            (key.x_right, keyboard.keyboard_bottom), (255, 0, 0), 1)
            
            # Popisek kazdou 12. klavesu (C)
            if key.note_name.startswith('C') and not key.is_black:
                cv2.putText(frame, key.note_name, (key.x_center - 8, keyboard.keyboard_top - 5),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 0), 1)
        
        # Detekovat noty v tomto snimku
        detected = detect_notes_in_frame(frame, config, keyboard)
        for midi, conf, hsv in detected:
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
        notes = detect_notes_from_video(video, progress_callback=lambda p, m: print(f"  [{p:.0f}%] {m}"))
        
        print(f"\nPrvnich 20 not:")
        for n in notes[:20]:
            print(f"  {n.note_name} (MIDI {n.midi_note}) | {n.start_time:.2f}s - {n.end_time:.2f}s | dur={n.duration:.2f}s | vel={n.velocity}")
    else:
        print(f"Video neexistuje: {video}")
