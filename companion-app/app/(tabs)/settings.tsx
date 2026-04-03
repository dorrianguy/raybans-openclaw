/**
 * Settings Screen — All configurable app settings.
 *
 * Organized into sections:
 * - Backend connection
 * - Glasses connection
 * - Camera/capture
 * - Voice pipeline
 * - TTS/Audio
 * - Privacy
 * - Debug
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  Pressable,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettingsStore } from '../../src/stores/settings-store';
import { COLORS } from '../../src/utils/constants';

// ─── Setting Row Components ─────────────────────────────────────

function SettingRow({ label, value, children }: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      {value && <Text style={styles.settingValue}>{value}</Text>}
      {children}
    </View>
  );
}

function SettingToggle({ label, value, onChange, description }: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  description?: string;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLabelContainer}>
        <Text style={styles.settingLabel}>{label}</Text>
        {description && (
          <Text style={styles.settingDescription}>{description}</Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: COLORS.border, true: COLORS.primary + '80' }}
        thumbColor={value ? COLORS.primary : COLORS.textMuted}
      />
    </View>
  );
}

function SettingInput({ label, value, onChange, placeholder, secureTextEntry, keyboardType }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'url' | 'numeric';
}) {
  return (
    <View style={styles.settingInputRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textMuted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon as any} size={16} color={COLORS.primary} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

// ─── Settings Screen ────────────────────────────────────────────

export default function SettingsScreen() {
  const settings = useSettingsStore();

  const handleResetDefaults = () => {
    Alert.alert(
      'Reset Settings',
      'This will reset all settings to defaults. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: settings.resetToDefaults },
      ],
    );
  };

  const captureModes = ['manual', 'auto', 'voice-triggered', 'continuous'] as const;
  const providerTypes = ['mock', 'ble-plx', 'meta-dat'] as const;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* ── Backend ── */}
        <SectionHeader icon="server" title="Backend Connection" />
        <View style={styles.section}>
          <SettingInput
            label="Backend URL"
            value={settings.backendUrl}
            onChange={settings.setBackendUrl}
            placeholder="http://localhost:3847"
            keyboardType="url"
          />
          <SettingInput
            label="Auth Token"
            value={settings.authToken}
            onChange={settings.setAuthToken}
            placeholder="Optional"
            secureTextEntry
          />
        </View>

        {/* ── Glasses ── */}
        <SectionHeader icon="glasses" title="Glasses Connection" />
        <View style={styles.section}>
          <SettingRow label="Connection Provider">
            <View style={styles.segmentedControl}>
              {providerTypes.map((type) => (
                <Pressable
                  key={type}
                  style={[
                    styles.segment,
                    settings.providerType === type && styles.segmentActive,
                  ]}
                  onPress={() => settings.setProviderType(type)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      settings.providerType === type && styles.segmentTextActive,
                    ]}
                  >
                    {type === 'meta-dat' ? 'DAT SDK' : type === 'ble-plx' ? 'BLE' : 'Mock'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </SettingRow>
          <SettingToggle
            label="Auto Connect"
            value={settings.autoConnect}
            onChange={settings.setAutoConnect}
            description="Reconnect to last glasses automatically"
          />
        </View>

        {/* ── Camera ── */}
        <SectionHeader icon="camera" title="Camera & Capture" />
        <View style={styles.section}>
          <SettingRow label="Capture Mode">
            <View style={styles.segmentedControl}>
              {captureModes.map((mode) => (
                <Pressable
                  key={mode}
                  style={[
                    styles.segment,
                    settings.captureMode === mode && styles.segmentActive,
                  ]}
                  onPress={() => settings.setCaptureMode(mode)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      settings.captureMode === mode && styles.segmentTextActive,
                    ]}
                  >
                    {mode.replace('-', '\n')}
                  </Text>
                </Pressable>
              ))}
            </View>
          </SettingRow>
          <SettingRow label="Capture FPS" value={`${settings.captureFps} fps`} />
          <SettingRow label="Auto-snap Interval" value={`${settings.autoSnapIntervalSec}s`} />
          <SettingToggle
            label="Adaptive Quality"
            value={settings.adaptiveQuality}
            onChange={settings.setAdaptiveQuality}
            description="Auto-adjust quality based on BLE bandwidth"
          />
        </View>

        {/* ── Voice ── */}
        <SectionHeader icon="mic" title="Voice Pipeline" />
        <View style={styles.section}>
          <SettingInput
            label="Wake Word"
            value={settings.wakeWord}
            onChange={settings.setWakeWord}
            placeholder="hey siberius"
          />
          <SettingToggle
            label="Wake Word Enabled"
            value={settings.wakeWordEnabled}
            onChange={settings.setWakeWordEnabled}
            description="Require wake word before listening"
          />
          <SettingInput
            label="Deepgram API Key"
            value={settings.deepgramApiKey}
            onChange={settings.setDeepgramApiKey}
            placeholder="dg_..."
            secureTextEntry
          />
          <SettingInput
            label="Voice Language"
            value={settings.voiceLanguage}
            onChange={settings.setVoiceLanguage}
            placeholder="en-US"
          />
        </View>

        {/* ── TTS ── */}
        <SectionHeader icon="volume-high" title="Text-to-Speech" />
        <View style={styles.section}>
          <SettingRow label="TTS Provider">
            <View style={styles.segmentedControl}>
              <Pressable
                style={[styles.segment, settings.ttsProvider === 'cartesia' && styles.segmentActive]}
                onPress={() => settings.setTtsProvider('cartesia')}
              >
                <Text style={[styles.segmentText, settings.ttsProvider === 'cartesia' && styles.segmentTextActive]}>
                  Cartesia
                </Text>
              </Pressable>
              <Pressable
                style={[styles.segment, settings.ttsProvider === 'system' && styles.segmentActive]}
                onPress={() => settings.setTtsProvider('system')}
              >
                <Text style={[styles.segmentText, settings.ttsProvider === 'system' && styles.segmentTextActive]}>
                  System
                </Text>
              </Pressable>
            </View>
          </SettingRow>
          <SettingInput
            label="Cartesia API Key"
            value={settings.cartesiaApiKey}
            onChange={settings.setCartesiaApiKey}
            placeholder="sk_car_..."
            secureTextEntry
          />
          <SettingRow label="Speed" value={`${settings.ttsSpeed}x`} />
          <SettingRow label="Volume" value={`${Math.round(settings.ttsVolume * 100)}%`} />
          <SettingToggle
            label="Output to Glasses"
            value={settings.outputToGlasses}
            onChange={settings.setOutputToGlasses}
            description="Play TTS through glasses speakers"
          />
        </View>

        {/* ── Privacy ── */}
        <SectionHeader icon="shield" title="Privacy" />
        <View style={styles.section}>
          <SettingToggle
            label="Privacy Mode"
            value={settings.privacyMode}
            onChange={settings.setPrivacyMode}
            description="Pauses all camera capture and microphone"
          />
        </View>

        {/* ── Debug ── */}
        <SectionHeader icon="bug" title="Debug" />
        <View style={styles.section}>
          <SettingToggle
            label="Debug Mode"
            value={settings.debugMode}
            onChange={settings.setDebugMode}
            description="Show extra logging and diagnostics"
          />
        </View>

        {/* Reset */}
        <Pressable style={styles.resetButton} onPress={handleResetDefaults}>
          <Ionicons name="refresh" size={16} color={COLORS.danger} />
          <Text style={styles.resetText}>Reset to Defaults</Text>
        </Pressable>

        {/* Version */}
        <Text style={styles.version}>Siberius Companion v0.1.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  scroll: {
    paddingBottom: 40,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    minHeight: 48,
  },
  settingInputRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  settingLabelContainer: {
    flex: 1,
    marginRight: 12,
  },
  settingLabel: {
    fontSize: 14,
    color: COLORS.text,
  },
  settingDescription: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  settingValue: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontFamily: 'monospace',
  },
  input: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: COLORS.text,
    marginTop: 6,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    padding: 2,
  },
  segment: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: COLORS.primary,
  },
  segmentText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
    textAlign: 'center',
  },
  segmentTextActive: {
    color: COLORS.text,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 24,
    backgroundColor: COLORS.danger + '15',
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: COLORS.danger + '30',
  },
  resetText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.danger,
  },
  version: {
    textAlign: 'center',
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 16,
  },
});
