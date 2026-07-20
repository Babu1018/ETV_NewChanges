# app.py - Fixed Edit History (No nested expanders)
import streamlit as st
import sys
import os
import tempfile
from datetime import datetime
import time
from pathlib import Path
import difflib

# Add current directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import your wrapper functions
try:
    from asr_wrapper import transcribe_english, transcribe_hindi, transcribe_telugu
    MODULES_LOADED = True
except ImportError as e:
    MODULES_LOADED = False
    IMPORT_ERROR = str(e)

# Audio processing
from pydub import AudioSegment

# Modern Beautiful CSS
ST_CSS = """
<style>
    /* Import Google Fonts */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    
    * {
        font-family: 'Inter', sans-serif;
    }
    
    /* Main container */
    .main-header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 1.5rem 2rem;
        border-radius: 0 0 20px 20px;
        margin-bottom: 2rem;
        box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    
    .main-header h1 {
        color: white;
        margin: 0;
        font-size: 1.8rem;
        font-weight: 600;
    }
    
    .main-header p {
        color: rgba(255,255,255,0.9);
        margin: 0.5rem 0 0 0;
        font-size: 0.9rem;
    }
    
    /* Card styles */
    .card {
        background: white;
        border-radius: 16px;
        padding: 1.5rem;
        margin-bottom: 1.5rem;
        box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        border: 1px solid #e2e8f0;
        transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .card:hover {
        box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    
    .card-title {
        font-size: 1.1rem;
        font-weight: 600;
        color: #1e293b;
        margin-bottom: 1rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    
    /* Upload zone */
    .upload-zone {
        border: 2px dashed #cbd5e1;
        border-radius: 16px;
        padding: 2rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s ease;
        background: #f8fafc;
    }
    
    .upload-zone:hover {
        border-color: #667eea;
        background: #f1f5f9;
    }
    
    /* Audio file item */
    .audio-item {
        background: #f8fafc;
        border-radius: 12px;
        padding: 1rem;
        margin-bottom: 0.75rem;
        cursor: pointer;
        transition: all 0.2s;
        border: 2px solid transparent;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    
    .audio-item:hover {
        background: #f1f5f9;
        transform: translateX(5px);
    }
    
    .audio-item.active {
        background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
        border-color: #667eea;
    }
    
    .audio-info {
        flex: 1;
    }
    
    .audio-name {
        font-weight: 600;
        color: #1e293b;
        margin-bottom: 0.25rem;
    }
    
    .audio-meta {
        font-size: 0.75rem;
        color: #64748b;
        display: flex;
        gap: 1rem;
    }
    
    .audio-status {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-right: 0.5rem;
    }
    
    .status-ready { background: #94a3b8; }
    .status-transcribing { background: #f59e0b; animation: pulse 1s infinite; }
    .status-complete { background: #10b981; }
    
    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
    }
    
    /* Transcript area */
    .transcript-container {
        background: #f8fafc;
        border-radius: 16px;
        padding: 1.5rem;
        min-height: 400px;
    }
    
    .transcript-label {
        font-weight: 600;
        color: #1e293b;
        margin-bottom: 0.75rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    
    /* Button styles */
    .stButton > button {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 12px;
        padding: 0.6rem 1.5rem;
        font-weight: 600;
        transition: all 0.3s;
    }
    
    .stButton > button:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    
    /* Success/Error messages */
    .stAlert {
        border-radius: 12px;
        border-left: 4px solid;
    }
    
    /* Select box */
    .stSelectbox > div {
        border-radius: 12px;
    }
    
    /* Text area */
    .stTextArea textarea {
        border-radius: 12px;
        border: 1px solid #e2e8f0;
        font-family: 'Inter', monospace;
        font-size: 14px;
        line-height: 1.6;
    }
    
    .stTextArea textarea:focus {
        border-color: #667eea;
        box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.1);
    }
    
    /* Metrics */
    .metric-card {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 12px;
        padding: 1rem;
        text-align: center;
        color: white;
    }
    
    .metric-value {
        font-size: 1.5rem;
        font-weight: 700;
    }
    
    .metric-label {
        font-size: 0.75rem;
        opacity: 0.9;
        margin-top: 0.25rem;
    }
    
    /* History item */
    .history-item {
        background: white;
        border-left: 3px solid #667eea;
        padding: 0.75rem;
        margin-bottom: 0.75rem;
        border-radius: 8px;
        font-size: 0.85rem;
    }
    
    .history-change-detail {
        background: #f1f5f9;
        padding: 0.5rem;
        border-radius: 6px;
        margin-top: 0.5rem;
        font-family: monospace;
        font-size: 0.8rem;
        overflow-x: auto;
    }
    
    .diff-added {
        background-color: #d1fae5;
        color: #065f46;
        padding: 0 2px;
        border-radius: 3px;
    }
    
    .diff-removed {
        background-color: #fee2e2;
        color: #991b1b;
        padding: 0 2px;
        border-radius: 3px;
        text-decoration: line-through;
    }
    
    .preview-box {
        background: #f8fafc;
        border-radius: 8px;
        padding: 0.5rem;
        margin-top: 0.5rem;
        font-size: 0.8rem;
        border: 1px solid #e2e8f0;
    }
    
    /* Divider */
    hr {
        margin: 1rem 0;
        border: none;
        border-top: 1px solid #e2e8f0;
    }
    
    /* Toast */
    .toast {
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 0.75rem 1.5rem;
        border-radius: 12px;
        color: white;
        font-weight: 500;
        z-index: 1000;
        animation: slideIn 0.3s ease;
    }
    
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    /* Badge */
    .badge {
        display: inline-block;
        padding: 0.2rem 0.6rem;
        border-radius: 20px;
        font-size: 0.7rem;
        font-weight: 600;
    }
    
    .badge-success {
        background: #d1fae5;
        color: #065f46;
    }
    
    .badge-warning {
        background: #fed7aa;
        color: #92400e;
    }
    
    /* Stats */
    .stats-row {
        display: flex;
        gap: 1rem;
        margin-top: 0.5rem;
        font-size: 0.75rem;
        color: #64748b;
    }
    
    /* Toggle button for details */
    .detail-toggle {
        cursor: pointer;
        color: #667eea;
        font-size: 0.75rem;
        margin-top: 0.5rem;
        text-decoration: underline;
    }
</style>
"""

