"""
app.py — PianoHelper Streamlit Web App
=======================================
YouTube Piano → MIDI & Sheet Music converter.

Run:  streamlit run app.py
"""
import os
import sys
import tempfile
from pathlib import Path

# Ensure project root is importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import streamlit as st
import pandas as pd

# ── Page config ──────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="PianoHelper",
    page_icon="🎹",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Custom dark-theme CSS ────────────────────────────────────────────────────
st.markdown("""
<style>
    /* Global dark background */
    .stApp {
        background: linear-gradient(145deg, #0d1117 0%, #161b22 50%, #0d1117 100%);
        color: #e6edf3;
    }
    /* Sidebar */
    section[data-testid="stSidebar"] {
        background: #161b22;
        border-right: 1px solid #30363d;
    }
    /* Cards / containers */
    .glass-card {
        background: rgba(22, 27, 34, 0.75);
        backdrop-filter: blur(12px);
        border: 1px solid #30363d;
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 1rem;
    }
    /* Metric cards */
    [data-testid="stMetric"] {
        background: rgba(22, 27, 34, 0.6);
        border: 1px solid #30363d;
        border-radius: 10px;
        padding: 0.8rem 1rem;
    }
    /* Tabs */
    .stTabs [data-baseweb="tab-list"] {
        gap: 4px;
    }
    .stTabs [data-baseweb="tab"] {
        border-radius: 8px 8px 0 0;
        padding: 0.5rem 1.2rem;
    }
    /* Title accent */
    .piano-title {
        background: linear-gradient(135deg, #58a6ff, #bc8cff);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-weight: 800;
    }
    .piano-subtitle {
        color: #8b949e;
        font-size: 1.1rem;
        margin-top: -0.5rem;
    }
    /* Download buttons */
    .stDownloadButton > button {
        border-radius: 8px;
        font-weight: 600;
    }
</style>
""", unsafe_allow_html=True)

# ── Lazy imports (heavy deps loaded only when needed) ────────────────────────
def _import_modules():
    from video_downloader import download_video, get_video_info
    from note_detector import detect_notes_from_video, preview_frame, DetectorConfig
    from midi_generator import notes_to_midi, notes_to_text, get_note_statistics
    from sheet_renderer import SimpleSheetRenderer
    return {
        "download_video": download_video,
        "get_video_info": get_video_info,
        "detect_notes_from_video": detect_notes_from_video,
        "preview_frame": preview_frame,
        "DetectorConfig": DetectorConfig,
        "notes_to_midi": notes_to_midi,
        "notes_to_text": notes_to_text,
        "get_note_statistics": get_note_statistics,
        "SimpleSheetRenderer": SimpleSheetRenderer,
    }

# ── Session state defaults ─────────────────────────────────────────────────────
DEFAULTS = {
    "video_path": None,
    "video_title": "Piano Notes",
    "video_info": None,
    "notes": None,
    "preview_path": None,
    "midi_path": None,
    "sheet_path": None,
    "text_path": None,
    "stats": None,
    "processing": False,
    "error": None,
    "output_dir": os.path.join(os.path.dirname(os.path.abspath(__file__)), "output"),
}

for key, val in DEFAULTS.items():
    if key not in st.session_state:
        st.session_state[key] = val


def reset_results():
    """Clear previous results when input changes."""
    for k in ("notes", "preview_path", "midi_path", "sheet_path", "text_path", "stats", "error"):
        st.session_state[k] = None


# ── Header ───────────────────────────────────────────────────────────────────
st.markdown('<h1 class="piano-title">🎹 PianoHelper</h1>', unsafe_allow_html=True)
st.markdown('<p class="piano-subtitle">YouTube Piano → MIDI &amp; Sheet Music</p>', unsafe_allow_html=True)
st.markdown("---")

