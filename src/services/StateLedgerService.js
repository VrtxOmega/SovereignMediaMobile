/**
 * StateLedgerService.js
 * VERITAS-sealed listening sessions. Tracks progression locally,
 * stamps with UNIX timestamps, hashes with local seal, syncs to PC.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import CryptoJS from 'crypto-js';
import MediaSyncService from './MediaSyncService';

const STORAGE_KEY     = '@sovereign_ledger';
const SYNC_DEBOUNCE   = 5000;  // 5s debounce on playhead POST

class StateLedgerServiceClass {
  constructor() {
    this.sessions     = {};   // trackId → { trackId, title, totalMs, lastPos, sessions: [], seal }
    this.syncTimers   = {};
    this.appState     = AppState.currentState;
    this._appStateSub = null;
  }

  async init() {
    await this._load();
    this._watchAppState();
  }

  // ─── Session Recording ────────────────────────────────────────────────────

  startSession(trackId, title, positionMs) {
    if (!this.sessions[trackId]) {
      this.sessions[trackId] = {
        trackId,
        title,
        totalMs: 0,
        lastPos: positionMs,
        sessions: [],
        seal: null,
      };
    }
    const session = this.sessions[trackId];
    session.lastPos   = positionMs;
    session._sessionStart = Date.now();
    session._sessionStartPos = positionMs;
  }

  updatePosition(trackId, positionMs) {
    const session = this.sessions[trackId];
    if (!session) return;
    session.lastPos = positionMs;

    // Debounced sync to PC
    clearTimeout(this.syncTimers[trackId]);
    this.syncTimers[trackId] = setTimeout(() => {
      MediaSyncService.postPlayhead(trackId, positionMs);
    }, SYNC_DEBOUNCE);
  }

  async endSession(trackId, finalPositionMs) {
    const session = this.sessions[trackId];
    if (!session) return;

    const durationMs = Date.now() - (session._sessionStart || Date.now());
    session.totalMs += durationMs;
    session.lastPos  = finalPositionMs;

    session.sessions.push({
      startPos:   session._sessionStartPos || 0,
      endPos:     finalPositionMs,
      durationMs,
      timestamp:  Date.now(),
    });

    // Seal the entry
    session.seal = this._generateSeal(session);

    // Immediate sync on session end
    clearTimeout(this.syncTimers[trackId]);
    MediaSyncService.postPlayhead(trackId, finalPositionMs);

    await this._save();
  }

  // ─── Position Retrieval ───────────────────────────────────────────────────

  getLastPosition(trackId) {
    return this.sessions[trackId]?.lastPos || 0;
  }

  getSession(trackId) {
    return this.sessions[trackId] || null;
  }

  getAllSessions() {
    return Object.values(this.sessions);
  }

  // ─── Metrics ─────────────────────────────────────────────────────────────

  getMetrics() {
    const all          = Object.values(this.sessions);
    const totalMs      = all.reduce((s, e) => s + e.totalMs, 0);
    const totalHours   = (totalMs / 1000 / 60 / 60).toFixed(1);
    const totalSessions= all.reduce((s, e) => s + e.sessions.length, 0);
    const uniqueTracks = all.length;

    return { totalHours, totalSessions, uniqueTracks };
  }

  // ─── VERITAS Seal ─────────────────────────────────────────────────────────

  _generateSeal(session) {
    const payload = JSON.stringify({
      trackId:    session.trackId,
      totalMs:    session.totalMs,
      lastPos:    session.lastPos,
      sessCount:  session.sessions.length,
      ts:         Date.now(),
    });
    const hash = CryptoJS.SHA256(payload).toString();
    return `SEAL:${hash.slice(0, 8)}`;
  }

  verifySeal(trackId) {
    const session = this.sessions[trackId];
    if (!session?.seal) return false;
    const expected = this._generateSeal(session);
    return session.seal.slice(5, 13) === expected.slice(5, 13);
  }

  // ─── App State (background flush) ────────────────────────────────────────

  _watchAppState() {
    this._appStateSub = AppState.addEventListener('change', async (nextState) => {
      if (this.appState === 'active' && nextState.match(/inactive|background/)) {
        // Flush all pending syncs immediately before backgrounding
        for (const [trackId, timer] of Object.entries(this.syncTimers)) {
          clearTimeout(timer);
          const session = this.sessions[trackId];
          if (session) {
            await MediaSyncService.postPlayhead(trackId, session.lastPos);
          }
        }
        await this._save();
      }
      this.appState = nextState;
    });
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  async _save() {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.sessions));
  }

  async _load() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) this.sessions = JSON.parse(raw);
    } catch (_) {}
  }

  destroy() {
    this._appStateSub?.remove();
    for (const timer of Object.values(this.syncTimers)) clearTimeout(timer);
  }
}

export const StateLedgerService = new StateLedgerServiceClass();
export default StateLedgerService;
