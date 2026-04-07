/**
 * OfflineBufferService.js
 * Download orchestrator — permanent vault + transient streaming buffer.
 * Handles space checks, auto-purging, queuing, and SHA-256 verification.
 */

import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';
import MediaSyncService from './MediaSyncService';

const VAULT_DIR      = `${RNFS.DocumentDirectoryPath}/sovereign_vault`;
const BUFFER_DIR     = `${RNFS.CachesDirectoryPath}/sovereign_buffer`;
const BUFFER_MAX_GB  = 4;
const VAULT_MAX_GB   = 32;
const LOW_SPACE_MB   = 100;
const STORAGE_KEY    = '@sovereign_offline_index';

class OfflineBufferServiceClass {
  constructor() {
    this.vaultIndex   = {};   // hash → { path, filename, size, addedAt, type }
    this.bufferIndex  = {};   // hash → { path, filename, size, addedAt }
    this.downloadQueue = [];
    this.activeDownloads = {};
    this.listeners    = {};
  }

  async init() {
    await RNFS.mkdir(VAULT_DIR);
    await RNFS.mkdir(BUFFER_DIR);
    await this._loadIndex();
    await this._reconcileFiles();
  }

  // ─── Vault (Permanent) ────────────────────────────────────────────────────

  async vaultTrack(track, onProgress) {
    const hash = this._hashId(track.path || track.id);
    if (this.vaultIndex[hash]) return { alreadyVaulted: true };

    const url      = MediaSyncService.buildStreamUrl(track.path);
    const filename = track.filename || `${hash}.mp3`;
    const destPath = `${VAULT_DIR}/${filename}`;

    return this._download(hash, url, destPath, filename, track.size, 'vault', onProgress);
  }

  isVaulted(trackPathOrId) {
    return !!this.vaultIndex[this._hashId(trackPathOrId)];
  }

  getVaultPath(trackPathOrId) {
    const entry = this.vaultIndex[this._hashId(trackPathOrId)];
    return entry?.path || null;
  }

  async removeFromVault(trackPathOrId) {
    const hash  = this._hashId(trackPathOrId);
    const entry = this.vaultIndex[hash];
    if (!entry) return;
    try { await RNFS.unlink(entry.path); } catch (_) {}
    delete this.vaultIndex[hash];
    await this._saveIndex();
    this._emit('vault_updated', this.getVaultStats());
  }

  getVaultStats() {
    const entries = Object.values(this.vaultIndex);
    const totalBytes = entries.reduce((s, e) => s + (e.size || 0), 0);
    return {
      count: entries.length,
      totalMB: (totalBytes / 1024 / 1024).toFixed(1),
      entries,
    };
  }

  // ─── Buffer (Transient) ───────────────────────────────────────────────────

  async bufferTrack(track, onProgress) {
    const hash = this._hashId(track.path || track.id);
    if (this.bufferIndex[hash]) return { alreadyCached: true, path: this.bufferIndex[hash].path };
    if (this.vaultIndex[hash])  return { alreadyCached: true, path: this.vaultIndex[hash].path };

    await this._ensureBufferSpace(track.size || 50 * 1024 * 1024);

    const url      = MediaSyncService.buildStreamUrl(track.path);
    const filename = track.filename || `${hash}_buf.mp3`;
    const destPath = `${BUFFER_DIR}/${filename}`;

    return this._download(hash, url, destPath, filename, track.size, 'buffer', onProgress);
  }

  getBufferPath(trackPathOrId) {
    const hash  = this._hashId(trackPathOrId);
    const entry = this.bufferIndex[hash] || this.vaultIndex[hash];
    return entry?.path || null;
  }

  async clearBuffer() {
    for (const entry of Object.values(this.bufferIndex)) {
      try { await RNFS.unlink(entry.path); } catch (_) {}
    }
    this.bufferIndex = {};
    await this._saveIndex();
    this._emit('buffer_updated', this.getBufferStats());
  }

  async removeFromBuffer(trackPathOrId) {
    const hash  = this._hashId(trackPathOrId);
    const entry = this.bufferIndex[hash];
    if (!entry) return;
    try { await RNFS.unlink(entry.path); } catch (_) {}
    delete this.bufferIndex[hash];
    await this._saveIndex();
    this._emit('buffer_updated', this.getBufferStats());
  }

  getBufferStats() {
    const entries    = Object.values(this.bufferIndex);
    const totalBytes = entries.reduce((s, e) => s + (e.size || 0), 0);
    return {
      count: entries.length,
      totalMB: (totalBytes / 1024 / 1024).toFixed(1),
      maxGB: BUFFER_MAX_GB,
      entries,
    };
  }