def init_session_state():
    defaults = {
        'files': {},
        'current_file': None,
        'validator_name': "",
        'toasts': [],
        'show_details': {}
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value

def get_audio_duration(audio_path: str) -> str:
    try:
        audio = AudioSegment.from_file(audio_path)
        duration_ms = len(audio)
        duration_sec = duration_ms // 1000
        minutes = duration_sec // 60
        seconds = duration_sec % 60
        return f"{minutes:02d}:{seconds:02d}"
    except:
        return "00:00"

def save_uploaded_file(uploaded_file) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(uploaded_file.name).suffix) as tmp_file:
        tmp_file.write(uploaded_file.getvalue())
        return tmp_file.name

def show_toast(message: str, type_: str = "success"):
    st.session_state.toasts.append({
        "message": message,
        "type": type_,
        "timestamp": time.time()
    })

def render_toasts():
    for toast in st.session_state.toasts[:]:
        color = {"success": "#10b981", "warning": "#f59e0b", "error": "#ef4444"}[toast["type"]]
        st.markdown(f"""
        <div class="toast" style="background: {color};">
            {toast['message']}
        </div>
        """, unsafe_allow_html=True)
        if time.time() - toast['timestamp'] > 3:
            st.session_state.toasts.remove(toast)

def get_word_count(text: str) -> int:
    if not text:
        return 0
    return len(text.split())

def compute_diff(before: str, after: str) -> tuple:
    """Compute detailed diff between two texts"""
    if not before or not after:
        return "", 0, 0
    
    # Simple diff - count added/removed words
    before_words = set(before.split())
    after_words = set(after.split())
    
    words_added = len(after_words - before_words)
    words_removed = len(before_words - after_words)
    
    # Generate HTML diff
    diff = difflib.ndiff(before.split(), after.split())
    diff_html = []
    for word in diff:
        if word.startswith('+ '):
            diff_html.append(f'<span class="diff-added">{word[2:]}</span>')
        elif word.startswith('- '):
            diff_html.append(f'<span class="diff-removed">{word[2:]}</span>')
        else:
            diff_html.append(word[2:])
    
    return ' '.join(diff_html), words_added, words_removed

