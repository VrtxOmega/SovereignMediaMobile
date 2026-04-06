import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Image, Dimensions, StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MediaSyncService from '../services/MediaSyncService';
import { colors, spacing, radius } from '../theme/veritas';
import Video from 'react-native-video';
import { SovereignHeader, SovereignFooter } from '../components/SovereignBranding';
import OfflineBufferService from '../services/OfflineBufferService';
import SovereignActionSheet from '../components/SovereignActionSheet';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const COLS = 2;
const CARD_W = (SCREEN_W - spacing.lg * 2 - spacing.md) / COLS;
const POSTER_H = CARD_W * 1.4;

const VIDEO_POS_PREFIX = '@video_pos_';

const formatDuration = (ms) => {
  if (!ms) return '';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
};

// Genre color accents
const GENRE_COLORS = {
  'Action': '#e74c3c',
  'Sci-Fi': '#3498db',
  'Drama': '#9b59b6',
  'Comedy': '#2ecc71',
  'Horror': '#e67e22',
  'Cinema': colors.gold,
};

export default function VideoScreen() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playingVideo, setPlayingVideo] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState('title_asc');
  const [currentShow, setCurrentShow] = useState(null);
  const [watchProgress, setWatchProgress] = useState({}); // {id: {positionSec, durationSec}}
  const [paused, setPaused] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef(null);
  const controlsTimer = useRef(null);

  const [offlineStatus, setOfflineStatus] = useState({});
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [selectedVideoObj, setSelectedVideoObj] = useState(null);

  const SORT_LABELS = { title_asc: 'A→Z', title_desc: 'Z→A', recent: 'RECENT' };
  const SORT_CYCLE = ['title_asc', 'title_desc', 'recent'];

  useEffect(() => {
    let unmounted = false;

    const loadLibrary = async () => {
      setLoading(true);
      try {
        const manifest = await MediaSyncService.fetchLibrary();
        if (manifest && manifest.Video && !unmounted) {
          let vidList = [];
          if (manifest.Video.videos) vidList = manifest.Video.videos;
          else if (Array.isArray(manifest.Video)) vidList = manifest.Video;
          else vidList = Object.values(manifest.Video);
          setVideos(vidList);
        }
      } catch (e) {
        console.log('[VIDEO] Failed to load library:', e);
      }
      if (!unmounted) setLoading(false);
    };

    const loadWatchProgress = async () => {
      try {
        const keys = await AsyncStorage.getAllKeys();
        const vidKeys = keys.filter(k => k.startsWith(VIDEO_POS_PREFIX));
        if (vidKeys.length > 0) {
          const pairs = await AsyncStorage.multiGet(vidKeys);
          const progress = {};
          pairs.forEach(([key, val]) => {
            const id = key.replace(VIDEO_POS_PREFIX, '');
            try { progress[id] = JSON.parse(val); } catch {}
          });
          setWatchProgress(progress);
        }
      } catch {}
    };

    loadLibrary();
    loadWatchProgress();

    const unsub = MediaSyncService.on('LIBRARY_RESPONSE', (manifest) => {
      if (manifest && manifest.Video) {
        let vidList = [];
        if (manifest.Video.videos) vidList = manifest.Video.videos;
        else if (Array.isArray(manifest.Video)) vidList = manifest.Video;
        else vidList = Object.values(manifest.Video);
        setVideos(vidList);
      }
    });

    const updateOfflineState = () => {
      const qMap = {};
      OfflineBufferService.queue.forEach(q => { qMap[q.trackId] = 'downloading'; });
      const bMap = {};
      OfflineBufferService.getBufferedTracks().forEach(k => { bMap[k] = 'downloaded'; });
      setOfflineStatus({ ...bMap, ...qMap });
    };
    updateOfflineState();

    const unsubQ = OfflineBufferService.on('queue_updated', updateOfflineState);
    const unsubC = OfflineBufferService.on('download_complete', updateOfflineState);
    const unsubD = OfflineBufferService.on('buffer_deleted', updateOfflineState);
    const unsubE = OfflineBufferService.on('download_error', updateOfflineState);
    const unsubClear = OfflineBufferService.on('buffer_cleared', updateOfflineState);

    return () => { 
      unmounted = true; 
      unsub(); 
      unsubQ(); unsubC(); unsubD(); unsubE(); unsubClear();
    };
  }, []);

  const savePosition = async (vid, positionSec, durationSec) => {
    if (!vid?.id) return;
    const data = { positionSec, durationSec, ts: Date.now() };
    setWatchProgress(prev => ({ ...prev, [vid.id]: data }));
    await AsyncStorage.setItem(VIDEO_POS_PREFIX + vid.id, JSON.stringify(data));
  };

  const filteredVideos = React.useMemo(() => {
    let result = [];
    const q = searchQuery.toLowerCase().trim();

    if (!currentShow) {
      const showsMap = new Map();
      const standalone = [];
      
      for (const t of videos) {
        if (t.type === 'tv' && t.show) {
          if (!showsMap.has(t.show)) showsMap.set(t.show, []);
          showsMap.get(t.show).push(t);
        } else {
          standalone.push(t);
        }
      }

      for (const [showName, episodes] of showsMap) {
        if (q && !showName.toLowerCase().includes(q)) continue;
        result.push({
          isGroup: true,
          id: 'show_' + showName,
          title: showName,
          genre: 'TV Show',
          episodes,
          poster: episodes[0].poster,
          duration: null
        });
      }

      for (const s of standalone) {
        const title = (s.title || '').toLowerCase();
        const genre = (s.genre || '').toLowerCase();
        if (q && !(title.includes(q) || genre.includes(q))) continue;
        result.push(s);
      }
    } else {
        // Inside currentShow
        let epList = [...currentShow.episodes];
        if (q) {
           epList = epList.filter(t => (t.title || '').toLowerCase().includes(q));
        }
        result = epList.sort((a,b) => (a.season - b.season) || (a.episode - b.episode));
    }

    result = [...result].sort((a, b) => {
      const tA = (a.title || '').toLowerCase();
      const tB = (b.title || '').toLowerCase();
      switch (sortMode) {
        case 'title_asc': return tA.localeCompare(tB);
        case 'title_desc': return tB.localeCompare(tA);
        case 'recent': {
          const pA = watchProgress[a.id]?.ts || 0;
          const pB = watchProgress[b.id]?.ts || 0;
          return pB - pA;
        }
        default: return 0;
      }
    });

    return result;
  }, [videos, searchQuery, sortMode, watchProgress, currentShow]);

  const handleVideoPress = useCallback(async (vid) => {
    if (vid.isGroup) {
      setCurrentShow(vid);
      setSearchQuery('');
    } else {
      handlePlay(vid);
    }
  }, [handlePlay]);

  const handlePlay = useCallback(async (vid) => {
    const videoPath = vid.path || vid.src;
    if (!videoPath) return;

    let streamUrl = MediaSyncService.getHttpUrl(`/stream_media?path=${encodeURIComponent(videoPath)}`);
    const localPath = OfflineBufferService.getLocalPath(vid.id);
    if (localPath) {
      streamUrl = `file://${localPath}`;
    }

    // Restore position
    const saved = watchProgress[vid.id];
    const startPos = saved?.positionSec || 0;
    setPlayingVideo({ ...vid, streamUrl, startPos });
    setPaused(false);
    setShowControls(true);
    setCurrentTime(startPos);
    setDuration(0);
  }, [watchProgress]);

  const handleClosePlayer = async () => {
    if (playingVideo && currentTime > 5) {
      await savePosition(playingVideo, currentTime, duration);
    }
    setPlayingVideo(null);
    setCurrentTime(0);
    setDuration(0);
  };

  const handleProgress = ({ currentTime: ct }) => {
    setCurrentTime(ct);
    // Auto-save every 10 seconds
    if (playingVideo && Math.round(ct) % 10 === 0 && ct > 0) {
      savePosition(playingVideo, ct, duration);
    }
  };

  const handleLoad = ({ duration: d }) => {
    setDuration(d);
    if (playingVideo?.startPos > 0) {
      videoRef.current?.seek(playingVideo.startPos);
    }
  };

  const toggleControls = () => {
    setShowControls(prev => !prev);
    clearTimeout(controlsTimer.current);
    if (!showControls) {
      controlsTimer.current = setTimeout(() => setShowControls(false), 4000);
    }
  };

  const handleSkip = (delta) => {
    const target = Math.max(0, Math.min(currentTime + delta, duration));
    videoRef.current?.seek(target);
    setCurrentTime(target);
  };

  const handleVideoLongPress = useCallback((vid) => {
    setSelectedVideoObj(vid);
    setActionSheetVisible(true);
  }, []);

  const handleDownloadVideoOffline = async () => {
    if (!selectedVideoObj) return;
    const url = MediaSyncService.getHttpUrl(`/stream_media?path=${encodeURIComponent(selectedVideoObj.path || selectedVideoObj.src)}`);
    await OfflineBufferService.queueDownload(
      selectedVideoObj.id, 
      url, 
      selectedVideoObj.filename || `${selectedVideoObj.id}.mkv`, 
      selectedVideoObj.size || 500000000, 
      {
         albumId: selectedVideoObj.id,
         albumName: selectedVideoObj.title,
         artist: selectedVideoObj.genre || 'Video'
      }, 
      true // isPersistent (Vault)
    );
  };

  const handleRemoveVideoOffline = () => {
    if (!selectedVideoObj) return;
    OfflineBufferService.deleteBuffer(selectedVideoObj.id);
  };

  // ─── Poster card ────────────────────────────────────────────
  const renderVideoCard = useCallback(({ item }) => {
    const genre = item.genre || 'Cinema';
    const genreColor = GENRE_COLORS[genre] || colors.gold;
    const posterUrl = item.poster 
      ? MediaSyncService.getHttpUrl(`/stream_media?path=${encodeURIComponent(item.poster)}`)
      : null;
    const progress = watchProgress[item.id];
    const progressPct = progress && progress.durationSec > 0
      ? Math.min(1, progress.positionSec / progress.durationSec)
      : 0;

    const status = offlineStatus[item.id] || 'none';

    return (
      <TouchableOpacity 
        style={styles.card} 
        onPress={() => handleVideoPress(item)} 
        onLongPress={() => handleVideoLongPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.posterWrap}>
          {posterUrl ? (
            <Image
              source={{ uri: posterUrl, headers: { 'Bypass-Tunnel-Reminder': 'true', 'User-Agent': 'localtunnel' }}}
              style={styles.poster}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.posterPlaceholder}>
              <Text style={styles.playIcon}>▶</Text>
              <View style={[styles.genreDot, { backgroundColor: genreColor }]} />
            </View>
          )}
          {/* Offline Status Badge */}
          {status !== 'none' && (
            <View style={[styles.cardOfflineBadge, status === 'downloaded' && { backgroundColor: colors.gold }]}>
              {status === 'downloading' ? (
                <ActivityIndicator size="small" color={colors.gold} />
              ) : (
                <Text style={styles.cardOfflineText}>✓</Text>
              )}
            </View>
          )}
          {/* Resume indicator */}
          {progressPct > 0.01 && progressPct < 0.95 && (
            <View style={styles.progressBarWrap}>
              <View style={[styles.progressBarFill, { width: `${progressPct * 100}%` }]} />
            </View>
          )}
          {/* Completed badge */}
          {progressPct >= 0.95 && (
            <View style={styles.completedBadge}>
              <Text style={styles.completedText}>✓</Text>
            </View>
          )}
          {/* Duration pill */}
          {item.duration && (
            <View style={styles.durationPill}>
              <Text style={styles.durationText}>{formatDuration(item.duration)}</Text>
            </View>
          )}
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title || 'Unknown'}</Text>
          <Text style={[styles.cardGenre, { color: genreColor }]}>{genre}</Text>
        </View>
      </TouchableOpacity>
    );
  }, [watchProgress, handlePlay]);

  // ─── Fullscreen Player ──────────────────────────────────────
  if (playingVideo) {
    const progressPct = duration > 0 ? currentTime / duration : 0;
    return (
      <View style={styles.playerContainer}>
        <StatusBar hidden />
        <TouchableOpacity style={styles.playerTouchZone} activeOpacity={1} onPress={toggleControls}>
          <Video
            ref={videoRef}
            source={{
              uri: playingVideo.streamUrl,
              headers: { 'Bypass-Tunnel-Reminder': 'true', 'User-Agent': 'localtunnel' }
            }}
            style={styles.videoPlayer}
            controls={false}
            resizeMode="contain"
            paused={paused}
            onProgress={handleProgress}
            onLoad={handleLoad}
            onError={(e) => console.log('Video Error:', e)}
          />
        </TouchableOpacity>

        {showControls && (
          <View style={styles.controlsOverlay}>
            {/* Top bar */}
            <View style={styles.topBar}>
              <TouchableOpacity onPress={handleClosePlayer} style={styles.closeBtn}>
                <Text style={styles.closeText}>✖ CLOSE</Text>
              </TouchableOpacity>
              <Text style={styles.playerVideoTitle} numberOfLines={1}>{playingVideo.title}</Text>
              <View style={{ width: 80 }} />
            </View>

            {/* Center controls */}
            <View style={styles.centerControls}>
              <TouchableOpacity onPress={() => handleSkip(-15)} style={styles.skipBtn}>
                <Text style={styles.skipText}>-15s</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPaused(!paused)} style={styles.playPauseBtn}>
                <Text style={styles.playPauseText}>{paused ? '▶' : '⏸'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleSkip(30)} style={styles.skipBtn}>
                <Text style={styles.skipText}>+30s</Text>
              </TouchableOpacity>
            </View>

            {/* Bottom progress */}
            <View style={styles.bottomBar}>
              <Text style={styles.timeCode}>{formatTime(currentTime)}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPct * 100}%` }]} />
              </View>
              <Text style={styles.timeCode}>{formatTime(duration)}</Text>
            </View>
          </View>
        )}
      </View>
    );
  }

  // ─── Library View ───────────────────────────────────────────
  return (
    <View style={styles.container}>
      <SovereignHeader />

      {currentShow && (
        <TouchableOpacity style={{ marginBottom: spacing.sm, paddingVertical: spacing.xs }} onPress={() => {setCurrentShow(null); setSearchQuery('');}}>
          <Text style={{ fontFamily: 'Courier New', fontSize: 10, color: colors.gold }}>{'< Back to Cinema'}</Text>
        </TouchableOpacity>
      )}

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search titles or genres..."
            placeholderTextColor="#555"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 6 }}>
              <Text style={{ color: '#888', fontSize: 14 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Sort + Count */}
      <View style={styles.sortRow}>
        <Text style={styles.countText}>
          {filteredVideos.length}{searchQuery ? `/${videos.length}` : ''}
        </Text>
        <TouchableOpacity
          style={styles.sortBtn}
          onPress={() => {
            const idx = SORT_CYCLE.indexOf(sortMode);
            setSortMode(SORT_CYCLE[(idx + 1) % SORT_CYCLE.length]);
          }}
        >
          <Text style={styles.sortBtnText}>⇅ {SORT_LABELS[sortMode]}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.gold} style={{ marginTop: 50 }} />
      ) : filteredVideos.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>▶</Text>
          <Text style={styles.emptyTitle}>
            {searchQuery ? 'No videos match your search' : 'No Video Library Detected'}
          </Text>
          <Text style={styles.emptySub}>
            {searchQuery ? 'Try a different search term' : 'Add sovereign_video_library.json to your Sovereign Media folder'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredVideos}
          keyExtractor={(i, idx) => i.id || String(idx)}
          renderItem={renderVideoCard}
          contentContainerStyle={{ paddingBottom: 20 }}
          numColumns={COLS}
          columnWrapperStyle={{ justifyContent: 'space-between' }}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={<SovereignFooter />}
        />
      )}
      
      <SovereignActionSheet
        visible={actionSheetVisible}
        onClose={() => setActionSheetVisible(false)}
        title={selectedVideoObj?.title}
        options={[
          { label: '⚡ DOWNLOAD VAULT', onPress: handleDownloadVideoOffline },
          { label: '✖ REMOVE CACHE', destructive: true, onPress: handleRemoveVideoOffline },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.obsidian,
    padding: spacing.lg,
    paddingTop: 50,
  },
  headerTitle: {
    color: colors.gold,
    fontFamily: 'Courier New',
    fontSize: 16,
    letterSpacing: 2,
    marginBottom: 16,
    fontWeight: 'bold',
  },

  // Search
  searchRow: { marginBottom: 10 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(212,175,55,0.2)',
    paddingHorizontal: 12, height: 42,
  },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: {
    flex: 1, color: '#E0D8C8', fontFamily: 'Courier New', fontSize: 13, paddingVertical: 0,
  },

  // Sort
  sortRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 14, paddingHorizontal: 2,
  },
  countText: { color: '#777', fontSize: 11, fontFamily: 'Courier New' },
  sortBtn: {
    backgroundColor: 'rgba(212,175,55,0.08)', borderRadius: 6,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.15)',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  sortBtnText: { color: colors.gold, fontFamily: 'Courier New', fontSize: 11, fontWeight: 'bold' },

  // Cards
  card: {
    width: CARD_W,
    backgroundColor: colors.obsidianLight,
    marginBottom: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  posterWrap: {
    width: CARD_W,
    height: POSTER_H,
    backgroundColor: '#0D0D0D',
    position: 'relative',
  },
  poster: {
    width: CARD_W,
    height: POSTER_H,
  },
  posterPlaceholder: {
    width: CARD_W,
    height: POSTER_H,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.04)',
  },
  playIcon: {
    fontSize: 32,
    color: colors.goldDim,
  },
  genreDot: {
    width: 8, height: 8, borderRadius: 4,
    position: 'absolute', top: 8, right: 8,
  },
  progressBarWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  progressBarFill: {
    height: 3, backgroundColor: colors.gold,
  },
  completedBadge: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: 'rgba(76,175,80,0.85)',
    borderRadius: 10, width: 20, height: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  completedText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  durationPill: {
    position: 'absolute', bottom: 8, right: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },
  durationText: {
    color: '#ccc', fontFamily: 'Courier New', fontSize: 9,
  },
  cardInfo: { padding: 8 },
  cardTitle: {
    color: colors.text, fontSize: 12, fontWeight: '600', marginBottom: 3,
  },
  cardGenre: {
    fontFamily: 'Courier New', fontSize: 9, letterSpacing: 1,
  },

  // Empty state
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40,
  },
  emptyIcon: { fontSize: 48, color: colors.goldDim, marginBottom: 16 },
  emptyTitle: {
    fontFamily: 'Courier New', fontSize: 13, color: colors.text,
    letterSpacing: 2, marginBottom: 8, textAlign: 'center',
  },
  emptySub: {
    fontFamily: 'Courier New', fontSize: 10, color: colors.textDim,
    textAlign: 'center',
  },

  // ─── Player ──────────────────────────────────────────────
  playerContainer: {
    flex: 1, backgroundColor: '#000', justifyContent: 'center',
  },
  playerTouchZone: { flex: 1, justifyContent: 'center' },
  videoPlayer: {
    width: '100%', height: '100%',
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 20, paddingHorizontal: 16,
  },
  closeBtn: { padding: 10 },
  closeText: { color: colors.gold, fontFamily: 'Courier New', fontSize: 13, fontWeight: 'bold' },
  playerVideoTitle: {
    flex: 1, color: '#fff', fontFamily: 'Courier New', fontSize: 13,
    textAlign: 'center', letterSpacing: 1,
  },
  centerControls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 30,
  },
  skipBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
  },
  skipText: { color: '#fff', fontFamily: 'Courier New', fontSize: 12 },
  playPauseBtn: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.gold, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 12, elevation: 12,
  },
  playPauseText: { fontSize: 28, color: '#000' },
  bottomBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 20, gap: 10,
  },
  timeCode: { color: '#ccc', fontFamily: 'Courier New', fontSize: 10, width: 55, textAlign: 'center' },
  progressTrack: {
    flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2,
  },
  progressFill: {
    height: 3, backgroundColor: colors.gold, borderRadius: 2,
  },
  cardOfflineBadge: {
    position: 'absolute', bottom: 4, left: 4,
    backgroundColor: 'rgba(10,10,12,0.85)',
    borderRadius: 8, width: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.gold,
  },
  cardOfflineText: { fontSize: 9, color: colors.gold },
});
