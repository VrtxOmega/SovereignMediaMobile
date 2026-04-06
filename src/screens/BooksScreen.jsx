import React, { useEffect, useState, useRef, memo, useCallback } from 'react';
import { View, Text, FlatList, SectionList, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Modal, ScrollView, TextInput, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MediaSyncService from '../services/MediaSyncService';
import OfflineBufferService from '../services/OfflineBufferService';
import { colors } from '../theme/veritas';
import { SovereignHeader, SovereignFooter } from '../components/SovereignBranding';
import SovereignActionSheet from '../components/SovereignActionSheet';
import { WebView } from 'react-native-webview';
import RNFS from 'react-native-fs';

const READING_POS_PREFIX = '@book_pos_';

const BookCard = memo(({ item, onPress, onLongPress, offlineState }) => {
  const [imageError, setImageError] = useState(false);
  const coverUrl = MediaSyncService.getHttpUrl(`/cover/${item.id}.jpg`);

  const status = offlineState?.[item.id] || 'none'; // 'none', 'downloading', 'downloaded'

  return (
    <TouchableOpacity 
      style={styles.card} 
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      activeOpacity={0.7}
    >
      <View style={{ position: 'relative' }}>
        {!imageError ? (
          <Image 
            source={{ 
              uri: coverUrl,
              headers: { 'Bypass-Tunnel-Reminder': 'true', 'User-Agent': 'localtunnel' }
            }} 
            style={styles.coverImage} 
            resizeMode="cover" 
            defaultSource={null}
            onError={() => setImageError(true)}
          />
        ) : (
          <View style={styles.coverPlaceholder}>
            <Text style={styles.coverIcon}>📖</Text>
          </View>
        )}
        
        {/* Offline Status Badge */}
        {status !== 'none' && (
          <View style={[styles.offlineBadge, status === 'downloaded' && { backgroundColor: colors.gold }]}>
            {status === 'downloading' ? (
              <ActivityIndicator size="small" color={colors.gold} />
            ) : (
              <Text style={styles.checkText}>✓</Text>
            )}
          </View>
        )}
      </View>
      <View style={styles.details}>
        <Text style={styles.title} numberOfLines={2}>{item.title || 'Unknown Title'}</Text>
        <Text style={styles.subtitle}>{item.author || item.creator || 'Unknown Author'}</Text>
      </View>
    </TouchableOpacity>
  );
});

export default function BooksScreen() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [readingBook, setReadingBook] = useState(null);
  const [showToc, setShowToc] = useState(false);
  const [tocChapters, setTocChapters] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState('author_asc');
  const [viewMode, setViewMode] = useState('authors'); // 'grid' | 'authors'
  const [collapsedAuthors, setCollapsedAuthors] = useState({});
  const webViewRef = useRef(null);

  const [offlineStatus, setOfflineStatus] = useState({});
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [selectedBookObj, setSelectedBookObj] = useState(null);

  const SORT_LABELS = {
    title_asc: 'TITLE A→Z',
    title_desc: 'TITLE Z→A',
    author_asc: 'AUTHOR A→Z',
    author_desc: 'AUTHOR Z→A',
    recent: 'RECENT',
  };
  const SORT_CYCLE = ['author_asc', 'author_desc', 'title_asc', 'title_desc', 'recent'];

  const filteredBooks = React.useMemo(() => {
    let result = books;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(b => {
        const title = (b.title || '').toLowerCase();
        const author = (b.author || b.creator || '').toLowerCase();
        return title.includes(q) || author.includes(q);
      });
    }
    result = [...result].sort((a, b) => {
      const tA = (a.title || '').toLowerCase();
      const tB = (b.title || '').toLowerCase();
      const aA = (a.author || a.creator || '').toLowerCase();
      const aB = (b.author || b.creator || '').toLowerCase();
      switch (sortMode) {
        case 'title_asc': return tA.localeCompare(tB);
        case 'title_desc': return tB.localeCompare(tA);
        case 'author_asc': return aA.localeCompare(aB) || tA.localeCompare(tB);
        case 'author_desc': return aB.localeCompare(aA) || tA.localeCompare(tB);
        case 'recent': return 0;
        default: return 0;
      }
    });
    return result;
  }, [books, searchQuery, sortMode]);

  // Group by author for SectionList
  const authorSections = React.useMemo(() => {
    const groups = {};
    filteredBooks.forEach(b => {
      const author = b.author || b.creator || 'Unknown Author';
      if (!groups[author]) groups[author] = [];
      groups[author].push(b);
    });
    return Object.keys(groups)
      .sort((a, b) => {
        if (sortMode === 'author_desc') return b.localeCompare(a);
        return a.localeCompare(b);
      })
      .map(author => ({
        title: author,
        count: groups[author].length,
        data: collapsedAuthors[author] ? [] : groups[author],
      }));
  }, [filteredBooks, sortMode, collapsedAuthors]);

  // Alphabet sidebar letters
  const alphaLetters = React.useMemo(() => {
    const letters = new Set();
    authorSections.forEach(s => {
      const first = s.title.charAt(0).toUpperCase();
      if (/[A-Z]/.test(first)) letters.add(first);
      else letters.add('#');
    });
    return Array.from(letters).sort();
  }, [authorSections]);

  const sectionListRef = useRef(null);

  const toggleAuthor = (author) => {
    setCollapsedAuthors(prev => ({ ...prev, [author]: !prev[author] }));
  };

  const jumpToLetter = (letter) => {
    const idx = authorSections.findIndex(s => {
      const first = s.title.charAt(0).toUpperCase();
      return letter === '#' ? !/[A-Z]/.test(first) : first === letter;
    });
    if (idx >= 0 && sectionListRef.current) {
      sectionListRef.current.scrollToLocation({ sectionIndex: idx, itemIndex: 0, viewOffset: 60 });
    }
  };

  useEffect(() => {
    let unmounted = false;
    
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

    const loadLibrary = async () => {
      setLoading(true);
      const manifest = await MediaSyncService.fetchLibrary();
      if (!unmounted && manifest && manifest.Books) {
        let bookList = [];
        if (manifest.Books.books) {
            bookList = manifest.Books.books;
        } else {
            const metadata = manifest.Books.metadata || manifest.Books;
            bookList = Array.isArray(metadata) ? metadata : Object.values(metadata);
        }
        setBooks(bookList);
      }
      if (!unmounted) setLoading(false);
    };

    loadLibrary();

    const unsub = MediaSyncService.on('LIBRARY_RESPONSE', (manifest) => {
      if (manifest && manifest.Books) {
        let bookList = [];
        if (manifest.Books.books) {
            bookList = manifest.Books.books;
        } else {
            const metadata = manifest.Books.metadata || manifest.Books;
            bookList = Array.isArray(metadata) ? metadata : Object.values(metadata);
        }
        setBooks(bookList);
      }
    });

    return () => {
      unmounted = true;
      unsub();
      unsubQ(); unsubC(); unsubD(); unsubE(); unsubClear();
    };
  }, []);

  const downloadToVault = (book) => {
    const remoteUrl = MediaSyncService.getHttpUrl(`/stream_media?path=${encodeURIComponent(book.path || book.src)}`);
    if (!remoteUrl) return;
    
    // Guessing 5MB default size for quota checks since manifest doesn't have exact bytes
    const estimatedSize = 5 * 1024 * 1024; 
    
    OfflineBufferService.queueDownload(
      book.id,
      remoteUrl,
      `book_${book.id}.epub`,
      estimatedSize,
      book, // AlbumData metadata
      true // isPersistent = true (Vault)
    );
  };

  const handleRead = async (book) => {
    setDownloading(true);
    try {
      let localPath = OfflineBufferService.getLocalPath(book.id);
      
      if (!localPath) {
        const remoteUrl = MediaSyncService.getHttpUrl(`/stream_media?path=${encodeURIComponent(book.path || book.src)}`);
        if (!remoteUrl) {
          setDownloading(false);
          return;
        }
        
        localPath = `${RNFS.CachesDirectoryPath}/book_${book.id}.epub`;
        
        const exists = await RNFS.exists(localPath);
        if (!exists) {
          const result = await RNFS.downloadFile({
            fromUrl: remoteUrl,
            toFile: localPath,
            headers: {
              'Bypass-Tunnel-Reminder': 'true',
              'User-Agent': 'localtunnel'
            }
          }).promise;
          if (result.statusCode !== 200) {
            throw new Error(`Download failed: HTTP ${result.statusCode}`);
          }
        }
      }
      
      const base64Data = await RNFS.readFile(localPath, 'base64');
      
      // Restore saved position
      const savedCfi = await AsyncStorage.getItem(`${READING_POS_PREFIX}${book.id}`);
      
      setReadingBook({ ...book, base64Data, savedCfi });
    } catch(e) {
      console.warn('[BOOKS] Failed loading EPUB:', e);
      setReadingBook({ ...book, loadError: e.message || 'Unknown error' });
    } finally {
      setDownloading(false);
    }
  };

  // Handle messages from WebView (position saves + TOC)
  const handleWebViewMessage = useCallback((event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'position' && readingBook) {
        AsyncStorage.setItem(`${READING_POS_PREFIX}${readingBook.id}`, msg.cfi);
      } else if ((msg.type === 'toc' || msg.type === 'toc_response') && msg.chapters) {
        setTocChapters(msg.chapters);
      }
    } catch(e) { /* ignore non-JSON messages */ }
  }, [readingBook]);

  const sendToWebView = useCallback((msg) => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`handleCommand(${JSON.stringify(msg)}); true;`);
    }
  }, []);

  const renderBookItem = ({ item }) => {
    return <BookCard item={item} onPress={handleRead} onLongPress={handleLongPress} offlineState={offlineStatus} />;
  };

  if (readingBook) {
    if (readingBook.loadError) {
      return (
        <View style={styles.readerContainer}>
          <View style={styles.readerHeader}>
            <TouchableOpacity onPress={() => setReadingBook(null)} style={styles.headerBtn}>
              <Text style={styles.closeText}>◀ LIBRARY</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
            <Text style={{ color: '#FF4444', fontFamily: 'Courier New', textAlign: 'center', fontSize: 13 }}>
              Failed to load: {readingBook.loadError}
            </Text>
          </View>
        </View>
      );
    }

    const savedCfiEscaped = readingBook.savedCfi ? readingBook.savedCfi.replace(/'/g, "\\'") : '';

    const viewerHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
        <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js"></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
          html, body { width: 100%; height: 100%; overflow: hidden; }
          body { background: #F5F0E8; color: #2C2C2C; font-family: Georgia, 'Times New Roman', serif; }
          
          #viewer { 
            width: 100%; height: calc(100% - 52px); 
            overflow: hidden; position: relative;
          }
          
          #status { 
            position: fixed; top: 35%; left: 50%; transform: translate(-50%,-50%); 
            text-align: center; z-index: 50; color: #8B7355; font-size: 14px;
            font-family: 'Courier New', monospace;
          }
          #status.hidden { display: none; }
          
          /* Invisible tap zones over the reader */
          .tap-zone {
            position: fixed; top: 0; z-index: 4;
            height: calc(100% - 52px); background: transparent;
          }
          #tap-prev { left: 0; width: 35%; }
          #tap-next { right: 0; width: 35%; }
          
          /* Bottom control bar */
          #controls {
            position: fixed; bottom: 0; left: 0; right: 0; height: 52px;
            background: linear-gradient(180deg, #1A1610 0%, #0F0D0A 100%);
            border-top: 1px solid rgba(212,175,55,0.3);
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 12px; z-index: 20;
          }
          
          .ctrl-btn {
            color: #D4AF37; font-size: 13px; font-weight: 600;
            font-family: 'Courier New', monospace;
            background: rgba(212,175,55,0.08); border: 1px solid rgba(212,175,55,0.25);
            border-radius: 8px; padding: 8px 16px; letter-spacing: 0.5px;
            -webkit-tap-highlight-color: rgba(212,175,55,0.15);
          }
          .ctrl-btn:active { background: rgba(212,175,55,0.2); }

          #page-info { 
            color: #8B7355; font-size: 10px; font-family: 'Courier New', monospace;
            text-align: center; letter-spacing: 1px; min-width: 60px;
          }

          /* Progress bar */
          #progress-wrap {
            position: fixed; bottom: 52px; left: 0; right: 0; height: 3px;
            background: rgba(212,175,55,0.1); z-index: 20;
          }
          #progress-bar {
            height: 100%; width: 0%; 
            background: linear-gradient(90deg, #D4AF37, #F0D060);
            transition: width 0.3s ease;
          }

          /* Font size controls */
          .font-btn {
            color: #D4AF37; font-size: 16px; font-weight: bold;
            font-family: Georgia, serif;
            background: none; border: 1px solid rgba(212,175,55,0.2);
            border-radius: 6px; width: 32px; height: 32px;
            display: flex; align-items: center; justify-content: center;
          }
          .font-btn:active { background: rgba(212,175,55,0.15); }
        </style>
      </head>
      <body>
        <div id="status">Rendering book...</div>
        <div class="tap-zone" id="tap-prev"></div>
        <div class="tap-zone" id="tap-next"></div>
        <div id="viewer"></div>
        <div id="progress-wrap"><div id="progress-bar"></div></div>
        <div id="controls">
          <button class="ctrl-btn" id="btn-prev">◀</button>
          <button class="font-btn" id="btn-smaller">A-</button>
          <span id="page-info">—</span>
          <button class="font-btn" id="btn-bigger">A+</button>
          <button class="ctrl-btn" id="btn-next">▶</button>
        </div>
        <script>
          var statusEl = document.getElementById('status');
          var pageInfo = document.getElementById('page-info');
          var progressBar = document.getElementById('progress-bar');
          var currentRendition = null;
          var currentBook = null;
          var fontSize = 100; // percentage
          var savedCfi = '${savedCfiEscaped}';
          var saveTimer = null;
          
          // Navigation
          function goPrev() { if (currentRendition) currentRendition.prev(); }
          function goNext() { if (currentRendition) currentRendition.next(); }
          
          document.getElementById('btn-prev').addEventListener('click', goPrev);
          document.getElementById('btn-next').addEventListener('click', goNext);
          document.getElementById('tap-prev').addEventListener('click', goPrev);
          document.getElementById('tap-next').addEventListener('click', goNext);
          
          // Font size
          document.getElementById('btn-smaller').addEventListener('click', function() {
            fontSize = Math.max(70, fontSize - 10);
            if (currentRendition) currentRendition.themes.fontSize(fontSize + '%');
          });
          document.getElementById('btn-bigger').addEventListener('click', function() {
            fontSize = Math.min(160, fontSize + 10);
            if (currentRendition) currentRendition.themes.fontSize(fontSize + '%');
          });
          
          // Commands from React Native
          function handleCommand(cmd) {
            if (cmd.action === 'goto' && currentRendition) {
              currentRendition.display(cmd.target);
            } else if (cmd.action === 'toc' && currentBook) {
              currentBook.loaded.navigation.then(function(nav) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'toc', chapters: nav.toc.map(function(ch) {
                    return { label: ch.label.trim(), href: ch.href };
                  })
                }));
              });
            }
          }
          
          function handleMsg(e) {
            try {
              var raw = atob(e.data);
              var arr = new Uint8Array(raw.length);
              for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
              
              statusEl.textContent = 'Rendering...';
              var book = ePub(arr.buffer);
              currentBook = book;
              
              var rendition = book.renderTo('viewer', { 
                width: '100%', height: '100%', 
                flow: 'paginated',
                snap: true
              });
              currentRendition = rendition;
              
              // Premium reading theme — warm parchment
              rendition.themes.register('sovereign', {
                'body': { 
                  'background': '#F5F0E8 !important',
                  'color': '#2C2C2C !important',
                  'font-family': 'Georgia, "Times New Roman", serif !important',
                  'line-height': '1.7 !important',
                  'padding': '12px 16px !important'
                },
                'p': {
                  'color': '#2C2C2C !important',
                  'line-height': '1.7 !important'
                },
                'h1, h2, h3, h4, h5, h6': {
                  'color': '#1A1A1A !important'
                },
                'a': {
                  'color': '#8B6914 !important'
                }
              });
              rendition.themes.select('sovereign');
              rendition.themes.fontSize(fontSize + '%');
              
              // Display at saved position or start
              var startLoc = savedCfi || undefined;
              rendition.display(startLoc).then(function() {
                statusEl.className = 'hidden';
              });
              
              // Track relocation — save position + update UI
              rendition.on('relocated', function(location) {
                if (location && location.start) {
                  var pg = location.start.displayed;
                  if (pg) pageInfo.textContent = pg.page + ' / ' + pg.total;
                  
                  // Progress bar
                  if (currentBook.locations && currentBook.locations.length()) {
                    var pct = currentBook.locations.percentageFromCfi(location.start.cfi);
                    progressBar.style.width = (pct * 100) + '%';
                  }
                  
                  // Debounced save to React Native
                  clearTimeout(saveTimer);
                  saveTimer = setTimeout(function() {
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: 'position',
                      cfi: location.start.cfi
                    }));
                  }, 500);
                }
              });
              
              // Generate locations for progress tracking
              book.ready.then(function() {
                return book.locations.generate(1600);
              });
              
              // Send TOC to React Native
              book.loaded.navigation.then(function(nav) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'toc',
                  chapters: nav.toc.map(function(ch) {
                    return { label: ch.label.trim(), href: ch.href };
                  })
                }));
              });
              
            } catch(err) {
              statusEl.textContent = 'Render error: ' + err.message;
              statusEl.style.color = '#FF4444';
            }
          }
          
          document.addEventListener('message', function(e) { handleMsg(e); });
          window.addEventListener('message', function(e) { handleMsg(e); });
        </script>
      </body>
      </html>
    `;

    return (
      <View style={styles.readerContainer}>
        <View style={styles.readerHeader}>
          <TouchableOpacity onPress={() => setReadingBook(null)} style={styles.headerBtn}>
            <Text style={styles.closeText}>◀ LIBRARY</Text>
          </TouchableOpacity>
          <Text style={styles.readerTitle} numberOfLines={1}>{readingBook.title}</Text>
          <TouchableOpacity onPress={() => {
            sendToWebView({ action: 'toc' });
            setShowToc(true);
          }} style={styles.headerBtn}>
            <Text style={styles.tocBtnText}>☰</Text>
          </TouchableOpacity>
        </View>
        <WebView 
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: viewerHtml }}
          style={styles.webview}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          allowFileAccess={true}
          allowUniversalAccessFromFileURLs={true}
          mixedContentMode="always"
          onMessage={handleWebViewMessage}
          onLoadEnd={() => {
            if (readingBook.base64Data && webViewRef.current) {
              webViewRef.current.postMessage(readingBook.base64Data);
            }
          }}
        />
        {/* Table of Contents Modal */}
        <TocModal 
          visible={showToc} 
          chapters={tocChapters}
          onClose={() => setShowToc(false)}
          onSelect={(href) => {
            sendToWebView({ action: 'goto', target: href });
            setShowToc(false);
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SovereignHeader />
      {/* Search Bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search titles or authors..."
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
      {/* Mode toggle + Sort + Count */}
      <View style={styles.sortRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            style={[styles.modeBtn, viewMode === 'authors' && styles.modeBtnActive]}
            onPress={() => setViewMode('authors')}
          >
            <Text style={[styles.modeBtnText, viewMode === 'authors' && styles.modeBtnTextActive]}>AUTHORS</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, viewMode === 'grid' && styles.modeBtnActive]}
            onPress={() => setViewMode('grid')}
          >
            <Text style={[styles.modeBtnText, viewMode === 'grid' && styles.modeBtnTextActive]}>GRID</Text>
          </TouchableOpacity>
          <Text style={styles.countText}>
            {filteredBooks.length}{searchQuery ? `/${books.length}` : ''}
          </Text>
        </View>
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
      ) : filteredBooks.length === 0 ? (
        <Text style={styles.emptyText}>
          {searchQuery ? 'No books match your search.' : 'No EPUB manifests detected.'}
        </Text>
      ) : viewMode === 'grid' ? (
        <FlatList
          data={filteredBooks}
          keyExtractor={(i, idx) => i.id || String(idx)}
          renderItem={renderBookItem}
          contentContainerStyle={{ paddingBottom: 20 }}
          numColumns={2}
          columnWrapperStyle={{ justifyContent: 'space-between' }}
          ListFooterComponent={<SovereignFooter />}
        />
      ) : (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <SectionList
            ref={sectionListRef}
            sections={authorSections}
            keyExtractor={(item, idx) => item.id || String(idx)}
            stickySectionHeadersEnabled={true}
            renderSectionHeader={({ section }) => (
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => toggleAuthor(section.title)}
                activeOpacity={0.7}
              >
                <Text style={styles.sectionArrow}>{collapsedAuthors[section.title] ? '▶' : '▼'}</Text>
                <Text style={styles.sectionTitle} numberOfLines={1}>{section.title}</Text>
                <Text style={styles.sectionCount}>{section.count}</Text>
              </TouchableOpacity>
            )}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.authorBookRow} onPress={() => handleRead(item)}>
                <Image
                  source={{
                    uri: MediaSyncService.getHttpUrl(`/cover/${item.id}`),
                    headers: { 'Bypass-Tunnel-Reminder': 'true', 'User-Agent': 'localtunnel' }
                  }}
                  style={styles.authorBookThumb}
                  resizeMode="cover"
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.authorBookTitle} numberOfLines={2}>{item.title || 'Unknown'}</Text>
                </View>
              </TouchableOpacity>
            )}
            contentContainerStyle={{ paddingBottom: 20 }}
            getItemLayout={undefined}
            onScrollToIndexFailed={() => {}}
            style={{ flex: 1 }}
            ListFooterComponent={<SovereignFooter />}
          />
          {/* Alphabet sidebar */}
          <View style={styles.alphaSidebar}>
            {alphaLetters.map(l => (
              <TouchableOpacity key={l} onPress={() => jumpToLetter(l)} style={styles.alphaItem}>
                <Text style={styles.alphaText}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
      {downloading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.gold} />
          <Text style={styles.loadingText}>Fetching Book Data...</Text>
        </View>
      )}
    </View>
  );
}

// Table of Contents Modal Component
function TocModal({ visible, onClose, onSelect, chapters = [] }) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.tocOverlay}>
        <View style={styles.tocContainer}>
          <View style={styles.tocHeader}>
            <Text style={styles.tocTitle}>TABLE OF CONTENTS</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 10 }}>
              <Text style={{ color: colors.gold, fontSize: 18 }}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.tocScroll}>
            {chapters.map((ch, i) => (
              <TouchableOpacity 
                key={i} 
                style={styles.tocItem}
                onPress={() => onSelect(ch.href)}
              >
                <Text style={styles.tocItemText}>{ch.label}</Text>
              </TouchableOpacity>
            ))}
            {chapters.length === 0 && (
              <Text style={styles.tocEmpty}>No chapters available</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.obsidian,
    padding: 16,
  },
  headerTitle: {
    color: colors.gold,
    fontFamily: 'Courier New',
    fontSize: 16,
    letterSpacing: 2,
    marginBottom: 12,
    marginTop: 10,
    fontWeight: 'bold',
  },
  searchRow: {
    marginBottom: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.2)',
    paddingHorizontal: 12,
    height: 42,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#E0D8C8',
    fontFamily: 'Courier New',
    fontSize: 13,
    paddingVertical: 0,
  },
  sortRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  countText: {
    color: '#777',
    fontFamily: 'Courier New',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  sortBtn: {
    backgroundColor: 'rgba(212,175,55,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.25)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sortBtnText: {
    color: colors.gold,
    fontFamily: 'Courier New',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  // View mode toggle
  modeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modeBtnActive: {
    backgroundColor: 'rgba(212,175,55,0.15)',
    borderColor: 'rgba(212,175,55,0.4)',
  },
  modeBtnText: {
    color: '#666',
    fontFamily: 'Courier New',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  modeBtnTextActive: {
    color: colors.gold,
  },
  // Section headers (author grouping)
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#151210',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212,175,55,0.12)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.03)',
  },
  sectionArrow: {
    color: colors.gold,
    fontSize: 10,
    marginRight: 10,
    width: 14,
  },
  sectionTitle: {
    color: '#E0D8C8',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  sectionCount: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'Courier New',
    marginLeft: 8,
  },
  // Author view book rows
  authorBookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    paddingLeft: 38,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
  },
  authorBookThumb: {
    width: 36,
    height: 52,
    borderRadius: 3,
    backgroundColor: 'rgba(212,175,55,0.05)',
  },
  authorBookTitle: {
    color: '#BBB',
    fontSize: 13,
  },
  // Alphabet sidebar
  alphaSidebar: {
    width: 22,
    paddingTop: 4,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  alphaItem: {
    paddingVertical: 1,
  },
  alphaText: {
    color: colors.gold,
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'Courier New',
  },
  card: {
    width: '48%',
    backgroundColor: colors.obsidianLight,
    marginBottom: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  coverImage: {
    width: '100%',
    height: 180,
  },
  coverPlaceholder: {
    width: '100%',
    height: 180,
    backgroundColor: 'rgba(212,175,55,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverIcon: {
    fontSize: 32,
    color: colors.gold,
  },
  details: {
    padding: 12,
  },
  title: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    color: colors.goldDim,
    fontSize: 10,
    fontFamily: 'Courier New',
  },
  emptyText: {
    color: colors.goldDim,
    fontSize: 12,
    fontFamily: 'Courier New',
    textAlign: 'center',
    marginTop: 50,
  },
  readerContainer: {
    flex: 1,
    backgroundColor: '#F5F0E8',
  },
  readerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212,175,55,0.3)',
    backgroundColor: '#0F0D0A',
  },
  headerBtn: {
    padding: 10,
  },
  closeText: {
    color: colors.gold,
    fontFamily: 'Courier New',
    fontSize: 12,
    fontWeight: 'bold',
  },
  tocBtnText: {
    color: colors.gold,
    fontSize: 20,
    fontWeight: 'bold',
  },
  readerTitle: {
    color: '#E8E0D0',
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Courier New',
  },
  webview: {
    flex: 1,
    backgroundColor: '#F5F0E8',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 10, 10, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  loadingText: {
    color: colors.gold,
    fontFamily: 'Courier New',
    fontSize: 14,
    marginTop: 16,
    letterSpacing: 1,
  },
  // TOC Modal styles
  tocOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  tocContainer: {
    backgroundColor: '#111',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
    borderTopWidth: 1,
    borderTopColor: 'rgba(212,175,55,0.3)',
  },
  tocHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212,175,55,0.15)',
  },
  tocTitle: {
    color: colors.gold,
    fontFamily: 'Courier New',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  tocScroll: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  tocItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  tocItemText: {
    color: '#CCC',
    fontSize: 14,
    fontFamily: 'Courier New',
  },
  tocEmpty: {
    color: '#666',
    fontSize: 12,
    fontFamily: 'Courier New',
    textAlign: 'center',
    marginTop: 30,
  },
});
