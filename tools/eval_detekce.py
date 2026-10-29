"""
Kontrola detekce not proti zvuku: noty ze zvukove stopy (basic-pitch) jako reference.

    1) reference (basic-pitch nejde na Python 3.14 -> samostatne prostredi s Pythonem 3.10;
       m4a neprecte, proto nejdriv wav pres PyAV z hlavniho prostredi):
       py -3.10 -m venv output/venv-bp && output/venv-bp/Scripts/pip install basic-pitch
       python tools/eval_detekce.py wav output/<id>/audio.m4a output/<id>/audio.wav
       output/venv-bp/Scripts/python tools/eval_detekce.py ref output/<id>/audio.wav output/<id>/ref.json
    2) porovnani (noty z knihovny web/songs/*.json nebo seznam [p, s, e]):
       python tools/eval_detekce.py cmp web/songs/<skladba>.json output/<id>/ref.json

Vypise posun obrazu proti zvuku, presnost (kolik detekovanych not je ve zvuku) a uplnost
(kolik not ze zvuku detekce nasla). basic-pitch sam neni presny, cisla jsou hlavne na porovnani
dvou verzi detekce na stejnem videu. Teorie: teorie/05-detekce-videa.md.
"""
import json
import sys
from bisect import bisect_left
from statistics import median


def to_wav(src, out_path):
    import os
    import wave
    import numpy as np
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from audio_octave import load_audio, SR
    x = load_audio(src)
    with wave.open(out_path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
    print(f'{len(x) / SR:.0f} s -> {out_path}')


def reference(audio_path, out_path):
    from basic_pitch.inference import predict
    _, _, events = predict(audio_path)
    notes = sorted([int(p), round(float(s), 3), round(float(e), 3)] for s, e, p, *_ in events)
    with open(out_path, 'w') as f:
        json.dump(notes, f)
    print(f'{len(notes)} not ze zvuku -> {out_path}')


def load(path):
    data = json.load(open(path, encoding='utf-8'))
    if isinstance(data, dict):
        data = [[n['p'], n['s'], n['e']] for n in data['notes']]
    return sorted((int(p), float(s), float(e)) for p, s, e in data)


def match(det, ref, offset=0.0, tol=0.05):
    """Pary (detekovana, reference) se stejnou vyskou a zacatkem do tol (det posunute o offset)."""
    by_pitch = {}
    for i, (p, s, _) in enumerate(ref):
        by_pitch.setdefault(p, []).append((s, i))
    used, pairs = set(), []
    for d in sorted(det, key=lambda n: n[1]):
        cands = by_pitch.get(d[0], [])
        t = d[1] - offset
        k = bisect_left(cands, (t - tol, -1))
        best = None
        while k < len(cands) and cands[k][0] <= t + tol:
            if cands[k][1] not in used and (best is None or abs(cands[k][0] - t) < abs(best[0] - t)):
                best = cands[k]
            k += 1
        if best:
            used.add(best[1])
            pairs.append((d, ref[best[1]]))
    return pairs


def compare(det, ref, tol=0.05):
    # posun obrazu proti zvuku (nota se rozsviti o par snimku driv/pozdeji nez zazni)
    rough = match(det, ref, 0.0, 0.3)
    offset = median(d[1] - r[1] for d, r in rough) if rough else 0.0
    pairs = match(det, ref, offset, tol)
    return {'offset': offset, 'det': len(det), 'ref': len(ref), 'ok': len(pairs),
            'precision': len(pairs) / max(1, len(det)), 'recall': len(pairs) / max(1, len(ref))}


def main():
    if len(sys.argv) == 4 and sys.argv[1] == 'wav':
        to_wav(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == 'ref':
        reference(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == 'cmp':
        r = compare(load(sys.argv[2]), load(sys.argv[3]))
        print(f"posun {r['offset'] * 1000:+.0f} ms | detekce {r['det']}, zvuk {r['ref']}, shoda {r['ok']} | "
              f"presnost {r['precision']:.1%}, uplnost {r['recall']:.1%}")
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == '__main__':
    main()
