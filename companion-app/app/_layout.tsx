/**
 * Root Layout — Expo Router entry point.
 *
 * Sets up navigation, dark theme, and status bar.
 * Routes to onboarding if first launch, otherwise to main tabs.
 */

import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import { useSettingsStore } from '../src/stores/settings-store';
import { configureAudioSession } from '../src/utils/audio';
import { COLORS } from '../src/utils/constants';

export default function RootLayout() {
  const onboardingComplete = useSettingsStore((s) => s.onboardingComplete);

  useEffect(() => {
    // Configure audio session for BLE headset communication
    configureAudioSession().catch(console.error);
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: COLORS.background },
          animation: 'fade',
        }}
      >
        {!onboardingComplete ? (
          <Stack.Screen name="onboarding" />
        ) : (
          <Stack.Screen name="(tabs)" />
        )}
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
});
