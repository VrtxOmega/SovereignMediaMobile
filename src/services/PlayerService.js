/**
 * PlayerService.js
 * TrackPlayer background service + high-level playback API.
 * Lock screen controls, Bluetooth A2DP, chapter-aware seeking.
 */

import TrackPlayer, {
  Capability,
  Event,
  RepeatMode,
  State,
  usePlaybackState,
  useProgress,
  useTrackPlayerEvents,
} from 'react-native-track-player';
import MediaSyncService from './MediaSyncService';
import StateLedgerService from './StateLedgerService';

// ─── Background Playback Service (registered in index.js) ─────────────────

export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay,     () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause,    () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop,     () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteNext,     () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());
  TrackPlayer.addEventListener(Event.RemoteSeek,     (e) => TrackPlayer.seekTo(e.position));
  TrackPlayer.addEventListener(Event.RemoteJumpForward,  (e) => PlayerService.seekForward(e.interval || 30));
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, (e) => PlayerService.seekBackward(e.interval || 15));

  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, async (e) => {
    const track = await TrackPlayer.getActiveTrack();
    if (track?.id) {
      StateLedgerService.updatePosition(track.id, Math.round(e.position * 1000));
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackState, async (e) => {
    if (e.state === State.Stopped || e.state === State.None) {
      const track = await TrackPlayer.getActiveTrack();
      if (track?.id) {
        const pos = await TrackPlayer.getPosition();
        await StateLedgerService.endSession(track.id, Math.round(pos * 1000));
      }
    }
  });
}

// ─── PlayerService API ────────────────────────────────────────────────────

class PlayerServiceClass {
  async setup() {
    try {
      await TrackPlayer.setupPlayer({
        maxCacheSize: 1024 * 5, // 5MB stream buffer
      });
      await TrackPlayer.updateOptions({
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.Stop,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
          Capability.JumpForward,
          Capability.JumpBackward,
        ],
        compactCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
        ],
        progressUpdateEventInterval: 5,
        jumpInterval: 30,
        forwardJumpInterval: 30,
        backwardJumpInterval: 15,
        notificationCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SeekTo,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
        ],
      });
    } catch (err) {
      // Already initialized
    }
  }

  async loadAlbum(tracks, startIndex = 0, startPositionMs = 0) {
    await TrackPlayer.reset();

    const formatted = tracks.map(t => ({
      id:          t.id || t.path,
      url:         t.localPath || MediaSyncService.buildStreamUrl(t.path),
      title:       t.title || t.filename,
      artist:      t.author || t.artist || 'Unknown',
      album:       t.album || t.collection,
      artwork:     t.artworkUrl || MediaSyncService.buildCoverUrl(t.coverHash),
      duration:    t.durationMs ? t.durationMs / 1000 : undefined,
      headers:     MediaSyncService.getRequestHeaders(),
      _raw:        t,
    }));

    await TrackPlayer.add(formatted);
    await TrackPlayer.skip(startIndex);

    if (startPositionMs > 0) {
      await TrackPlayer.seekTo(startPositionMs / 1000);
    }

    const track = formatted[startIndex];
    if (track) {
      StateLedgerService.startSession(track.id, track.title, startPositionMs);
    }
  }

  async play()  { await TrackPlayer.play(); }
  async pause() { await TrackPlayer.pause(); }
  async stop()  { await TrackPlayer.stop(); }

  async seekTo(ms) {
    await TrackPlayer.seekTo(ms / 1000);
  }

  async seekForward(seconds = 30) {
    const pos = await TrackPlayer.getPosition();
    await TrackPlayer.seekTo(pos + seconds);
  }

  async seekBackward(seconds = 15) {
    const pos = await TrackPlayer.getPosition();
    await TrackPlayer.seekTo(Math.max(0, pos - seconds));
  }

  async next()     { await TrackPlayer.skipToNext(); }
  async previous() { await TrackPlayer.skipToPrevious(); }

  async getState()    { return await TrackPlayer.getPlaybackState(); }
  async getPosition() { return (await TrackPlayer.getPosition()) * 1000; } // returns ms
  async getDuration() { return (await TrackPlayer.getDuration()) * 1000; }
  async getActiveTrack() { return await TrackPlayer.getActiveTrack(); }

  async setRepeat(mode) {
    await TrackPlayer.setRepeatMode(mode || RepeatMode.Off);
  }
}

export const PlayerService = new PlayerServiceClass();
export { usePlaybackState, useProgress, useTrackPlayerEvents, State, Event };
export default PlayerService;
