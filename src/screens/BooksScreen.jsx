/**
 * BooksScreen.jsx — EPUB/eBook library. 3-column grid, EPUB.js WebView renderer,
 * CFI position tracking, vault downloads, author grouping.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Dimensions, Modal, ActivityIndicator, RefreshControl,
  ScrollView,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, SPACING, RADIUS } from '../theme/veritas';
import MediaSyncService from '../services/MediaSyncService';
import OfflineBufferService from '../services/OfflineBufferService';

const { width: W, height: H } = Dimensions.get('window');
const CARD_W = (W - SPACING.md * 4) / 3;
const CARD_H = CARD_W * 1.5;
const CFI_KEY_PREFIX = '@sovereign_cfi_';

// ─── EPUB Reader HTML ─────────────────────────────────────────────────────

function buildReaderHtml(epubUrl, savedCfi, headers) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0A0A0A;
      color: #F0EAD6;
      font-family: Georgia, serif;
      font-size: 18px;
      line-height: 1.8;
    }
    #viewer {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }
    #prev, #next {
      position: fixed;
      top: 0; bottom: 0;
      width: 40px;
      background: transparent;
      border: none;
      cursor: pointer;
      z-index: 999;
    }
    #prev { left: 0; }
    #next { right: 0; }
    .epub-container {
      background: #0A0A0A !important;
    }
  </style>
</head>
<body>
  <div id="viewer"></div>
  <button id="prev" onclick="prevPage()"></button>
  <button id="next" onclick="nextPage()"></button>
  <script>
    var book = ePub("${epubUrl}");
    var rendition = book.renderTo("viewer", {
      width: "100%",
      height: "100%",
      flow: "paginated",
    });

    rendition.themes.override("body", {
      "background": "#0A0A0A !important",
      "color": "#F0EAD6 !important",
      "font-family": "Georgia, serif !important",
      "font-size": "18px !important",
      "line-height": "1.8 !important",
      "padding": "0 24px !important",
    });
    rendition.themes.override("*", {
      "background": "#0A0A0A !important",
      "color": "#F0EAD6 !important",
    });
    rendition.themes.override("a", { "color": "#D4AF37 !important" });

    var savedCfi = ${savedCfi ? `"${savedCfi}"` : 'null'};
    if (savedCfi) {
      rendition.display(savedCfi);
    } else {
      rendition.display();
    }

    rendition.on("relocated", function(location) {
      if (location && location.start && location.start.cfi) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: "CFI_UPDATE",
          cfi: location.start.cfi,
          percent: Math.round((location.start.percentage || 0) * 100),
        }));
      }
    });

    function prevPage() {
      rendition.prev();
    }
    function nextPage() {
      rendition.next();
    }

    document.addEventListener("keyup", function(e) {
      if (e.key === "ArrowLeft")  rendition.prev();
      if (e.key === "ArrowRight") rendition.next();
    });
  </script>
</body>
</html>
  `;
}

// ─── Book Card ────────────────────────────────────────────────────────────

function BookCard({ book, onPress, onLongPress }) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(book)}
      onLongPress={() => onLongPress(book)}
      activeOpacity={0.85}
    >
      <FastImage
        style={styles.cover}
        source={{
          uri: MediaSyncService.buildCoverUrl(book.coverHash) || book.cover,
          headers: MediaSyncService.getRequestHeaders(),
          priority: FastImage.priority.normal,
        }}
        resizeMode={FastImage.resizeMode.cover}
      />
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={2}>{book.title}</Text>
        <Text style={styles.cardAuthor} numberOfLines={1}>{book.author}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── EPUB Reader Modal ────────────────────────────────────────────────────

function EpubReaderModal({ book, visible, onClose }) {
  const webViewRef  = useRef(null);
  const [cfi,       setCfi]      = useState(null);
  const [percent,   setPercent]  = useState(0);
  const [savedCfi,  setSavedCfi] = useState(null);

  useEffect(() => {
    if (visible && book) {
      AsyncStorage.getItem(`${CFI_KEY_PREFIX}${book.id || book.path}`)
        .then(v => setSavedCfi(v));
    }
  }, [visible, book]);

  const onMessage = useCallback(async (e) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'CFI_UPDATE') {
        setCfi(msg.cfi);
        setPercent(msg.percent);
        await AsyncStorage.setItem(`${CFI_KEY_PREFIX}${book.id || book.path}`, msg.cfi);
        MediaSyncService.send({ type: 'CFI_UPDATE', payload: { bookId: book.id, cfi: msg.cfi } });
      }
    } catch (_) {}
  }, [book]);

  const epubUrl = book
    ? (OfflineBufferService.getBufferPath(book.path || book.id) ||
       `${MediaSyncService.getBaseUrl()}/download_book?path=${encodeURIComponent(book.path)}`)
    : null;

  if (!visible || !book) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.readerRoot}>
        {/* Reader header */}
        <View style={styles.readerHeader}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.readerTitle} numberOfLines={1}>{book.title}</Text>
          <Text style={styles.readerPercent}>{percent}%</Text>
        </View>

        {/* EPUB WebView */}
        {epubUrl && (
          <WebView
            ref={webViewRef}
            style={styles.webView}
            source={{ html: buildReaderHtml(epubUrl, savedCfi, MediaSyncService.getRequestHeaders()) }}
            onMessage={onMessage}
            allowsInlineMediaPlayback
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={['*']}
            mixedContentMode="always"
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ─── Books Screen ─────────────────────────────────────────────────────────

export default function BooksScreen() {
  const [books,       setBooks]       = useState([]);
  const [filtered,    setFiltered]    = useState([]);
  const [query,       setQuery]       = useState('');
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [activeBook,  setActiveBook]  = useState(null);
  const [readerOpen,  setReaderOpen]  = useState(false);
  const [sort,        setSort]        = useState('recent'); // recent | alpha | author

  useEffect(() => {
    const unsub = MediaSyncService.on('manifest', (manifest) => {
      const data = manifest?.Books || [];
      setBooks(data);
      setLoading(false);
    });
    const existing = MediaSyncService.getManifest();
    if (existing?.Books) {
      setBooks(existing.Books);
      setLoading(false);
    }
    return unsub;
  }, []);

  useEffect(() => {
    let result = [...books];
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(b =>
        b.title?.toLowerCase().includes(q) ||
        b.author?.toLowerCase().includes(q)
      );
    }
    if (sort === 'alpha')  result.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    if (sort === 'author') result.sort((a, b) => (a.author || '').localeCompare(b.author || ''));
    setFiltered(result);
  }, [query, books, sort]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await MediaSyncService.refreshManifest();
    setRefreshing(false);
  }, []);

  const onPress = useCallback((book) => {
    setActiveBook(book);
    setReaderOpen(true);
  }, []);

  const onLongPress = useCallback(async (book) => {
    await OfflineBufferService.vaultTrack({
      ...book,
      path: book.filePath || book.path,
    });
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
      {/* Search + sort */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search books..."
          placeholderTextColor={COLORS.textDim}
        />
        <Text style={styles.countLabel}>{filtered.length}</Text>
      </View>

      <View style={styles.sortRow}>
        {['recent', 'alpha', 'author'].map(s => (
          <TouchableOpacity key={s} onPress={() => setSort(s)} style={styles.sortBtn}>
            <Text style={[styles.sortText, sort === s && styles.sortActive]}>
              {s.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id || item.path}
        numColumns={3}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <BookCard book={item} onPress={onPress} onLongPress={onLongPress} />
        )}
        initialNumToRender={12}
        maxToRenderPerBatch={9}
        windowSize={5}
        removeClippedSubviews
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.gold} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>NO BOOKS FOUND</Text>
          </View>
        }
      />

      <EpubReaderModal
        book={activeBook}
        visible={readerOpen}
        onClose={() => setReaderOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.obsidian },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.obsidian },
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
  countLabel: { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 12, marginLeft: SPACING.sm },

  sortRow: { flexDirection: 'row', paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm, backgroundColor: COLORS.obsidianDeep },
  sortBtn: { marginRight: SPACING.md },
  sortText:   { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 2 },
  sortActive: { color: COLORS.gold },

  list: { paddingHorizontal: SPACING.md, paddingBottom: 120 },
  row:  { justifyContent: 'space-between', marginTop: SPACING.md },

  card: {
    width: CARD_W, backgroundColor: COLORS.obsidianCard,
    borderRadius: RADIUS.sm, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.obsidianBorder,
  },
  cover: { width: CARD_W, height: CARD_H },
  cardInfo: { padding: SPACING.xs },
  cardTitle:  { color: COLORS.textPrimary, fontFamily: FONTS.mono, fontSize: 10 },
  cardAuthor: { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 9, marginTop: 2 },

  empty: { flex: 1, alignItems: 'center', marginTop: 80 },
  emptyText: { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 12, letterSpacing: 2 },

  // Reader
  readerRoot:   { flex: 1, backgroundColor: COLORS.obsidianDeep },
  readerHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    backgroundColor: COLORS.obsidianDeep,
    borderBottomWidth: 1, borderBottomColor: COLORS.gold,
  },
  closeBtn:       { marginRight: SPACING.md },
  closeText:      { color: COLORS.gold, fontSize: 18, fontFamily: FONTS.mono },
  readerTitle:    { flex: 1, color: COLORS.textPrimary, fontFamily: FONTS.mono, fontSize: 13 },
  readerPercent:  { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 11 },
  webView:        { flex: 1, backgroundColor: COLORS.obsidianDeep },
});
