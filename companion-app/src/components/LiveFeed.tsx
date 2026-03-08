/**
 * LiveFeed — Camera frame preview from glasses.
 *
 * Shows the most recent captured frame with overlay info
 * (FPS, frame count, capture mode indicator).
 */

import React from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../utils/constants';
import type { CaptureStats } from '../services/camera-capture';

interface Props {
  /** Latest frame as base64 JPEG */
  frameData: string | null;
  /** Whether streaming is active */
  isStreaming: boolean;
  /** Capture stats */
  stats: CaptureStats | null;
  /** Whether glasses are connected */
  isConnected: boolean;
  /** Capture single frame */
  onCapture?: () => void;
  /** Toggle streaming */
  onToggleStream?: () => void;
}

export const LiveFeed: React.FC<Props> = ({
  frameData,
  isStreaming,
  stats,
  isConnected,
  onCapture,
  onToggleStream,
}) => {
  return (
    <View style={styles.container}>
      {/* Frame display */}
      <View style={styles.frameContainer}>
        {frameData ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${frameData}` }}
            style={styles.frame}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons
              name={isConnected ? 'camera-outline' : 'glasses-outline'}
              size={48}
              color={COLORS.textMuted}
            />
            <Text style={styles.placeholderText}>
              {isConnected
                ? 'Tap capture or start streaming'
                : 'Connect glasses to see camera feed'}
            </Text>
          </View>
        )}

        {/* Streaming indicator */}
        {isStreaming && (
          <View style={styles.streamingBadge}>
            <View style={styles.redDot} />
            <Text style={styles.streamingText}>LIVE</Text>
          </View>
        )}

        {/* Stats overlay */}
        {stats && isStreaming && (
          <View style={styles.statsOverlay}>
            <Text style={styles.statText}>
              {stats.averageFps.toFixed(1)} FPS
            </Text>
            <Text style={styles.statText}>
              {stats.totalCaptured} frames
            </Text>
            <Text style={styles.statText}>
              {stats.bufferedCount} buffered
            </Text>
          </View>
        )}
      </View>

      {/* Controls */}
      {isConnected && (
        <View style={styles.controls}>
          <Pressable
            style={[styles.captureButton, !isConnected && styles.disabledButton]}
            onPress={onCapture}
            disabled={!isConnected}
          >
            <Ionicons name="camera" size={20} color={COLORS.text} />
            <Text style={styles.buttonText}>Capture</Text>
          </Pressable>

          <Pressable
            style={[
              styles.streamButton,
              isStreaming && styles.streamActiveButton,
            ]}
            onPress={onToggleStream}
          >
            <Ionicons
              name={isStreaming ? 'stop' : 'play'}
              size={20}
              color={isStreaming ? COLORS.danger : COLORS.text}
            />
            <Text
              style={[
                styles.buttonText,
                isStreaming && { color: COLORS.danger },
              ]}
            >
              {isStreaming ? 'Stop' : 'Stream'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 12,
  },
  frameContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    overflow: 'hidden',
    aspectRatio: 16 / 9,
    position: 'relative',
  },
  frame: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  placeholderText: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 18,
  },
  streamingBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  redDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.danger,
    marginRight: 6,
  },
  streamingText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.danger,
    letterSpacing: 1,
  },
  statsOverlay: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 6,
    padding: 8,
  },
  statText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontFamily: 'monospace',
  },
  controls: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  captureButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingVertical: 10,
  },
  disabledButton: {
    opacity: 0.4,
  },
  streamButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingVertical: 10,
  },
  streamActiveButton: {
    backgroundColor: COLORS.danger + '20',
    borderWidth: 1,
    borderColor: COLORS.danger + '40',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
});
