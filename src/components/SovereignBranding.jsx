import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/veritas';

export function SovereignHeader() {
  return (
    <View style={styles.header}>
      <Text style={styles.omega}>Ω</Text>
      <Text style={styles.title}>SOVEREIGN MEDIA CENTER</Text>
    </View>
  );
}

export function SovereignFooter() {
  return (
    <View style={styles.footer}>
      <View style={styles.footerRule} />
      <Text style={styles.latin}>
        {'\'Examina omnia, venerare nihil, pro te cogita.\''}
      </Text>
      <Text style={styles.english}>
        Question everything, worship nothing, think for yourself.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // ─── Header ──────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.obsidian,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212,175,55,0.15)',
  },
  omega: {
    fontSize: 26,
    color: colors.gold,
    fontWeight: 'bold',
    marginRight: 10,
    textShadowColor: 'rgba(212,175,55,0.4)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  title: {
    fontFamily: 'Courier New',
    fontSize: 13,
    color: colors.gold,
    letterSpacing: 3,
    fontWeight: 'bold',
  },

  // ─── Footer ──────────────────────────────────
  footer: {
    paddingVertical: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  footerRule: {
    width: 60,
    height: 1,
    backgroundColor: 'rgba(212,175,55,0.25)',
    marginBottom: 14,
  },
  latin: {
    fontStyle: 'italic',
    fontSize: 12,
    color: 'rgba(212,175,55,0.6)',
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  english: {
    fontSize: 10,
    color: 'rgba(212,175,55,0.35)',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});
