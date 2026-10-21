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


# Spolecne yt-dlp flagy (node = dostupny JS runtime na Windows)
_YTDLP_BASE = ['python', '-m', 'yt_dlp', '--js-runtimes', 'node']


def get_video_info(url: str) -> dict:
    """Ziska metadata videa (nazev, delka, atd.) bez stazeni."""
    cmd = [
        *_YTDLP_BASE,
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
    
    # yt-dlp: stahnout video.
    # Proc nejdriv H.264 (avc1) - AV1/VP9 se v OpenCV dekoduji radove pomaleji.
    # Progresivni (video+audio v jednom) je idealni, ale vetsina videi ho nema,
    # proto zkusime formaty postupne.
    format_candidates = [
        f'best[height<={max_height}][ext=mp4][vcodec^=avc1]',  # ideal: H.264 + audio
        f'bestvideo[height<={max_height}][ext=mp4][vcodec^=avc1]',  # H.264 jen video
        f'best[height<={max_height}][vcodec^=avc1]',              # H.264 bez omezeni kontejnera
        f'bestvideo[height<={max_height}]',                       # cokoliv jineho do limitu
        f'best[height<={max_height}]',
    ]

    result = None
    for i, fmt in enumerate(format_candidates):
        if i > 0:
            print(f"  Fallback {i}: zkousim jiny format ({fmt[:40]}...)")

        cmd = [
            *_YTDLP_BASE,
            '-f', fmt,
            '--merge-output-format', 'mp4',
            '-o', output_path,
            '--no-playlist',
            '--no-write-subs',
            url
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
        if result.returncode == 0:
            break

    if result is None or result.returncode != 0:
        raise RuntimeError(f"Chyba pri stahovani:\n{result.stderr if result else 'neznamo'}")
    
    if not os.path.exists(output_path):
        # yt-dlp mozna ulozil s jinou priponou nebo s format kodem (e.g. .f397.mp4)
        # Hledat nejprve presnou shodu, pak soubory obsahujici title
        found = False
        for ext in ['.mp4', '.mkv', '.webm', '.m4a']:
            candidate = os.path.join(output_dir, f"{title}{ext}")
            if os.path.exists(candidate):
                output_path = candidate
                found = True
                break
        
        if not found:
            # Hledat soubory s format kodem: title.fXXX.mp4
            import glob
            pattern = os.path.join(output_dir, f"{title}.*.mp4")
            matches = glob.glob(pattern)
            if matches:
                # Vzít video stream (preferovat .mp4)
                output_path = matches[0]
                print(f"  Nalezen video stream: {os.path.basename(output_path)}")
            else:
                # Posledni pokus - jakekoli mp4/webm v output_dir
                for ext in ['.mp4', '.mkv', '.webm']:
                    pattern = os.path.join(output_dir, f"*{ext}")
                    matches = glob.glob(pattern)
                    if matches:
                        output_path = matches[0]
                        print(f"  Nalezeno video: {os.path.basename(output_path)}")
                        break
    
    if not os.path.exists(output_path):
        raise FileNotFoundError(f"Video nebylo stazeno do {output_path}")
    
    print(f"  Stazeno: {output_path}")
    return output_path


def download_audio(url: str, output_dir: str) -> str:
    """Stahne jen zvukovou stopu (m4a/webm, bez ffmpeg) - slouzi ke kalibraci oktavy."""
    os.makedirs(output_dir, exist_ok=True)
    template = os.path.join(output_dir, 'audio.%(ext)s')
    cmd = [*_YTDLP_BASE, '-f', 'bestaudio[ext=m4a]/bestaudio', '-o', template,
           '--no-playlist', '--force-overwrites', url]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    if result.returncode != 0:
        raise RuntimeError(f"Chyba pri stahovani zvuku: {result.stderr[-500:]}")
    for ext in ('m4a', 'webm', 'opus', 'mp4'):
        path = os.path.join(output_dir, f'audio.{ext}')
        if os.path.exists(path):
            return path
    raise FileNotFoundError("Zvukova stopa nebyla stazena")


if __name__ == '__main__':
    # Test
    test_url = "https://www.youtube.com/watch?v=UVnXmLGu4cI"
    result = download_video(test_url, "output")
    print(f"Vysledek: {result}")
