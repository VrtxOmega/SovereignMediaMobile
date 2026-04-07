/**
 * LibraryScreen.jsx — Audio tab. 2-column masonry grid of audiobook covers.
 * Auto-resume indicators, long-press to vault, tap to navigate to AlbumScreen.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import { createStackNavigator } from '@react-navigation/stack';
import { COLORS, FONTS, SPACING, RADIUS } from '../theme/veritas';
import MediaSyncService from '../services/MediaSyncService';
import StateLedgerService from '../services/StateLedgerService';
import AlbumScreen from './AlbumScreen';

const Stack = createStackNavigator();
const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = (SCREEN_W - SPACING.md * 3) / 2;
const CARD_H = CARD_W * 1.4;

// ─── Cover Card ───────────────────────────────────────────────────────────

function AlbumCard({ album, onPress, onLongPress }) {
  const session  = StateLedgerService.getSession(album.id);
  const progress = session && album.durationMs
    ? Math.min(session.lastPos / album.durationMs, 1)
    : 0;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(album)}
      onLongPress={() => onLongPress(album)}
      activeOpacity={0.85}
    >
      <FastImage
        style={styles.cover}
        source={{
          uri: MediaSyncService.buildCoverUrl(album.coverHash) || album.artwork,
          headers: MediaSyncService.getRequestHeaders(),
          priority: FastImage.priority.normal,
        }}
        resizeMode={FastImage.resizeMode.cover}
      />

      {/* In-progress bar */}
      {progress > 0 && progress < 0.95 && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      )}

      {/* Completed badge */}
      {progress >= 0.95 && (
        <View style={styles.completedBadge}>
          <Text style={styles.completedText}>✓</Text>
        </View>
      )}

      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={2}>{album.title}</Text>
        <Text style={styles.cardAuthor} numberOfLines={1}>{album.author}</Text>
        <Text style={styles.cardTracks}>{album.trackCount || 1} track{(album.trackCount || 1) !== 1 ? 's' : ''}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Library Grid ─────────────────────────────────────────────────────────

function LibraryGrid({ navigation, onTrackPress }) {
  const [albums,     setAlbums]     = useState([]);
  const [filtered,   setFiltered]   = useState([]);
  const [query,      setQuery]      = useState('');
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const unsub = MediaSyncService.on('manifest', (manifest) => {
      const data = manifest?.Audio || [];
      setAlbums(data);
      setFiltered(data);
      setLoading(false);
    });
    const existing = MediaSyncService.getManifest();
    if (existing?.Audio) {
      setAlbums(existing.Audio);
      setFiltered(existing.Audio);
      setLoading(false);
    }
    return unsub;
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setFiltered(albums);
    } else {
      const q = query.toLowerCase();
      setFiltered(albums.filter(a =>
        a.title?.toLowerCase().includes(q) ||
        a.author?.toLowerCase().includes(q)
      ));
    }
  }, [query, albums]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await MediaSyncService.refreshManifest();
    setRefreshing(false);
  }, []);

  const onPress = useCallback((album) => {
    navigation.navigate('Album', { album });
  }, [navigation]);

  const onLongPress = useCallback((album) => {
    // TODO: show action sheet for vault options
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.gold} size="large" />
        <Text style={styles.loadingText}>LOADING LIBRARY...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search audiobooks..."
          placeholderTextColor={COLORS.textDim}
        />
        <Text style={styles.countLabel}>{filtered.length} albums</Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id || item.path}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <AlbumCard album={item} onPress={onPress} onLongPress={onLongPress} />
        )}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.gold}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>NO AUDIOBOOKS FOUND</Text>
          </View>
        }
      />
    </View>
  );
}

// ─── Stack Navigator (Library → Album) ───────────────────────────────────

export default function LibraryScreen({ onTrackPress }) {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle:      { backgroundColor: COLORS.obsidianDeep },
        headerTintColor:  COLORS.gold,
        headerTitleStyle: { fontFamily: FONTS.mono, letterSpacing: 2 },
        headerBackTitle:  '',
      }}
    >
      <Stack.Screen name="Library" options={{ title: 'AUDIO' }}>
        {(props) => <LibraryGrid {...props} onTrackPress={onTrackPress} />}
      </Stack.Screen>
      <Stack.Screen name="Album" options={{ title: 'ALBUM' }}>
        {(props) => <AlbumScreen {...props} onTrackPress={onTrackPress} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  root:  { flex: 1, backgroundColor: COLORS.obsidian },
  center:{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.obsidian },
  loadingText: { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 11, letterSpacing: 2, marginTop: SPACING.md },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    backgroundColor: COLORS.obsidianDeep,
  },
  searchInput: {
    flex: 1, backgroundColor: COLORS.obsidianCard,
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm, color: COLORS.textPrimary,
    fontFamily: FONTS.mono, fontSize: 13,
    borderWidth: 1, borderColor: COLORS.obsidianBorder,
  },
  countLabel: { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 11, marginLeft: SPACING.sm },

  list: { paddingHorizontal: SPACING.md, paddingBottom: 120 },
  row:  { justifyContent: 'space-between', marginTop: SPACING.md },

  card: {
    width: CARD_W, backgroundColor: COLORS.obsidianCard,
    borderRadius: RADIUS.md, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.obsidianBorder,
  },
  cover: { width: CARD_W, height: CARD_H },

  progressTrack: {
    position: 'absolute', bottom: 56, left: 0, right: 0,
    height: 3, backgroundColor: COLORS.obsidianBorder,
  },
  progressFill: { height: 3, backgroundColor: COLORS.gold },

  completedBadge: {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: COLORS.gold, borderRadius: RADIUS.full,
    width: 22, height: 22, alignItems: 'center', justifyContent: 'center',
  },
  completedText: { color: COLORS.obsidian, fontSize: 12, fontWeight: 'bold' },

  cardInfo: { padding: SPACING.sm },
  cardTitle:  { color: COLORS.textPrimary, fontFamily: FONTS.mono, fontSize: 12, marginBottom: 2 },
  cardAuthor: { color: COLORS.gold,        fontFamily: FONTS.mono, fontSize: 10 },
  cardTracks: { color: COLORS.textDim,     fontFamily: FONTS.mono, fontSize: 10, marginTop: 2 },

  empty: { flex: 1, alignItems: 'center', marginTop: 80 },
  emptyText: { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 12, letterSpacing: 2 },
});
