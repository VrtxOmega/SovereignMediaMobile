/**
 * NowPlayingScreen.jsx — Full-screen now playing overlay.
 * Large artwork, chapter list, scrubber, +30/-15 seeks, sleep timer.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  Dimensions, Image, ScrollView, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TrackPlayer from 'react-native-track-player';
import { usePlaybackState, useProgress, State } from 'react-native-track-player';
import LinearGradient from 'react-native-linear-gradient';
import { COLORS, FONTS, SPACING, RADIUS } from '../theme/veritas';
import PlayerService from '../services/PlayerService';

const { width: W, height: H } = Dimensions.get('window');

function formatSec(s) {
  if (!s && s !== 0) return '—';
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2,'0')}:${String(Math.floor(s) % 60).padStart(2,'0')}`;
  return `${m}:${String(Math.floor(s) % 60).padStart(2,'0')}`;
}

export default function NowPlayingScreen({ visible, onClose }) {
  const playbackState = usePlaybackState();
  const { position, duration, buffered } = useProgress(500);
  const [track,    setTrack]    = useState(null);
  const [chapters, setChapters] = useState([]);
  const [speed,    setSpeed]    = useState(1.0);

  const isPlaying = playbackState.state === State.Playing;
  const progress  = duration > 0 ? position / duration : 0;

  useEffect(() => {
    if (!visible) return;
    const fetch = async () => {
      const active = await TrackPlayer.getActiveTrack();
      setTrack(active);
      if (active?._raw?.chapters) setChapters(active._raw.chapters);
    };
    fetch();
  }, [visible, playbackState]);

  const cycleSpeed = useCallback(async () => {
    const speeds = [1.0, 1.25, 1.5, 1.75, 2.0, 0.75];
    const next   = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
    setSpeed(next);
    await TrackPlayer.setRate(next);
  }, [speed]);

  const seekToPercent = useCallback((pct) => {
    if (duration > 0) TrackPlayer.seekTo(pct * duration);
  }, [duration]);

  const currentChapter = chapters.find((c, i) => {
    const next = chapters[i + 1];
    const startS = (c.startMs || c.start || 0) / 1000;
    const endS   = next ? (next.startMs || next.start || 0) / 1000 : duration;
    return position >= startS && position < endS;
  });

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.root}>
        {/* Blurred background */}
        {track?.artwork && (
          <Image source={{ uri: track.artwork }} style={styles.bgArt} blurRadius={25} />
        )}
        <LinearGradient
          colors={[COLORS.overlayDark, COLORS.obsidian]}
          style={StyleSheet.absoluteFill}
        />

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeIcon}>⌄</Text>
          </TouchableOpacity>
          <Text style={styles.headerLabel}>NOW PLAYING</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Artwork */}
          {track?.artwork ? (
            <Image source={{ uri: track.artwork }} style={styles.artwork} />
          ) : (
            <View style={[styles.artwork, styles.artworkPlaceholder]}>
              <Text style={styles.artworkIcon}>◎</Text>
            </View>
          )}

          {/* Track Info */}
          <Text style={styles.title}>{track?.title || '—'}</Text>
          <Text style={styles.artist}>{track?.artist || track?.album || '—'}</Text>

          {/* Current Chapter */}
          {currentChapter && (
            <View style={styles.chapterBadge}>
              <Text style={styles.chapterText}>◈ {currentChapter.title}</Text>
            </View>
          )}

          {/* Scrubber */}
          <View style={styles.scrubberWrap}>
            <TouchableOpacity
              style={styles.scrubberTrack}
              onPress={(e) => seekToPercent(e.nativeEvent.locationX / (W - SPACING.xl * 2))}
              activeOpacity={1}
            >
              {/* Buffer fill */}
              <View style={[styles.scrubberBuffer, {
                width: `${(duration > 0 ? buffered / duration : 0) * 100}%`
              }]} />
              {/* Progress fill */}
              <View style={[styles.scrubberFill, { width: `${progress * 100}%` }]} />
              {/* Thumb */}
              <View style={[styles.scrubberThumb, { left: `${progress * 100}%` }]} />
            </TouchableOpacity>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatSec(position)}</Text>
              <Text style={styles.timeText}>{formatSec(duration)}</Text>
            </View>
          </View>

          {/* Controls */}
          <View style={styles.controls}>
            <TouchableOpacity onPress={() => PlayerService.seekBackward(15)} style={styles.seekBtn}>
              <Text style={styles.seekIcon}>↺</Text>
              <Text style={styles.seekLabel}>15</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={PlayerService.previous} style={styles.skipBtn}>
              <Text style={styles.skipIcon}>⏮</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => isPlaying ? PlayerService.pause() : PlayerService.play()}
              style={styles.playBtn}
            >
              <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={PlayerService.next} style={styles.skipBtn}>
              <Text style={styles.skipIcon}>⏭</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => PlayerService.seekForward(30)} style={styles.seekBtn}>
              <Text style={styles.seekIcon}>↻</Text>
              <Text style={styles.seekLabel}>30</Text>
            </TouchableOpacity>
          </View>

          {/* Speed control */}
          <TouchableOpacity style={styles.speedBtn} onPress={cycleSpeed}>
            <Text style={styles.speedText}>{speed}×</Text>
          </TouchableOpacity>

          {/* Chapter List */}
          {chapters.length > 0 && (
            <View style={styles.chapterList}>
              <Text style={styles.chapterListHeader}>CHAPTERS</Text>
              {chapters.map((ch, i) => {
                const startS = (ch.startMs || ch.start || 0) / 1000;
                const active = ch === currentChapter;
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.chapterRow, active && styles.chapterRowActive]}
                    onPress={() => TrackPlayer.seekTo(startS)}
                  >
                    <Text style={[styles.chapterTitle, active && styles.chapterTitleActive]}>
                      {active ? '▶ ' : ''}{ch.title || `Chapter ${i + 1}`}
                    </Text>
                    <Text style={styles.chapterTime}>{formatSec(startS)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.obsidian },
  bgArt: {
    ...StyleSheet.absoluteFillObject,
    width: '100%', height: '100%',
    opacity: 0.3,
  },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
  },
  closeBtn:    { padding: SPACING.sm },
  closeIcon:   { color: COLORS.gold, fontSize: 28, fontFamily: FONTS.mono },
  headerLabel: { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 3 },

  scroll: { alignItems: 'center', paddingHorizontal: SPACING.xl, paddingBottom: 40 },

  artwork: {
    width: W - SPACING.xl * 2,
    height: W - SPACING.xl * 2,
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.gold,
    marginBottom: SPACING.xl,
    marginTop: SPACING.md,
  },
  artworkPlaceholder: {
    backgroundColor: COLORS.obsidianCard,
    alignItems: 'center', justifyContent: 'center',
  },
  artworkIcon: { color: COLORS.gold, fontSize: 64, fontFamily: FONTS.mono },

  title:  { color: COLORS.textPrimary, fontFamily: FONTS.mono, fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  artist: { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 14, marginTop: 6, textAlign: 'center' },

  chapterBadge: {
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderWidth: 1, borderColor: COLORS.goldDim,
    borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 4,
    marginTop: SPACING.md,
  },
  chapterText: { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 11 },

  scrubberWrap: { width: '100%', marginTop: SPACING.xl },
  scrubberTrack: {
    height: 4, backgroundColor: COLORS.obsidianBorder,
    borderRadius: 2, position: 'relative',
  },
  scrubberBuffer: { height: 4, backgroundColor: 'rgba(212,175,55,0.25)', borderRadius: 2, position: 'absolute' },
  scrubberFill:   { height: 4, backgroundColor: COLORS.gold, borderRadius: 2, position: 'absolute' },
  scrubberThumb: {
    position: 'absolute', top: -6,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.gold, marginLeft: -8,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.sm },
  timeText: { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 11 },

  controls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: SPACING.xl, gap: SPACING.sm,
  },
  seekBtn:   { alignItems: 'center', padding: SPACING.sm },
  seekIcon:  { color: COLORS.textSecondary, fontSize: 24 },
  seekLabel: { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 10, marginTop: -4 },
  skipBtn:   { padding: SPACING.sm },
  skipIcon:  { color: COLORS.textSecondary, fontSize: 24 },
  playBtn:   {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: COLORS.gold,
    alignItems: 'center', justifyContent: 'center',
    marginHorizontal: SPACING.md,
  },
  playIcon: { color: COLORS.obsidian, fontSize: 28, fontFamily: FONTS.mono },

  speedBtn: {
    marginTop: SPACING.md, borderWidth: 1, borderColor: COLORS.obsidianBorder,
    borderRadius: RADIUS.full, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
  },
  speedText: { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 13 },

  chapterList: { width: '100%', marginTop: SPACING.xl },
  chapterListHeader: {
    color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 11,
    letterSpacing: 3, marginBottom: SPACING.sm,
  },
  chapterRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.obsidianBorder,
  },
  chapterRowActive: { backgroundColor: 'rgba(212,175,55,0.06)' },
  chapterTitle: { flex: 1, color: COLORS.textSecondary, fontFamily: FONTS.mono, fontSize: 12 },
  chapterTitleActive: { color: COLORS.gold },
  chapterTime: { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 11 },
});
