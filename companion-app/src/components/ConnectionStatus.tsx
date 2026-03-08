/**
 * ConnectionStatus — Shows glasses connection state, battery, signal.
 *
 * Compact indicator bar at the top of the main screen.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../utils/constants';
import type { ConnectionState, GlassesStatus } from '../services/glasses-connection';

interface Props {
  connectionState: ConnectionState;
  deviceName: string | null;
  status: GlassesStatus | null;
  backendConnected: boolean;
  onPress?: () => void;
}

const STATE_CONFIG: Record<ConnectionState, { label: string; color: string; icon: string }> = {
  disconnected: { label: 'Disconnected', color: COLORS.textMuted, icon: 'glasses-outline' },
  scanning: { label: 'Scanning...', color: COLORS.accent, icon: 'bluetooth' },
  connecting: { label: 'Connecting...', color: COLORS.accent, icon: 'bluetooth' },
  connected: { label: 'Connected', color: COLORS.success, icon: 'glasses' },
  reconnecting: { label: 'Reconnecting...', color: COLORS.warning, icon: 'refresh' },
  error: { label: 'Error', color: COLORS.danger, icon: 'alert-circle' },
};

function getBatteryIcon(level: number): string {
  if (level >= 80) return 'battery-full';
  if (level >= 50) return 'battery-half';
  if (level >= 20) return 'battery-dead';
  return 'battery-dead';
}

function getBatteryColor(level: number): string {
  if (level >= 50) return COLORS.success;
  if (level >= 20) return COLORS.warning;
  return COLORS.danger;
}

function getSignalBars(rssi: number): number {
  if (rssi >= -50) return 4;
  if (rssi >= -60) return 3;
  if (rssi >= -70) return 2;
  return 1;
}

export const ConnectionStatus: React.FC<Props> = ({
  connectionState,
  deviceName,
  status,
  backendConnected,
  onPress,
}) => {
  const config = STATE_CONFIG[connectionState];

  return (
    <Pressable style={styles.container} onPress={onPress}>
      {/* Connection state */}
      <View style={styles.stateRow}>
        <Ionicons
          name={config.icon as any}
          size={18}
          color={config.color}
        />
        <Text style={[styles.stateLabel, { color: config.color }]}>
          {deviceName || config.label}
        </Text>

        {/* Backend indicator */}
        <View style={styles.spacer} />
        <View
          style={[
            styles.backendDot,
            { backgroundColor: backendConnected ? COLORS.success : COLORS.danger },
          ]}
        />
        <Text style={styles.backendLabel}>
          {backendConnected ? 'Backend' : 'Offline'}
        </Text>
      </View>

      {/* Status details (when connected) */}
      {connectionState === 'connected' && status && (
        <View style={styles.detailsRow}>
          {/* Battery */}
          <View style={styles.detailItem}>
            <Ionicons
              name={getBatteryIcon(status.batteryLevel) as any}
              size={14}
              color={getBatteryColor(status.batteryLevel)}
            />
            <Text style={styles.detailText}>
              {status.batteryLevel}%
              {status.isCharging ? ' ⚡' : ''}
            </Text>
          </View>

          {/* Signal */}
          <View style={styles.detailItem}>
            <View style={styles.signalBars}>
              {[1, 2, 3, 4].map((bar) => (
                <View
                  key={bar}
                  style={[
                    styles.signalBar,
                    {
                      height: 4 + bar * 2,
                      backgroundColor:
                        bar <= getSignalBars(status.rssi)
                          ? COLORS.success
                          : COLORS.border,
                    },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.detailText}>{status.rssi} dBm</Text>
          </View>

          {/* Capabilities */}
          <View style={styles.detailItem}>
            {status.cameraAvailable && (
              <Ionicons name="camera" size={12} color={COLORS.textSecondary} style={styles.capIcon} />
            )}
            {status.microphoneAvailable && (
              <Ionicons name="mic" size={12} color={COLORS.textSecondary} style={styles.capIcon} />
            )}
            {status.speakerAvailable && (
              <Ionicons name="volume-medium" size={12} color={COLORS.textSecondary} style={styles.capIcon} />
            )}
          </View>
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stateLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  spacer: {
    flex: 1,
  },
  backendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  backendLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 16,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  signalBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
  },
  signalBar: {
    width: 3,
    borderRadius: 1,
  },
  capIcon: {
    marginRight: 2,
  },
});
