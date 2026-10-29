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
from types import SimpleNamespace  # noqa: E402
from note_detector import (DetectedNote, DetectorConfig, _flash_notes, _flash_ranges, _read_mode, assign_hands, detect_keyboard,  # noqa: E402
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


def render_video(path, duration=6.0, intro=0.0, felt=0):
    rects = key_rects()
    kb_top, white_top, kb_bot = 300, 400, 470
    stop = kb_top - felt                           # noty dopadaji na horni okraj filcu nad klavesami
    speed = 150.0                                  # px/s padani
    vw = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*'mp4v'), FPS, (W, H))
    for f in range(int((duration + intro) * FPS)):
        img = np.zeros((H, W, 3), np.uint8)
        if f / FPS < intro:                        # uvodni karta: text bez klavesnice, blika
            img[:] = (40, 30, 30)
            for i in range(6):
                if (f // 10 + i) % 3:
                    cv2.rectangle(img, (60 + i * 120, 330 + (i % 2) * 60), (140 + i * 120, 360 + (i % 2) * 60), (255, 255, 255), -1)
            vw.write(img)
            continue
        t = f / FPS - intro
        for m, s, e, hand in TRUTH:                # padajici noty
            x0, x1, _ = rects[m]
            y_bot, y_top = stop - (s - t) * speed, stop - (e - t) * speed
            if y_bot > 0 and y_top < stop:
                cv2.rectangle(img, (x0 + 2, int(max(0, y_top)) + 2), (x1 - 2, int(min(stop, y_bot)) - 2),
                              RH if hand == 'R' else LH, -1)
        img[stop:kb_top] = (30, 30, 150)           # cerveny filc (felt=0: nic)
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


def test_keyboard_with_vignette_and_glow():
    # natocene piano (Pianella): klavesy tmavnou ke krajum, nad nimi svitici linka jasnejsi nez klavesy
    img = np.zeros((H, W, 3), np.uint8)
    for m, (x0, x1, is_b) in sorted(key_rects().items(), key=lambda kv: kv[1][2]):
        cv2.rectangle(img, (x0, 300), (x1, 395 if is_b else 470), (20, 20, 20) if is_b else (200, 200, 200), -1)
    img[294:297] = 255
    gain = 0.3 + 0.7 * np.sin(np.linspace(0, np.pi, W))           # stred 1.0, kraje 0.3
    img = (img * gain[None, :, None]).astype(np.uint8)
    kb = detect_keyboard(img)
    assert kb is not None and kb.pattern_score == 1.0
    whites = [k for k in kb.keys if not k.is_black]
    assert len(whites) == N_WHITE and whites[0].midi_note == FIRST, (len(whites), whites[0].note_name)


def _flash(g, f0, k, frames=3):
    # zablesk pri dopadu noty: klavesa nejjasnejsi, sousede slabsi (zare), 2 klavesy na kazdou stranu
    for d, v in ((0, 250), (1, 195), (2, 150)):
        for j in {k - d, k + d} & set(range(g.shape[1])):
            g[f0:f0 + frames, j] = np.maximum(g[f0:f0 + frames, j], v)


def test_flash_notes():
    # nota pri dopadu blikne pres 2 klavesy na kazdou stranu, pak sviti jen ona; opakovany uhoz
    g = np.full((40, 12), 70.0)
    for f0 in (10, 18):
        _flash(g, f0, 4)
        g[f0 + 3:f0 + 6, 4] = 240                                   # nota E4
    g[16:18, 4] = 195                                               # pohasina, ale konci az dalsim uhozem
    assert _flash_found(g) == [(64, 10, 18), (64, 18, 24)]


def test_flash_held_note_and_neighbour():
    # drzene E4 a uhoz F4 vedle: zare F4 je slabsi nez E4, E4 nekonci
    g = np.full((60, 12), 70.0)
    _flash(g, 10, 4)
    g[13:41, 4] = 200
    _flash(g, 22, 5)
    g[25:35, 5] = 240
    assert _flash_found(g) == [(64, 10, 41), (65, 22, 35)]
    # skutecny opakovany uhoz drzene E4 (zablesk ma stred na E4) = nova nota. Slucovat takove uhozy
    # s drzenou notou bylo podle zvuku horsi (Levels: 91 ze 133 skutecnych, tools/eval_detekce.py).
    g = np.full((60, 12), 70.0)
    _flash(g, 10, 4)
    g[13:41, 4] = 200
    _flash(g, 22, 4)
    assert _flash_found(g) == [(64, 10, 22), (64, 22, 41)]


def test_flash_fast_repeats_do_not_overlap():
    # E4 kazde 3 snimky (0,1 s): kazdy uhoz je nota, zadna nezasahuje do dalsi
    g = np.full((60, 12), 70.0)
    for f0 in range(10, 40, 3):
        _flash(g, f0, 4, frames=1)
        g[f0 + 1, 4], g[f0 + 2, 4] = 240, 200                       # sviti a pred dalsim uhozem pohasina
    found = _flash_found(g)
    assert [s for _, s, _ in found] == list(range(10, 40, 3)), found
    assert all(e <= s2 for (_, _, e), (_, s2, _) in zip(found, found[1:])), found


def test_read_mode():
    rng = np.random.default_rng(0)
    hit = rng.random((3000, 50)) < 0.08                      # linie dopadu blika
    lit = hit & (rng.random(hit.shape) < 0.4)                # Synthesia: klavesa sviti pod svitici linii
    assert _read_mode(lit, hit) == 'keys'
    hands = rng.random(hit.shape) < 0.05                     # natocene piano: klavesy meni ruce (Let Her Go:
                                                             # meni se min nez linie, stary pomer to nepoznal)
    assert _read_mode(hands, hit) == 'flash'
    assert _read_mode(hands, np.zeros_like(hit)) == 'keys'   # staticky filc nad klavesami
    assert _read_mode(lit & (rng.random(hit.shape) < 0.1), hit) == 'line'   # klavesy se skoro nebarvi


def _flash_found(g, **kw):
    kb = SimpleNamespace(keys=[SimpleNamespace(midi_note=60 + i) for i in range(len(g[0]))])
    dt = 1 / 30
    return [(n.midi_note, round(n.start_time / dt), round(n.end_time / dt))
            for n in _flash_notes(g, kb, np.arange(len(g)) * dt, dt, **kw)]


def test_flash_ranges_narrow_black_key():
    # nizke rozliseni: cerna klavesa 2 px siroka nesmi dat prazdny rozsah (deleni nulou)
    keys = [SimpleNamespace(x_left=0, x_right=6, is_black=False), SimpleNamespace(x_left=5, x_right=7, is_black=True),
            SimpleNamespace(x_left=6, x_right=12, is_black=False)]
    r = _flash_ranges(SimpleNamespace(keys=keys))
    assert (r[:, 1] > r[:, 0]).all(), r


def test_synthetic_video():
    for felt in (0, 12):                            # 12 px staticky filc nad klavesami: linie se nemeni
        _check_synthetic(felt)


def _check_synthetic(felt):
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, 'synth.mp4')
        render_video(path, felt=felt)

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



def test_intro_card_without_keyboard():
    # 9 s uvodni karty (delsi nez pul okna klouzaveho medianu): zadne falesne noty, ostatni sedi
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, 'intro.mp4')
        render_video(path, duration=20.0, intro=9.0)          # uvod je mensina videa jako ve skutecnosti
        notes = detect_notes_from_video(path, DetectorConfig())
        found = sorted((n.midi_note, round(n.start_time - 9.0, 2), n.hand) for n in notes)
        truth = sorted(TRUTH)
        assert len(found) == len(truth), found
        # rezim zustane "klavesy se barvi" (uvod nesmi vypadat jako ruce pres klavesy) -> ruce podle barvy
        assert all(abs(t - s) <= 1.5 / FPS and h == th for (_, t, h), (_, s, _, th) in zip(found, truth)), found


if __name__ == '__main__':
    for name, fn in list(globals().items()):
        if name.startswith('test_'):
            fn()
            print(f'OK  {name}')
