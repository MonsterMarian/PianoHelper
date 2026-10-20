"""
video_downloader.py - Stazeni videa z YouTube pomoci yt-dlp
"""
import subprocess
import os
import re
import json
from pathlib import Path


def sanitize_filename(name: str) -> str:
    """Odstrani nepovolene znaky z nazvu souboru."""
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = name.strip('. ')
    return name[:200] if name else 'video'


def get_video_info(url: str) -> dict:
    """Ziska metadata videa (nazev, delka, atd.) bez stazeni."""
    cmd = [
        'python', '-m', 'yt_dlp',
        '--dump-json',
        '--no-download',
        url
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    if result.returncode != 0:
        raise RuntimeError(f"Chyba pri ziskavani info: {result.stderr}")
    return json.loads(result.stdout)


def download_video(url: str, output_dir: str, max_height: int = 480) -> str:
    """
    Stahne video z YouTube.
    
    Args:
        url: YouTube URL
        output_dir: Slozka pro ulozeni
        max_height: Maximalni vyska videa (480 staci pro detekci not)
    
    Returns:
        Cesta k stazenemu videu
    """
    os.makedirs(output_dir, exist_ok=True)
    
    # Ziskat info pro nazev souboru
    info = get_video_info(url)
    title = sanitize_filename(info.get('title', 'video'))
    duration = info.get('duration', 0)
    print(f"  Nazev: {info.get('title', '?')}")
    print(f"  Delka: {duration}s ({duration//60}m {duration%60}s)")
    
    output_path = os.path.join(output_dir, f"{title}.mp4")
    
    # Pokud video uz existuje, preskocit stahovani
    if os.path.exists(output_path):
        print(f"  Video uz existuje: {output_path}")
        return output_path
    
    # yt-dlp: stahnout v nizke kvalite, mp4 format
    cmd = [
        'python', '-m', 'yt_dlp',
        '-f', f'bestvideo[height<={max_height}]+bestaudio/best[height<={max_height}]/best',
        '--merge-output-format', 'mp4',
        '-o', output_path,
        '--no-playlist',
        '--no-write-subs',
        url
    ]
    
    print(f"  Stahuji video (max {max_height}p)...")
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    
    if result.returncode != 0:
        # Fallback: zkusit bez specifikace kvality
        print("  Fallback: stahuji nejlepsi dostupnou kvalitu...")
        cmd_fallback = [
            'python', '-m', 'yt_dlp',
            '--merge-output-format', 'mp4',
            '-o', output_path,
            '--no-playlist',
            url
        ]
        result = subprocess.run(cmd_fallback, capture_output=True, text=True, encoding='utf-8')
        if result.returncode != 0:
            raise RuntimeError(f"Chyba pri stahovani:\n{result.stderr}")
    
    if not os.path.exists(output_path):
        # yt-dlp mozna ulozil s jinou priponou
        for ext in ['.mp4', '.mkv', '.webm', '.m4a']:
            candidate = os.path.join(output_dir, f"{title}{ext}")
            if os.path.exists(candidate):
                output_path = candidate
                break
    
    if not os.path.exists(output_path):
        raise FileNotFoundError(f"Video nebylo stazeno do {output_path}")
    
    print(f"  Stazeno: {output_path}")
    return output_path


if __name__ == '__main__':
    # Test
    test_url = "https://www.youtube.com/watch?v=UVnXmLGu4cI"
    result = download_video(test_url, "output")
    print(f"Vysledek: {result}")
