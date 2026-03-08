/**
 * Home Screen — Main dashboard.
 *
 * Shows:
 * - Connection status bar (glasses + backend)
 * - Live camera feed preview
 * - Voice pipeline status + manual trigger
 * - Recent agent response feed
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  SafeAreaView,
  TextInput,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useGlasses } from '../../src/hooks/useGlasses';
import { useVoice } from '../../src/hooks/useVoice';
import { useAgents } from '../../src/hooks/useAgents';
import { ConnectionStatus } from '../../src/components/ConnectionStatus';
import { LiveFeed } from '../../src/components/LiveFeed';
import { ResponseBubble } from '../../src/components/ResponseBubble';
import { COLORS } from '../../src/utils/constants';

export default function HomeScreen() {
  const glasses = useGlasses();
  const voice = useVoice();
  const agents = useAgents();
  const [refreshing, setRefreshing] = useState(false);
  const [lastFrameData, setLastFrameData] = useState<string | null>(null);
  const [textCommand, setTextCommand] = useState('');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await agents.checkHealth();
    await glasses.refreshStatus();
    setRefreshing(false);
  }, []);

  const handleCapture = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const frame = await glasses.captureFrame();
    if (frame) {
      setLastFrameData(frame.frame.data);
    }
  }, []);

  const handleToggleStream = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (glasses.isStreaming) {
      await glasses.stopStreaming();
    } else {
      await glasses.startStreaming();
    }
  }, [glasses.isStreaming]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Siberius</Text>
        <Text style={styles.subtitle}>Ray-Ban Companion</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Connection Status */}
        <ConnectionStatus
          connectionState={glasses.connectionState}
          deviceName={glasses.device?.name ?? null}
          status={glasses.status}
          backendConnected={agents.backendConnected}
        />

        {/* Live Camera Feed */}
        <LiveFeed
          frameData={lastFrameData}
          isStreaming={glasses.isStreaming}
          stats={glasses.captureStats}
          isConnected={glasses.isConnected}
          onCapture={handleCapture}
          onToggleStream={handleToggleStream}
        />

        {/* Voice Status */}
        <View style={styles.voiceSection}>
          <View style={styles.voiceHeader}>
            <Ionicons
              name={voice.isListening ? 'mic' : 'mic-outline'}
              size={18}
              color={voice.isListening ? COLORS.accent : COLORS.textSecondary}
            />
            <Text style={styles.voiceLabel}>
              {voice.voiceState === 'idle' && 'Waiting for "Hey Siberius"'}
              {voice.voiceState === 'listening' && 'Listening...'}
              {voice.voiceState === 'processing' && 'Processing...'}
              {voice.voiceState === 'responding' && 'Speaking...'}
              {voice.voiceState === 'disabled' && 'Voice disabled'}
              {voice.voiceState === 'error' && 'Voice error'}
            </Text>
            <View style={styles.spacer} />
            <Pressable
              style={styles.voiceButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                voice.triggerManualListen();
              }}
            >
              <Ionicons name="mic" size={20} color={COLORS.primary} />
            </Pressable>
          </View>

          {/* Interim transcript */}
          {voice.interimTranscript ? (
            <Text style={styles.transcript}>"{voice.interimTranscript}"</Text>
          ) : null}

          {/* Text command fallback */}
          <View style={styles.textCommandRow}>
            <TextInput
              style={styles.textCommandInput}
              placeholder="Type a command..."
              placeholderTextColor={COLORS.textMuted}
              value={textCommand}
              onChangeText={setTextCommand}
              onSubmitEditing={() => {
                if (textCommand.trim()) {
                  agents.sendVoiceCommand(textCommand.trim());
                  setTextCommand('');
                }
              }}
              returnKeyType="send"
            />
            <Pressable
              style={styles.textCommandSend}
              onPress={() => {
                if (textCommand.trim()) {
                  agents.sendVoiceCommand(textCommand.trim());
                  setTextCommand('');
                }
              }}
            >
              <Ionicons name="send" size={16} color={COLORS.primary} />
            </Pressable>
          </View>
        </View>

        {/* Current Mode */}
        {agents.currentMode !== 'general' && (
          <View style={styles.modeIndicator}>
            <Ionicons name="compass" size={14} color={COLORS.secondary} />
            <Text style={styles.modeText}>
              Mode: {agents.currentMode.charAt(0).toUpperCase() + agents.currentMode.slice(1)}
            </Text>
          </View>
        )}

        {/* Agent Responses Feed */}
        <View style={styles.responsesSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Agent Responses</Text>
            {agents.responses.length > 0 && (
              <Pressable onPress={agents.clearResponses}>
                <Text style={styles.clearButton}>Clear</Text>
              </Pressable>
            )}
          </View>

          {agents.isProcessing && (
            <View style={styles.processingBanner}>
              <Ionicons name="hourglass" size={14} color={COLORS.accent} />
              <Text style={styles.processingText}>
                {agents.processingAgentId
                  ? `${agents.processingAgentId} is analyzing...`
                  : 'Processing...'}
              </Text>
            </View>
          )}

          {agents.responses.length === 0 && !agents.isProcessing && (
            <View style={styles.emptyState}>
              <Ionicons name="chatbubbles-outline" size={32} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>
                Agent responses will appear here.{'\n'}
                Capture a frame or say a voice command to start.
              </Text>
            </View>
          )}

          {agents.responses.map((response, index) => (
            <ResponseBubble
              key={`${response.agentId}-${response.receivedAt}`}
              response={response}
              onDismiss={() => agents.dismissResponse(index)}
            />
          ))}
        </View>
      </ScrollView>

      {/* Error Banner */}
      {glasses.error && (
        <Pressable style={styles.errorBanner} onPress={glasses.clearError}>
          <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
          <Text style={styles.errorText}>{glasses.error}</Text>
          <Ionicons name="close" size={16} color={COLORS.textMuted} />
        </Pressable>
      )}
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
    paddingBottom: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  scroll: {
    paddingBottom: 24,
  },
  voiceSection: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
  },
  voiceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  voiceLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  spacer: {
    flex: 1,
  },
  voiceButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transcript: {
    fontSize: 14,
    color: COLORS.accent,
    fontStyle: 'italic',
    marginTop: 8,
  },
  textCommandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  textCommandInput: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    paddingHorizontal: 10,
    fontSize: 13,
    color: COLORS.text,
  },
  textCommandSend: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: COLORS.secondary + '15',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  modeText: {
    fontSize: 13,
    color: COLORS.secondary,
    fontWeight: '600',
  },
  responsesSection: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  clearButton: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  processingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.accent + '15',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  processingText: {
    fontSize: 13,
    color: COLORS.accent,
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.danger + '15',
    borderTopWidth: 1,
    borderTopColor: COLORS.danger + '30',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.danger,
  },
});
