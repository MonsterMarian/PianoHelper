"""
midi_generator.py - Prevod detekovanych not na MIDI soubor.
"""
import mido
from mido import Message, MidiFile, MidiTrack
from typing import List
from note_detector import DetectedNote
import os


def notes_to_midi(
    notes: List[DetectedNote],
    output_path: str,
    tempo: int = 120,
    ticks_per_beat: int = 480,
    title: str = "Detected Piano Notes"
) -> str:
    """
    Prevede seznam DetectedNote na MIDI soubor.
    
    Args:
        notes: Seznam detekovanych not
        output_path: Cesta pro ulozeni MIDI
        tempo: Tempo v BPM
        ticks_per_beat: Rozliseni MIDI
        title: Nazev skladby
    
    Returns:
        Cesta k ulozenemu MIDI souboru
    """
    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else '.', exist_ok=True)
    
    mid = MidiFile(ticks_per_beat=ticks_per_beat)
    track = MidiTrack()
    mid.tracks.append(track)
    
    # Metadata
    track.append(mido.MetaMessage('track_name', name=title, time=0))
    track.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(tempo), time=0))
    
    if not notes:
        mid.save(output_path)
        return output_path
    
    # Vytvorit seznam udalosti (note_on, note_off)
    events = []
    for note in notes:
        start_tick = int(note.start_time * ticks_per_beat * tempo / 60)
        end_tick = int(note.end_time * ticks_per_beat * tempo / 60)
        
        # Zajistit minimalni delku noty
        if end_tick <= start_tick:
            end_tick = start_tick + 1
        
        events.append(('note_on', start_tick, note.midi_note, note.velocity))
        events.append(('note_off', end_tick, note.midi_note, 0))
    
    # Seradit podle casu, note_off pred note_on pri stejnem casu
    events.sort(key=lambda e: (e[1], 0 if e[0] == 'note_off' else 1))
    
    # Konvertovat na delta casy
    last_tick = 0
    for event_type, tick, midi_note, velocity in events:
        delta = tick - last_tick
        if delta < 0:
            delta = 0
        
        if event_type == 'note_on':
            track.append(Message('note_on', note=midi_note, velocity=velocity, time=delta))
        else:
            track.append(Message('note_off', note=midi_note, velocity=0, time=delta))
        
        last_tick = tick
    
    # Konec skladby
    track.append(mido.MetaMessage('end_of_track', time=0))
    
    mid.save(output_path)
    print(f"  MIDI ulozeno: {output_path}")
    print(f"  {len(notes)} not, tempo {tempo} BPM")
    
    return output_path


def notes_to_text(notes: List[DetectedNote], output_path: str, title: str = "Note List") -> str:
    """
    Exportuje noty jako textovy seznam.
    
    Format:
    [HH:MM:SS] Note | Duration | Velocity
    """
    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else '.', exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(f"# {title}\n")
        f.write(f"# Celkem not: {len(notes)}\n")
        if notes:
            f.write(f"# Delka: {notes[-1].end_time:.1f}s\n")
        f.write(f"#\n")
        f.write(f"# {'Cas':>10} | {'Nota':>5} | {'MIDI':>4} | {'Delka':>6} | {'Vel':>3}\n")
        f.write(f"# {'-'*10} | {'-'*5} | {'-'*4} | {'-'*6} | {'-'*3}\n")
        
        for note in notes:
            time_str = f"{note.start_time:6.2f}s"
            f.write(f"  {time_str:>10} | {note.note_name:>5} | {note.midi_note:>4} | "
                    f"{note.duration:>5.2f}s | {note.velocity:>3}\n")
    
    print(f"  Text ulozen: {output_path}")
    return output_path


def get_note_statistics(notes: List[DetectedNote]) -> dict:
    """Vrati statistiky o detekovanych notach."""
    if not notes:
        return {'count': 0}
    
    midi_values = [n.midi_note for n in notes]
    durations = [n.duration for n in notes]
    
    note_counts = {}
    for n in notes:
        note_counts[n.note_name] = note_counts.get(n.note_name, 0) + 1
    
    return {
        'count': len(notes),
        'midi_min': min(midi_values),
        'midi_max': max(midi_values),
        'lowest_note': min(notes, key=lambda n: n.midi_note).note_name,
        'highest_note': max(notes, key=lambda n: n.midi_note).note_name,
        'avg_duration': sum(durations) / len(durations),
        'total_duration': notes[-1].end_time if notes else 0,
        'most_common': sorted(note_counts.items(), key=lambda x: -x[1])[:10]
    }


if __name__ == '__main__':
    # Test s dummy notami
    test_notes = [
        DetectedNote(midi_note=60, start_time=0.0, end_time=0.5, velocity=80),
        DetectedNote(midi_note=64, start_time=0.5, end_time=1.0, velocity=90),
        DetectedNote(midi_note=67, start_time=1.0, end_time=1.5, velocity=85),
        DetectedNote(midi_note=72, start_time=1.5, end_time=2.5, velocity=100),
    ]
    
    notes_to_midi(test_notes, "output/test.mid", title="Test C-E-G-C")
    notes_to_text(test_notes, "output/test_notes.txt", title="Test")
    
    stats = get_note_statistics(test_notes)
    print(f"Statistiky: {stats}")
