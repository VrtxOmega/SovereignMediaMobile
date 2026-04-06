import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Switch, Alert, Image,
} from 'react-native';
import { colors, spacing, radius, typography } from '../theme/veritas';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MediaSyncService from '../services/MediaSyncService';
import OfflineBufferService from '../services/OfflineBufferService';
import StateLedgerService from '../services/StateLedgerService';
import { SovereignHeader, SovereignFooter } from '../components/SovereignBranding';

const CONN_KEY = '@omega_host_ip';
const BUFFER_KEY = '@omega_buffer_limit';
const VAULT_KEY = '@omega_vault_limit';
const BLE_KEY = '@omega_ble_enabled';
const A2DP_KEY = '@omega_a2dp_force';
const VERBOSE_KEY = '@omega_verbose_logs';

const formatBytes = (bytes) => {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${Math.round(bytes / 1024 / 1024 * 10) / 10}MB`;
};

export default function SettingsScreen() {
  const [ip, setIp] = useState('');
  const [savedIp, setSavedIp] = useState('');
  const [loading, setLoading] = useState(false);
  const [btEnabled, setBtEnabled] = useState(true);
  const [a2dpEnabled, setA2dpEnabled] = useState(false);
  const [sysLogEnabled, setSysLogEnabled] = useState(false);
  const [bufferLimit, setBufferLimit] = useState(4);
  const [vaultLimit, setVaultLimit] = useState(32);
  const [activeSection, setActiveSection] = useState('config'); // config | storage | ledger
  
  // Storage state
  const [bufferedTracks, setBufferedTracks] = useState({});
  const [offlineBooks, setOfflineBooks] = useState([]);
  const [transientSizeBytes, setTransientSizeBytes] = useState(0);
  const [persistentSizeBytes, setPersistentSizeBytes] = useState(0);
  const [ledger, setLedger] = useState([]);
  const [ledgerStats, setLedgerStats] = useState({});

  useEffect(() => {
    const loadSettings = async () => {
      const [val, buf, vault, ble, a2dp, vLog] = await Promise.all([
        AsyncStorage.getItem(CONN_KEY),
        AsyncStorage.getItem(BUFFER_KEY),
        AsyncStorage.getItem(VAULT_KEY),
        AsyncStorage.getItem(BLE_KEY),
        AsyncStorage.getItem(A2DP_KEY),
        AsyncStorage.getItem(VERBOSE_KEY)
      ]);
      if (val) { setIp(val); setSavedIp(val); }
      if (buf) setBufferLimit(parseInt(buf, 10));
      if (vault) setVaultLimit(parseInt(vault, 10));
      if (ble !== null) setBtEnabled(ble === 'true');
      if (a2dp !== null) setA2dpEnabled(a2dp === 'true');
      if (vLog !== null) setSysLogEnabled(vLog === 'true');
    };
    loadSettings();
    loadBufferInfo();
    loadLedger();
    
    const unsubProgress = OfflineBufferService.on('download_complete', () => loadBufferInfo());
    const unsubDeleted = OfflineBufferService.on('buffer_deleted', () => loadBufferInfo());
    return () => { unsubProgress(); unsubDeleted(); };
  }, []);

  const loadBufferInfo = async () => {
    const meta = OfflineBufferService.meta || {};
    setBufferedTracks(meta);
    const [transSize, persSize] = await Promise.all([
      OfflineBufferService.getTransientSize(),
      OfflineBufferService.getPersistentSize()
    ]);
    setTransientSizeBytes(transSize);
    setPersistentSizeBytes(persSize);
    // Aggregate book groups
    const booksMap = {};
    Object.entries(meta).forEach(([trackId, info]) => {
      if (info.albumData && info.albumData.albumId) {
        const aId = info.albumData.albumId;
        if (!booksMap[aId]) {
          booksMap[aId] = { ...info.albumData, downloadedTracks: 0, totalSize: 0, trackIds: [] };
        }
        booksMap[aId].downloadedTracks += 1;
        booksMap[aId].totalSize += (info.size || 0);
        booksMap[aId].trackIds.push(trackId);
      }
    });
    setOfflineBooks(Object.values(booksMap));
  };

  const loadLedger = () => {
    const sessions = StateLedgerService.getLedger();
    setLedger([...sessions].reverse().slice(0, 50));
    setLedgerStats(StateLedgerService.getLedgerStats());
  };

  const handleToggle = async (key, val, setter) => {
    setter(val);
    await AsyncStorage.setItem(key, String(val));
    if (key === VERBOSE_KEY) MediaSyncService.setVerboseLogs?.(val);
  };

  const handleBufferLimitCycle = async () => {
    const options = [2, 4, 8, 16, 32, 64, -1];
    const nextIdx = (options.indexOf(bufferLimit) + 1) % options.length;
    setBufferLimit(options[nextIdx]);
    await AsyncStorage.setItem(BUFFER_KEY, String(options[nextIdx]));
  };

  const handleVaultLimitCycle = async () => {
    const options = [16, 32, 64, 128, 256, 512, 1024, -1];
    const nextIdx = (options.indexOf(vaultLimit) + 1) % options.length;
    setVaultLimit(options[nextIdx]);
    await AsyncStorage.setItem(VAULT_KEY, String(options[nextIdx]));
  };

  const handleUpdate = async () => {
    if (!ip.trim()) return;
    setLoading(true);
    await MediaSyncService.init(ip.trim());
    setSavedIp(ip.trim());
    setTimeout(() => setLoading(false), 800);
  };

  const handlePurge = async () => {
    await AsyncStorage.removeItem(CONN_KEY);
    setIp('');
    setSavedIp('');
    MediaSyncService.ws?.close();
  };

  const handleDeleteBuffer = (trackId) => {
    Alert.alert('Remove Buffer', 'Delete this locally buffered file?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => OfflineBufferService.deleteBuffer(trackId) }
    ]);
  };

  const handleClearAll = () => {
    Alert.alert('Clear All Buffers',
      `Delete all ${Object.keys(bufferedTracks).length} buffered files (${formatBytes(transientSizeBytes)})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear All', style: 'destructive', onPress: () => OfflineBufferService.clearAllBuffers() }
      ]
    );
  };

  const trackCount = Object.keys(bufferedTracks).filter(k => !bufferedTracks[k].isPersistent).length;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SovereignHeader />
      {/* Section Tabs */}
      <View style={styles.sectionTabs}>
        {[['config', '⚙ CONFIG'], ['storage', '⬡ STORAGE'], ['ledger', '◈ LEDGER']].map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.sectionTab, activeSection === key && styles.sectionTabActive]}
            onPress={() => setActiveSection(key)}
          >
            <Text style={[styles.sectionTabText, activeSection === key && styles.sectionTabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        
        {activeSection === 'config' && (
          <>
            {/* Network */}
            <View style={styles.card}>
              <Text style={styles.sectionHeader}>☁ CLOUD RELAY ARCHITECTURE</Text>
              <Text style={styles.label}>TELEMETRY HOST URL OR IP ADDRESS</Text>
              <TextInput
                style={styles.input}
                value={ip}
                onChangeText={setIp}
                placeholder="omega-audio-rlopez.loca.lt"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity 
                style={[styles.btn, (!ip || loading) && styles.btnDisabled]} 
                onPress={handleUpdate}
                disabled={!ip || loading}
              >
                <Text style={styles.btnText}>
                  {loading ? 'SECURING SOCKET...' : 'ENFORCE NEW ROUTE'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Hardware */}
            <View style={styles.card}>
              <Text style={styles.sectionHeader}>🎧 HARDWARE & STORAGE</Text>
              
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>High-Fidelity BLE Broadcast</Text>
                  <Text style={styles.toggleSub}>Push full track metadata to dash/smartwatch</Text>
                </View>
                <Switch value={btEnabled} onValueChange={(val) => handleToggle(BLE_KEY, val, setBtEnabled)}
                  trackColor={{ false: colors.obsidian, true: colors.goldDim }}
                  thumbColor={btEnabled ? colors.gold : colors.textDim} />
              </View>
              
              <View style={styles.separator} />

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>Force A2DP Audio Sink</Text>
                  <Text style={styles.toggleSub}>Lock output to connected Bluetooth device</Text>
                </View>
                <Switch value={a2dpEnabled} onValueChange={(val) => handleToggle(A2DP_KEY, val, setA2dpEnabled)}
                  trackColor={{ false: colors.obsidian, true: colors.goldDim }}
                  thumbColor={a2dpEnabled ? colors.gold : colors.textDim} />
              </View>

              <View style={styles.separator} />

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>Temp Buffer Limit</Text>
                  <Text style={styles.toggleSub}>Max storage for streaming tracks</Text>
                </View>
                <TouchableOpacity style={styles.limitBtn} onPress={handleBufferLimitCycle}>
                  <Text style={styles.limitBtnText}>{bufferLimit === -1 ? 'UNLIMITED' : `${bufferLimit} GB`}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.separator} />

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>Offline Book Vault Limit</Text>
                  <Text style={styles.toggleSub}>Max storage for permanent downloads</Text>
                </View>
                <TouchableOpacity style={styles.limitBtn} onPress={handleVaultLimitCycle}>
                  <Text style={styles.limitBtnText}>{vaultLimit === -1 ? 'UNLIMITED' : `${vaultLimit} GB`}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Diagnostics */}
            <View style={styles.card}>
              <Text style={styles.sectionHeader}>📊 DIAGNOSTICS & LOGGING</Text>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>Verbose Telemetry Logs</Text>
                  <Text style={styles.toggleSub}>Show handshake trace / heartbeat ping latency</Text>
                </View>
                <Switch value={sysLogEnabled} onValueChange={(val) => handleToggle(VERBOSE_KEY, val, setSysLogEnabled)}
                  trackColor={{ false: colors.obsidian, true: colors.goldDim }}
                  thumbColor={sysLogEnabled ? colors.gold : colors.textDim} />
              </View>
            </View>

            {/* Danger Zone */}
            <View style={[styles.card, { borderColor: colors.red + '44' }]}>
              <Text style={[styles.sectionHeader, { color: colors.red }]}>⚠ LOCAL STATE DANGER ZONE</Text>
              <Text style={styles.label}>PURGE ALL CACHE AND AUTH TOKENS</Text>
              <TouchableOpacity style={styles.purgeBtn} onPress={handlePurge}>
                <Text style={styles.purgeBtnText}>FLUSH STORAGE CONFIG</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {activeSection === 'storage' && (
          <>
            {/* Stats bar */}
            <View style={styles.statsCard}>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{trackCount}</Text>
                <Text style={styles.statLabel}>Cached</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{Math.round(transientSizeBytes / 1024 / 1024)}MB</Text>
                <Text style={styles.statLabel}>Buffer</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{offlineBooks.length}</Text>
                <Text style={styles.statLabel}>Vaulted</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{Math.round(persistentSizeBytes / 1024 / 1024)}MB</Text>
                <Text style={styles.statLabel}>Vault</Text>
              </View>
            </View>

            {/* Transient cache */}
            {trackCount > 0 && (
              <>
                <Text style={styles.sectionLabel}>TRANSIENT CACHE ({trackCount})</Text>
                <View style={styles.storageCard}>
                  {Object.entries(bufferedTracks)
                    .filter(([, info]) => !info.isPersistent)
                    .sort((a, b) => (b[1].downloadedAt || 0) - (a[1].downloadedAt || 0))
                    .map(([trackId, info]) => (
                    <View key={trackId} style={styles.trackRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.trackName} numberOfLines={1}>{info.filename}</Text>
                        <Text style={styles.trackMeta}>{formatBytes(info.size)} · {new Date(info.downloadedAt).toLocaleDateString()}</Text>
                      </View>
                      <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteBuffer(trackId)}>
                        <Text style={styles.deleteBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
                <TouchableOpacity style={styles.clearAllBtn} onPress={handleClearAll}>
                  <Text style={styles.clearAllText}>Clear All Buffers</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Offline books */}
            {offlineBooks.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>PERMANENT VAULT ({offlineBooks.length})</Text>
                {offlineBooks.map(book => (
                  <View key={book.albumId} style={styles.bookRow}>
                    <View style={styles.bookThumbWrap}>
                      {book.coverUrl ? (
                        <Image source={{ uri: book.coverUrl, headers: { 'Bypass-Tunnel-Reminder': 'true' } }} style={styles.bookThumb} />
                      ) : (
                        <View style={styles.bookThumbPlaceholder}><Text style={{ color: colors.goldDim, fontSize: 18 }}>Ω</Text></View>
                      )}
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.trackName} numberOfLines={2}>{book.albumName}</Text>
                      <Text style={styles.trackMeta}>{book.downloadedTracks}/{book.totalTracks} parts · {formatBytes(book.totalSize)}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}

            {trackCount === 0 && offlineBooks.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>⬡</Text>
                <Text style={styles.emptyTitle}>No Offline Content</Text>
                <Text style={styles.emptySub}>Files buffer automatically when you play them</Text>
              </View>
            )}
          </>
        )}

        {activeSection === 'ledger' && (
          <>
            <View style={styles.statsCard}>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{ledgerStats.sessions || 0}</Text>
                <Text style={styles.statLabel}>Sessions</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{ledgerStats.totalListenedHours || 0}h</Text>
                <Text style={styles.statLabel}>Listened</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{ledgerStats.uniqueTracks || 0}</Text>
                <Text style={styles.statLabel}>Titles</Text>
              </View>
            </View>

            {ledger.length > 0 ? (
              <View style={styles.storageCard}>
                {ledger.map((session, i) => {
                  const duration = Math.round((session.totalListenedMs || 0) / 60000);
                  return (
                    <View key={i} style={styles.ledgerRow}>
                      <View style={styles.sealBar} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.trackName} numberOfLines={1}>{session.trackTitle}</Text>
                        <Text style={styles.trackMeta}>
                          {duration}min · {new Date(session.endedAt || session.startedAt).toLocaleDateString()}
                        </Text>
                        <Text style={styles.sealHash} numberOfLines={1}>SEAL: {session.seal?.substr(0, 20)}...</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>◈</Text>
                <Text style={styles.emptyTitle}>No Sessions Yet</Text>
                <Text style={styles.emptySub}>Sessions are VERITAS-sealed as you listen</Text>
              </View>
            )}
          </>
        )}

      </ScrollView>
      <SovereignFooter />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.obsidian },
  scroll: { padding: spacing.xl, paddingBottom: 100 },

  // Section tabs
  sectionTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingTop: 50,
    backgroundColor: colors.obsidian,
  },
  sectionTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sectionTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.gold,
  },
  sectionTabText: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: colors.textDim,
    letterSpacing: 1,
    fontWeight: 'bold',
  },
  sectionTabTextActive: { color: colors.gold },

  // Config section
  header: { alignItems: 'center', marginBottom: spacing.xl, marginTop: spacing.md },
  headerTitle: { ...typography.title, fontSize: 24, letterSpacing: 4 },
  headerSub: { fontFamily: 'Courier New', fontSize: 10, color: colors.goldDim, marginTop: spacing.xs, letterSpacing: 1 },

  card: {
    backgroundColor: colors.obsidianMid,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  sectionHeader: {
    fontFamily: 'Courier New', fontSize: 11, fontWeight: 'bold',
    color: colors.gold, letterSpacing: 2, marginBottom: spacing.md,
  },

  label: { fontFamily: 'Courier New', fontSize: 10, color: colors.textDim, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.obsidianDark, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, borderRadius: radius.md,
    color: colors.gold, fontFamily: 'Courier New', marginBottom: spacing.lg,
  },

  btn: {
    backgroundColor: colors.gold, padding: spacing.md,
    borderRadius: radius.md, alignItems: 'center',
    shadowColor: colors.gold, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3, shadowRadius: 10,
  },
  btnDisabled: { backgroundColor: colors.obsidian, borderColor: colors.border, borderWidth: 1, shadowOpacity: 0 },
  btnText: { color: colors.obsidianDark, fontFamily: 'Courier New', fontWeight: 'bold', letterSpacing: 2 },

  purgeBtn: {
    backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.red,
    padding: spacing.md, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.xs,
  },
  purgeBtnText: { color: colors.red, fontFamily: 'Courier New', fontWeight: 'bold', letterSpacing: 2 },

  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  toggleTitle: { fontFamily: 'Courier New', fontSize: 13, color: colors.text, marginBottom: 2 },
  toggleSub: { fontFamily: 'Courier New', fontSize: 9, color: colors.textDim },
  separator: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },

  limitBtn: {
    backgroundColor: colors.obsidianDark, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md,
  },
  limitBtnText: { fontFamily: 'Courier New', fontSize: 13, color: colors.gold, fontWeight: 'bold' },

  // Storage + Ledger sections
  statsCard: {
    flexDirection: 'row', backgroundColor: colors.obsidianMid,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontFamily: 'Courier New', fontSize: 18, color: colors.gold, fontWeight: 'bold' },
  statLabel: { fontFamily: 'Courier New', fontSize: 8, color: colors.textDim, letterSpacing: 1, marginTop: 2 },

  sectionLabel: {
    fontFamily: 'Courier New', fontSize: 10, color: colors.goldDim,
    marginBottom: 8, letterSpacing: 1,
  },
  storageCard: {
    backgroundColor: colors.obsidianMid, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: spacing.md,
  },
  trackRow: {
    flexDirection: 'row', alignItems: 'center', padding: spacing.md,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.03)',
  },
  trackName: { fontFamily: 'Courier New', fontSize: 11, color: colors.text },
  trackMeta: { fontFamily: 'Courier New', fontSize: 9, color: colors.textDim, marginTop: 2 },
  deleteBtn: { padding: spacing.sm },
  deleteBtnText: { color: colors.red, fontSize: 14 },

  bookRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.obsidianMid, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  bookThumbWrap: {},
  bookThumb: { width: 44, height: 44, borderRadius: radius.sm },
  bookThumbPlaceholder: {
    width: 44, height: 44, borderRadius: radius.sm,
    backgroundColor: colors.obsidianLight, alignItems: 'center', justifyContent: 'center',
  },

  clearAllBtn: {
    borderWidth: 1, borderColor: colors.red,
    borderRadius: radius.md, padding: spacing.md,
    alignItems: 'center', marginBottom: spacing.lg,
  },
  clearAllText: { fontFamily: 'Courier New', fontSize: 11, color: colors.red, letterSpacing: 1 },

  ledgerRow: {
    flexDirection: 'row', alignItems: 'flex-start', padding: spacing.md,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.03)',
  },
  sealBar: { width: 3, minHeight: 40, backgroundColor: colors.gold, borderRadius: 2, marginRight: 10 },
  sealHash: { fontFamily: 'Courier New', fontSize: 8, color: colors.goldDim, marginTop: 2 },

  emptyState: { alignItems: 'center', padding: spacing.xxl },
  emptyIcon: { fontSize: 40, color: colors.goldDim, marginBottom: spacing.lg },
  emptyTitle: { fontFamily: 'Courier New', fontSize: 13, color: colors.text, letterSpacing: 2, marginBottom: spacing.sm },
  emptySub: { fontFamily: 'Courier New', fontSize: 10, color: colors.textDim, textAlign: 'center' },
});