# ── Sidebar — Configuration ──────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### ⚙️ Configuration")

    tempo = st.slider("Tempo (BPM)", 40, 200, 120, help="MIDI playback speed")
    min_pixels = st.slider("Min Pixels", 10, 100, 25, help="Minimum pixel count for a detected note")
    frame_skip = st.slider("Frame Skip", 1, 5, 2, help="Analyse every N-th frame (lower = more accurate)")
    notes_per_staff = st.slider("Notes per Staff", 8, 32, 16, help="How many notes fit on one staff line")
    min_note_duration = st.slider(
        "Min Note Duration (s)", 0.02, 0.20, 0.05, step=0.01,
        help="Shorter notes are discarded",
    )

    st.markdown("---")
    st.markdown("### 📂 Output")
    st.text(f"→ {st.session_state.output_dir}")

    if st.button("🗑️ Clear Results"):
        reset_results()
        st.session_state.video_path = None
        st.session_state.video_info = None
        st.rerun()

# ── Input Section — Two Tabs ─────────────────────────────────────────────────
col_left, col_right = st.columns([3, 2])

with col_left:
    input_tab_yt, input_tab_local = st.tabs(["🌐 YouTube URL", "📁 Local Video"])

    # — YouTube tab —
    with input_tab_yt:
        yt_url = st.text_input(
            "YouTube URL",
            placeholder="https://www.youtube.com/watch?v=...",
            label_visibility="collapsed",
        )
        col_fetch, col_space = st.columns([1, 2])
        with col_fetch:
            fetch_btn = st.button("🔍 Fetch Video Info", use_container_width=True)

        if fetch_btn and yt_url:
            with st.spinner("Fetching video metadata…"):
                try:
                    mods = _import_modules()
                    info = mods["get_video_info"](yt_url)
                    st.session_state.video_info = info
                    st.session_state.video_title = info.get("title", "Piano Notes")
                    reset_results()
                except Exception as exc:
                    st.error(f"Failed to fetch info: {exc}")

        if st.session_state.video_info:
            info = st.session_state.video_info
            dur = info.get("duration", 0)
            with st.container():
                st.markdown(f"**{info.get('title', 'Unknown')}**")
                m1, m2, m3 = st.columns(3)
                m1.metric("Duration", f"{dur // 60}m {dur % 60}s")
                m2.metric("Resolution", f"{info.get('height', '?')}p")
                m3.metric("FPS", f"{info.get('fps', '?')}")

    # — Local video tab —
    with input_tab_local:
        uploaded = st.file_uploader(
            "Upload a video file",
            type=["mp4", "mkv", "webm"],
            label_visibility="collapsed",
        )
        if uploaded is not None:
            # Save to a temp location
            tmp_dir = tempfile.mkdtemp(prefix="piano_")
            local_path = os.path.join(tmp_dir, uploaded.name)
            with open(local_path, "wb") as f:
                f.write(uploaded.getbuffer())
            st.session_state.video_path = local_path
            st.session_state.video_title = Path(uploaded.name).stem
            st.session_state.video_info = {"title": st.session_state.video_title, "source": "local"}
            reset_results()
            st.success(f"Loaded **{uploaded.name}** ({uploaded.size / 1e6:.1f} MB)")

with col_right:
    st.markdown("### ℹ️ How it works")
    st.markdown("""
1. **Provide** a YouTube URL or upload a Synthesia-style piano video.
2. **Configure** detection parameters in the sidebar.
3. **Process** — the app detects falling notes, maps them to MIDI keys, 
   and exports MIDI, sheet music, and a text note list.
4. **Download** your files below.
    """)

# ── Process Button ───────────────────────────────────────────────────────────
st.markdown("---")
col_proc, col_proc_spacer = st.columns([1, 3])
with col_proc:
    process_btn = st.button(
        "🚀 Process Video",
        type="primary",
        use_container_width=True,
        disabled=st.session_state.video_info is None,
    )

