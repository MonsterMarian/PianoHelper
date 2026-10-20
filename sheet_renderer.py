"""
sheet_renderer.py - Generovani notoveho zapisu z detekovanych not.

Pouziva matplotlib pro vykresleni jednoduchych notovych listu
a music21 pro pokrocilejsi notaci.
"""
import os
from typing import List, Optional
from note_detector import DetectedNote
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch
import numpy as np


# Notace konstanty
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
STAFF_LINES = {
    # Treble clef (G clef) - linky odspodu: E4, G4, B4, D5, F5
    'treble': [64, 67, 71, 74, 77],  # MIDI cisla
    # Bass clef (F clef) - linky odspodu: G2, B2, D3, F3, A3
    'bass': [43, 47, 50, 53, 57],
}

# Pozice na staff (Y souradnice) - linky a mezery
STAFF_Y_POSITIONS = [0, 1, 2, 3, 4]  # 5 linek, index 0=spodni


def midi_to_staff_position(midi_note: int, clef: str = 'treble') -> float:
    """
    Prevede MIDI cislo na Y pozici na notove linie.
    Vraci: 0-4 = na lince, 0.5 = mezi linkami, zaporne = pod staff, >4 = nad staff
    """
    lines = STAFF_LINES[clef]
    
    # Najit ne nejbizsi linku
    for i, line_midi in enumerate(lines):
        diff = midi_note - line_midi
        if diff == 0:
            return float(i)
        elif diff < 0 and i == 0:
            return diff / 2  # Pod staff
    
    # Nad nebo pod
    if midi_note < lines[0]:
        return (midi_note - lines[0]) / 2
    if midi_note > lines[-1]:
        return 4 + (midi_note - lines[-1]) / 2
    
    # Interpolace mezi linkami
    for i in range(len(lines) - 1):
        if lines[i] <= midi_note <= lines[i + 1]:
            ratio = (midi_note - lines[i]) / (lines[i + 1] - lines[i])
            return i + ratio
    
    return 0


def choose_clef(midi_note: int) -> str:
    """Zvoli appropriate clef pro danou notu."""
    # Stredni C (C4) = MIDI 60
    # Treble clef: od ~E4 (64) nahoru
    # Bass clef: od ~G3 (55) dolu
    if midi_note >= 55:
        return 'treble'
    return 'bass'


def get_note_head_style(midi_note: int) -> str:
    """Urci styl notove hlavicky (bila/cerna)."""
    note_name = NOTE_NAMES[midi_note % 12]
    # Cerna klavesa
    if '#' in note_name:
        return 'black_key'
    return 'white_key'


