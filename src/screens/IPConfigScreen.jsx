/**
 * IPConfigScreen.jsx — First-run host configuration.
 * Validates connection, stores host, transitions to main app.
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../theme/veritas';
import MediaSyncService from '../services/MediaSyncService';

export default function IPConfigScreen({ onSaved }) {
  const [url,      setUrl]      = useState('');
  const [lanIp,    setLanIp]    = useState('');
  const [testing,  setTesting]  = useState(false);
  const [status,   setStatus]   = useState(null);  // null | 'ok' | 'error'
  const [message,  setMessage]  = useState('');

  const testAndSave = async () => {
    const target = url.trim() || (lanIp.trim() ? `http://${lanIp.trim()}:5002` : null);
    if (!target) {
      setStatus('error');
      setMessage('Enter a tunnel URL or LAN IP address.');
      return;
    }

    setTesting(true);
    setStatus(null);
    setMessage('');

    try {
      const res = await fetch(`${target.replace(/\/$/, '')}/health`, {
        headers: { 'Bypass-Tunnel-Reminder': 'true' },
      });
      if (res.ok) {
        if (url.trim())   await MediaSyncService.setHost(url.trim());
        if (lanIp.trim()) await MediaSyncService.setLanIp(lanIp.trim());
        setStatus('ok');
        setMessage('Connected. Loading library...');
        setTimeout(() => onSaved(), 800);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      setStatus('error');
      setMessage(`Connection failed: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <Text style={styles.omega}>Ω</Text>
          <Text style={styles.title}>SOVEREIGN MEDIA</Text>
          <Text style={styles.subtitle}>NODE CONFIGURATION</Text>

          <View style={styles.divider} />

          {/* Tunnel URL */}
          <Text style={styles.label}>LOCALTUNNEL URL</Text>
          <Text style={styles.hint}>e.g. https://your-subdomain.loca.lt</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="https://your-tunnel.loca.lt"
            placeholderTextColor={COLORS.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <Text style={styles.orLabel}>— OR —</Text>

          {/* LAN IP */}
          <Text style={styles.label}>LOCAL NETWORK IP</Text>
          <Text style={styles.hint}>e.g. 192.168.1.100</Text>
          <TextInput
            style={styles.input}
            value={lanIp}
            onChangeText={setLanIp}
            placeholder="192.168.1.x"
            placeholderTextColor={COLORS.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numeric"
          />

          {/* Status */}
          {status === 'ok' && (
            <View style={[styles.statusBox, styles.statusOk]}>
              <Text style={styles.statusText}>✓ {message}</Text>
            </View>
          )}
          {status === 'error' && (
            <View style={[styles.statusBox, styles.statusError]}>
              <Text style={styles.statusText}>✗ {message}</Text>
            </View>
          )}

          {/* Connect Button */}
          <TouchableOpacity
            style={[styles.button, testing && styles.buttonDisabled]}
            onPress={testAndSave}
            disabled={testing}
          >
            {testing
              ? <ActivityIndicator color={COLORS.obsidian} />
              : <Text style={styles.buttonText}>ESTABLISH CONNECTION</Text>
            }
          </TouchableOpacity>

          <Text style={styles.footer}>
            VERITAS SOVEREIGN NODE · PORT 5002
          </Text>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: COLORS.obsidianDeep },
  flex:    { flex: 1 },
  scroll:  { padding: SPACING.xl, alignItems: 'center', paddingTop: SPACING.xxl },

  omega:   { fontSize: 64, color: COLORS.gold, fontFamily: FONTS.mono, marginBottom: 8 },
  title:   { fontSize: 22, color: COLORS.gold, fontFamily: FONTS.mono, letterSpacing: 4 },
  subtitle:{ fontSize: 11, color: COLORS.textDim, fontFamily: FONTS.mono, letterSpacing: 3, marginTop: 4 },

  divider: {
    width: '100%', height: 1,
    backgroundColor: COLORS.obsidianBorder,
    marginVertical: SPACING.xl,
  },

  label:   { alignSelf: 'flex-start', fontSize: 11, color: COLORS.gold, fontFamily: FONTS.mono, letterSpacing: 2, marginBottom: 4 },
  hint:    { alignSelf: 'flex-start', fontSize: 11, color: COLORS.textDim, fontFamily: FONTS.mono, marginBottom: 8 },

  input: {
    width: '100%',
    backgroundColor: COLORS.obsidianCard,
    borderWidth: 1,
    borderColor: COLORS.obsidianBorder,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    color: COLORS.textPrimary,
    fontFamily: FONTS.mono,
    fontSize: 14,
    marginBottom: SPACING.md,
  },

  orLabel: {
    color: COLORS.textDim,
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 2,
    marginVertical: SPACING.md,
  },

  statusBox: {
    width: '100%', borderRadius: RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.md,
  },
  statusOk:    { backgroundColor: 'rgba(46,204,113,0.12)', borderWidth: 1, borderColor: COLORS.success },
  statusError: { backgroundColor: 'rgba(231,76,60,0.12)',  borderWidth: 1, borderColor: COLORS.error   },
  statusText:  { color: COLORS.textPrimary, fontFamily: FONTS.mono, fontSize: 12 },

  button: {
    width: '100%', backgroundColor: COLORS.gold,
    borderRadius: RADIUS.md, paddingVertical: SPACING.md,
    alignItems: 'center', marginTop: SPACING.md,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: COLORS.obsidian, fontFamily: FONTS.mono, fontSize: 13, letterSpacing: 2, fontWeight: 'bold' },

  footer: { color: COLORS.textDim, fontFamily: FONTS.mono, fontSize: 10, marginTop: SPACING.xl, letterSpacing: 1 },
});