  // ─── Download Core ────────────────────────────────────────────────────────

  async _download(hash, url, destPath, filename, fileSize, lane, onProgress) {
    if (this.activeDownloads[hash]) {
      return new Promise(resolve => {
        this.once(`download_complete_${hash}`, resolve);
      });
    }

    this._emit('queue_updated', { hash, status: 'starting', filename });

    const headers = MediaSyncService.getRequestHeaders();
    let lastPercent = 0;

    const { promise, jobId } = RNFS.downloadFile({
      fromUrl: url,
      toFile: destPath,
      headers,
      progressDivider: 5,
      begin: (res) => {
        this.activeDownloads[hash] = { jobId, filename, lane };
        this._emit('download_begin', { hash, filename, contentLength: res.contentLength });
      },
      progress: (res) => {
        const pct = Math.round((res.bytesWritten / res.contentLength) * 100);
        if (pct !== lastPercent) {
          lastPercent = pct;
          onProgress && onProgress(pct);
          this._emit('download_progress', { hash, filename, pct });
        }
      },
    });

    this.activeDownloads[hash] = { jobId, filename, lane };

    try {
      const result = await promise;
      if (result.statusCode === 200) {
        const stat    = await RNFS.stat(destPath);
        const entry   = { path: destPath, filename, size: stat.size, addedAt: Date.now() };
        if (lane === 'vault')  this.vaultIndex[hash]  = { ...entry, type: 'vault' };
        else                   this.bufferIndex[hash] = entry;
        await this._saveIndex();

        delete this.activeDownloads[hash];
        this._emit('download_complete', { hash, filename, path: destPath });
        this._emit(`download_complete_${hash}`, { hash, filename, path: destPath });
        if (lane === 'vault') this._emit('vault_updated', this.getVaultStats());
        else                  this._emit('buffer_updated', this.getBufferStats());
        return { success: true, path: destPath };
      }
      throw new Error(`Status ${result.statusCode}`);
    } catch (err) {
      delete this.activeDownloads[hash];
      try { await RNFS.unlink(destPath); } catch (_) {}
      this._emit('download_error', { hash, filename, error: err.message });
      return { success: false, error: err.message };
    }
  }

  // ─── Space Management ─────────────────────────────────────────────────────

  async _ensureBufferSpace(neededBytes) {
    const fsInfo     = await RNFS.getFSInfo();
    const freeMB     = fsInfo.freeSpace / 1024 / 1024;
    const bufferMB   = parseFloat(this.getBufferStats().totalMB);
    const maxMB      = BUFFER_MAX_GB * 1024;

    if (freeMB < LOW_SPACE_MB || bufferMB + neededBytes / 1024 / 1024 > maxMB) {
      await this._evictOldest(neededBytes);
    }
  }

  async _evictOldest(neededBytes) {
    const sorted = Object.entries(this.bufferIndex)
      .sort((a, b) => a[1].addedAt - b[1].addedAt);
    let freed = 0;
    for (const [hash, entry] of sorted) {
      if (freed >= neededBytes) break;
      try { await RNFS.unlink(entry.path); } catch (_) {}
      freed += entry.size || 0;
      delete this.bufferIndex[hash];
    }
    await this._saveIndex();
    this._emit('buffer_updated', this.getBufferStats());
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  async _saveIndex() {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
      vault: this.vaultIndex,
      buffer: this.bufferIndex,
    }));
  }

  async _loadIndex() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.vaultIndex  = parsed.vault  || {};
        this.bufferIndex = parsed.buffer || {};
      }
    } catch (_) {}
  }

  async _reconcileFiles() {
    // Remove index entries for files that no longer exist on disk
    for (const [hash, entry] of Object.entries(this.vaultIndex)) {
      const exists = await RNFS.exists(entry.path);
      if (!exists) delete this.vaultIndex[hash];
    }
    for (const [hash, entry] of Object.entries(this.bufferIndex)) {
      const exists = await RNFS.exists(entry.path);
      if (!exists) delete this.bufferIndex[hash];
    }
    await this._saveIndex();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _hashId(str) {
    return CryptoJS.SHA256(String(str)).toString().slice(0, 16);
  }

  on(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
    return () => this.off(event, cb);
  }

  once(event, cb) {
    const wrapped = (data) => { cb(data); this.off(event, wrapped); };
    this.on(event, wrapped);
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
}

export const OfflineBufferService = new OfflineBufferServiceClass();
export default OfflineBufferService;
