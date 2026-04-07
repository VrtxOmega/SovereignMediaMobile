/**
 * SettingsScreen.jsx — System tab. CONFIG | STORAGE | LEDGER sub-tabs.
 * Network config, cache stats, ledger metrics.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Switch, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../theme/veritas';
import MediaSyncService from '../services/MediaSyncService';
import OfflineBufferService from '../services/OfflineBufferService';
import StateLedgerService from '../services/StateLedgerService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TABS = ['⚙ CONFIG', '⬡ STORAGE', '◈ LEDGER'];

// ─── CONFIG Tab ───────────────────────────────────────────────────────────

function ConfigTab() {
  const [tunnelUrl,   setTunnelUrl]   = useState('');
  const [lanIp,       setLanIp]       = useState('');
  const [connected,   setConnected]   = useState(false);
  const [testing,     setTesting]     = useState(false);
  const [bleEnabled,  setBleEnabled]  = useState(false);
  const [a2dpEnabled, setA2dpEnabled] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('@sovereign_host').then(v => v && setTunnelUrl(v));
    AsyncStorage.getItem('@sovereign_lan_ip').then(v => v && setLanIp(v));
    setConnected(MediaSyncService.isConnected);
    const unsub = MediaSyncService.on('connected', setConnected);
    return unsub;
  }, []);

  const testConnection = async () => {
    setTesting(true);
    try {
      const target = tunnelUrl || (lanIp ? `http://${lanIp}:5002` : null);
      if (!target) return;
      const res = await fetch(`${target.replace(/\/$/, '')}/health`, {
        headers: { 'Bypass-Tunnel-Reminder': 'true' },
      });
      if (res.ok) {
        if (tunnelUrl) await MediaSyncService.setHost(tunnelUrl);
        if (lanIp)     await MediaSyncService.setLanIp(lanIp);
        Alert.alert('Connected', 'Sovereign node reachable.');
      } else {
        Alert.alert('Failed', `HTTP ${res.status}`);
      }
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <ScrollView style={styles.tabContent}>
      <Text style={styles.sectionHeader}>NETWORK RELAY</Text>

      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: connected ? COLORS.success : COLORS.error }]} />
        <Text style={styles.statusLabel}>{connected ? 'NODE CONNECTED' : 'NODE OFFLINE'}</Text>
      </View>

      <Text style={styles.fieldLabel}>TUNNEL URL</Text>
      <TextInput
        style={styles.input}
        value={tunnelUrl}
        onChangeText={setTunnelUrl}
        placeholder="https://your-subdomain.loca.lt"
        placeholderTextColor={COLORS.textDim}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.fieldLabel}>LAN IP (OPTIONAL)</Text>
      <TextInput
        style={styles.input}
        value={lanIp}
        onChangeText={setLanIp}
        placeholder="192.168.1.x"
        placeholderTextColor={COLORS.textDim}
        autoCapitalize="none"
        keyboardType="numeric"
      />

      <TouchableOpacity style={styles.button} onPress={testConnection} disabled={testing}>
        {testing
          ? <ActivityIndicator color={COLORS.obsidian} />
          : <Text style={styles.buttonText}>TEST & SAVE CONNECTION</Text>
        }
      </TouchableOpacity>

      <View style={styles.divider} />

      <Text style={styles.sectionHeader}>HARDWARE</Text>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>BLE METADATA BROADCAST</Text>
        <Switch
          value={bleEnabled}
          onValueChange={setBleEnabled}
          trackColor={{ false: COLORS.obsidianBorder, true: COLORS.goldDim }}
          thumbColor={bleEnabled ? COLORS.gold : COLORS.textDim}
        />
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>A2DP AUDIO SINK</Text>
        <Switch
          value={a2dpEnabled}
          onValueChange={setA2dpEnabled}
          trackColor={{ false: COLORS.obsidianBorder, true: COLORS.goldDim }}
          thumbColor={a2dpEnabled ? COLORS.gold : COLORS.textDim}
        />
      </View>
    </ScrollView>
  );
}

// ─── STORAGE Tab ──────────────────────────────────────────────────────────

function StorageTab() {
  const [vaultStats,  setVaultStats]  = useState({ count: 0, totalMB: '0', entries: [] });
  const [bufferStats, setBufferStats] = useState({ count: 0, totalMB: '0', entries: [] });

  useEffect(() => {
    setVaultStats(OfflineBufferService.getVaultStats());
    setBufferStats(OfflineBufferService.getBufferStats());

    const u1 = OfflineBufferService.on('vault_updated',  setVaultStats);
    const u2 = OfflineBufferService.on('buffer_updated', setBufferStats);
    return () => { u1(); u2(); };
  }, []);

  const clearBuffer = () => {
    Alert.alert(
      'Clear Buffer',
      'Remove all transient cached files?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => OfflineBufferService.clearBuffer() },
      ]
    );
  };

  return (
    <ScrollView style={styles.tabContent}>
      {/* Vault */}
      <Text style={styles.sectionHeader}>PERMANENT VAULT</Text>
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{vaultStats.count}</Text>
          <Text style={styles.statLabel}>VAULTED</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{vaultStats.totalMB}MB</Text>
          <Text style={styles.statLabel}>STORED</Text>
        </View>
      </View>

      {vaultStats.entries.map(entry => (
        <View key={entry.path} style={styles.entryRow}>
          <Text style={styles.entryName} numberOfLines={1}>{entry.filename}</Text>
          <Text style={styles.entrySize}>{(entry.size / 1024 / 1024).toFixed(1)}MB</Text>
        </View>
      ))}

      <View style={styles.divider} />

      {/* Buffer */}
      <Text style={styles.sectionHeader}>TRANSIENT BUFFER</Text>
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{bufferStats.count}</Text>
          <Text style={styles.statLabel}>CACHED</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{bufferStats.totalMB}MB</Text>
          <Text style={styles.statLabel}>/ {bufferStats.maxGB}GB MAX</Text>
        </View>
      </View>

      {bufferStats.entries.map(entry => (
        <View key={entry.path} style={styles.entryRow}>
          <Text style={styles.entryName} numberOfLines={1}>{entry.filename}</Text>
          <Text style={styles.entrySize}>{(entry.size / 1024 / 1024).toFixed(1)}MB</Text>
          <TouchableOpacity onPress={() => OfflineBufferService.removeFromBuffer(entry.path)}>
            <Text style={styles.entryDelete}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={clearBuffer}>
        <Text style={[styles.buttonText, { color: COLORS.error }]}>CLEAR ALL BUFFERS</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── LEDGER Tab ───────────────────────────────────────────────────────────

function LedgerTab() {
  const metrics  = StateLedgerService.getMetrics();
  const sessions = StateLedgerService.getAllSessions().slice(0, 50);

  return (
    <ScrollView style={styles.tabContent}>
      <Text style={styles.sectionHeader}>VERITAS LEDGER</Text>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{metrics.totalHours}h</Text>
          <Text style={styles.statLabel}>TOTAL HOURS</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{metrics.totalSessions}</Text>
          <Text style={styles.statLabel}>SESSIONS</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{metrics.uniqueTracks}</Text>
          <Text style={styles.statLabel}>UNIQUE TRACKS</Text>
        </View>
      </View>

      <View style={styles.divider} />
      <Text style={styles.sectionHeader}>SEAL CHAIN</Text>

      {sessions.map(session => (
        <View key={session.trackId} style={styles.sealRow}>
          <View style={styles.sealLeft}>
            <Text style={styles.sealTitle} numberOfLines={1}>{session.title}</Text>
            <Text style={styles.sealMeta}>
              {session.sessions.length} session{session.sessions.length !== 1 ? 's' : ''} ·{' '}
              {((session.totalMs || 0) / 1000 / 60).toFixed(0)}min
            </Text>
          </View>
          <Text style={styles.sealHash}>{session.seal || '—'}</Text>
        </View>
      ))}

      {sessions.length === 0 && (
        <Text style={styles.emptyText}>NO SESSIONS RECORDED</Text>
      )}
    </ScrollView>
  );
}

// ─── Main Settings Screen ─────────────────────────────────────────────────

export default function SettingsScreen() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Sub-tab bar */}
      <View style={styles.tabBar}>
        {TABS.map((tab, i) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === i && styles.tabActive]}
            onPress={() => setActiveTab(i)}
          >
            <Text style={[styles.tabText, activeTab === i && styles.tabTextActive]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 0 && <ConfigTab />}
      {activeTab === 1 && <StorageTab />}
      {activeTab === 2 && <LedgerTab />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.obsidian },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.obsidianDeep,
    borderBottomWidth: 1, borderBottomColor: COLORS.gold,
  },
  tab: {
    flex: 1, paddingVertical: SPACING.sm + 2,
    alignItems: 'center',
  },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.gold },
  tabText:   { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 1 },
  tabTextActive: { color: COLORS.gold },

  tabContent: { flex: 1, padding: SPACING.md },

  sectionHeader: {
    color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 11,
    letterSpacing: 3, marginBottom: SPACING.sm, marginTop: SPACING.md,
  },

  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: SPACING.sm },
  statusLabel: { color: COLORS.textPrimary, fontFamily: FONTS.mono, fontSize: 12 },

  fieldLabel: { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 10, letterSpacing: 2, marginBottom: 4 },
  input: {
    backgroundColor: COLORS.obsidianCard,
    borderWidth: 1, borderColor: COLORS.obsidianBorder,
    borderRadius: RADIUS.md, padding: SPACING.md,
    color: COLORS.textPrimary, fontFamily: FONTS.mono, fontSize: 13,
    marginBottom: SPACING.md,
  },

  button: {
    backgroundColor: COLORS.gold, borderRadius: RADIUS.md,
    paddingVertical: SPACING.md, alignItems: 'center', marginVertical: SPACING.sm,
  },
  dangerButton: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: COLORS.error,
  },
  buttonText: { color: COLORS.obsidian, fontFamily: FONTS.mono, fontSize: 12, letterSpacing: 2, fontWeight: 'bold' },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.obsidianBorder,
  },
  toggleLabel: { color: COLORS.textPrimary, fontFamily: FONTS.mono, fontSize: 12 },

  divider: { height: 1, backgroundColor: COLORS.obsidianBorder, marginVertical: SPACING.md },

  statsGrid: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  statCard: {
    flex: 1, backgroundColor: COLORS.obsidianCard,
    borderRadius: RADIUS.md, padding: SPACING.md,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.obsidianBorder,
  },
  statValue: { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 22, fontWeight: 'bold' },
  statLabel: { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 9, letterSpacing: 1, marginTop: 4 },

  entryRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.obsidianBorder,
  },
  entryName:   { flex: 1, color: COLORS.textPrimary, fontFamily: FONTS.mono, fontSize: 11 },
  entrySize:   { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 11, marginHorizontal: SPACING.sm },
  entryDelete: { color: COLORS.error, fontFamily: FONTS.mono, fontSize: 14, paddingHorizontal: SPACING.sm },

  sealRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.obsidianBorder,
  },
  sealLeft:  { flex: 1 },
  sealTitle: { color: COLORS.textPrimary, fontFamily: FONTS.mono, fontSize: 12 },
  sealMeta:  { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 10, marginTop: 2 },
  sealHash:  { color: COLORS.gold, fontFamily: FONTS.mono, fontSize: 10 },

  emptyText: { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 12, letterSpacing: 2, textAlign: 'center', marginTop: SPACING.xl },
});