def transcribe_file(audio_path: str, language: str) -> str:
    try:
        if language == "English":
            return transcribe_english(audio_path)
        elif language == "Hindi":
            return transcribe_hindi(audio_path)
        elif language == "Telugu":
            return transcribe_telugu(audio_path)
        else:
            return "Language not supported"
    except Exception as e:
        from app.utils.user_messages import sanitize_user_message

        return sanitize_user_message(f"Transcription failed: {e}")

def get_change_summary(before: str, after: str) -> str:
    """Generate a human-readable summary of changes"""
    if not before:
        return "Initial transcription"
    
    before_len = len(before)
    after_len = len(after)
    
    if after_len > before_len:
        added = after_len - before_len
        return f"Added {added} characters"
    elif before_len > after_len:
        removed = before_len - after_len
        return f"Removed {removed} characters"
    else:
        return "Modified content"

def main():
    # Page config
    st.set_page_config(
        page_title="ASR Validator Tool",
        page_icon="🎤",
        layout="wide",
        initial_sidebar_state="collapsed"
    )
    
    st.markdown(ST_CSS, unsafe_allow_html=True)
    
    # Header
    st.markdown("""
    <div class="main-header">
        <h1>🎤 ASR Validator Tool</h1>
        <p>Upload audio files, transcribe with AI, and validate transcripts</p>
    </div>
    """, unsafe_allow_html=True)
    
    # Check modules
    if not MODULES_LOADED:
        st.error(f"❌ Import error: {IMPORT_ERROR}")
        st.stop()
    
    init_session_state()
    
    # Create two columns
    left_col, right_col = st.columns([1, 1.5], gap="large")
    
    # ==================== LEFT COLUMN ====================
    with left_col:
        # Upload Card
        st.markdown("""
        <div class="card">
            <div class="card-title">
                📁 Upload Audio Files
            </div>
        </div>
        """, unsafe_allow_html=True)
        
        uploaded_files = st.file_uploader(
            "Choose audio files",
            type=['mp3', 'wav', 'm4a', 'mp4', 'ogg', 'flac'],
            accept_multiple_files=True,
            label_visibility="collapsed",
            help="Supports MP3, WAV, M4A, MP4, OGG, FLAC"
        )
        
        if uploaded_files:
            for uploaded_file in uploaded_files:
                if uploaded_file.name not in st.session_state.files:
                    audio_path = save_uploaded_file(uploaded_file)
                    duration = get_audio_duration(audio_path)
                    
                    st.session_state.files[uploaded_file.name] = {
                        'path': audio_path,
                        'duration': duration,
                        'language': None,
                        'original_transcript': None,
                        'current_transcript': None,
                        'edit_history': [],
                        'status': 'ready'
                    }
                    show_toast(f"✅ {uploaded_file.name} added")
                    st.rerun()
        
        # Language Selection Card
        if st.session_state.files:
            st.markdown("---")
            st.markdown("""
            <div class="card">
                <div class="card-title">
                    🌐 Select Language
                </div>
            </div>
            """, unsafe_allow_html=True)
            
            language = st.selectbox(
                "Transcription Language",
                ["English", "Hindi", "Telugu"],
                label_visibility="collapsed"
            )
            
            # Transcribe Button
            st.markdown("---")
            if st.button("🎙️ **TRANSCRIBE NOW**", use_container_width=True):
                pending_files = [f for f, data in st.session_state.files.items() if data['status'] != 'complete']
                if pending_files:
                    progress_bar = st.progress(0)
                    for i, filename in enumerate(pending_files):
                        file_data = st.session_state.files[filename]
                        file_data['language'] = language
                        file_data['status'] = 'transcribing'
                        
                        with st.spinner(f"Transcribing {filename}..."):
                            transcript = transcribe_file(file_data['path'], language)
                        
                        file_data['original_transcript'] = transcript
                        file_data['current_transcript'] = transcript
                        file_data['edit_history'].append({
                            'id': 1,
                            'timestamp': datetime.now().isoformat(),
                            'validator': st.session_state.validator_name or "System",
                            'action': 'Initial Transcription',
                            'change_summary': f'Initial transcription in {language}',
                            'before': '',
                            'after': transcript,
                            'before_preview': '',
                            'after_preview': transcript[:200] + ('...' if len(transcript) > 200 else ''),
                            'word_count': get_word_count(transcript)
                        })
                        file_data['status'] = 'complete'
                        progress_bar.progress((i + 1) / len(pending_files))
                    
                    show_toast(f"✅ Transcribed {len(pending_files)} file(s)!")
                    st.rerun()
    
    # ==================== RIGHT COLUMN ====================
    with right_col:
        # Validator Name
        col1, col2 = st.columns([2, 1])
        with col1:
            st.session_state.validator_name = st.text_input(
                "👤 **Validator Name**",
                value=st.session_state.validator_name,
                placeholder="Enter your name",
                help="Your name will be tracked in edit history"
            )
        
        # Audio Files Section
        st.markdown("### 📋 Audio Files")
        
        if st.session_state.files:
            for filename, file_data in st.session_state.files.items():
                status_text = {
                    "ready": "Ready",
                    "transcribing": "Transcribing...",
                    "complete": "Completed"
                }.get(file_data['status'], "Ready")
                
                # File item
                with st.container():
                    col1, col2, col3 = st.columns([4, 1, 0.5])
                    with col1:
                        if st.button(f"🎵 {filename}\n{file_data['duration']} • {status_text}", 
                                   key=f"select_{filename}", use_container_width=True):
                            st.session_state.current_file = filename
                            st.rerun()
                    with col3:
                        if st.button("🗑️", key=f"del_{filename}"):
                            if os.path.exists(file_data['path']):
                                os.unlink(file_data['path'])
                            del st.session_state.files[filename]
                            if st.session_state.current_file == filename:
                                st.session_state.current_file = None
                            st.rerun()
        
        # Transcript Section
        st.markdown("### 📄 Transcript")
        
        if st.session_state.current_file and st.session_state.current_file in st.session_state.files:
            file_data = st.session_state.files[st.session_state.current_file]
            
            # Metrics row
            col1, col2, col3 = st.columns(3)
            with col1:
                st.metric("Duration", file_data['duration'])
            with col2:
                st.metric("Words", get_word_count(file_data.get('current_transcript', '')))
            with col3:
                st.metric("Language", file_data.get('language', 'Not set'))
            
            # Transcript text area
            current_transcript = st.text_area(
                "",
                value=file_data.get('current_transcript', ''),
                height=350,
                key=f"transcript_{st.session_state.current_file}",
                label_visibility="collapsed",
                placeholder="Transcription will appear here..."
            )
            
            # Buttons row
            col1, col2, col3, col4 = st.columns(4)
            with col1:
                if st.button("💾 Save", use_container_width=True):
                    if current_transcript != file_data.get('current_transcript', ''):
                        before_text = file_data.get('current_transcript', '')
                        after_text = current_transcript
                        
                        # Generate detailed change summary
                        change_summary = get_change_summary(before_text, after_text)
                        
                        # Compute diff for display
                        diff_html, words_added, words_removed = compute_diff(before_text, after_text)
                        
                        file_data['edit_history'].append({
                            'id': len(file_data['edit_history']) + 1,
                            'timestamp': datetime.now().isoformat(),
                            'validator': st.session_state.validator_name or "Anonymous",
                            'action': 'Manual Edit',
                            'change_summary': change_summary,
                            'before': before_text,
                            'after': after_text,
                            'before_preview': before_text[:200] + ('...' if len(before_text) > 200 else ''),
                            'after_preview': after_text[:200] + ('...' if len(after_text) > 200 else ''),
                            'diff_html': diff_html,
                            'words_added': words_added,
                            'words_removed': words_removed,
                            'word_count': get_word_count(after_text)
                        })
                        file_data['current_transcript'] = current_transcript
                        show_toast(f"✅ Saved! {change_summary}")
                        st.rerun()
            
            with col2:
                if st.button("↩️ Revoke Last", use_container_width=True):
                    if len(file_data.get('edit_history', [])) >= 2:
                        previous = file_data['edit_history'][-2]
                        current = file_data['edit_history'][-1]
                        file_data['current_transcript'] = previous['after']
                        
                        file_data['edit_history'].append({
                            'id': len(file_data['edit_history']) + 1,
                            'timestamp': datetime.now().isoformat(),
                            'validator': st.session_state.validator_name or "Anonymous",
                            'action': 'Revoke',
                            'change_summary': f"Revoked: {current['action']} - {current['change_summary']}",
                            'before': current['after'],
                            'after': previous['after'],
                            'before_preview': current['after'][:200] + ('...' if len(current['after']) > 200 else ''),
                            'after_preview': previous['after'][:200] + ('...' if len(previous['after']) > 200 else ''),
                            'word_count': get_word_count(previous['after'])
                        })
                        show_toast("↩️ Last change revoked!")
                        st.rerun()
                    else:
                        show_toast("No previous version to revoke", "warning")
            
            with col3:
                if file_data.get('current_transcript'):
                    st.download_button(
                        label="⬇️ Download",
                        data=file_data['current_transcript'].encode('utf-8'),
                        file_name=f"{st.session_state.current_file}_transcript.txt",
                        mime="text/plain",
                        use_container_width=True
                    )
            
            # Enhanced Edit History (No nested expanders)
            history_count = len(file_data.get('edit_history', []))
            
            if history_count > 0:
                st.markdown(f"### 📋 Edit History ({history_count} entries)")
                
                for edit in reversed(file_data['edit_history']):
                    # Determine icon based on action
                    icon = "✏️" if edit['action'] == 'Manual Edit' else "🎤" if edit['action'] == 'Initial Transcription' else "↩️"
                    
                    # Word count display
                    word_info = f"📝 {edit.get('word_count', 0)} words"
                    if edit.get('words_added') or edit.get('words_removed'):
                        word_info += f" (+{edit.get('words_added', 0)}/-{edit.get('words_removed', 0)})"
                    
                    # Create a unique key for this edit's details
                    detail_key = f"detail_{edit['id']}_{st.session_state.current_file}"
                    
                    # Show history item
                    with st.container():
                        st.markdown(f"""
                        <div class="history-item">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <strong>{icon} {edit['action']}</strong>
                                    <span style="color: #64748b; font-size: 0.75rem; margin-left: 0.5rem;">v{edit['id']}</span>
                                </div>
                                <span style="color: #64748b; font-size: 0.7rem;">{edit['timestamp'][:19]}</span>
                            </div>
                            <div style="margin-top: 0.25rem;">
                                <span class="badge badge-success" style="font-size: 0.7rem;">{edit['change_summary']}</span>
                            </div>
                            <div class="stats-row">
                                <span>{word_info}</span>
                                <span>👤 {edit['validator']}</span>
                            </div>
                        </div>
                        """, unsafe_allow_html=True)
                        
                        # Use a checkbox to show/hide details (no nested expander)
                        if edit['action'] == 'Manual Edit' and edit.get('before_preview') and edit.get('after_preview'):
                            show_details = st.checkbox(f"Show changes for v{edit['id']}", key=detail_key, label_visibility="collapsed")
                            if show_details:
                                col1, col2 = st.columns(2)
                                with col1:
                                    st.markdown("**Before:**")
                                    st.text(edit['before_preview'])
                                with col2:
                                    st.markdown("**After:**")
                                    st.text(edit['after_preview'])
                                
                                # Show diff if available
                                if edit.get('diff_html'):
                                    st.markdown("**Changes highlighted:**")
                                    st.markdown(f'<div class="history-change-detail">{edit["diff_html"]}</div>', unsafe_allow_html=True)
                        elif edit['action'] == 'Initial Transcription' and edit.get('after_preview'):
                            show_details = st.checkbox(f"Show preview for v{edit['id']}", key=detail_key, label_visibility="collapsed")
                            if show_details:
                                st.text(edit['after_preview'])
                        elif edit['action'] == 'Revoke' and edit.get('change_summary'):
                            st.caption(f"↩️ {edit['change_summary']}")
                        
                        st.markdown("---")
            else:
                st.info("No edits yet. Make changes to see detailed history here.")
        else:
            st.info("👈 Select an audio file from the left to view transcript")
    
    # Render toasts
    render_toasts()

if __name__ == "__main__":
    main()