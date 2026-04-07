"""
Omega Media Sync Daemon (Unified aiohttp Pipeline)
Serves WebSockets on /ws and HTTP streaming on /stream
"""
import asyncio
import json
import sqlite3
import hashlib
import time
import os
import re
import aiohttp
from aiohttp import web
from pathlib import Path
from contextlib import closing
from tinytag import TinyTag
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Config
PORT = 5002
DB_PATH = os.path.expanduser('~/.veritas/media_state.db')
AUDIOBOOKS_DIR = Path(os.path.expanduser('~/Audiobooks'))
VIDEOS_DIR = Path(os.path.expanduser('~/Sovereign Videos'))
START_TIME = time.time()

connected_clients = set()

# ══════════════════════════════════════════════════════════════
# DATABASE
# ══════════════════════════════════════════════════════════════

def init_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS media_state (
                track_id TEXT PRIMARY KEY,
                position_ms INTEGER DEFAULT 0,
                is_paused INTEGER DEFAULT 1,
                updated_at INTEGER DEFAULT 0,
                title TEXT,
                artist TEXT
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS session_ledger (
                id TEXT PRIMARY KEY,
                track_id TEXT,
                track_title TEXT,
                start_position_ms INTEGER,
                end_position_ms INTEGER,
                total_listened_ms INTEGER,
                device TEXT,
                started_at INTEGER,
                ended_at INTEGER,
                seal TEXT,
                created_at INTEGER DEFAULT (strftime('%s','now'))
            )
        ''')
        conn.commit()

def save_position(track_id, position_ms, is_paused):
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute('''
            INSERT INTO media_state (track_id, position_ms, is_paused, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(track_id) DO UPDATE SET
                position_ms = excluded.position_ms,
                is_paused = excluded.is_paused,
                updated_at = excluded.updated_at
        ''', (track_id, position_ms, 1 if is_paused else 0, int(time.time() * 1000)))
        conn.commit()

def get_position(track_id):
    with closing(sqlite3.connect(DB_PATH)) as conn:
        row = conn.execute(
            'SELECT position_ms, is_paused, updated_at FROM media_state WHERE track_id = ?',
            (track_id,)
        ).fetchone()
        if row:
            return {'position_ms': row[0], 'is_paused': bool(row[1]), 'updated_at': row[2]}
        return {'position_ms': 0, 'is_paused': True, 'updated_at': 0}

class LibraryState:
    def __init__(self):
        self.albums = []
        self.videos = []
        self.track_paths = {}
        self.cover_paths = {}

library_state = LibraryState()

def build_library():
    print("[SYNC] Scanning library...")
    AUDIOBOOKS_DIR.mkdir(parents=True, exist_ok=True)
    new_albums = {}
    new_track_paths = {}
    new_cover_paths = {}
    
    for p in AUDIOBOOKS_DIR.rglob('*'):
        if p.is_file() and p.suffix.lower() in ['.mp3', '.m4b', '.m4a']:
            try:
                tag = TinyTag.get(str(p), image=True)
                
                album_title = tag.album or p.parent.name
                if album_title == AUDIOBOOKS_DIR.name:
                    album_title = p.stem
                    
                track_title = tag.title or p.stem
                duration = int(tag.duration * 1000) if tag.duration else 0
                track_no = tag.track if tag.track else 1
                
                track_path_str = str(p)
                track_id = hashlib.sha256(track_path_str.encode('utf-8')).hexdigest()[:16]
                album_id = hashlib.sha256(album_title.encode('utf-8')).hexdigest()[:16]
                
                if album_id not in new_albums:
                    new_albums[album_id] = {
                        "id": album_id,
                        "title": album_title,
                        "artist": tag.artist or tag.albumartist or "Unknown",
                        "coverHash": album_id,
                        "tracks": []
                    }
                    
                    cover_path = p.parent / "cover.jpg"
                    if not cover_path.exists() and tag.get_image() is not None:
                        with open(cover_path, 'wb') as f:
                            f.write(tag.get_image())
                    if cover_path.exists():
                        new_cover_paths[album_id] = cover_path
                        
                new_albums[album_id]["tracks"].append({
                    "id": track_id,
                    "title": track_title,
                    "filename": p.name,
                    "path": track_path_str,
                    "duration": duration,
                    "trackNo": track_no
                })
                new_track_paths[track_id] = track_path_str
                
            except Exception as e:
                print(f"[SYNC] Error parsing {p}: {e}")

    for album in new_albums.values():
        album["tracks"].sort(key=lambda t: int(t["trackNo"]) if str(t["trackNo"]).isdigit() else 0)

    library_state.albums = list(new_albums.values())
    library_state.track_paths = new_track_paths
    library_state.cover_paths = new_cover_paths
    
    # ─── Videos Scan ────────────────────────────────────────────────────────
    new_videos = []
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    for p in VIDEOS_DIR.rglob('*'):
        if p.is_file() and p.suffix.lower() in ['.mp4', '.mkv', '.webm', '.avi']:
            try:
                # Basic scene release regex parsing for title ("Movie.Name.2024.1080p.mkv" -> "Movie Name")
                title = p.stem
                title = re.sub(r'\.(19|20)\d{2}\..*', '', title)
                title = re.sub(r'\b(1080p|720p|2160p|4K|BluRay|x264|x265|HEVC)\b.*', '', title, flags=re.IGNORECASE)
                title = title.replace('.', ' ').replace('_', ' ').strip()
                title = re.sub(r'\[.*?\]|\(.*?\)', '', title).strip() # remove [YTS.MX] or similar
                
                vid_id = hashlib.sha256(str(p).encode('utf-8')).hexdigest()[:16]

                vid_type = "movie"
                show_name = None
                season_num = None
                episode_num = None

                tv_match = re.search(r'(?i)S(\d{1,2})E(\d{1,2})', title)
                if not tv_match:
                    tv_match = re.search(r'(?i)\b0?(\d{1,2})x(\d{1,2})\b', title)

                if "Season" in p.parent.name and p.parent.parent != VIDEOS_DIR:
                    vid_type = "tv"
                    show_name = p.parent.parent.name
                    if not tv_match:
                        season_match = re.search(r'Season\s*(\d+)', p.parent.name, re.IGNORECASE)
                        if season_match:
                            season_num = int(season_match.group(1))
                        ep_match = re.search(r'(?i)E(?:pisode)?\s*(\d+)', title)
                        if ep_match:
                            episode_num = int(ep_match.group(1))

                if tv_match:
                    vid_type = "tv"
                    season_num = int(tv_match.group(1))
                    episode_num = int(tv_match.group(2))
                    if not show_name:
                        show_name_match = re.split(r'(?i)(?:S\d{1,2}E\d{1,2}|\b\d{1,2}x\d{1,2}\b)', title)[0].strip()
                        if show_name_match:
                            show_name = show_name_match
                            if show_name.endswith('-') or show_name.endswith('_'):
                                show_name = show_name[:-1].strip()
                        elif p.parent != VIDEOS_DIR:
                            show_name = p.parent.name
                            if "Season" in show_name and p.parent.parent != VIDEOS_DIR:
                                show_name = p.parent.parent.name
                
                if vid_type == "tv" and not show_name:
                    show_name = "Unknown Show"

                # Check for poster and register in cover_paths for serving
                poster_path = None
                for candidate in [f"{p.stem}.jpg", f"{p.stem}.png", "poster.jpg", "cover.jpg", "folder.jpg"]:
                    cp = p.parent / candidate
                    if cp.exists():
                        poster_path = cp
                        break
                
                if poster_path:
                    new_cover_paths[vid_id] = poster_path
                        
                new_video = {
                    "id": vid_id,
                    "title": title,
                    "type": vid_type,
                    "genre": p.parent.name if p.parent != VIDEOS_DIR else "Cinema",
                    "path": str(p),
                    "coverHash": vid_id,
                }
                
                if vid_type == "tv":
                    new_video["show"] = show_name
                    new_video["season"] = season_num
                    new_video["episode"] = episode_num

                new_videos.append(new_video)
            except Exception as e:
                print(f"[SYNC] Error parsing video {p}: {e}")
                
    library_state.videos = new_videos
    print(f"[SYNC] Library rebuilt: {len(library_state.albums)} albums, {len(library_state.videos)} videos.")

class LibraryHandler(FileSystemEventHandler):
    def on_any_event(self, event):
        if event.is_directory: return
        ext = Path(event.src_path).suffix.lower()
        if ext in ['.mp3', '.m4b', '.m4a', '.mp4', '.mkv', '.webm', '.avi']:
            build_library()

def get_track_path(track_id):
    return library_state.track_paths.get(track_id)

def get_cover_path(album_id):
    return library_state.cover_paths.get(album_id)

def scan_grouped_library():
    """
    Returns the library grouped by Albums, injecting live playhead state.
    """
    albums = library_state.albums
    for album in albums:
        for track in album.get('tracks', []):
            state = get_position(track.get('id'))
            track['lastPositionMs'] = state.get('position_ms', 0)
            track['lastPlayedAt'] = state.get('updated_at', 0)
            track['isPaused'] = state.get('is_paused', True)
    return albums

# ══════════════════════════════════════════════════════════════
# HTTP ROUTES
# ══════════════════════════════════════════════════════════════



async def handle_stream(request):
    """Serve native HTTP audio streaming (accepting Range headers) for ID-based tracks"""
    track_id = request.match_info.get('track_id')
    path_str = get_track_path(track_id)
    if not path_str or not Path(path_str).exists():
        return web.Response(status=404, text="Track not found")
    return await _stream_file(request, Path(path_str))

async def handle_stream_media(request):
    """Serve arbitrary media (EPUB, MP4) by explicit path over HTTP with Range support"""
    path_str = request.query.get('path')
    if not path_str or not Path(path_str).exists():
        return web.Response(status=404, text="File not found")
    return await _stream_file(request, Path(path_str))

async def _stream_file(request, file_path):
    file_size = file_path.stat().st_size
    response = web.StreamResponse()
    
    # Range headers
    range_header = request.headers.get('Range', '')
    if range_header:
        byte_range = range_header.replace('bytes=', '').split('-')
        start = int(byte_range[0])
        end = int(byte_range[1]) if len(byte_range) > 1 and byte_range[1] else file_size - 1
        response.set_status(206)
        response.headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
        response.headers['Content-Length'] = str(end - start + 1)
        response.headers['Accept-Ranges'] = 'bytes'
        
        # MIME mapping for universal playback
        ext = file_path.suffix.lower()
        if ext == '.mp4': response.content_type = 'video/mp4'
        elif ext == '.epub': response.content_type = 'application/epub+zip'
        else: response.content_type = 'audio/mpeg'
        
        return await _serve_stream(response, request, file_path, start, end)
        
    else:
        response.set_status(200)
        response.headers['Content-Length'] = str(file_size)
        response.headers['Accept-Ranges'] = 'bytes'
        ext = file_path.suffix.lower()
        if ext == '.mp4': response.content_type = 'video/mp4'
        elif ext == '.epub': response.content_type = 'application/epub+zip'
        else: response.content_type = 'audio/mpeg'
        return await _serve_stream(response, request, file_path, 0, file_size - 1)

async def _serve_stream(response, request, file_path, start, end):
    await response.prepare(request)
    try:
        with open(file_path, 'rb') as f:
            f.seek(start)
            chunk_size = 8192
            bytes_left = end - start + 1
            while bytes_left > 0:
                data = f.read(min(chunk_size, bytes_left))
                if not data:
                    break
                await response.write(data)
                bytes_left -= len(data)
    except Exception as e:
        pass
    return response

async def handle_cover(request):
    """Serve Cover Art directly"""
    album_id = request.match_info.get('album_id', '')
    if album_id.endswith('.jpg'):
        album_id = album_id[:-4]
    if album_id.endswith('.png'):
        album_id = album_id[:-4]
    
    # 1. Resolve from AppData sovereign-media/covers (supports both naming patterns)
    appdata_base = Path(os.getenv('APPDATA')) / 'sovereign-media' / 'covers'
    
    cache_headers = {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
    }
    
    # Check direct ID match first (most common: {id}.jpg)
    for ext in ['.jpg', '.png']:
        direct = appdata_base / f"{album_id}{ext}"
        if direct.exists():
            resp = web.FileResponse(direct)
            resp.headers.update(cache_headers)
            return resp
    
    # Check book_ prefixed match (book_{id}.jpg)
    for ext in ['.jpg', '.png']:
        prefixed = appdata_base / f"book_{album_id}{ext}"
        if prefixed.exists():
            resp = web.FileResponse(prefixed)
            resp.headers.update(cache_headers)
            return resp

    # 2. Fallback to legacy Audio tracking map
    cover_path = get_cover_path(album_id)
    if not cover_path or not cover_path.exists():
        return web.Response(status=404)
    resp = web.FileResponse(cover_path)
    resp.headers.update(cache_headers)
    return resp

# ══════════════════════════════════════════════════════════════
# HTTP TELEMETRY (React Native WebSocket Fallback)
# ══════════════════════════════════════════════════════════════

async def handle_sync_http(request):
    try:
        data = await request.json()
        cmd = data.get('type')

        if cmd == 'HEARTBEAT':
            return web.json_response({'type': 'HEARTBEAT_ACK', 'ts': data.get('ts')})
            
        elif cmd == 'WAKE_SYNC_REQUEST':
            tid = data.get('track_id')
            if tid:
                state = get_position(tid)
                return web.json_response({
                    'type': 'WAKE_SYNC_RESPONSE',
                    'track_id': tid,
                    'position_ms': state.get('position_ms', 0)
                })

        elif cmd == 'PLAYHEAD_UPDATE':
            tid = data.get('track_id')
            pos = data.get('position_ms')
            isp = data.get('is_paused')
            if tid and pos is not None:
                save_position(tid, pos, isp)
                # Broadcast out to Electron Hub if applicable over ws
                await bcast({
                    'type': 'SYNC_UPDATE_BCAST',
                    'track_id': tid,
                    'position_ms': pos,
                    'is_paused': isp
                })
            return web.json_response({'type': 'ACK'})

        return web.json_response({'status': 'ignored'})
    except Exception as e:
        return web.Response(status=400, text=str(e))

# ══════════════════════════════════════════════════════════════
# WEBSOCKET TELEMETRY
# ══════════════════════════════════════════════════════════════

async def bcast(msg):
    for ws in set(connected_clients):
        if not ws.closed:
            try:
                await ws.send_str(json.dumps(msg))
            except:
                pass

async def handle_ws(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    connected_clients.add(ws)
    client_ip = request.remote or 'unknown'
    print(f'[SYNC] Mobile node connected from {client_ip}')
    
    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                data = json.loads(msg.data)
                cmd = data.get('type')
                
                if cmd == 'HEARTBEAT':
                    await ws.send_str(json.dumps({'type': 'HEARTBEAT_ACK', 'ts': data.get('ts')}))

                elif cmd == 'PING':
                    await ws.send_str(json.dumps({'type': 'PONG'}))
                    
                elif cmd == 'WAKE_SYNC_REQUEST':
                    pass # Legacy. State is now bundled directly through /library via HTTP.

                elif cmd == 'PLAYHEAD_UPDATE':
                    # Extremely fast state injection directly into DB without blocking reads
                    tid = data.get('track_id')
                    pos = data.get('position_ms')
                    isp = data.get('is_paused')
                    if tid and pos is not None:
                        save_position(tid, pos, isp)
                        # Broadcast out to Electron Hub if applicable
                        await bcast({
                            'type': 'SYNC_UPDATE_BCAST',
                            'track_id': tid,
                            'position_ms': pos,
                            'is_paused': isp
                        })

    except Exception as e:
        pass
    finally:
        connected_clients.discard(ws)
        print(f'[SYNC] Mobile node detached ({client_ip}).')
    return ws


# ══════════════════════════════════════════════════════════════
# MAIN RUNNER
# ══════════════════════════════════════════════════════════════

async def handle_library(request):
    """Serve structured Album JSON list alongside Sovereign Library Metadata"""
    
    # Inject playhead state into Videos
    videos = list(library_state.videos)
    for vid in videos:
        state = get_position(vid.get('id'))
        vid['lastPositionMs'] = state.get('position_ms', 0)
        vid['lastPlayedAt'] = state.get('updated_at', 0)
        vid['isPaused'] = state.get('is_paused', True)
        
    manifest = {'Audio': scan_grouped_library(), 'Books': [], 'Video': videos}
    try:
        appdata = Path(os.getenv('APPDATA')) / 'sovereign-media'
        
        books_path = appdata / 'sovereign_book_library.json'
        if books_path.exists():
            with open(books_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                books = data.get('books', []) if isinstance(data, dict) else data
                for book in books:
                    book['coverHash'] = book.get('id', '')
                    state = get_position(book.get('id'))
                    if state and 'position_ms' in state:
                        book['lastPositionMs'] = state['position_ms']
                        book['lastPlayedAt'] = state['updated_at']
                        book['isPaused'] = state.get('is_paused', True)
                manifest['Books'] = books

        # sovereign_video_library.json static manifest is no longer required due to dynamic scan
    except Exception as e:
        print(f"[SYNC] Failed to load Universal Manifests: {e}")
    return web.json_response(manifest)

async def handle_health(request):
    """Health check endpoint for monitoring"""
    uptime = int(time.time() - START_TIME)
    albums = len(library_state.albums)
    tracks = len(library_state.track_paths)
    clients = len(connected_clients)
    return web.json_response({
        'status': 'ok',
        'uptime_seconds': uptime,
        'albums': albums,
        'tracks': tracks,
        'connected_clients': clients,
        'port': PORT,
    })

# ══════════════════════════════════════════════════════════════
# CORS MIDDLEWARE
# ══════════════════════════════════════════════════════════════

@web.middleware
async def cors_middleware(request, handler):
    # Handle preflight OPTIONS requests
    if request.method == 'OPTIONS':
        resp = web.Response(status=204)
    else:
        try:
            resp = await handler(request)
        except web.HTTPException as ex:
            resp = ex
    
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Bypass-Tunnel-Reminder, User-Agent'
    return resp

if __name__ == '__main__':
    init_db()
    build_library()
    
    observer = Observer()
    observer.schedule(LibraryHandler(), str(AUDIOBOOKS_DIR), recursive=True)
    if VIDEOS_DIR.exists():
        observer.schedule(LibraryHandler(), str(VIDEOS_DIR), recursive=True)
    observer.start()
    
    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get('/ws', handle_ws)
    app.router.add_get('/library', handle_library)
    app.router.add_get('/stream/{track_id}', handle_stream)
    app.router.add_get('/stream_media', handle_stream_media)
    app.router.add_get('/cover/{album_id}', handle_cover)
    app.router.add_post('/api/sync', handle_sync_http)
    app.router.add_get('/health', handle_health)
    
    print(f"[SYNC] Launching unified aiohttp telemetry node on port {PORT}")
    try:
        web.run_app(app, host='0.0.0.0', port=PORT, print=None)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