# ── Processing Pipeline ──────────────────────────────────────────────────────
if process_btn and st.session_state.video_info is not None:
    mods = _import_modules()
    info = st.session_state.video_info
    output_dir = st.session_state.output_dir
    os.makedirs(output_dir, exist_ok=True)
    safe_title = "".join(c for c in st.session_state.video_title if c.isalnum() or c in " -_").strip()[:50]

    progress_bar = st.progress(0, text="Starting…")
    status_container = st.empty()

    try:
        # ── Step 1: Obtain video file ────────────────────────────────────────
        progress_bar.progress(5, text="Step 1/5 — Obtaining video…")
        video_path = st.session_state.video_path

        if info.get("source") != "local":
            with status_container.container():
                st.info("⬇️ Downloading video from YouTube…")
            video_path = mods["download_video"](yt_url, output_dir)

        if not video_path or not os.path.exists(video_path):
            raise FileNotFoundError("Video file not found after download.")

        st.session_state.video_path = video_path

        # ── Step 2: Preview frame ────────────────────────────────────────────
        progress_bar.progress(15, text="Step 2/5 — Generating preview…")
        preview_path = os.path.join(output_dir, "preview.jpg")
        try:
            mods["preview_frame"](video_path, preview_path, time_s=min(10.0, 5.0))
            st.session_state.preview_path = preview_path
        except Exception:
            st.session_state.preview_path = None

        # ── Step 3: Detect notes ─────────────────────────────────────────────
        progress_bar.progress(25, text="Step 3/5 — Detecting notes (this may take a while)…")

        config = mods["DetectorConfig"](
            frame_skip=frame_skip,
            min_note_pixels=min_pixels,
            min_note_duration=min_note_duration,
        )

        def _progress(pct, msg):
            scaled = 25 + int(pct * 0.55)          # 25 → 80
            progress_bar.progress(min(scaled, 80), text=f"Detecting… {pct:.0f}%  —  {msg}")

        notes = mods["detect_notes_from_video"](video_path, config=config, progress_callback=_progress)

        if not notes:
            raise RuntimeError(
                "No notes detected. The video may not be Synthesia-style, "
                "or try lowering Min Pixels / Frame Skip."
            )

        st.session_state.notes = notes
        st.session_state.stats = mods["get_note_statistics"](notes)

        # ── Step 4: Generate MIDI + Text ─────────────────────────────────────
        progress_bar.progress(82, text="Step 4/5 — Generating MIDI & text…")

        midi_path = os.path.join(output_dir, f"{safe_title}.mid")
        mods["notes_to_midi"](notes, midi_path, tempo=tempo, title=st.session_state.video_title)
        st.session_state.midi_path = midi_path

        text_path = os.path.join(output_dir, f"{safe_title}_notes.txt")
        mods["notes_to_text"](notes, text_path, title=st.session_state.video_title)
        st.session_state.text_path = text_path

        # ── Step 5: Render sheet music ───────────────────────────────────────
        progress_bar.progress(90, text="Step 5/5 — Rendering sheet music…")

        sheet_path = os.path.join(output_dir, f"{safe_title}_sheet.png")
        renderer = mods["SimpleSheetRenderer"](notes_per_staff=notes_per_staff)
        renderer.render(notes, sheet_path, title=st.session_state.video_title, tempo=tempo)
        st.session_state.sheet_path = sheet_path

        progress_bar.progress(100, text="✅ Done!")
        status_container.empty()
        st.success(f"Processed **{len(notes)} notes** in **{st.session_state.stats['total_duration']:.1f}s** of video.")

    except Exception as exc:
        progress_bar.empty()
        status_container.empty()
        st.error(f"Processing failed: {exc}")
        st.session_state.error = str(exc)

