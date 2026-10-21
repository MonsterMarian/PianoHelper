"""
Test detekce not na synteticky vyrobenem Synthesia videu se znamymi notami.

    python tests/test_detector.py      (nebo pytest tests/)
"""
import os
import sys
import tempfile

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from note_detector import (DetectedNote, DetectorConfig, assign_hands, detect_keyboard,  # noqa: E402
                           detect_notes_from_video, drop_bursts, fix_hand_spans, median_frame, parse_note_name)

FPS = 30
W, H = 854, 480
FIRST = 40          # E2 = nejlevejsi bila klavesa (jako ve videu Fourth of July)
N_WHITE = 28
RH = (240, 150, 60)     # BGR modra
LH = (150, 110, 230)    # BGR ruzova

# (midi, start, end, ruka) - vcetne opakovane noty s kratkou mezerou a akordu
TRUTH = [
    (64, 1.0, 1.5, 'R'), (64, 1.6, 2.1, 'R'), (64, 2.2, 2.7, 'R'),   # opakovane E4, mezera 0.1 s
    (48, 1.0, 3.0, 'L'), (52, 1.0, 3.0, 'L'), (55, 1.0, 3.0, 'L'),   # akord C3 E3 G3
    (66, 3.2, 3.6, 'R'), (68, 3.6, 4.0, 'R'), (70, 4.0, 4.4, 'R'),   # cerne klavesy F#4 G#4 A#4
    (43, 3.2, 4.4, 'L'), (85, 4.6, 5.2, 'R'), (41, 4.6, 5.2, 'L'),   # G2, C#6, F2
]


def white_midis():
    out, m = [], FIRST
    while len(out) < N_WHITE:
        if m % 12 in (0, 2, 4, 5, 7, 9, 11):
            out.append(m)
        m += 1
    return out


def key_rects():
    ww = W / N_WHITE
    rects = {}
    for i, m in enumerate(white_midis()):
        rects[m] = (int(i * ww), int((i + 1) * ww), False)
    for m in range(FIRST, white_midis()[-1]):
        if m % 12 in (1, 3, 6, 8, 10) and m - 1 in rects:
            x = rects[m - 1][1]
            rects[m] = (int(x - ww * 0.3), int(x + ww * 0.3), True)
    return rects


def render_video(path, duration=6.0):
    rects = key_rects()
    kb_top, white_top, kb_bot = 300, 400, 470
    speed = 150.0                                  # px/s padani
    vw = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*'mp4v'), FPS, (W, H))
    for f in range(int(duration * FPS)):
        t = f / FPS
        img = np.zeros((H, W, 3), np.uint8)
        for m, s, e, hand in TRUTH:                # padajici noty
            x0, x1, _ = rects[m]
            y_bot, y_top = kb_top - (s - t) * speed, kb_top - (e - t) * speed
            if y_bot > 0 and y_top < kb_top:
                cv2.rectangle(img, (x0 + 2, int(max(0, y_top)) + 2), (x1 - 2, int(min(kb_top, y_bot)) - 2),
                              RH if hand == 'R' else LH, -1)
        lit = {m: hand for m, s, e, hand in TRUTH if s <= t < e}
        for black in (False, True):                # klavesnice
            for m, (x0, x1, is_b) in rects.items():
                if is_b != black:
                    continue
                color = (RH if lit[m] == 'R' else LH) if m in lit else ((20, 20, 20) if is_b else (245, 245, 245))
                if is_b:
                    cv2.rectangle(img, (x0, kb_top), (x1, white_top - 5), color, -1)
                else:
                    cv2.rectangle(img, (x0, kb_top), (x1 - 1, kb_bot), color, -1)
                    cv2.line(img, (x1 - 1, kb_top), (x1 - 1, kb_bot), (90, 90, 90), 1)
        vw.write(img)
    vw.release()


def test_parse_note_name():
    assert parse_note_name('C4') == 60
    assert parse_note_name('A0') == 21
    assert parse_note_name('F#2') == 42
    assert parse_note_name('Bb3') == 58
    assert parse_note_name('60') == 60
    assert parse_note_name('H4') is None


def test_assign_hands_by_color():
    notes = [DetectedNote(40 + i, i, i + 1, color_hsv=(105, 200, 200)) for i in range(5)]
    notes += [DetectedNote(70 + i, i, i + 1, color_hsv=(165, 200, 200)) for i in range(5)]
    assert assign_hands(notes)
    assert all(n.hand == 'L' for n in notes[:5]) and all(n.hand == 'R' for n in notes[5:])
    same = [DetectedNote(40 + i, i, i + 1, color_hsv=(105, 200, 200)) for i in range(8)]
    assert not assign_hands(same)          # jedna barva = ruce nerozlisit


