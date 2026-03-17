/**
 * Agents Screen — View and control all specialist agents.
 *
 * Shows each agent with enable/disable toggle, status, and last response.
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAgents } from '../../src/hooks/useAgents';
import { AgentCard } from '../../src/components/AgentCard';
import { COLORS } from '../../src/utils/constants';

export default function AgentsScreen() {
  const {
    agents,
    responses,
    isProcessing,
    processingAgentId,
    currentMode,
    toggleAgent,
    backendConnected,
  } = useAgents();

  // Get last response per agent
  const lastResponseByAgent = useMemo(() => {
    const map: Record<string, { text: string; time: number }> = {};
    for (const r of responses) {
      if (!map[r.agentId] && r.voiceResponse) {
        map[r.agentId] = {
          text: r.voiceResponse,
          time: r.processingTimeMs,
        };
      }
    }
    return map;
  }, [responses]);

  const handleToggle = (agentId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleAgent(agentId);
  };

  const enabledCount = agents.filter((a) => a.enabled).length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Agents</Text>
        <Text style={styles.subtitle}>
          {enabledCount} of {agents.length} active
          {!backendConnected && ' • Backend offline'}
        </Text>
      </View>

      {/* Current mode indicator */}
      <View style={styles.modeBar}>
        <Text style={styles.modeLabel}>Current Mode</Text>
        <View style={styles.modeBadge}>
          <Text style={styles.modeValue}>
            {currentMode.charAt(0).toUpperCase() + currentMode.slice(1)}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* High priority agents */}
        <Text style={styles.sectionLabel}>High Priority</Text>
        {agents
          .filter((a) => a.priority <= 2)
          .sort((a, b) => a.priority - b.priority)
          .map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isProcessing={isProcessing && processingAgentId === agent.id}
              lastResponse={lastResponseByAgent[agent.id]?.text}
              responseTime={lastResponseByAgent[agent.id]?.time}
              onToggle={handleToggle}
            />
          ))}

        {/* Normal priority agents */}
        <Text style={styles.sectionLabel}>Standard Priority</Text>
        {agents
          .filter((a) => a.priority > 2)
          .sort((a, b) => a.priority - b.priority)
          .map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isProcessing={isProcessing && processingAgentId === agent.id}
              lastResponse={lastResponseByAgent[agent.id]?.text}
              responseTime={lastResponseByAgent[agent.id]?.time}
              onToggle={handleToggle}
            />
          ))}

        {/* Legend */}
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>How Routing Works</Text>
          <Text style={styles.legendText}>
            The Context Router automatically selects which agent(s) handle each
            captured frame based on the scene type, voice commands, and current mode.
            Higher priority agents (lower number) get processed first, and security
            alerts always interrupt other responses.
          </Text>
        </View>
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
    paddingBottom: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  modeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modeLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  modeBadge: {
    backgroundColor: COLORS.secondary + '20',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  modeValue: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.secondary,
  },
  scroll: {
    padding: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 8,
    marginLeft: 4,
  },
  legend: {
    marginTop: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
  },
  legendTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  legendText: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
});