# ── Results Section ──────────────────────────────────────────────────────────
if st.session_state.notes is not None:
    st.markdown("---")
    st.markdown("## 📊 Results")

    notes = st.session_state.notes
    stats = st.session_state.stats

    # ── Stat metrics row ─────────────────────────────────────────────────────
    m1, m2, m3, m4, m5 = st.columns(5)
    m1.metric("Total Notes", stats["count"])
    m2.metric("Range", f"{stats['lowest_note']} – {stats['highest_note']}")
    m3.metric("MIDI Range", f"{stats['midi_min']} – {stats['midi_max']}")
    m4.metric("Avg Duration", f"{stats['avg_duration']:.2f}s")
    m5.metric("Total Duration", f"{stats['total_duration']:.1f}s")

    # ── Result tabs ──────────────────────────────────────────────────────────
    tab_preview, tab_notes, tab_midi, tab_sheet = st.tabs(
        ["🖼️ Preview", "🎵 Notes", "🎶 MIDI", "🎼 Sheet Music"]
    )

    # — Preview tab —
    with tab_preview:
        if st.session_state.preview_path and os.path.exists(st.session_state.preview_path):
            st.image(st.session_state.preview_path, caption="Keyboard detection overlay", use_container_width=True)
        else:
            st.warning("Preview image not available.")

    # — Notes tab —
    with tab_notes:
        df = pd.DataFrame([
            {
                "Time (s)": round(n.start_time, 2),
                "Note": n.note_name,
                "MIDI": n.midi_note,
                "Duration (s)": round(n.duration, 3),
                "Velocity": n.velocity,
            }
            for n in notes
        ])
        st.dataframe(df, use_container_width=True, height=420)

        # Most common notes
        if stats.get("most_common"):
            st.markdown("**Most common notes:**")
            cols = st.columns(min(5, len(stats["most_common"])))
            for i, (name, count) in enumerate(stats["most_common"][:5]):
                cols[i].metric(name, f"{count}×")

    # — MIDI tab —
    with tab_midi:
        midi_path = st.session_state.midi_path
        if midi_path and os.path.exists(midi_path):
            st.markdown("#### Download MIDI")
            with open(midi_path, "rb") as f:
                st.download_button(
                    "⬇️ Download .mid",
                    data=f.read(),
                    file_name=os.path.basename(midi_path),
                    mime="audio/midi",
                    use_container_width=True,
                )
            st.info("Open the `.mid` file in MuseScore, Synthesia, FL Studio, or any DAW.")
        else:
            st.warning("MIDI file not available.")

    # — Sheet tab —
    with tab_sheet:
        sheet_path = st.session_state.sheet_path
        if sheet_path and os.path.exists(sheet_path):
            st.image(sheet_path, caption="Generated sheet music", use_container_width=True)
            with open(sheet_path, "rb") as f:
                st.download_button(
                    "⬇️ Download Sheet PNG",
                    data=f.read(),
                    file_name=os.path.basename(sheet_path),
                    mime="image/png",
                    use_container_width=True,
                )
        else:
            st.warning("Sheet music image not available.")

    # ── Bulk download row ────────────────────────────────────────────────────
    st.markdown("---")
    st.markdown("### ⬇️ Download All")
    dl1, dl2, dl3, _ = st.columns([1, 1, 1, 2])

    with dl1:
        if st.session_state.midi_path and os.path.exists(st.session_state.midi_path):
            with open(st.session_state.midi_path, "rb") as f:
                st.download_button("MIDI (.mid)", data=f.read(), file_name=os.path.basename(st.session_state.midi_path), mime="audio/midi")

    with dl2:
        if st.session_state.sheet_path and os.path.exists(st.session_state.sheet_path):
            with open(st.session_state.sheet_path, "rb") as f:
                st.download_button("Sheet (.png)", data=f.read(), file_name=os.path.basename(st.session_state.sheet_path), mime="image/png")

    with dl3:
        if st.session_state.text_path and os.path.exists(st.session_state.text_path):
            with open(st.session_state.text_path, "rb") as f:
                st.download_button("Notes (.txt)", data=f.read(), file_name=os.path.basename(st.session_state.text_path), mime="text/plain")

elif st.session_state.error:
    st.markdown("---")
    st.warning("No results to display. Fix the error above and try again.")
else:
    st.markdown("---")
    st.info("👆 Provide a YouTube URL or upload a video, then click **Process Video**.")

# ── Footer ───────────────────────────────────────────────────────────────────
st.markdown("---")
st.markdown(
    '<p style="text-align:center; color:#484f58; font-size:0.85rem;">'
    "PianoHelper — Synthesia-style video → MIDI &amp; Sheet Music  •  "
    "Built with Streamlit + OpenCV + mido + matplotlib</p>",
    unsafe_allow_html=True,
)
