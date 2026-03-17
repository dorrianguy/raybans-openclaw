/**
 * ResponseBubble — Displays a single agent response.
 *
 * Shows agent name, response text, confidence, and timing.
 * Security alerts are highlighted in red.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, AGENT_COLORS, AGENT_ICONS } from '../utils/constants';
import type { AgentResponseWithMeta } from '../stores/agent-store';

interface Props {
  response: AgentResponseWithMeta;
  onDismiss?: () => void;
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export const ResponseBubble: React.FC<Props> = ({ response, onDismiss }) => {
  const color = AGENT_COLORS[response.agentId] || COLORS.primary;
  const icon = AGENT_ICONS[response.agentId] || 'cube-outline';
  const isHighPriority = response.priority <= 2;

  return (
    <View
      style={[
        styles.container,
        isHighPriority && styles.highPriority,
        response.spoken && styles.spoken,
      ]}
    >
      <View style={styles.header}>
        <Ionicons name={icon as any} size={14} color={color} />
        <Text style={[styles.agentName, { color }]}>
          {response.agentId}
        </Text>
        <Text style={styles.time}>{getTimeAgo(response.receivedAt)}</Text>
        <View style={styles.spacer} />

        {response.spoken && (
          <Ionicons name="volume-medium" size={12} color={COLORS.textMuted} style={{ marginRight: 6 }} />
        )}

        <Text style={styles.confidence}>
          {(response.confidence * 100).toFixed(0)}%
        </Text>

        {onDismiss && (
          <Pressable onPress={onDismiss} hitSlop={8} style={styles.dismissButton}>
            <Ionicons name="close" size={14} color={COLORS.textMuted} />
          </Pressable>
        )}
      </View>

      {response.voiceResponse && (
        <Text style={styles.responseText}>
          {response.voiceResponse}
        </Text>
      )}

      {response.data && Object.keys(response.data).length > 0 && (
        <View style={styles.dataSection}>
          {Object.entries(response.data).slice(0, 3).map(([key, value]) => (
            <View key={key} style={styles.dataRow}>
              <Text style={styles.dataKey}>{key}:</Text>
              <Text style={styles.dataValue} numberOfLines={1}>
                {typeof value === 'string' ? value : JSON.stringify(value)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.processingTime}>
        {response.processingTimeMs}ms
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.border,
  },
  highPriority: {
    borderLeftColor: COLORS.danger,
    backgroundColor: COLORS.danger + '10',
  },
  spoken: {
    opacity: 0.8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  agentName: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  time: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  spacer: {
    flex: 1,
  },
  confidence: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontFamily: 'monospace',
  },
  dismissButton: {
    marginLeft: 8,
    padding: 2,
  },
  responseText: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
    marginTop: 8,
  },
  dataSection: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  dataRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 2,
  },
  dataKey: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  dataValue: {
    fontSize: 11,
    color: COLORS.textSecondary,
    flex: 1,
  },
  processingTime: {
    fontSize: 10,
    color: COLORS.textMuted,
    textAlign: 'right',
    marginTop: 6,
    fontFamily: 'monospace',
  },
});
