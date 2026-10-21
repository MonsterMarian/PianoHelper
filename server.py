"""
server.py - Lokalni server pro webovy prehravac PianoHelper.

    python server.py            -> http://localhost:8000

Servíruje slozku web/ a API pro prevod YouTube videa na skladbu:
    GET  /api/health
    POST /api/convert   {"url": "...", "start_note": "E2"}   -> {"id": ...}
    GET  /api/jobs/<id>                                       -> {"status", "last_line", "song"}
Prevod spousti main.py jako samostatny proces; vysledek se ulozi do web/songs/.
"""
import json
import os
import re
import subprocess
import sys
import threading
import uuid
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, 'web')
YOUTUBE = re.compile(r'^https://(www\.|m\.|music\.)?(youtube\.com/(watch\?v=|shorts/)|youtu\.be/)[\w-]{6,}[\w&=%.-]*$')
NOTE = re.compile(r'^[A-Ga-g][#b]?[0-8]$')
JOBS = {}


def song_index():
    """Seznam skladeb ze slozky web/songs (staticky index.json slouzi jen bez serveru)."""
    songs_dir = os.path.join(WEB, 'songs')
    out = []
    for name in sorted(os.listdir(songs_dir)):
        if not name.endswith('.json') or name == 'index.json':
            continue
        try:
            with open(os.path.join(songs_dir, name), encoding='utf-8') as f:
                song = json.load(f)
            notes = song.get('notes', [])
            out.append({'file': name, 'title': song.get('title', name), 'notes': len(notes),
                        'duration': round(max((n['e'] for n in notes), default=0), 1)})
        except (OSError, ValueError, KeyError, TypeError):
            continue          # poskozeny soubor v knihovne nesmi shodit seznam
    return sorted(out, key=lambda s: s['title'].lower())


def run_job(job_id, url, start_note):
    job = JOBS[job_id]
    cmd = [sys.executable, os.path.join(ROOT, 'main.py'), url,
           '--output', os.path.join(ROOT, 'output', job_id), '--library', os.path.join(WEB, 'songs'), '--skip-sheet']
    if start_note:
        cmd += ['--start-note', start_note]
    env = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUNBUFFERED': '1'}
    proc = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding='utf-8', errors='replace', env=env)
    for line in proc.stdout:
        # progress bar prepisuje radek pres \r - ukazat jen posledni stav
        line = line.rstrip().split('\r')[-1].strip()
        if not line:
            continue
        job['last_line'] = line[-160:]
        m = re.search(r'Pisen ulozena do knihovny: (.+\.json)', line)
        if m:
            job['song'] = os.path.basename(m.group(1).strip())
    job['status'] = 'done' if proc.wait() == 0 and job.get('song') else 'error'


class Handler(SimpleHTTPRequestHandler):
    def _json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/api/health':
            return self._json(200, {'ok': True})
        if self.path.split('?')[0] == '/songs/index.json':
            return self._json(200, song_index())
        if self.path.startswith('/api/jobs/'):
            job = JOBS.get(self.path.rsplit('/', 1)[-1])
            return self._json(200, job) if job else self._json(404, {'error': 'neznamy prevod'})
        return super().do_GET()

    def do_POST(self):
        if self.path != '/api/convert':
            return self._json(404, {'error': 'nenalezeno'})
        try:
            length = min(int(self.headers.get('Content-Length', 0)), 10_000)
            data = json.loads(self.rfile.read(length) or b'{}')
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {'error': 'spatny pozadavek'})
        url = str(data.get('url', '')).strip()
        start = str(data.get('start_note', '') or '').strip()
        if not YOUTUBE.match(url):
            return self._json(400, {'error': 'Zadej odkaz na YouTube video (https://www.youtube.com/watch?v=...)'})
        if start and not NOTE.match(start):
            return self._json(400, {'error': 'Prvni klavesa musi byt napr. E2, C3 nebo F#2'})
        job_id = uuid.uuid4().hex[:12]
        JOBS[job_id] = {'id': job_id, 'status': 'running', 'last_line': 'startuji', 'song': None}
        threading.Thread(target=run_job, args=(job_id, url, start), daemon=True).start()
        return self._json(202, JOBS[job_id])

    def end_headers(self):
        # knihovna se meni za behu - nekesovat JSON
        if self.path.endswith('.json'):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.makedirs(os.path.join(WEB, 'songs'), exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=WEB))
    print(f"PianoHelper bezi na http://localhost:{port}  (Ctrl+C = konec)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
