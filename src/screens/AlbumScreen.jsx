/**
 * AlbumScreen.jsx — Album detail. Large cover, track list, vault download,
 * chapter-aware playback, progress resumption.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Dimensions, Modal, ActivityIndicator,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import LinearGradient from 'react-native-linear-gradient';
import { COLORS, FONTS, SPACING, RADIUS } from '../theme/veritas';
import MediaSyncService from '../services/MediaSyncService';
import OfflineBufferService from '../services/OfflineBufferService';
import StateLedgerService from '../services/StateLedgerService';
import PlayerService from '../services/PlayerService';

const { width: W } = Dimensions.get('window');

function formatMs(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m ${s % 60}s`;
}

export default function AlbumScreen({ route, navigation }) {
  const { album } = route.params;
  const tracks    = album.tracks || [album];

  const [downloading, setDownloading] = useState({});
  const [progresses,  setProgresses]  = useState({});

  const playTrack = useCallback(async (track, index) => {
    const resumePos = StateLedgerService.getLastPosition(track.id || track.path);
    // Check if buffered/vaulted
    const localPath = OfflineBufferService.getBufferPath(track.path || track.id);
    const enriched  = localPath ? { ...track, localPath } : track;

    await PlayerService.loadAlbum(tracks, index, resumePos);
    navigation.getParent()?.navigate?.('NowPlaying');
  }, [tracks, navigation]);

  const vaultTrack = useCallback(async (track) => {
    if (OfflineBufferService.isVaulted(track.path || track.id)) return;
    const key = track.id || track.path;
    setDownloading(d => ({ ...d, [key]: true }));

    await OfflineBufferService.vaultTrack(track, (pct) => {
      setProgresses(p => ({ ...p, [key]: pct }));
    });

    setDownloading(d => ({ ...d, [key]: false }));
    setProgresses(p => ({ ...p, [key]: 100 }));
  }, []);

  const vaultAll = useCallback(async () => {
    for (const track of tracks) {
      await vaultTrack(track);
    }
  }, [tracks, vaultTrack]);

  const renderTrack = useCallback(({ item: track, index }) => {
    const key      = track.id || track.path;
    const vaulted  = OfflineBufferService.isVaulted(key);
    const dlActive = downloading[key];
    const pct      = progresses[key];
    const session  = StateLedgerService.getSession(key);
    const resume   = session ? session.lastPos : 0;

    return (
      <TouchableOpacity style={styles.trackRow} onPress={() => playTrack(track, index)}>
        <View style={styles.trackLeft}>
          <Text style={styles.trackNum}>{String(index + 1).padStart(2, '0')}</Text>
          <View style={styles.trackMeta}>
            <Text style={styles.trackTitle} numberOfLines={1}>{track.title || track.filename}</Text>
            <View style={styles.trackSubRow}>
              {track.durationMs && <Text style={styles.trackDur}>{formatMs(track.durationMs)}</Text>}
              {resume > 0 && (
                <Text style={styles.resumeTag}>↩ {formatMs(resume)}</Text>
              )}
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.vaultBtn}
          onPress={() => vaultTrack(track)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {dlActive
            ? <Text style={styles.vaultIcon}>{pct ? `${pct}%` : '...'}</Text>
            : vaulted
              ? <Text style={[styles.vaultIcon, { color: COLORS.gold }]}>✓</Text>
              : <Text style={styles.vaultIcon}>↓</Text>
          }
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }, [downloading, progresses, playTrack, vaultTrack]);

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <FastImage
          style={styles.headerBg}
          source={{
            uri: MediaSyncService.buildCoverUrl(album.coverHash) || album.artwork,
            headers: MediaSyncService.getRequestHeaders(),
          }}
          resizeMode={FastImage.resizeMode.cover}
          blurRadius={12}
        />
        <LinearGradient
          colors={['transparent', COLORS.obsidian]}
          style={styles.gradient}
        />
        <View style={styles.headerContent}>
          <FastImage
            style={styles.coverArt}
            source={{
              uri: MediaSyncService.buildCoverUrl(album.coverHash) || album.artwork,
              headers: MediaSyncService.getRequestHeaders(),
            }}
            resizeMode={FastImage.resizeMode.cover}
          />
          <View style={styles.headerMeta}>
            <Text style={styles.albumTitle}>{album.title}</Text>
            <Text style={styles.albumAuthor}>{album.author}</Text>
            <Text style={styles.albumStats}>
              {tracks.length} track{tracks.length !== 1 ? 's' : ''} · {formatMs(album.durationMs)}
            </Text>
          </View>
        </View>
      </View>

      {/* Vault All Button */}
      <TouchableOpacity style={styles.vaultAllBtn} onPress={vaultAll}>
        <Text style={styles.vaultAllText}>↓ VAULT ENTIRE ALBUM</Text>
      </TouchableOpacity>

      {/* Track List */}
      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id || item.path}
        renderItem={renderTrack}
        contentContainerStyle={styles.trackList}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.obsidian },

  header:      { height: 220, position: 'relative' },
  headerBg:    { ...StyleSheet.absoluteFillObject },
  gradient:    { ...StyleSheet.absoluteFillObject },
  headerContent: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', padding: SPACING.md, alignItems: 'flex-end',
  },
  coverArt: { width: 100, height: 100, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.gold },
  headerMeta: { flex: 1, marginLeft: SPACING.md },
  albumTitle:  { color: COLORS.textPrimary, fontFamily: FONTS.mono, fontSize: 16, fontWeight: 'bold' },
  albumAuthor: { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 12, marginTop: 4 },
  albumStats:  { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 11, marginTop: 4 },

  vaultAllBtn: {
    marginHorizontal: SPACING.md, marginVertical: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.gold, borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm, alignItems: 'center',
  },
  vaultAllText: { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 2 },

  trackList: { paddingBottom: 120 },
  separator: { height: 1, backgroundColor: COLORS.obsidianBorder, marginLeft: SPACING.md + 40 },

  trackRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 2,
  },
  trackLeft:  { flex: 1, flexDirection: 'row', alignItems: 'center' },
  trackNum:   { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 12, width: 28 },
  trackMeta:  { flex: 1 },
  trackTitle: { color: COLORS.textPrimary, fontFamily: FONTS.mono, fontSize: 13 },
  trackSubRow:{ flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  trackDur:   { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 10 },
  resumeTag:  { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 10, marginLeft: SPACING.sm },
  vaultBtn:   { paddingHorizontal: SPACING.sm },
  vaultIcon:  { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 14 },
});
