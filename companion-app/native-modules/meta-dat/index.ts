/**
 * Meta DAT SDK Native Module Bridge
 *
 * This module will be the React Native native module that bridges
 * to the Meta Wearables DAT SDK for Android and iOS.
 *
 * Currently stubbed — the native (Java/Kotlin for Android, Swift/ObjC for iOS)
 * implementations will be added when we have access to the actual SDK.
 *
 * Architecture:
 *   JS (glasses-connection.ts) → This Bridge → Native Module → Meta DAT SDK → Glasses
 *
 * Installation (when ready):
 * 1. Download Meta Wearables DAT SDK from Meta developer portal
 * 2. Add SDK AAR (Android) / Framework (iOS) to native-modules/meta-dat/
 * 3. Implement the native bridge (MetaDatModule.java / MetaDatModule.swift)
 * 4. Register the module in package list
 * 5. Call `MetaDat.initialize()` from JS
 */

// ─── TypeScript Interface ───────────────────────────────────────

export interface MetaDatConfig {
  /** Application ID registered with Meta */
  appId: string;
  /** Enable verbose SDK logging */
  debugLogging: boolean;
}

export interface MetaDatDevice {
  id: string;
  name: string;
  model: string;
  firmwareVersion: string;
  rssi: number;
  batteryLevel: number;
}

export interface MetaDatDeviceStatus {
  batteryLevel: number;
  isCharging: boolean;
  rssi: number;
  firmwareVersion: string;
  features: {
    camera: boolean;
    microphone: boolean;
    speaker: boolean;
    touchpad: boolean;
  };
}

export interface MetaDatCameraConfig {
  fps: number;
  quality: number; // 0-1
  resolution: 'low' | 'medium' | 'high';
}

export interface MetaDatAudioConfig {
  sampleRate: number;
  channels: number;
  encoding: 'pcm16' | 'opus';
}

// ─── Native Module Interface ────────────────────────────────────

export interface IMetaDatNativeModule {
  /** Initialize the DAT SDK with config */
  initialize(config: MetaDatConfig): Promise<boolean>;

  /** Check if SDK is available on this device */
  isAvailable(): Promise<boolean>;

  /** Get SDK version */
  getSdkVersion(): Promise<string>;

  /** Discover nearby wearable devices */
  discoverDevices(timeoutMs: number): Promise<MetaDatDevice[]>;

  /** Connect to a specific device */
  connectDevice(deviceId: string): Promise<boolean>;

  /** Disconnect from current device */
  disconnectDevice(): Promise<void>;

  /** Get connected device status */
  getDeviceStatus(): Promise<MetaDatDeviceStatus>;

  /** Start camera stream with config */
  startCameraStream(config: MetaDatCameraConfig): Promise<boolean>;

  /** Capture a single photo */
  capturePhoto(): Promise<{ data: string; width: number; height: number }>;

  /** Stop camera stream */
  stopCameraStream(): Promise<void>;

  /** Start microphone audio stream */
  startMicrophoneStream(config: MetaDatAudioConfig): Promise<boolean>;

  /** Stop microphone stream */
  stopMicrophoneStream(): Promise<void>;

  /** Send audio data to glasses speakers */
  sendAudioToSpeaker(base64Audio: string, format: string): Promise<void>;

  /** Stop speaker playback */
  stopSpeaker(): Promise<void>;

  /** Register for gesture events */
  registerGestureListener(): Promise<void>;

  /** Unregister gesture events */
  unregisterGestureListener(): Promise<void>;

  // ─── Event Emitter ──────────────────────────────────────

  /** Add event listener */
  addListener(eventType: string): void;

  /** Remove event listeners */
  removeListeners(count: number): void;
}

/**
 * Event types emitted by the native module:
 *
 * 'onCameraFrame' → { data: string (base64), width: number, height: number, timestamp: string }
 * 'onAudioChunk' → { data: string (base64), sampleRate: number, channels: number, durationMs: number }
 * 'onGesture' → { gesture: 'single_tap' | 'double_tap' | 'long_press' | 'swipe' }
 * 'onConnectionStateChange' → { state: string, deviceId: string }
 * 'onBatteryUpdate' → { level: number, isCharging: boolean }
 * 'onError' → { code: string, message: string }
 */

// ─── Mock Implementation (for development) ──────────────────────

export class MockMetaDatModule implements IMetaDatNativeModule {
  private connected = false;

  async initialize(_config: MetaDatConfig): Promise<boolean> {
    console.log('[MockMetaDat] Initialized');
    return true;
  }

  async isAvailable(): Promise<boolean> {
    return false; // Mock is not the real SDK
  }

  async getSdkVersion(): Promise<string> {
    return 'mock-0.1.0';
  }

  async discoverDevices(timeoutMs: number): Promise<MetaDatDevice[]> {
    await new Promise((r) => setTimeout(r, Math.min(timeoutMs, 2000)));
    return [
      {
        id: 'mock-001',
        name: 'Ray-Ban Meta Wayfarer',
        model: 'Wayfarer (Large)',
        firmwareVersion: '3.2.1',
        rssi: -45,
        batteryLevel: 78,
      },
    ];
  }

  async connectDevice(_deviceId: string): Promise<boolean> {
    await new Promise((r) => setTimeout(r, 1500));
    this.connected = true;
    return true;
  }

  async disconnectDevice(): Promise<void> {
    this.connected = false;
  }

  async getDeviceStatus(): Promise<MetaDatDeviceStatus> {
    return {
      batteryLevel: 78,
      isCharging: false,
      rssi: -45,
      firmwareVersion: '3.2.1',
      features: {
        camera: true,
        microphone: true,
        speaker: true,
        touchpad: true,
      },
    };
  }

  async startCameraStream(_config: MetaDatCameraConfig): Promise<boolean> {
    return this.connected;
  }

  async capturePhoto(): Promise<{ data: string; width: number; height: number }> {
    return { data: '', width: 1280, height: 720 };
  }

  async stopCameraStream(): Promise<void> {}

  async startMicrophoneStream(_config: MetaDatAudioConfig): Promise<boolean> {
    return this.connected;
  }

  async stopMicrophoneStream(): Promise<void> {}

  async sendAudioToSpeaker(_base64Audio: string, _format: string): Promise<void> {}

  async stopSpeaker(): Promise<void> {}

  async registerGestureListener(): Promise<void> {}

  async unregisterGestureListener(): Promise<void> {}

  addListener(_eventType: string): void {}

  removeListeners(_count: number): void {}
}

// ─── Module Export ──────────────────────────────────────────────

/**
 * Attempt to load the real native module, fall back to mock.
 */
export function getMetaDatModule(): IMetaDatNativeModule {
  try {
    // When the real native module is built, this will work:
    // const { NativeModules } = require('react-native');
    // if (NativeModules.MetaDatBridge) {
    //   return NativeModules.MetaDatBridge as IMetaDatNativeModule;
    // }
    console.log('[MetaDat] Real native module not found — using mock');
  } catch {
    // Expected during development
  }

  return new MockMetaDatModule();
}
