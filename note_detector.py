"""
note_detector.py - Detekce not z videi s padajicimi notami (Synthesia styl).

Postup:
1. Median z ~30 snimku = cista klavesnice (padajici noty, efekty i ruce zmizi).
2. Klavesnice: pas bilych klaves (svetle radky) + nad nim pas cernych klaves.
   Hranice bilych klaves = tmave delici cary, cerne klavesy = tmave useky.
   Vzor cernych klaves (skupiny 2 + 3) urci, ktera bila klavesa je C.
3. Kazdy snimek: rozsvicena klavesa (barva se lisi od medianu) = znejici nota.
   Zaloha pro videa, kde se klavesy nebarvi: barevny pruh tesne nad klavesnici.
4. Barva noty -> ruka (2 shluky odstinu, nizsi prumerna vyska = leva ruka).
5. Oktava se z pixelu urcit neda: odhad podle stredu klavesnice,
   zpresneni podle zvuku (audio_octave.py) nebo rucne --start-note.
"""
import math
import os
from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np


NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
WHITE_PCS = [0, 2, 4, 5, 7, 9, 11]          # C D E F G A B
BLACK_AFTER_WHITE = {0, 1, 3, 4, 5}         # za C, D, F, G, A nasleduje cerna


def midi_name(midi: int) -> str:
    return f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


@dataclass
class DetectedNote:
    """Jedna detekovana nota."""
    midi_note: int
    start_time: float
    end_time: float
    velocity: int = 80
    color_hsv: Tuple[int, int, int] = (0, 0, 0)
    confidence: float = 1.0
    hand: str = ''          # 'L', 'R' nebo '' (neznamo)

    @property
    def duration(self) -> float:
        return self.end_time - self.start_time

    @property
    def note_name(self) -> str:
        return midi_name(self.midi_note)


@dataclass
class KeyInfo:
    x_center: int
    x_left: int
    x_right: int
    is_black: bool
    midi_note: int
    note_name: str


@dataclass
class KeyboardLayout:
    keys: List[KeyInfo]
    keyboard_top: int       # horni okraj cernych klaves (= linie dopadu not)
    keyboard_bottom: int
    total_width: int
    white_key_width: float
    num_octaves: float
    white_top: int = 0      # od tohoto radku dolu jsou jen bile klavesy
    pattern_score: float = 1.0  # jak dobre sedi vzor cernych klaves (0-1)

    def get_key_by_midi(self, midi_note: int) -> Optional[KeyInfo]:
        return next((k for k in self.keys if k.midi_note == midi_note), None)


@dataclass
class DetectorConfig:
    frame_skip: int = 1                 # analyzovat kazdy N-ty snimek
    min_note_duration: float = 0.05     # kratsi useky jsou sum (s)
    lit_threshold: float = 40.0         # vzdalenost barvy od medianu = rozsvicena klavesa
    keyboard_samples: int = 30          # snimku pro median
    start_note_override: Optional[str] = None  # prvni (nejlevejsi bila) klavesa, napr. 'E2'
    split_hands: bool = True            # rozdelit ruce podle barvy


def parse_note_name(name) -> Optional[int]:
    """'C4', 'c#3', 'Bb2' nebo '60' -> MIDI cislo."""
    if name is None:
        return None
    s = str(name).strip()
    if not s:
        return None
    try:
        return int(float(s))
    except ValueError:
        pass
    base = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    pitch = s[0].upper()
    if pitch not in base:
        return None
    idx, acc = 1, 0
    if idx < len(s) and s[idx] in '#b':
        acc = 1 if s[idx] == '#' else -1
        idx += 1
    try:
        octave = int(s[idx:])
    except ValueError:
        return None
    return (octave + 1) * 12 + base[pitch] + acc


def _runs(mask: np.ndarray, merge_gap: int = 0) -> List[Tuple[int, int]]:
    """Souvisle useky True v 1D poli jako [(start, end_exclusive)]."""
    padded = np.concatenate([[False], mask.astype(bool), [False]])
    d = np.diff(padded.astype(np.int8))
    runs = list(zip(np.where(d == 1)[0], np.where(d == -1)[0]))
    merged = []
    for a, b in runs:
        if merged and a - merged[-1][1] <= merge_gap:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((int(a), int(b)))
    return merged