def test_assign_hands_four_similar_colors():
    # "give it back": leva = zluta (bile) + oranzova (cerne), prava = jina zluta (bile) + zelena (cerne);
    # odstin bilych se lisi jen o 8 stupnu. Navic par not ma barvu zablesku (bila/seda).
    import random
    rnd = random.Random(1)
    notes = []
    for i in range(60):
        lp = rnd.choice([41, 43, 45, 47, 48])               # bile, leva
        rp = rnd.choice([65, 67, 69, 71, 72, 74])            # bile, prava
        notes.append(DetectedNote(lp, i, i + .5, color_hsv=(28, 230, 250), hand='?L'))
        notes.append(DetectedNote(rp, i, i + .5, color_hsv=(32, 225, 245), hand='?R'))
        if i % 3 == 0:
            notes.append(DetectedNote(42, i + .5, i + .9, color_hsv=(16, 220, 240), hand='?L'))   # cerna, leva
            notes.append(DetectedNote(70, i + .5, i + .9, color_hsv=(50, 230, 220), hand='?R'))   # cerna, prava
    notes.append(DetectedNote(60, 30.2, 30.6, color_hsv=(0, 0, 255), hand='?R'))    # zablesk uprostred, okoli prava
    for n in notes:
        n.hand, n.truth = '', n.hand[1]
    assert assign_hands(notes)
    wrong = [n for n in notes if n.hand != n.truth]
    assert len(wrong) <= 1, [(n.note_name, n.color_hsv, n.hand) for n in wrong]


def test_drop_bursts():
    chord = [DetectedNote(60 + i, 1.0, 2.0) for i in range(10)]           # 10 prstu = jeste hudba
    burst = [DetectedNote(40 + i, 5.0, 5.5) for i in range(30)]           # zablesk pres celou klavesnici
    kept = drop_bursts(chord + burst + [DetectedNote(72, 5.2, 5.6)])
    assert len(kept) == 11 and all(n.start_time != 5.0 for n in kept)


def test_fix_hand_spans():
    # zaverecny akord obarveny jako leva ruka: C3 E3 A3 + C5 E5 -> horni tony do prave ruky
    final = [DetectedNote(p, 10.0, 12.0, hand='L') for p in (48, 52, 57, 72, 76)]
    assert fix_hand_spans(final) == 2
    assert [n.hand for n in final] == ['L', 'L', 'L', 'R', 'R']
    # kdyz druha ruka hraje, nic se neprehazuje (muze to byt zamer)
    both = [DetectedNote(48, 1.0, 2.0, hand='L'), DetectedNote(72, 1.0, 2.0, hand='L'), DetectedNote(76, 1.0, 2.0, hand='R')]
    assert fix_hand_spans(both) == 0


def test_keyboard_without_separator_lines():
    # nektera videa nemaji mezi bilymi klavesami viditelne cary -> mrizka z cernych klaves
    img = np.zeros((H, W, 3), np.uint8)
    for m, (x0, x1, is_b) in sorted(key_rects().items(), key=lambda kv: kv[1][2]):
        if is_b:
            cv2.rectangle(img, (x0, 300), (x1, 395), (20, 20, 20), -1)
        else:
            cv2.rectangle(img, (x0, 300), (x1, 470), (245, 245, 245), -1)
    kb = detect_keyboard(img)
    assert kb is not None and kb.pattern_score == 1.0
    whites = [k for k in kb.keys if not k.is_black]
    assert len(whites) == N_WHITE, len(whites)
    assert whites[0].midi_note == FIRST


def test_synthetic_video():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, 'synth.mp4')
        render_video(path)

        cap = cv2.VideoCapture(path)
        kb = detect_keyboard(median_frame(cap))
        cap.release()
        assert kb is not None
        whites = [k for k in kb.keys if not k.is_black]
        assert len(whites) == N_WHITE, len(whites)
        assert whites[0].midi_note == FIRST, whites[0].note_name        # E2 podle stredu klavesnice
        assert kb.pattern_score == 1.0

        notes = detect_notes_from_video(path, DetectorConfig())
        found = [(n.midi_note, n.start_time, n.end_time, n.hand) for n in notes]
        assert len(found) == len(TRUTH), found
        tol = 1.5 / FPS
        for m, s, e, hand in TRUTH:
            match = [f for f in found if f[0] == m and abs(f[1] - s) <= tol]
            assert match, f'chybi nota {m} @ {s}: {found}'
            assert abs(match[0][2] - e) <= tol, (m, s, e, match)
            assert match[0][3] == hand, (m, s, hand, match)


if __name__ == '__main__':
    for name, fn in list(globals().items()):
        if name.startswith('test_'):
            fn()
            print(f'OK  {name}')
