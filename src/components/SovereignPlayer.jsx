/**
 * SovereignPlayer.jsx — Persistent gold mini-player bar.
 * Always visible when media is active. Play/pause, title ticker, artwork.
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing, Image,
} from 'react-native';
import { usePlaybackState, useProgress, State } from 'react-native-track-player';
import TrackPlayer from 'react-native-track-player';
import { COLORS, FONTS, SPACING, RADIUS, MINI_PLAYER_HEIGHT } from '../theme/veritas';
import PlayerService from '../services/PlayerService';

export default function SovereignPlayer({ onExpand }) {
  const playbackState = usePlaybackState();
  const { position, duration } = useProgress(1000);
  const [track, setTrack] = useState(null);
  const tickerAnim = useRef(new Animated.Value(0)).current;
  const tickerWidth = useRef(0);

  const isPlaying = playbackState.state === State.Playing;
  const isActive  = track && playbackState.state !== State.None && playbackState.state !== State.Stopped;
  const progress  = duration > 0 ? position / duration : 0;

  useEffect(() => {
    const fetch = async () => {
      const active = await TrackPlayer.getActiveTrack();
      setTrack(active);
    };
    fetch();
    const interval = setInterval(fetch, 2000);
    return () => clearInterval(interval);
  }, [playbackState]);

  // Ticker animation
  useEffect(() => {
    if (!isActive) return;
    const loop = Animated.loop(
      Animated.timing(tickerAnim, {
        toValue: -200,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [isActive, track?.id]);

  if (!isActive) return null;

  return (
    <TouchableOpacity
      style={styles.root}
      onPress={() => onExpand && onExpand(track)}
      activeOpacity={0.9}
    >
      {/* Progress bar at top */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      <View style={styles.inner}>
        {/* Artwork */}
        {track?.artwork ? (
          <Image source={{ uri: track.artwork }} style={styles.artwork} />
        ) : (
          <View style={[styles.artwork, styles.artworkPlaceholder]}>
            <Text style={styles.artworkIcon}>◎</Text>
          </View>
        )}

        {/* Title ticker */}
        <View style={styles.titleWrap}>
          <Animated.Text
            style={[styles.title, { transform: [{ translateX: tickerAnim }] }]}
            numberOfLines={1}
          >
            {track?.title}
          </Animated.Text>
          <Text style={styles.artist} numberOfLines={1}>{track?.artist}</Text>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <TouchableOpacity onPress={PlayerService.previous} style={styles.ctrlBtn}>
            <Text style={styles.ctrlIcon}>⏮</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => isPlaying ? PlayerService.pause() : PlayerService.play()}
            style={styles.playBtn}
          >
            <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={PlayerService.next} style={styles.ctrlBtn}>
            <Text style={styles.ctrlIcon}>⏭</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {
    height:          MINI_PLAYER_HEIGHT,
    backgroundColor: COLORS.obsidianDeep,
    borderTopWidth:  1,
    borderTopColor:  COLORS.gold,
  },
  progressTrack: { height: 2, backgroundColor: COLORS.obsidianBorder },
  progressFill:  { height: 2, backgroundColor: COLORS.gold },

  inner: {
    flex: 1, flexDirection: 'row',
    alignItems: 'center', paddingHorizontal: SPACING.md,
  },

  artwork: {
    width: 44, height: 44, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: COLORS.gold,
  },
  artworkPlaceholder: {
    backgroundColor: COLORS.obsidianCard,
    alignItems: 'center', justifyContent: 'center',
  },
  artworkIcon: { color: COLORS.gold, fontSize: 18, fontFamily: FONTS.mono },

  titleWrap: {
    flex: 1, marginHorizontal: SPACING.md, overflow: 'hidden',
  },
  title:  { color: COLORS.textPrimary, fontFamily: FONTS.mono, fontSize: 13 },
  artist: { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 11, marginTop: 2 },

  controls: { flexDirection: 'row', alignItems: 'center' },
  ctrlBtn:  { padding: SPACING.sm },
  ctrlIcon: { color: COLORS.textSecondary, fontSize: 16 },
  playBtn:  { padding: SPACING.sm, marginHorizontal: 4 },
  playIcon: { color: COLORS.gold, fontSize: 22 },
});
