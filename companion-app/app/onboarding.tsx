/**
 * Onboarding Screen — First-run pairing flow.
 *
 * Steps:
 * 1. Welcome splash
 * 2. Scan for glasses
 * 3. Connect to glasses
 * 4. Configure backend URL
 * 5. Ready!
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  FlatList,
  TextInput,
  SafeAreaView,
} from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useGlasses } from '../src/hooks/useGlasses';
import { useSettingsStore } from '../src/stores/settings-store';
import { COLORS, DEFAULT_BACKEND_URL } from '../src/utils/constants';
import type { GlassesDevice } from '../src/services/glasses-connection';

type Step = 'welcome' | 'scan' | 'connect' | 'backend' | 'ready';

export default function OnboardingScreen() {
  const [step, setStep] = useState<Step>('welcome');
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [selectedDevice, setSelectedDevice] = useState<GlassesDevice | null>(null);

  const glasses = useGlasses();
  const settings = useSettingsStore();

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      await glasses.scan();
    } catch {
      // Scan might timeout — that's fine
    }
    setScanning(false);
  }, []);

  const handleConnect = useCallback(async (device: GlassesDevice) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedDevice(device);
    setConnecting(true);
    try {
      await glasses.connect(device.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep('backend');
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setConnecting(false);
    }
  }, []);

  const handleSkipConnect = useCallback(() => {
    setStep('backend');
  }, []);

  const handleFinish = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    settings.setBackendUrl(backendUrl);
    settings.setOnboardingComplete(true);
    router.replace('/(tabs)');
  }, [backendUrl]);

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Step 1: Welcome ── */}
      {step === 'welcome' && (
        <View style={styles.centered}>
          <View style={styles.iconGlow}>
            <Ionicons name="glasses" size={64} color={COLORS.primary} />
          </View>
          <Text style={styles.welcomeTitle}>Siberius</Text>
          <Text style={styles.welcomeSubtitle}>
            AI-Powered Ray-Ban Smart Glasses
          </Text>
          <Text style={styles.welcomeDescription}>
            Connect your Ray-Ban Meta glasses to your AI agents.
            See through intelligent eyes.
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => setStep('scan')}
          >
            <Text style={styles.primaryButtonText}>Get Started</Text>
            <Ionicons name="arrow-forward" size={18} color={COLORS.text} />
          </Pressable>
        </View>
      )}

      {/* ── Step 2: Scan ── */}
      {step === 'scan' && (
        <View style={styles.stepContainer}>
          <Text style={styles.stepTitle}>Find Your Glasses</Text>
          <Text style={styles.stepSubtitle}>
            Make sure your Ray-Ban Meta glasses are powered on and nearby.
          </Text>

          {scanning ? (
            <View style={styles.scanningContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.scanningText}>Scanning for devices...</Text>
            </View>
          ) : (
            <Pressable style={styles.primaryButton} onPress={handleScan}>
              <Ionicons name="bluetooth" size={18} color={COLORS.text} />
              <Text style={styles.primaryButtonText}>Start Scan</Text>
            </Pressable>
          )}

          {/* Discovered devices */}
          {glasses.discoveredDevices.length > 0 && (
            <FlatList
              data={glasses.discoveredDevices}
              keyExtractor={(item) => item.id}
              style={styles.deviceList}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.deviceCard}
                  onPress={() => handleConnect(item)}
                  disabled={connecting}
                >
                  <View style={styles.deviceInfo}>
                    <Ionicons name="glasses" size={24} color={COLORS.primary} />
                    <View style={styles.deviceText}>
                      <Text style={styles.deviceName}>{item.name}</Text>
                      <Text style={styles.deviceMeta}>
                        {item.model || 'Ray-Ban Meta'}
                        {item.batteryLevel != null && ` • ${item.batteryLevel}%`}
                        {` • ${item.rssi} dBm`}
                      </Text>
                    </View>
                  </View>
                  {connecting && selectedDevice?.id === item.id ? (
                    <ActivityIndicator size="small" color={COLORS.primary} />
                  ) : (
                    <Ionicons name="link" size={20} color={COLORS.textSecondary} />
                  )}
                </Pressable>
              )}
            />
          )}

          {/* Skip option */}
          <Pressable style={styles.skipButton} onPress={handleSkipConnect}>
            <Text style={styles.skipText}>Skip — set up later</Text>
          </Pressable>
        </View>
      )}

      {/* ── Step 3: Backend Config ── */}
      {step === 'backend' && (
        <View style={styles.stepContainer}>
          <Text style={styles.stepTitle}>Connect to Backend</Text>
          <Text style={styles.stepSubtitle}>
            Enter the URL of your raybans-openclaw backend server.
          </Text>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Backend URL</Text>
            <TextInput
              style={styles.input}
              value={backendUrl}
              onChangeText={setBackendUrl}
              placeholder="http://localhost:3847"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.inputHint}>
              This is the DashboardApiServer URL from your raybans-openclaw setup.
            </Text>
          </View>

          <Pressable
            style={styles.primaryButton}
            onPress={() => setStep('ready')}
          >
            <Text style={styles.primaryButtonText}>Continue</Text>
            <Ionicons name="arrow-forward" size={18} color={COLORS.text} />
          </Pressable>
        </View>
      )}

      {/* ── Step 4: Ready ── */}
      {step === 'ready' && (
        <View style={styles.centered}>
          <View style={styles.iconGlow}>
            <Ionicons name="checkmark-circle" size={64} color={COLORS.success} />
          </View>
          <Text style={styles.readyTitle}>You're All Set</Text>
          <Text style={styles.readySubtitle}>
            Siberius is ready to see through your glasses.
          </Text>

          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Ionicons name="glasses" size={16} color={COLORS.textSecondary} />
              <Text style={styles.summaryText}>
                {glasses.isConnected
                  ? `Connected to ${glasses.device?.name}`
                  : 'No glasses connected'}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Ionicons name="server" size={16} color={COLORS.textSecondary} />
              <Text style={styles.summaryText}>{backendUrl}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Ionicons name="grid" size={16} color={COLORS.textSecondary} />
              <Text style={styles.summaryText}>7 AI agents active</Text>
            </View>
          </View>

          <Pressable style={styles.primaryButton} onPress={handleFinish}>
            <Text style={styles.primaryButtonText}>Launch Siberius</Text>
            <Ionicons name="rocket" size={18} color={COLORS.text} />
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  stepContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  iconGlow: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  welcomeTitle: {
    fontSize: 36,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: -1,
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  welcomeDescription: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 16,
    marginBottom: 40,
  },
  stepTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: 24,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  scanningContainer: {
    alignItems: 'center',
    gap: 12,
    padding: 32,
  },
  scanningText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  deviceList: {
    marginTop: 16,
    maxHeight: 300,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  deviceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  deviceText: {
    flex: 1,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  deviceMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  skipText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  inputContainer: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  inputHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 6,
  },
  readyTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.success,
    marginBottom: 8,
  },
  readySubtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
  },
  summaryCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 32,
    gap: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  summaryText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
});