class SimpleSheetRenderer:
    """
    Jednoduchy renderer notoveho zapisu pomoci matplotlib.
    Kresli noty na standardni notovou linku.
    """
    
    def __init__(self, 
                 notes_per_staff: int = 12,
                 staff_width: float = 14,
                 staff_height: float = 3,
                 margin: float = 0.5):
        self.notes_per_staff = notes_per_staff
        self.staff_width = staff_width
        self.staff_height = staff_height
        self.margin = margin
    
    def render(self, notes: List[DetectedNote], output_path: str, 
               title: str = "Piano Sheet Music", tempo: int = 120):
        """
        Vykresli noty do obrazku.
        """
        if not notes:
            self._render_empty(output_path, title)
            return
        
        # Rozdelit noty na radky (staff systems)
        systems = []
        for i in range(0, len(notes), self.notes_per_staff):
            systems.append(notes[i:i + self.notes_per_staff])
        
        num_systems = len(systems)
        total_height = num_systems * (self.staff_height + self.margin * 2) + 3
        
        fig, axes = plt.subplots(
            num_systems, 1,
            figsize=(self.staff_width, total_height / num_systems * num_systems),
            squeeze=False
        )
        
        fig.suptitle(title, fontsize=16, fontweight='bold', y=0.98)
        
        for sys_idx, system_notes in enumerate(systems):
            ax = axes[sys_idx][0]
            self._draw_staff(ax, system_notes, sys_idx == 0)
        
        plt.tight_layout(rect=[0, 0, 1, 0.95])
        
        os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else '.', exist_ok=True)
        fig.savefig(output_path, dpi=150, bbox_inches='tight', 
                   facecolor='white', edgecolor='none')
        plt.close(fig)
        
        print(f"  Notovy zapis ulozen: {output_path}")
    
    def _draw_staff(self, ax, notes: List[DetectedNote], show_clef: bool = True):
        """Nakresli jednu notovou linku s notami."""
        ax.set_xlim(-1, len(notes) + 1)
        ax.set_ylim(-3, 8)
        ax.set_aspect('equal')
        ax.axis('off')
        
        # Notove linky (5 linek)
        for y in range(5):
            ax.plot([-0.5, len(notes) + 0.5], [y, y], 'k-', linewidth=0.8)
        
        # Clef - kresleny styl (Unicode clefy nejsou ve vsech fontech)
        if show_clef:
            clef = choose_clef(notes[0].midi_note)
            if clef == 'treble':
                # Stylizovane G (treble clef)
                ax.text(-0.8, 2.5, 'G', fontsize=22, fontweight='bold',
                       ha='center', va='center', style='italic',
                       family='serif', color='#333333')
                # Smycka kolem G linky
                theta = np.linspace(0, 2*np.pi, 50)
                cx, cy, r = -0.8, 2.0, 0.35
                ax.plot(cx + r*np.cos(theta), cy + r*np.sin(theta),
                       color='#333333', linewidth=1.2)
                # Cara dolu
                ax.plot([-0.8, -0.8], [2.0, -0.5], color='#333333', linewidth=1.2)
            else:
                # Stylizovane F (bass clef)
                ax.text(-0.8, 3, 'F', fontsize=22, fontweight='bold',
                       ha='center', va='center', style='italic',
                       family='serif', color='#333333')
                # Dva tecky
                ax.plot(-0.4, 3.5, 'ko', markersize=4)
                ax.plot(-0.4, 2.5, 'ko', markersize=4)
        
        # Casovy udaj (4/4) na prvnim radku
        if show_clef:
            ax.text(0.3, 3.5, '4', fontsize=14, fontweight='bold', ha='center')
            ax.text(0.3, 1.5, '4', fontsize=14, fontweight='bold', ha='center')
        
        # Noty
        for i, note in enumerate(notes):
            x = i + 1
            clef = choose_clef(note.midi_note)
            y = midi_to_staff_position(note.midi_note, clef)
            
            # Notova hlavicka
            duration = note.duration
            if duration >= 1.5:
                # Cela nota - prazdne kolecko
                circle = plt.Circle((x, y), 0.35, fill=False, edgecolor='black', linewidth=1.5)
                ax.add_patch(circle)
            elif duration >= 0.75:
                # Pulova nota - prazdne kolecko s nozickou
                circle = plt.Circle((x, y), 0.35, fill=False, edgecolor='black', linewidth=1.5)
                ax.add_patch(circle)
                ax.plot([x + 0.35, x + 0.35], [y, y + 2.5], 'k-', linewidth=1.2)
            elif duration >= 0.35:
                # Ctvrtove nota - plne kolecko s nozickou
                circle = plt.Circle((x, y), 0.3, fill=True, facecolor='black', edgecolor='black')
                ax.add_patch(circle)
                ax.plot([x + 0.3, x + 0.3], [y, y + 2.5], 'k-', linewidth=1.2)
            else:
                # Osminova nota - plne kolecko s nozickou a praporkem
                circle = plt.Circle((x, y), 0.3, fill=True, facecolor='black', edgecolor='black')
                ax.add_patch(circle)
                ax.plot([x + 0.3, x + 0.3], [y, y + 2.5], 'k-', linewidth=1.2)
                # Praporek
                ax.plot([x + 0.3, x + 0.6], [y + 2.5, y + 2.0], 'k-', linewidth=1.2)
            
            # Posuvky (krizek) pro cerne klavesy
            note_name = NOTE_NAMES[note.midi_note % 12]
            if '#' in note_name:
                # Kresleny krizek (#) misto Unicode
                ax.text(x - 0.55, y, '#', fontsize=11, fontweight='bold',
                       ha='center', va='center', color='black')
            
            # Pomocne linky pro noty mimo staff
            if y < 0:
                for ly in np.arange(-1, y - 0.5, -1):
                    ax.plot([x - 0.4, x + 0.4], [ly, ly], 'k-', linewidth=0.6)
            elif y > 4:
                for ly in np.arange(5, y + 0.5, 1):
                    ax.plot([x - 0.4, x + 0.4], [ly, ly], 'k-', linewidth=0.6)
        
        # Taktovaci cara na konci
        ax.plot([len(notes) + 0.5, len(notes) + 0.5], [-0.5, 4.5], 'k-', linewidth=1.5)
    
    def _render_empty(self, output_path: str, title: str):
        """Vykresli prazdny notovy zapis."""
        fig, ax = plt.subplots(1, 1, figsize=(10, 4))
        ax.text(0.5, 0.5, f"{title}\n\nZadne noty nebyly detekovany.",
                ha='center', va='center', fontsize=14, transform=ax.transAxes)
        ax.axis('off')
        
        os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else '.', exist_ok=True)
        fig.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
        plt.close(fig)


def render_music21_sheet(midi_path: str, output_path: str, title: str = "Sheet Music"):
    """
    Pokrocily rendering pomoci music21 (vyzaduje MuseScore nebo LilyPond).
    Toto je fallback pokud je k dispozici.
    """
    try:
        from music21 import converter, environment
        
        # Nacist MIDI
        score = converter.parse(midi_path)
        score.metadata.title = title
        
        # Pokus o MusicXML export
        xml_path = output_path.replace('.png', '.xml').replace('.pdf', '.xml')
        score.write('musicxml', fp=xml_path)
        print(f"  MusicXML exportovan: {xml_path}")
        
        # Pokus o obrazek (vyzaduje MuseScore)
        try:
            score.write('lily.png', fp=output_path)
            print(f"  Notovy zapis (LilyPond): {output_path}")
        except:
            print("  LilyPond neni k dispozici, pouzivam matplotlib renderer")
            return False
        
        return True
        
    except Exception as e:
        print(f"  music21 rendering selhal: {e}")
        return False


if __name__ == '__main__':
    # Test
    test_notes = [
        DetectedNote(midi_note=60, start_time=0.0, end_time=0.5, velocity=80),   # C4
        DetectedNote(midi_note=62, start_time=0.5, end_time=1.0, velocity=80),   # D4
        DetectedNote(midi_note=64, start_time=1.0, end_time=1.5, velocity=80),   # E4
        DetectedNote(midi_note=65, start_time=1.5, end_time=2.0, velocity=80),   # F4
        DetectedNote(midi_note=67, start_time=2.0, end_time=2.5, velocity=80),   # G4
        DetectedNote(midi_note=69, start_time=2.5, end_time=3.0, velocity=80),   # A4
        DetectedNote(midi_note=71, start_time=3.0, end_time=3.5, velocity=80),   # B4
        DetectedNote(midi_note=72, start_time=3.5, end_time=4.5, velocity=90),   # C5
    ]
    
    renderer = SimpleSheetRenderer(notes_per_staff=8)
    renderer.render(test_notes, "output/test_sheet.png", title="C Major Scale - Test")
    print("Test dokonceny!")
