/**
 * Tests for NodeBridge — OpenClaw node integration layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NodeBridge, type NodeBridgeConfig } from './node-bridge.js';

// ─── Test Fixtures ──────────────────────────────────────────────

const BASE_CONFIG: NodeBridgeConfig = {
  gatewayUrl: 'http://localhost:9315',
  gatewayToken: 'test-token-123',
  nodeId: 'rayban-phone-001',
  cameraFacing: 'back',
  maxImageWidth: 1920,
  imageQuality: 85,
  snapTimeoutMs: 5000,
  ttsTimeoutMs: 5000,
  debug: true,
};

function createBridge(overrides: Partial<NodeBridgeConfig> = {}): NodeBridge {
  return new NodeBridge({ ...BASE_CONFIG, ...overrides });
}

// Mock fetch globally
const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Construction ───────────────────────────────────────────────

describe('NodeBridge - Construction', () => {
  it('should create a bridge with config', () => {
    const bridge = createBridge();
    expect(bridge).toBeDefined();
    expect(bridge.isConnected()).toBe(false);
    expect(bridge.getDeviceInfo()).toBeNull();
  });

  it('should apply default config values', () => {
    const bridge = new NodeBridge({
      gatewayUrl: 'http://localhost:9315',
      gatewayToken: 'token',
      nodeId: 'node-1',
    });
    expect(bridge).toBeDefined();
  });
});

// ─── Image Capture ──────────────────────────────────────────────

describe('NodeBridge - Image Capture', () => {
  it('should capture an image from the camera', async () => {
    const bridge = createBridge();
    const testImageBase64 = Buffer.from('fake-jpeg-data').toString('base64');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        image: testImageBase64,
        mimeType: 'image/jpeg',
      }),
    });

    // Mock location call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        latitude: 44.98,
        longitude: -93.27,
        accuracy: 10,
      }),
    });

    const image = await bridge.captureImage('manual');

    expect(image).not.toBeNull();
    expect(image!.id).toBeDefined();
    expect(image!.buffer).toBeInstanceOf(Buffer);
    expect(image!.mimeType).toBe('image/jpeg');
    expect(image!.trigger).toBe('manual');
    expect(image!.deviceId).toBe('rayban-phone-001');
    expect(image!.location?.latitude).toBe(44.98);
  });

  it('should return null on camera failure', async () => {
    const bridge = createBridge();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'Camera unavailable',
      }),
    });

    const errHandler = vi.fn();
    bridge.on('error', errHandler);

    const image = await bridge.captureImage();
    expect(image).toBeNull();
    expect(errHandler).toHaveBeenCalledWith('camera', expect.stringContaining('Camera unavailable'));
  });

  it('should return null on network error', async () => {
    const bridge = createBridge();

    mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

    const errHandler = vi.fn();
    bridge.on('error', errHandler);

    const image = await bridge.captureImage();
    expect(image).toBeNull();
    expect(errHandler).toHaveBeenCalled();
  });

  it('should prevent concurrent captures', async () => {
    const bridge = createBridge();

    // Slow response
    mockFetch.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve({
        ok: true,
        json: async () => ({
          ok: true,
          image: Buffer.from('data').toString('base64'),
          mimeType: 'image/jpeg',
        }),
      }), 100);
    }));

    // Start two captures simultaneously
    const [img1Promise, img2Promise] = [
      bridge.captureImage('auto'),
      bridge.captureImage('auto'),
    ];

    const img1 = await img1Promise;
    const img2 = await img2Promise;

    // Only one should succeed (the other is skipped)
    expect([img1, img2].filter((x) => x !== null).length).toBeLessThanOrEqual(1);
  });

  it('should emit image:captured event', async () => {
    const bridge = createBridge();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        image: Buffer.from('data').toString('base64'),
        mimeType: 'image/jpeg',
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false }), // no location
    });

    const handler = vi.fn();
    bridge.on('image:captured', handler);

    await bridge.captureImage('gesture');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].trigger).toBe('gesture');
  });

  it('should include voice annotation in captured image', async () => {
    const bridge = createBridge();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        image: Buffer.from('data').toString('base64'),
        mimeType: 'image/jpeg',
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false }),
    });

    const image = await bridge.captureImage('voice', 'Important whiteboard');
    expect(image?.voiceAnnotation).toBe('Important whiteboard');
  });
});

// ─── Burst Capture ──────────────────────────────────────────────

describe('NodeBridge - Burst Capture', () => {
  it('should capture multiple images in sequence', async () => {
    const bridge = createBridge();
    let callCount = 0;

    mockFetch.mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => {
          if (callCount % 2 === 1) {
            // Camera snap response
            return {
              ok: true,
              image: Buffer.from(`image-${callCount}`).toString('base64'),
              mimeType: 'image/jpeg',
            };
          } else {
            // Location response
            return { ok: false };
          }
        },
      };
    });

    const images = await bridge.captureBurst(3, 10);
    expect(images.length).toBe(3);
    expect(images[0].id).not.toBe(images[1].id);
  });
});

// ─── TTS / Speak ────────────────────────────────────────────────

describe('NodeBridge - TTS', () => {
  it('should send TTS via notify endpoint', async () => {
    const bridge = createBridge();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const handler = vi.fn();
    bridge.on('tts:delivered', handler);

    const result = await bridge.speak('50 items counted in aisle 3');
    expect(result).toBe(true);
    expect(handler).toHaveBeenCalledWith('50 items counted in aisle 3');
  });

  it('should return false on TTS failure', async () => {
    const bridge = createBridge();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: 'Device offline' }),
    });

    const result = await bridge.speak('Test message');
    expect(result).toBe(false);
  });
});

// ─── Connection Status ──────────────────────────────────────────

describe('NodeBridge - Connection', () => {
  it('should check connection and update status', async () => {
    const bridge = createBridge();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        nodes: [{
          id: 'rayban-phone-001',
          name: "Dorrian's Ray-Bans",
          platform: 'ios',
          online: true,
          lastSeen: new Date().toISOString(),
        }],
      }),
    });

    const handler = vi.fn();
    bridge.on('device:status', handler);

    const connected = await bridge.checkConnection();
    expect(connected).toBe(true);
    expect(bridge.isConnected()).toBe(true);
    expect(handler).toHaveBeenCalledWith(true, expect.objectContaining({
      nodeId: 'rayban-phone-001',
      name: "Dorrian's Ray-Bans",
    }));
  });

  it('should detect when device goes offline', async () => {
    const bridge = createBridge();

    // First: online
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        nodes: [{ id: 'rayban-phone-001', online: true }],
      }),
    });
    await bridge.checkConnection();
    expect(bridge.isConnected()).toBe(true);

    // Second: offline
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        nodes: [{ id: 'rayban-phone-001', online: false }],
      }),
    });

    const handler = vi.fn();
    bridge.on('device:status', handler);

    await bridge.checkConnection();
    expect(bridge.isConnected()).toBe(false);
    expect(handler).toHaveBeenCalledWith(false, expect.anything());
  });

  it('should handle device not found', async () => {
    const bridge = createBridge();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        nodes: [{ id: 'other-device', online: true }],
      }),
    });

    const connected = await bridge.checkConnection();
    expect(connected).toBe(false);
  });

  it('should handle network failure gracefully', async () => {
    const bridge = createBridge();

    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const connected = await bridge.checkConnection();
    expect(connected).toBe(false);
  });
});

// ─── Location ───────────────────────────────────────────────────

describe('NodeBridge - Location', () => {
  it('should get device GPS location', async () => {
    const bridge = createBridge();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        latitude: 44.9778,
        longitude: -93.2650,
        accuracy: 5,
        altitude: 250,
      }),
    });

    const location = await bridge.getDeviceLocation();
    expect(location).toEqual({
      latitude: 44.9778,
      longitude: -93.2650,
      accuracy: 5,
      altitude: 250,
    });
  });

  it('should return null when location unavailable', async () => {
    const bridge = createBridge();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false }),
    });

    const location = await bridge.getDeviceLocation();
    expect(location).toBeNull();
  });
});

// ─── Health Check ───────────────────────────────────────────────

describe('NodeBridge - Health Check', () => {
  it('should start and stop periodic health checks', () => {
    const bridge = createBridge();
    
    bridge.startHealthCheck(60000);
    // Should not throw
    bridge.stopHealthCheck();
  });

  it('should clean up on shutdown', () => {
    const bridge = createBridge();
    bridge.startHealthCheck(60000);
    bridge.shutdown();
    // No errors = success
  });
});

// ─── API Call Structure ─────────────────────────────────────────

describe('NodeBridge - API Calls', () => {
  it('should send correct headers to gateway', async () => {
    const bridge = createBridge();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        image: Buffer.from('test').toString('base64'),
        mimeType: 'image/jpeg',
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false }),
    });

    await bridge.captureImage();

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:9315/api/nodes/camera_snap',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token-123',
        }),
      })
    );
  });

  it('should include node ID and camera config in snap request', async () => {
    const bridge = createBridge();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        image: Buffer.from('test').toString('base64'),
        mimeType: 'image/jpeg',
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false }),
    });

    await bridge.captureImage();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.node).toBe('rayban-phone-001');
    expect(body.facing).toBe('back');
    expect(body.maxWidth).toBe(1920);
    expect(body.quality).toBe(85);
  });
});
