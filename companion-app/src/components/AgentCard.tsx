/**
 * AgentCard — Displays a single agent's status with enable/disable toggle.
 */

import React from 'react';
import { View, Text, StyleSheet, Switch, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, AGENT_COLORS, AGENT_ICONS } from '../utils/constants';
import type { AgentInfo } from '../services/backend-client';

interface Props {
  agent: AgentInfo;
  isProcessing?: boolean;
  lastResponse?: string | null;
  responseTime?: number | null;
  onToggle: (agentId: string) => void;
  onPress?: (agentId: string) => void;
}

export const AgentCard: React.FC<Props> = ({
  agent,
  isProcessing = false,
  lastResponse,
  responseTime,
  onToggle,
  onPress,
}) => {
  const color = AGENT_COLORS[agent.id] || COLORS.primary;
  const icon = AGENT_ICONS[agent.id] || 'cube-outline';

  return (
    <Pressable
      style={[
        styles.container,
        !agent.enabled && styles.disabled,
        isProcessing && styles.processing,
      ]}
      onPress={() => onPress?.(agent.id)}
    >
      <View style={styles.header}>
        <View style={[styles.iconContainer, { backgroundColor: color + '20' }]}>
          <Ionicons name={icon as any} size={20} color={color} />
        </View>

        <View style={styles.info}>
          <Text style={[styles.name, !agent.enabled && styles.disabledText]}>
            {agent.name}
          </Text>
          <Text style={styles.priority}>
            Priority: {agent.priority}
            {isProcessing && (
              <Text style={styles.processingText}> • Processing...</Text>
            )}
          </Text>
        </View>

        <Switch
          value={agent.enabled}
          onValueChange={() => onToggle(agent.id)}
          trackColor={{ false: COLORS.border, true: color + '80' }}
          thumbColor={agent.enabled ? color : COLORS.textMuted}
        />
      </View>

      {/* Last response preview */}
      {lastResponse && agent.enabled && (
        <View style={styles.responsePreview}>
          <Text style={styles.responseText} numberOfLines={2}>
            {lastResponse}
          </Text>
          {responseTime != null && (
            <Text style={styles.responseTime}>{responseTime}ms</Text>
          )}
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  disabled: {
    opacity: 0.5,
  },
  processing: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.accent,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  disabledText: {
    color: COLORS.textMuted,
  },
  priority: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  processingText: {
    color: COLORS.accent,
    fontWeight: '600',
  },
  responsePreview: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  responseText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  responseTime: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginLeft: 8,
  },
});
