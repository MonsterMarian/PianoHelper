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


def _whites_from_separators(band: np.ndarray):
    """Bile klavesy z tmavych delicich car v pasu bilych klaves -> (whites, W) nebo None."""
    prof = np.convolve(band.mean(axis=0), np.ones(3) / 3, mode='same')
    base = float(np.median(prof))
    dip = (prof < base - max(20.0, base * 0.12)).astype(np.float32)
    # Odhad sirky bile klavesy z autokorelace delicich car (7 az 90 klaves na sirku).
    ac = np.correlate(dip - dip.mean(), dip - dip.mean(), mode='full')[len(dip) - 1:]
    lo, hi = max(3, len(dip) // 90), max(4, len(dip) // 7)
    if hi <= lo or dip.sum() == 0:
        return None
    W0 = lo + int(np.argmax(ac[lo:hi]))
    # Necelociselna sirka (26.7 px) muze vyhrat nasobek periody (80 = 3 x 26.7) - zkusit 1/4, 1/3, 1/2.
    for k in (4, 3, 2):
        i = int(round(W0 / k))
        if i - 1 >= lo and ac[i - 1: i + 2].max() > 0.6 * ac[W0]:
            W0 = i - 1 + int(np.argmax(ac[i - 1: i + 2]))
            break
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
    return _whites_from_bounds(fixed, W, band.shape[1])


def _whites_from_blacks(dark_runs, width_px: int):
    """
    Bile klavesy z poloh cernych klaves: ve skupine (C# D#, F# G# A#) jsou cerne klavesy od sebe
    o sirku bile klavesy W a lezi na hranicich bilych klaves -> mrizka x0 + k*W.
    """
    inner = [(a, b) for a, b in dark_runs if a > 0 and b < width_px]
    if len(inner) < 5:
        return None
    bw = float(np.median([b - a for a, b in inner]))
    centers = np.array([(a + b) / 2 for a, b in inner if 0.5 * bw <= b - a <= 1.6 * bw])
    if len(centers) < 5:
        return None
    # 5 mezer mezi cernymi = 1 oktava = 7 bilych klaves (plati i kdyz jsou cerne posunute jako na
    # skutecnem piane - mezery uvnitr skupiny pak nejsou presne W)
    if len(centers) < 6:
        return None
    W = float(np.median(centers[5:] - centers[:-5])) / 7
    if W < 4:
        return None
    # faze mrizky = kruhovy prumer poloh cernych klaves modulo W
    ang = 2 * np.pi * (centers % W) / W
    x0 = (np.arctan2(np.sin(ang).mean(), np.cos(ang).mean()) % (2 * np.pi)) / (2 * np.pi) * W
    bounds = [int(round(x0 + k * W)) for k in range(0, int(width_px / W) + 2) if 0 < x0 + k * W < width_px]
    return _whites_from_bounds(bounds, W, width_px)


def _whites_from_bounds(bounds, W: float, width_px: int):
    edges = [0] + list(bounds) + [width_px]
    whites = [(a, b) for a, b in zip(edges, edges[1:]) if b - a >= 0.5 * W]
    return (whites, W) if len(whites) >= 7 else None


def _filter_blacks(dark_runs, W: float, width_px: int):
    blacks = []
    for a, b in dark_runs:
        width = b - a
        at_edge = a == 0 or b == width_px
        if (0.3 * W <= width <= 0.95 * W) or (at_edge and 0.2 * W <= width <= 0.95 * W):
            blacks.append((a, b))
    return blacks


def _black_pattern(whites, blacks, W: float):
    """Ktera bila klavesa je C: hranice za bilou j ma cernou klavesu? -> (best_p, shoda 0-1)."""
    bounds = [b for _, b in whites[:-1]]
    centers = np.array([(a + b) / 2 for a, b in blacks]) if blacks else np.array([-1e9])
    flags = [bool(np.min(np.abs(centers - x)) < 0.5 * W) for x in bounds]
    best_p, best_score = 0, -1
    for p in range(7):
        score = sum(f == ((p + j) % 7 in BLACK_AFTER_WHITE) for j, f in enumerate(flags))
        if score > best_score:
            best_p, best_score = p, score
    return best_p, best_score / max(1, len(flags))


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
    # Median pres par radku smaze tenkou zarici linku nad klavesami (natocene piano ma sedave
    # klavesy a linka by vyhrala jako "nejsvetlejsi pas").
    k = max(3, h // 60) | 1
    bright = np.median(np.lib.stride_tricks.sliding_window_view(np.pad(bright, k // 2, mode='edge'), k), axis=1)
    if bright.max() < 0.3:
        return None
    runs = _runs(bright > bright.max() * 0.85, merge_gap=max(2, h // 80))
    wy0, wy1 = max(runs, key=lambda r: r[1] - r[0])
    if wy1 - wy0 < max(4, h // 60):
        return None

    # Vinetace (natocene piano tmavne ke krajum): zesvetlit sloupce podle obalky pasu bilych klaves.
    env = cv2.dilate(gray[wy0:wy1].mean(axis=0, keepdims=True), np.ones((1, max(3, w // 30)), np.uint8))[0]
    gray = np.minimum(gray * np.clip(230 / np.maximum(env, 1), 1, 4)[None, :], 255)

    # Vodorovny rozsah klavesnice = sloupce, ktere jsou v pasu bile svetle.
    white_prof = gray[wy0:wy1].mean(axis=0)
    cols = _runs(white_prof > 150, merge_gap=max(3, w // 100))
    kx0, kx1 = max(cols, key=lambda r: r[1] - r[0])
    if kx1 - kx0 < w * 0.3:
        return None

    # 2) Pas cernych klaves: od pasu bile nahoru, dokud radek obsahuje svetle i tmave.
    seg = gray[:, kx0:kx1]
    by0, y, miss = wy0, wy0, 0
    while y > 0 and miss <= 3:                 # tolerovat par prechodovych radku (vyhlazene hrany)
        row = seg[y - 1]
        y -= 1
        if (row > 150).mean() < 0.15 or (row < 100).mean() < 0.15:
            miss += 1
        else:
            miss, by0 = 0, y
    black_h = wy0 - by0
    if black_h < 4:
        return None

    width_px = kx1 - kx0
    band = gray[wy0 + 1: wy0 + max(3, (wy1 - wy0) // 2), kx0:kx1]
    base = float(np.median(band))

    # Cerne klavesy = tmave useky ve stredu pasu cernych klaves (vzdy kontrastni).
    mid = seg[by0 + black_h // 4: by0 + 3 * black_h // 4]
    is_dark = (mid < np.minimum(100, base * 0.5)).mean(axis=0) > 0.6
    dark_runs = _runs(is_dark)

    # Dve metody pro bile klavesy, vybere se ta, ktere lip sedi vzor cernych klaves:
    #  A) tmave delici cary mezi bilymi klavesami,
    #  B) mrizka z poloh cernych klaves (kdyz jsou delici cary skoro neviditelne).
    candidates = [c for c in (_whites_from_separators(band), _whites_from_blacks(dark_runs, width_px)) if c]
    if not candidates:
        return None
    best = None
    for whites, W in candidates:
        blacks = _filter_blacks(dark_runs, W, len(is_dark))
        best_p, pattern_score = _black_pattern(whites, blacks, W)
        cand = (pattern_score, len(whites), whites, W, blacks, best_p)
        if best is None or cand[:2] > best[:2]:
            best = cand
    pattern_score, _, whites, W, blacks, best_p = best

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


def _flash_ranges(kb: KeyboardLayout) -> np.ndarray:
    """Sloupce pro cteni nad klavesnici: bila klavesa bez casti, nad kterou dopadaji cerne noty."""
    blacks = [(k.x_left, k.x_right) for k in kb.keys if k.is_black]
    out = []
    for k in kb.keys:
        a, b = k.x_left, k.x_right
        if k.is_black:
            m = max(1, (b - a) // 4)
            out.append((a + m, max(a + m + 1, b - m)))      # uzka cerna (nizke rozliseni): aspon 1 px
            continue
        c = (a + b) / 2
        for bl, br in blacks:
            if bl < b and br > a:                # cerna zasahuje do bile: odriznout tu stranu
                if (bl + br) / 2 < c:
                    a = max(a, br)
                else:
                    b = min(b, bl)
        out.append((a + 1, max(a + 2, b - 1)))
    return np.array(out)


def _band_luma(frame, y1: int, ranges) -> np.ndarray:
    """Prumerny jas 3 radku nad y1 pro kazdou klavesu -> (n_keys,)."""
    prof = cv2.reduce(cv2.cvtColor(frame[y1 - 3:y1], cv2.COLOR_BGR2GRAY), 0, cv2.REDUCE_AVG, dtype=cv2.CV_32F)[0]
    cs = np.concatenate([[0.0], np.cumsum(prof)])
    return (cs[ranges[:, 1]] - cs[ranges[:, 0]]) / (ranges[:, 1] - ranges[:, 0])


def _flash_notes(g: np.ndarray, kb: KeyboardLayout, times: np.ndarray, dt: float,
                 rise: float = 30, keep: float = 100, post_s: float = 0.15,
                 min_dur: float = 0.0) -> List[DetectedNote]:
    """
    Noty z pasu tesne nad klavesnici ve videich, kde nota pri dopadu blikne pres 2 klavesy
    na kazdou stranu (Pianella apod.). Zacatek = skok jasu; nota = klavesa, ktera sviti
    i po zablesku (post_s) a sviti vic nez oba sousede (zare od vedlejsi noty je slabsi).
    Kratsi nota (staccato) staci, kdyz po zablesku sousede zhasnou a ona jeste sviti.
    Nota konci zhasnutim nebo dalsim uhozem teze klavesy (opakovany akord nikdy nezhasne);
    zablesk vedlejsi noty drzenou notu neukonci.
    shortcut: dve sousedni pultonove noty naraz se rozpoznaji jen jako jedna, upravit az bude vadit.
    """
    n, K = g.shape
    post = max(1, int(round(post_s / dt)))
    base = np.percentile(g, 20, axis=0)
    on = g - base >= keep
    up = np.zeros_like(g, bool)
    up[1:] = g[1:] - g[:-1] > rise
    up[1:] &= ~up[:-1]                       # zablesk trva par snimku - jen prvni
    black = [kk.midi_note % 12 in (1, 3, 6, 8, 10) for kk in kb.keys]
    hits = []                                # (klavesa, uhoz, snimek, od ktereho nota urcite sviti)
    for t, k in zip(*np.where(up)):
        tp = min(n - 1, t + post)
        nb = [j for j in (k - 1, k + 1) if 0 <= j < K]
        if on[tp, k] and g[tp, k] >= max(g[tp, j] for j in nb) - 1:
            hits.append((k, t, tp))
            continue
        # jen klavesa, ktera pred uhozem nesvitila - drzenou notu rozsviti i zablesk souseda.
        # Bila hned po uhozu cerne vedle je zare te cerne noty (Levels: 59 takovych, zni jako nahoda).
        short = [f for f in range(t + 1, tp + 1) if on[f, k] and not any(on[f, j] for j in nb)]
        leak = not black[k] and any(black[j] and (up[max(0, t - 3):t, j] & ~up[max(0, t - 3):t, k]).any() for j in nb)
        if short and not on[t - 1, k] and not leak:
            hits.append((k, t, short[0]))
    hits.sort()
    notes = []
    for i, (k, t, f) in enumerate(hits):
        stop = hits[i + 1][1] if i + 1 < len(hits) and hits[i + 1][0] == k else n   # dalsi uhoz teze klavesy
        e = min(f, stop - 1)
        while e + 1 < stop and on[e + 1, k]:
            e += 1
        if times[e] + dt - times[t] < min_dur:
            continue
        notes.append(DetectedNote(midi_note=kb.keys[k].midi_note, start_time=round(float(times[t]), 4),
                                  end_time=round(float(times[e] + dt), 4)))
    notes.sort(key=lambda n: (n.start_time, n.midi_note))
    return drop_bursts(notes)


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
    return drop_bursts(notes)


def drop_bursts(notes: List[DetectedNote], max_together: int = 10) -> List[DetectedNote]:
    """
    Hrac ma 10 prstu: vic nez 10 not se stejnym zacatkem neni hudba, ale efekt videa
    (zaverecny zablesk, prechod, titulky pres klavesnici). Takove skupiny se zahodi.
    """
    from collections import Counter
    counts = Counter(n.start_time for n in notes)
    bursts = {t for t, c in counts.items() if c > max_together}
    if bursts:
        print(f"  Zahozeno {sum(counts[t] for t in bursts)} not ze {len(bursts)} zablesku (> {max_together} not naraz)")
    return [n for n in notes if n.start_time not in bursts]


def _lab(hsv) -> np.ndarray:
    bgr = cv2.cvtColor(np.uint8([[hsv]]), cv2.COLOR_HSV2BGR)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)


def _two_colors(pts: np.ndarray):
    """
    2-means v barevnem prostoru. Vraci pole bool (prislusnost k 2. shluku) nebo None,
    kdyz barvy netvori dva zretelne shluky (vzdalenost stredu >= 4x rozptyl uvnitr shluku).
    """
    c0 = np.median(pts, axis=0)
    c1 = pts[int(np.argmax(((pts - c0) ** 2).sum(axis=1)))]
    c0 = pts[int(np.argmax(((pts - c1) ** 2).sum(axis=1)))]
    for _ in range(25):
        lab = ((pts - c1) ** 2).sum(axis=1) < ((pts - c0) ** 2).sum(axis=1)
        if lab.all() or (~lab).all():
            return None
        c0, c1 = pts[~lab].mean(axis=0), pts[lab].mean(axis=0)
    between = float(np.linalg.norm(c0 - c1))
    within = float(np.sqrt(np.mean(np.where(lab[:, None], pts - c1, pts - c0) ** 2) * 3))
    if between < 6 or between < 4 * within or min(lab.mean(), 1 - lab.mean()) < 0.04:
        return None
    return lab


def _hand_colors(pts: np.ndarray, pitch: np.ndarray):
    """
    Dva shluky barev = dve ruce. Ruce se lisi i rejstrikem, takze rozdeleni plati, jen kdyz se
    prumerna vyska shluku lisi aspon o 5 pultonu. Jinak je mensi shluk zbytek efektu (zablesk,
    stin) - pokud je maly (< 15 %), vyradi se a deli se znovu. Vraci (indexy, prislusnost) nebo None.
    """
    idx = np.arange(len(pts))
    for _ in range(3):
        if len(idx) < 4:
            return None
        lab = _two_colors(pts[idx])
        if lab is None:
            return None
        if abs(pitch[idx][lab].mean() - pitch[idx][~lab].mean()) >= 5:
            return idx, lab
        small = lab if lab.mean() < 0.5 else ~lab
        if small.mean() >= 0.15:
            return None                                               # barvy nejsou ruce
        idx = idx[~small]                                             # odriznout odlehle noty
    return None


def assign_hands(notes: List[DetectedNote]) -> bool:
    """
    Rozdeli noty na levou/pravou ruku podle barvy.
    Videa barvi ruce ruzne, casto i zvlast bile a cerne klavesy (4 barvy, nekdy skoro stejne
    odstiny), proto se shlukuje zvlast na bilych a zvlast na cernych klavesach, v barve Lab
    a jen u sytych not (zablesky a sede noty by shluky pokazily). Shluk s nizsi prumernou
    vyskou = leva ruka. Ostatni noty dostanou ruku podle not, ktere zni okolo.
    Vraci False, pokud barvy ruce nerozlisuji (pak hand zustane '').
    """
    if len(notes) < 4:
        return False
    raw = np.array([_lab(n.color_hsv) for n in notes])
    labs = raw * np.float32([0.5, 1, 1])                                   # jas ma mensi vahu
    saturated = np.array([n.color_hsv[1] >= 60 and n.color_hsv[2] >= 60 for n in notes])
    black = np.array([n.midi_note % 12 in (1, 3, 6, 8, 10) for n in notes])
    # rozsvicena bila klavesa je vzdy svetla; tmave "bile" noty jsou zbytky efektu
    usable = saturated & (black | (raw[:, 0] >= 150))
    done = np.zeros(len(notes), bool)
    for is_black in (False, True):
        idx = np.where(usable & (black == is_black))[0]
        if len(idx) < 4:
            continue
        found = _hand_colors(labs[idx], np.array([notes[i].midi_note for i in idx], np.float32))
        if found is None:
            continue
        sub, lab = found
        idx = idx[sub]
        pitch = np.array([notes[i].midi_note for i in idx])
        right_is_1 = pitch[lab].mean() > pitch[~lab].mean()
        for i, l in zip(idx, lab):
            notes[i].hand = 'R' if l == right_is_1 else 'L'
            done[i] = True
    if not done.any():
        return False

    # zbytek (zablesky, typ klaves bez rozlisene barvy) podle okoli
    assigned = [n for n, d in zip(notes, done) if d]
    for n, d in zip(notes, done):
        if d:
            continue
        ctx = [m for m in assigned if m.start_time < n.end_time + 1.0 and m.end_time > n.start_time - 1.0]
        left = [m.midi_note for m in ctx if m.hand == 'L']
        right = [m.midi_note for m in ctx if m.hand == 'R']
        if left and right:
            n.hand = 'L' if abs(n.midi_note - np.mean(left)) < abs(n.midi_note - np.mean(right)) else 'R'
        elif left:
            n.hand = 'L' if n.midi_note <= max(left) + 7 else 'R'
        elif right:
            n.hand = 'R' if n.midi_note >= min(right) - 7 else 'L'
        else:
            n.hand = 'L' if n.midi_note < 60 else 'R'
    return any(n.hand == 'L' for n in notes) and any(n.hand == 'R' for n in notes)


def fix_hand_spans(notes: List[DetectedNote], max_span: int = 12) -> int:
    """
    Jedna ruka neobsahne vic nez oktavu. Kdyz akord jedne ruky (stejny zacatek) presahne oktavu
    a druha ruka v tu chvili nic nezacina, krajni tony prejdou do druhe ruky (typicky zaverecny
    akord, kde video obarvi obe ruce stejne). Vraci pocet presunutych not.
    """
    from itertools import groupby
    moved = 0
    for _, group in groupby(sorted(notes, key=lambda n: n.start_time), key=lambda n: n.start_time):
        group = list(group)
        for hand, other in (('L', 'R'), ('R', 'L')):
            own = sorted((n for n in group if n.hand == hand), key=lambda n: n.midi_note)
            if any(n.hand == other for n in group) or len(own) < 2:
                continue
            while own and own[-1].midi_note - own[0].midi_note > max_span:
                # nejvzdalenejsi ton od zbytku ruky prejde do druhe ruky
                out = own.pop() if hand == 'L' else own.pop(0)
                out.hand = other
                moved += 1
    return moved


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
    flash_y, flash_rg = kb.keyboard_top - max(4, int(cap.get(4)) // 60), _flash_ranges(kb)

    colors, hits, flashes, times = [], [], [], []
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
            flashes.append(_band_luma(frame, flash_y, flash_rg))
            times.append(idx / fps)
            if progress_callback and len(times) % 300 == 0:
                progress_callback(min(99.0, 100.0 * idx / max(1, total)), f"snimek {idx}/{total}")
        idx += 1
    cap.release()
    if not times:
        return []

    colors = np.stack(colors)
    hits, flashes = np.stack(hits).astype(np.float32), np.stack(flashes)
    times = np.array(times)
    dt = config.frame_skip / fps
    # Snimky bez klavesnice (uvodni karta, titulky, prechod): vetsina klaves se lisi od medianu.
    # Dosadi se do nich klidova klavesnice - jinak by se je klouzavy median naucil jako pozadi
    # a zmeny textu by vypadaly jako noty (Climax JUMPING: 6 s uvodu = 30 falesnych not).
    med_colors = _key_colors(med, kb, white_rows, black_rows, ranges, is_black)
    gone = np.median(np.linalg.norm(colors - med_colors, axis=2), axis=1) > 1.5 * config.lit_threshold
    if gone.any():
        print(f"  Bez klavesnice (uvod, titulky): {gone.sum() * dt:.1f} s")
        colors[gone] = med_colors
        hits[gone] = _hit_line_colors(med, kb, ranges)
        flashes[gone] = _band_luma(med, flash_y, flash_rg)
    lit = _changed(colors, 1 / dt, config.lit_threshold)
    hit = _changed(hits, 1 / dt, config.lit_threshold)
    if hit.mean() < lit.mean() < 4 * hit.mean():
        # Pomer lit/hit: Synthesia 0,30-0,52 (linie nad klavesou se meni vic nez klavesa), natocene
        # ruce pres klavesy (Pianella) 1,23 - linie tam blika pri kazdem dopadu. Linie, ktera se
        # skoro nemeni (staticky filc nad klavesami), neni zablesk: tam se ctou klavesy.
        print("  Klavesy zakryvaji ruce - ctu noty ze zablesku nad klavesnici")
        notes = _flash_notes(flashes, kb, times, dt, min_dur=config.min_note_duration)
    else:
        if lit.mean() * 5 < hit.mean():
            print("  Klavesy se v tomto videu nebarvi - ctu noty z linie dopadu")
            lit = hit
        notes = _active_to_notes(lit, colors, kb, times, dt, config.min_note_duration)
    if config.split_hands and assign_hands(notes):
        print(f"\n  Ruce podle barvy: L={sum(n.hand == 'L' for n in notes)}, R={sum(n.hand == 'R' for n in notes)}")
        moved = fix_hand_spans(notes)
        if moved:
            print(f"  Prehozeno do druhe ruky (akord sirsi nez oktava): {moved}")
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
