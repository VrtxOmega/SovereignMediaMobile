/**
 * BottomTabNavigator.jsx — VERITAS gold-on-obsidian bottom tabs.
 * AUDIO | EBOOKS | MOVIES | SYSTEM
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { COLORS, FONTS, TAB_BAR_HEIGHT } from '../theme/veritas';

import LibraryScreen from '../screens/LibraryScreen';
import BooksScreen   from '../screens/BooksScreen';
import VideoScreen   from '../screens/VideoScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();

function TabIcon({ label, focused }) {
  const icons = {
    AUDIO:   '◎',
    EBOOKS:  '⊟',
    MOVIES:  '▶',
    SYSTEM:  '⬡',
  };
  return (
    <View style={styles.tabItem}>
      <Text style={[styles.tabIcon, focused && styles.tabIconActive]}>
        {icons[label] || '●'}
      </Text>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>
        {label}
      </Text>
    </View>
  );
}

export default function BottomTabNavigator({ onTrackPress }) {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen
        name="AUDIO"
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="AUDIO" focused={focused} /> }}
      >
        {(props) => <LibraryScreen {...props} onTrackPress={onTrackPress} />}
      </Tab.Screen>

      <Tab.Screen
        name="EBOOKS"
        component={BooksScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="EBOOKS" focused={focused} /> }}
      />

      <Tab.Screen
        name="MOVIES"
        component={VideoScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="MOVIES" focused={focused} /> }}
      />

      <Tab.Screen
        name="SYSTEM"
        component={SettingsScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="SYSTEM" focused={focused} /> }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor:  COLORS.obsidianDeep,
    borderTopColor:   COLORS.gold,
    borderTopWidth:   1,
    height:           TAB_BAR_HEIGHT,
    paddingBottom:    0,
    paddingTop:       0,
  },
  tabItem: {
    alignItems:     'center',
    justifyContent: 'center',
    paddingTop:     6,
  },
  tabIcon: {
    fontSize:   18,
    color:      COLORS.textDim,
    fontFamily: FONTS.mono,
  },
  tabIconActive: {
    color: COLORS.gold,
  },
  tabLabel: {
    fontSize:   9,
    color:      COLORS.textDim,
    fontFamily: FONTS.mono,
    letterSpacing: 1.5,
    marginTop:  3,
  },
  tabLabelActive: {
    color: COLORS.gold,
  },
});