def median_frame(cap: cv2.VideoCapture, samples: int = 30) -> Optional[np.ndarray]:
    """Median z rovnomerne rozlozenych snimku (bez uvodu a zaveru videa)."""
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        return None
    # Sekvencne (grab je levny); seek je u nekterych souboru ~1 s na snimek.
    wanted = set(np.linspace(total * 0.05, total * 0.9, samples).astype(int).tolist())
    frames = []
    for idx in range(max(wanted) + 1):
        if not cap.grab():
            break
        if idx in wanted:
            ok, f = cap.retrieve()
            if ok:
                frames.append(f)
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    if not frames:
        return None
    return np.median(np.stack(frames), axis=0).astype(np.uint8)


def detect_keyboard(frame: np.ndarray, config: Optional[DetectorConfig] = None) -> Optional[KeyboardLayout]:
    """
    Najde klavesnici ve snimku (idealne median, viz median_frame).
    Vraci None, pokud ve snimku zadna klavesnice neni.
    """
    config = config or DetectorConfig()
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32)
    h, w = gray.shape

    # 1) Pas bilych klaves: nejdelsi blok svetlych radku ve spodnich 70 % obrazu.
    bright = (gray > 170).mean(axis=1)
    bright[: int(h * 0.3)] = 0
    if bright.max() < 0.3:
        return None
    runs = _runs(bright > bright.max() * 0.85, merge_gap=max(2, h // 80))
    wy0, wy1 = max(runs, key=lambda r: r[1] - r[0])
    if wy1 - wy0 < max(4, h // 60):
        return None

    # Vodorovny rozsah klavesnice = sloupce, ktere jsou v pasu bile svetle.
    white_prof = gray[wy0:wy1].mean(axis=0)
    cols = _runs(white_prof > 150, merge_gap=max(3, w // 100))
    kx0, kx1 = max(cols, key=lambda r: r[1] - r[0])
    if kx1 - kx0 < w * 0.3:
        return None

    # 2) Pas cernych klaves: od pasu bile nahoru, dokud radek obsahuje svetle i tmave.
    seg = gray[:, kx0:kx1]
    by0 = wy0
    while by0 > 0:
        row = seg[by0 - 1]
        if (row > 150).mean() < 0.15 or (row < 100).mean() < 0.15:
            break
        by0 -= 1
    black_h = wy0 - by0
    if black_h < 4:
        return None

    # 3) Hranice bilych klaves = tmave cary v horni polovine pasu bile
    #    (spodek pasu muze obsahovat popisky klaves).
    band = gray[wy0 + 1: wy0 + max(3, (wy1 - wy0) // 2), kx0:kx1]
    prof = np.convolve(band.mean(axis=0), np.ones(3) / 3, mode='same')
    base = float(np.median(prof))
    dip = (prof < base - max(20.0, base * 0.12)).astype(np.float32)
    # Odhad sirky bile klavesy z autokorelace delicich car (7 az 90 klaves na sirku).
    ac = np.correlate(dip - dip.mean(), dip - dip.mean(), mode='full')[len(dip) - 1:]
    lo, hi = max(3, len(dip) // 90), max(4, len(dip) // 7)
    if hi <= lo:
        return None
    W0 = lo + int(np.argmax(ac[lo:hi]))
    # Kvuli strídani sirek 30/31 px muze vyhrat nasobek periody - zkusit polovinu.
    while W0 // 2 >= lo and ac[W0 // 2 - 1: W0 // 2 + 2].max() > 0.6 * ac[W0]:
        W0 = W0 // 2 - 1 + int(np.argmax(ac[W0 // 2 - 1: W0 // 2 + 2]))
    seps = []
    for a, b in _runs(dip > 0):
        x = a + int(np.argmin(prof[a:b]))
        if seps and x - seps[-1] < 0.6 * W0:
            continue
        seps.append(x)
    if len(seps) < 3:
        return None
    W = float(np.median(np.diff(seps)))
    # Doplnit chybejici hranice (napr. prekryte efektem) do pravidelne mrizky.
    fixed = [seps[0]]
    for x in seps[1:]:
        gap = x - fixed[-1]
        n = int(round(gap / W))
        for k in range(1, n):
            fixed.append(int(round(fixed[-1] + gap / n)))
        if n >= 1:
            fixed.append(x)
    seps = fixed
    edges = [0] + seps + [kx1 - kx0]
    whites = [(a, b) for a, b in zip(edges, edges[1:]) if b - a >= 0.5 * W]

    # 4) Cerne klavesy ve stredu pasu cernych klaves.
    mid = seg[by0 + black_h // 4: by0 + 3 * black_h // 4]
    is_dark = (mid < np.minimum(100, base * 0.5)).mean(axis=0) > 0.6
    blacks = []
    for a, b in _runs(is_dark):
        width = b - a
        at_edge = a == 0 or b == len(is_dark)
        if (0.3 * W <= width <= 0.95 * W) or (at_edge and 0.2 * W <= width <= 0.95 * W):
            blacks.append((a, b))

    # 5) Vzor: hranice za bilou klavesou j ma cernou klavesu?
    bounds = [b for _, b in whites[:-1]]
    centers = np.array([(a + b) / 2 for a, b in blacks]) if blacks else np.array([-1e9])
    flags = [bool(np.min(np.abs(centers - x)) < 0.5 * W) for x in bounds]
    best_p, best_score = 0, -1
    for p in range(7):
        score = sum(f == ((p + j) % 7 in BLACK_AFTER_WHITE) for j, f in enumerate(flags))
        if score > best_score:
            best_p, best_score = p, score
    pattern_score = best_score / max(1, len(flags))

    # 6) Oktava: kalibrace uzivatelem, jinak stred klavesnice co nejbliz E4 (64).
    override = parse_note_name(config.start_note_override)
    if override is not None:
        start_midi = override if override % 12 in WHITE_PCS else override + 1
    else:
        pc = WHITE_PCS[best_p]
        candidates = [pc + 12 * o for o in range(0, 9)]
        n_w = len(whites)

        def center_midi(s):
            wi = WHITE_PCS.index(s % 12)
            k = wi + n_w // 2
            return s - WHITE_PCS[wi] + 12 * (k // 7) + WHITE_PCS[k % 7]

        start_midi = min(candidates, key=lambda s: abs(center_midi(s) - 64))

    white_midis = []
    m = start_midi
    for _ in whites:
        white_midis.append(m)
        m += 1
        while m % 12 not in WHITE_PCS:
            m += 1

    keys = [KeyInfo((a + b) // 2 + kx0, a + kx0, b + kx0, False, mi, midi_name(mi))
            for (a, b), mi in zip(whites, white_midis)]
    # Cerna klavesa lezi na hranici bilych: hranice j = levy okraj bile j (posledni = pravy okraj).
    edges_x = np.array([a for a, _ in whites] + [whites[-1][1]])
    for a, b in blacks:
        c = (a + b) / 2
        j = int(np.argmin(np.abs(edges_x - c)))
        mi = white_midis[j] - 1 if j < len(whites) else white_midis[-1] + 1
        if mi % 12 in WHITE_PCS:
            continue
        keys.append(KeyInfo(int(c) + kx0, a + kx0, b + kx0, True, mi, midi_name(mi)))
    keys.sort(key=lambda k: k.midi_note)

    return KeyboardLayout(
        keys=keys, keyboard_top=by0, keyboard_bottom=wy1, total_width=kx1 - kx0,
        white_key_width=W, num_octaves=len(whites) / 7, white_top=wy0,
        pattern_score=pattern_score,
    )


def _key_samplers(kb: KeyboardLayout):
    """Radky a sloupcove rozsahy, ze kterych se cte barva kazde klavesy."""
    black_h = kb.white_top - kb.keyboard_top
    white_rows = (kb.white_top + 2, kb.white_top + max(4, (kb.keyboard_bottom - kb.white_top) * 9 // 20))
    black_rows = (kb.keyboard_top + black_h // 3, kb.keyboard_top + black_h * 4 // 5)
    ranges = []
    for k in kb.keys:
        m = max(1, (k.x_right - k.x_left) // 4)
        ranges.append((k.x_left + m, max(k.x_left + m + 1, k.x_right - m)))
    return white_rows, black_rows, np.array(ranges)


def _key_colors(frame, kb, white_rows, black_rows, ranges, is_black) -> np.ndarray:
    """Prumerna BGR barva kazde klavesy -> (n_keys, 3)."""
    out = np.empty((len(ranges), 3), np.float32)
    for rows, sel in ((white_rows, ~is_black), (black_rows, is_black)):
        prof = cv2.reduce(frame[rows[0]:rows[1]], 0, cv2.REDUCE_AVG, dtype=cv2.CV_32F)[0]  # (w, 3)
        cs = np.vstack([np.zeros((1, 3)), np.cumsum(prof, axis=0)])
        r = ranges[sel]
        out[sel] = (cs[r[:, 1]] - cs[r[:, 0]]) / (r[:, 1] - r[:, 0])[:, None]
    return out


def _hit_line_colors(frame, kb, ranges) -> np.ndarray:
    """Prumerna barva pruhu tesne nad klavesnici nad kazdou klavesou -> (n_keys, 3)."""
    y1 = max(1, kb.keyboard_top - 2)
    prof = cv2.reduce(frame[max(0, y1 - 5):y1], 0, cv2.REDUCE_AVG, dtype=cv2.CV_32F)[0]
    cs = np.vstack([np.zeros((1, 3)), np.cumsum(prof, axis=0)])
    return (cs[ranges[:, 1]] - cs[ranges[:, 0]]) / (ranges[:, 1] - ranges[:, 0])[:, None]


def _changed(colors: np.ndarray, fps_eff: float, threshold: float, window_s: float = 8.0) -> np.ndarray:
    """
    True tam, kde se barva lisi od klouzaveho medianu (okno +-window_s).
    Klouzavy median zvlada poloprusvitne klavesnice a menici se pozadi;
    nota by musela svitit dele nez window_s, aby se stala "pozadim".
    """
    n = len(colors)
    half = max(1, int(window_s * fps_eff))
    step = max(1, int(fps_eff))
    base = np.empty_like(colors)
    for c in range(0, n, step):
        base[c:c + step] = np.median(colors[max(0, c - half):c + half:2], axis=0)
    out = np.linalg.norm(colors - base, axis=2) > threshold
    out[out.mean(axis=1) > 0.5] = False          # prolinacky / titulky
    return out


def _bgr_to_hsv(bgr) -> Tuple[int, int, int]:
    px = np.clip(np.array(bgr, np.float32), 0, 255).astype(np.uint8).reshape(1, 1, 3)
    return tuple(int(v) for v in cv2.cvtColor(px, cv2.COLOR_BGR2HSV)[0, 0])


def _active_to_notes(active: np.ndarray, colors: np.ndarray, kb: KeyboardLayout,
                     times: np.ndarray, frame_dt: float, min_dur: float) -> List[DetectedNote]:
    notes = []
    for ki, key in enumerate(kb.keys):
        for a, b in _runs(active[:, ki]):
            start, end = times[a], times[b - 1] + frame_dt
            if end - start < min_dur:
                continue
            notes.append(DetectedNote(
                midi_note=key.midi_note, start_time=round(float(start), 4), end_time=round(float(end), 4),
                color_hsv=_bgr_to_hsv(colors[a:b, ki].mean(axis=0)),
            ))
    notes.sort(key=lambda n: (n.start_time, n.midi_note))
    # Akord se rozsviti v sousednich snimcich -> sjednotit zacatek na prvni.
    group_start = None
    for n in notes:
        if group_start is None or n.start_time - group_start > 1.5 * frame_dt:
            group_start = n.start_time
        else:
            n.start_time = group_start
    return notes


def assign_hands(notes: List[DetectedNote]) -> bool:
    """
    Rozdeli noty na levou/pravou ruku podle barvy (Synthesia barvi ruce ruzne).
    Vraci False, pokud barvy netvori dva jasne shluky (pak hand zustane '').
    """
    if len(notes) < 4:
        return False
    hue = np.array([n.color_hsv[0] for n in notes], np.float32) * 2.0      # 0-360
    ang = np.deg2rad(hue)
    pts = np.stack([np.cos(ang), np.sin(ang)], axis=1)
    # 2-means na kruznici, start v nejvzdalenejsich bodech
    c0 = pts[0]
    c1 = pts[int(np.argmax(((pts - c0) ** 2).sum(axis=1)))]
    for _ in range(20):
        lab = ((pts - c1) ** 2).sum(axis=1) < ((pts - c0) ** 2).sum(axis=1)
        if lab.all() or (~lab).all():
            return False
        c0, c1 = pts[~lab].mean(axis=0), pts[lab].mean(axis=0)
    sep = math.degrees(math.acos(float(np.clip(
        np.dot(c0, c1) / (np.linalg.norm(c0) * np.linalg.norm(c1) + 1e-9), -1, 1))))
    if sep < 25 or min(lab.mean(), 1 - lab.mean()) < 0.05:
        return False
    pitch = np.array([n.midi_note for n in notes])
    right_is_1 = pitch[lab].mean() > pitch[~lab].mean()
    for n, l in zip(notes, lab):
        n.hand = 'R' if l == right_is_1 else 'L'
    return True


def detect_notes_from_video(video_path: str, config: Optional[DetectorConfig] = None,
                            progress_callback=None) -> List[DetectedNote]:
    """Hlavni funkce: video -> seznam not serazenych podle casu."""
    config = config or DetectorConfig()
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Nelze otevrit video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"  Video: {int(cap.get(3))}x{int(cap.get(4))}, {fps:.1f} FPS, {total} snimku, {total / fps:.1f}s")

    med = median_frame(cap, config.keyboard_samples)
    kb = detect_keyboard(med, config) if med is not None else None
    if kb is None:
        cap.release()
        raise RuntimeError("Klavesnice nenalezena - video asi neni Synthesia styl (zkuste --audio)")
    print(f"  Klavesnice: {len(kb.keys)} klaves, {kb.keys[0].note_name}-{kb.keys[-1].note_name}, "
          f"Y {kb.keyboard_top}-{kb.keyboard_bottom}, vzor {kb.pattern_score:.0%}")
    if kb.pattern_score < 0.9:
        print("  VAROVANI: vzor cernych klaves sedi spatne, nazvy not mohou byt posunute")

    white_rows, black_rows, ranges = _key_samplers(kb)
    is_black = np.array([k.is_black for k in kb.keys])

    colors, hits, times = [], [], []
    idx = 0
    while True:
        ok = cap.grab()
        if not ok:
            break
        if idx % config.frame_skip == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            colors.append(_key_colors(frame, kb, white_rows, black_rows, ranges, is_black))
            hits.append(_hit_line_colors(frame, kb, ranges))
            times.append(idx / fps)
            if progress_callback and len(times) % 300 == 0:
                progress_callback(min(99.0, 100.0 * idx / max(1, total)), f"snimek {idx}/{total}")
        idx += 1
    cap.release()
    if not times:
        return []

    colors = np.stack(colors)
    times = np.array(times)
    dt = config.frame_skip / fps
    lit = _changed(colors, 1 / dt, config.lit_threshold)
    hit = _changed(np.stack(hits).astype(np.float32), 1 / dt, config.lit_threshold)
    if lit.mean() * 5 < hit.mean():
        print("  Klavesy se v tomto videu nebarvi - ctu noty z linie dopadu")
        lit = hit

    notes = _active_to_notes(lit, colors, kb, times, dt, config.min_note_duration)
    if config.split_hands and assign_hands(notes):
        print(f"  Ruce podle barvy: L={sum(n.hand == 'L' for n in notes)}, R={sum(n.hand == 'R' for n in notes)}")
    if progress_callback:
        progress_callback(100.0, f"{len(notes)} not")
    print(f"  Celkem detekovano: {len(notes)} not")
    return notes


def preview_frame(video_path: str, output_path: str, time_s: float = 5.0,
                  config: Optional[DetectorConfig] = None):
    """Ulozi snimek s vyznacenou detekovanou klavesnici (pro kontrolu)."""
    config = config or DetectorConfig()
    cap = cv2.VideoCapture(video_path)
    med = median_frame(cap, config.keyboard_samples)
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(time_s * (cap.get(cv2.CAP_PROP_FPS) or 30)))
    ok, frame = cap.read()
    cap.release()
    if not ok or med is None:
        print("  Nepodarilo se nacist snimek")
        return
    kb = detect_keyboard(med, config)
    if kb:
        cv2.line(frame, (0, kb.keyboard_top), (frame.shape[1], kb.keyboard_top), (0, 255, 0), 1)
        for k in kb.keys:
            y0 = kb.keyboard_top if k.is_black else kb.white_top
            cv2.rectangle(frame, (k.x_left, y0), (k.x_right - 1, kb.keyboard_bottom - 1),
                          (0, 0, 255) if k.is_black else (255, 0, 0), 1)
            if k.note_name.startswith('C') and not k.is_black:
                cv2.putText(frame, k.note_name, (k.x_left + 2, kb.keyboard_bottom - 4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 255), 1)
    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    cv2.imwrite(output_path, frame)
    print(f"  Nahled ulozen: {output_path}")
