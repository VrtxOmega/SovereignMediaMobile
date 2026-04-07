/**
 * MediaSyncService.js
 * Central nervous system — connects to PC daemon, fetches library manifest,
 * manages WebSocket, handles reconnection, caches manifest to AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const STORAGE_KEY_HOST       = '@sovereign_host';
const STORAGE_KEY_MANIFEST   = '@sovereign_manifest_cache';
const STORAGE_KEY_LAN        = '@sovereign_lan_ip';

const PING_INTERVAL_MS       = 8000;
const PONG_TIMEOUT_MS        = 12000;
const RECONNECT_BASE_MS      = 2000;
const RECONNECT_MAX_MS       = 30000;
const BYPASS_HEADER          = 'Bypass-Tunnel-Reminder';

class MediaSyncServiceClass {
  constructor() {
    this.host           = null;
    this.lanIp          = null;
    this.ws             = null;
    this.isConnected    = false;
    this.manifest       = null;
    this.listeners      = {};
    this.pingTimer      = null;
    this.pongTimer      = null;
    this.reconnectTimer = null;
    this.reconnectDelay = RECONNECT_BASE_MS;
    this.destroyed      = false;
    this._pendingQueue  = [];
  }

  // ─── Initialization ───────────────────────────────────────────────────────

  async init() {
    this.host  = await AsyncStorage.getItem(STORAGE_KEY_HOST);
    this.lanIp = await AsyncStorage.getItem(STORAGE_KEY_LAN);
    if (this.host || this.lanIp) {
      await this._fetchManifest();
      this._connectWebSocket();
    }
    this._monitorNetwork();
  }

  async setHost(url) {
    const clean = url.trim().replace(/\/$/, '');
    this.host = clean;
    await AsyncStorage.setItem(STORAGE_KEY_HOST, clean);
    await this._fetchManifest();
    this._connectWebSocket();
  }

  async setLanIp(ip) {
    this.lanIp = ip;
    await AsyncStorage.setItem(STORAGE_KEY_LAN, ip);
  }

  getBaseUrl() {
    return this.host || (this.lanIp ? `http://${this.lanIp}:5002` : null);
  }

  // ─── Manifest Fetch ───────────────────────────────────────────────────────

  async _fetchManifest() {
    const base = this.getBaseUrl();
    if (!base) return null;
    try {
      const res = await fetch(`${base}/library`, {
        headers: {
          [BYPASS_HEADER]: 'true',
          'Accept': 'application/json',
        },
        timeout: 10000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.manifest = data;
      await AsyncStorage.setItem(STORAGE_KEY_MANIFEST, JSON.stringify(data));
      this._emit('manifest', data);
      return data;
    } catch (err) {
      console.warn('[MediaSync] Manifest fetch failed, loading cache:', err.message);
      return await this._loadCachedManifest();
    }
  }

  async _loadCachedManifest() {
    try {
      const cached = await AsyncStorage.getItem(STORAGE_KEY_MANIFEST);
      if (cached) {
        const data = JSON.parse(cached);
        this.manifest = data;
        this._emit('manifest', data);
        return data;
      }
    } catch (_) {}
    return null;
  }

  async refreshManifest() {
    return await this._fetchManifest();
  }

  getManifest() {
    return this.manifest;
  }

  // ─── WebSocket ────────────────────────────────────────────────────────────

  _connectWebSocket() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    const base = this.getBaseUrl();
    if (!base) return;

    const wsUrl = base
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')
      + '/ws';

    try {
      this.ws = new WebSocket(wsUrl, null, {
        headers: { [BYPASS_HEADER]: 'true' },
      });

      this.ws.onopen = () => {
        this.isConnected    = true;
        this.reconnectDelay = RECONNECT_BASE_MS;
        this._emit('connected', true);
        this._startPing();
        this._flushQueue();
      };

      this.ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'PONG') {
            clearTimeout(this.pongTimer);
          } else {
            this._emit('message', msg);
            this._emit(msg.type, msg.payload);
          }
        } catch (_) {}
      };

      this.ws.onerror = (err) => {
        console.warn('[MediaSync] WS error:', err.message);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this._emit('connected', false);
        this._stopPing();
        if (!this.destroyed) this._scheduleReconnect();
      };
    } catch (err) {
      console.warn('[MediaSync] WS connect failed:', err.message);
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, RECONNECT_MAX_MS);
      this._connectWebSocket();
    }, this.reconnectDelay);
  }

  _startPing() {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING' }));
        this.pongTimer = setTimeout(() => {
          console.warn('[MediaSync] PONG timeout, reconnecting');
          this.ws?.close();
        }, PONG_TIMEOUT_MS);
      }
    }, PING_INTERVAL_MS);
  }

  _stopPing() {
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      if (this._pendingQueue.length < 50) {
        this._pendingQueue.push(msg);
      }
    }
  }

  _flushQueue() {
    while (this._pendingQueue.length > 0) {
      const msg = this._pendingQueue.shift();
      this.ws?.send(JSON.stringify(msg));
    }
  }

  // ─── Playhead Sync ────────────────────────────────────────────────────────

  async postPlayhead(trackId, positionMs, type = 'audio') {
    const base = this.getBaseUrl();
    if (!base) return;
    try {
      await fetch(`${base}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [BYPASS_HEADER]: 'true',
        },
        body: JSON.stringify({ track_id: trackId, position_ms: positionMs, type }),
      });
    } catch (_) {}
  }

  // ─── Stream URL Builder ───────────────────────────────────────────────────

  buildStreamUrl(path) {
    const base = this.getBaseUrl();
    if (!base) return null;
    return `${base}/stream_media?path=${encodeURIComponent(path)}`;
  }

  buildCoverUrl(hash) {
    const base = this.getBaseUrl();
    if (!base) return null;
    return `${base}/cover/${hash}.jpg`;
  }

  getRequestHeaders() {
    return { [BYPASS_HEADER]: 'true' };
  }

  // ─── Network Monitor ─────────────────────────────────────────────────────

  _monitorNetwork() {
    NetInfo.addEventListener(state => {
      if (state.isConnected && !this.isConnected) {
        this._fetchManifest();
        this._connectWebSocket();
      }
    });
  }

  // ─── Event Bus ───────────────────────────────────────────────────────────

  on(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
    return () => this.off(event, cb);
  }

  off(event, cb) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(l => l !== cb);
  }

  _emit(event, data) {
    (this.listeners[event] || []).forEach(cb => {
      try { cb(data); } catch (_) {}
    });
  }

  destroy() {
    this.destroyed = true;
    this._stopPing();
    clearTimeout(this.reconnectTimer);
    try { this.ws?.close(); } catch (_) {}
  }
}

export const MediaSyncService = new MediaSyncServiceClass();
export default MediaSyncService;
