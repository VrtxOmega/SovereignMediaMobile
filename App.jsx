/**
 * App.jsx — Root. Initializes services, handles IP config gate,
 * renders BottomTabNavigator + NowPlaying overlay.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  StatusBar,
  LogBox,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { COLORS } from './src/theme/veritas';
import BottomTabNavigator from './src/navigation/BottomTabNavigator';
import IPConfigScreen from './src/screens/IPConfigScreen';
import NowPlayingScreen from './src/screens/NowPlayingScreen';
import SovereignPlayer from './src/components/SovereignPlayer';

import MediaSyncService from './src/services/MediaSyncService';
import OfflineBufferService from './src/services/OfflineBufferService';
import StateLedgerService from './src/services/StateLedgerService';
import PlayerService from './src/services/PlayerService';

LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
  'Require cycle:',
]);

export default function App() {
  const [ready,          setReady]          = useState(false);
  const [hasHost,        setHasHost]        = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [currentTrack,   setCurrentTrack]   = useState(null);

  useEffect(() => {
    bootstrap();
    return () => {
      MediaSyncService.destroy();
      StateLedgerService.destroy();
    };
  }, []);

  const bootstrap = async () => {
    try {
      await PlayerService.setup();
      await OfflineBufferService.init();
      await StateLedgerService.init();
      await MediaSyncService.init();

      const host = await AsyncStorage.getItem('@sovereign_host');
      setHasHost(!!host);
    } catch (err) {
      console.warn('[App] Bootstrap error:', err);
    } finally {
      setReady(true);
    }
  };

  const handleHostSaved = useCallback(() => {
    setHasHost(true);
  }, []);

  const openNowPlaying = useCallback((track) => {
    setCurrentTrack(track);
    setNowPlayingOpen(true);
  }, []);

  const closeNowPlaying = useCallback(() => {
    setNowPlayingOpen(false);
  }, []);

  if (!ready) return (
    <View style={styles.splash}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.obsidianDeep} />
    </View>
  );

  if (!hasHost) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.obsidianDeep} />
        <IPConfigScreen onSaved={handleHostSaved} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.obsidianDeep} />
      <NavigationContainer
        theme={{
          dark: true,
          colors: {
            primary:      COLORS.gold,
            background:   COLORS.obsidian,
            card:         COLORS.obsidianCard,
            text:         COLORS.textPrimary,
            border:       COLORS.obsidianBorder,
            notification: COLORS.gold,
          },
        }}
      >
        <View style={styles.root}>
          <BottomTabNavigator onTrackPress={openNowPlaying} />

          {/* Mini player — always visible when media is active */}
          <SovereignPlayer onExpand={openNowPlaying} />

          {/* Full-screen now playing overlay */}
          <NowPlayingScreen
            visible={nowPlayingOpen}
            track={currentTrack}
            onClose={closeNowPlaying}
          />
        </View>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: COLORS.obsidianDeep,
  },
  root: {
    flex: 1,
    backgroundColor: COLORS.obsidian,
  },
});
