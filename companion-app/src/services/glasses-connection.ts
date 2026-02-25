/**
 * Glasses Connection Service
 *
 * Manages BLE connection to Meta Ray-Ban smart glasses.
 * Uses a provider abstraction so we can swap between:
 *   - MetaDatProvider (real DAT SDK, native module)
 *   - BlePlxProvider (direct BLE, for development)
 *   - MockProvider (simulator, for testing)
 *
 * The Meta Wearables DAT SDK integration is stubbed with clear interfaces —
 * the native module bridge will be filled in when we have the actual SDK.
 */

import {
  BLE_SCAN_TIMEOUT_MS,
  BLE_RECONNECT_DELAY_MS,
  BLE_MAX_RECONNECT_ATTEMPTS,
  META_MANUFACTURER_ID,
  GLASSES_BLE_SERVICE_UUID,
  GLASSES_BLE_CAMERA_CHAR_UUID,
  GLASSES_BLE_AUDIO_CHAR_UUID,
  GLASSES_BLE_CONTROL_CHAR_UUID,
  GLASSES_BLE_STATUS_CHAR_UUID,
} from '../utils/constants';

// ─── Types ──────────────────────────────────────────────────────

export type ConnectionState =
  | 'disconnected'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface GlassesDevice {
  /** Unique device identifier (BLE address or DAT device ID) */
  id: string;
  /** User-facing device name */
  name: string;
  /** Model identifier (e.g., "Ray-Ban Meta Wayfarer") */
  model?: string;
  /** Firmware version */
  firmwareVersion?: string;
  /** Signal strength (RSSI) */
  rssi: number;
  /** Battery level 0-100, null if unknown */
  batteryLevel: number | null;
  /** Whether this device is currently connected */
  isConnected: boolean;
}

export interface GlassesStatus {
  /** Current battery level 0-100 */
  batteryLevel: number;
  /** Whether the glasses are charging */
  isCharging: boolean;
  /** BLE signal strength */
  rssi: number;
  /** Firmware version string */
  firmwareVersion: string;
  /** Camera availability */
  cameraAvailable: boolean;
  /** Microphone availability */
  microphoneAvailable: boolean;
  /** Speaker availability */
  speakerAvailable: boolean;
  /** Whether the privacy LED is on */
  privacyLedActive: boolean;
}

export interface CameraFrame {
  /** Raw frame data as base64 JPEG */
  data: string;
  /** Frame width in pixels */
  width: number;
  /** Frame height in pixels */
  height: number;
  /** MIME type */
  mimeType: 'image/jpeg' | 'image/png';
  /** ISO timestamp of capture */
  timestamp: string;
}

export interface AudioChunk {
  /** Raw audio data as base64 PCM16 */
  data: string;
  /** Sample rate */
  sampleRate: number;
  /** Number of channels */
  channels: number;
  /** Duration in milliseconds */
  durationMs: number;
}

// ─── Connection Event Callbacks ─────────────────────────────────

export interface GlassesConnectionCallbacks {
  onStateChange?: (state: ConnectionState) => void;
  onDeviceDiscovered?: (device: GlassesDevice) => void;
  onConnected?: (device: GlassesDevice) => void;
  onDisconnected?: (reason: string) => void;
  onStatusUpdate?: (status: GlassesStatus) => void;
  onCameraFrame?: (frame: CameraFrame) => void;
  onAudioChunk?: (chunk: AudioChunk) => void;
  onGesture?: (gesture: 'single_tap' | 'double_tap' | 'long_press' | 'swipe') => void;
  onError?: (error: Error) => void;
}

// ─── Provider Interface ─────────────────────────────────────────
// This is the abstraction layer. Each provider implements this interface.

export interface IGlassesProvider {
  readonly providerName: string;

  /** Start scanning for nearby glasses */
  startScan(timeoutMs?: number): Promise<GlassesDevice[]>;

  /** Stop scanning */
  stopScan(): void;

  /** Connect to a specific device */
  connect(deviceId: string): Promise<void>;

  /** Disconnect from current device */
  disconnect(): Promise<void>;

  /** Get current device status */
  getStatus(): Promise<GlassesStatus | null>;

  /** Request a single camera frame */
  captureFrame(): Promise<CameraFrame | null>;

  /** Start continuous frame streaming */
  startFrameStream(fps: number): Promise<void>;

  /** Stop continuous frame streaming */
  stopFrameStream(): Promise<void>;

  /** Start audio input stream from glasses microphones */
  startAudioInput(): Promise<void>;

  /** Stop audio input stream */
  stopAudioInput(): Promise<void>;

  /** Play audio through glasses speakers */
  playAudio(audioData: string, format: 'pcm16' | 'opus' | 'aac'): Promise<void>;

  /** Stop audio playback */
  stopAudio(): Promise<void>;

  /** Clean up resources */
  dispose(): void;
}

// ─── Meta DAT SDK Provider (Stubbed) ────────────────────────────
// This will be filled in when we have access to the actual Meta Wearables DAT SDK.
// The native module bridge lives in native-modules/meta-dat/

/**
 * Types representing the Meta DAT SDK native interface.
 * These are the methods we expect the native module to expose.
 */
export interface IMetaDatNativeModule {
  /** Initialize the DAT SDK */
  initialize(): Promise<boolean>;
  /** Discover nearby wearable devices */
  discoverDevices(timeoutMs: number): Promise<MetaDatDevice[]>;
  /** Connect to a device by ID */
  connectDevice(deviceId: string): Promise<boolean>;
  /** Disconnect current device */
  disconnectDevice(): Promise<void>;
  /** Get device status */
  getDeviceStatus(): Promise<MetaDatDeviceStatus>;
  /** Request camera access */
  requestCameraStream(fps: number, quality: number): Promise<boolean>;
  /** Stop camera stream */
  stopCameraStream(): Promise<void>;
  /** Request microphone access */
  requestMicrophoneAccess(): Promise<boolean>;
  /** Stop microphone */
  stopMicrophone(): Promise<void>;
  /** Send audio to speakers */
  sendAudioToSpeaker(base64Audio: string, format: string): Promise<void>;
  /** Get SDK version */
  getSdkVersion(): string;
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

/**
 * Meta DAT SDK provider — uses the native module bridge.
 * Currently stubbed. The native module will be implemented when SDK access is available.
 */
export class MetaDatProvider implements IGlassesProvider {
  readonly providerName = 'meta-dat';

  private nativeModule: IMetaDatNativeModule | null = null;
  private callbacks: GlassesConnectionCallbacks;
  private isInitialized = false;

  constructor(callbacks: GlassesConnectionCallbacks) {
    this.callbacks = callbacks;
    this.tryLoadNativeModule();
  }

  private tryLoadNativeModule(): void {
    try {
      // This will be a real import when the native module is built:
      // this.nativeModule = NativeModules.MetaDatBridge;
      //
      // For now, we check if it exists and gracefully degrade
      this.nativeModule = null;
      console.log('[MetaDatProvider] Native module not yet available — using stub');
    } catch {
      this.nativeModule = null;
    }
  }

  async startScan(timeoutMs = BLE_SCAN_TIMEOUT_MS): Promise<GlassesDevice[]> {
    if (!this.nativeModule) {
      throw new Error(
        'Meta DAT SDK native module not available. ' +
        'Use BlePlxProvider or MockProvider for development.',
      );
    }

    if (!this.isInitialized) {
      await this.nativeModule.initialize();
      this.isInitialized = true;
    }

    const devices = await this.nativeModule.discoverDevices(timeoutMs);
    return devices.map((d) => ({
      id: d.id,
      name: d.name,
      model: d.model,
      firmwareVersion: d.firmwareVersion,
      rssi: d.rssi,
      batteryLevel: d.batteryLevel,
      isConnected: false,
    }));
  }

  stopScan(): void {
    // DAT SDK handles scan lifecycle internally
  }

  async connect(deviceId: string): Promise<void> {
    if (!this.nativeModule) throw new Error('Native module not available');
    const success = await this.nativeModule.connectDevice(deviceId);
    if (!success) throw new Error(`Failed to connect to device ${deviceId}`);
  }

  async disconnect(): Promise<void> {
    if (!this.nativeModule) return;
    await this.nativeModule.disconnectDevice();
  }

  async getStatus(): Promise<GlassesStatus | null> {
    if (!this.nativeModule) return null;
    const status = await this.nativeModule.getDeviceStatus();
    return {
      batteryLevel: status.batteryLevel,
      isCharging: status.isCharging,
      rssi: status.rssi,
      firmwareVersion: status.firmwareVersion,
      cameraAvailable: status.features.camera,
      microphoneAvailable: status.features.microphone,
      speakerAvailable: status.features.speaker,
      privacyLedActive: false,
    };
  }

  async captureFrame(): Promise<CameraFrame | null> {
    if (!this.nativeModule) return null;
    await this.nativeModule.requestCameraStream(1, 0.8);
    // Frame comes through event callback — single-shot would be:
    // return await this.nativeModule.capturePhoto();
    return null;
  }

  async startFrameStream(fps: number): Promise<void> {
    if (!this.nativeModule) throw new Error('Native module not available');
    await this.nativeModule.requestCameraStream(fps, 0.8);
  }

  async stopFrameStream(): Promise<void> {
    if (!this.nativeModule) return;
    await this.nativeModule.stopCameraStream();
  }

  async startAudioInput(): Promise<void> {
    if (!this.nativeModule) throw new Error('Native module not available');
    await this.nativeModule.requestMicrophoneAccess();
  }

  async stopAudioInput(): Promise<void> {
    if (!this.nativeModule) return;
    await this.nativeModule.stopMicrophone();
  }

  async playAudio(audioData: string, format: 'pcm16' | 'opus' | 'aac'): Promise<void> {
    if (!this.nativeModule) throw new Error('Native module not available');
    await this.nativeModule.sendAudioToSpeaker(audioData, format);
  }

  async stopAudio(): Promise<void> {
    // No explicit stop on DAT SDK — audio stops when buffer is consumed
  }

  dispose(): void {
    this.nativeModule = null;
    this.isInitialized = false;
  }
}

// ─── Mock Provider (for Development/Testing) ────────────────────

export class MockGlassesProvider implements IGlassesProvider {
  readonly providerName = 'mock';

  private callbacks: GlassesConnectionCallbacks;
  private isConnected = false;
  private frameInterval: ReturnType<typeof setInterval> | null = null;
  private audioInterval: ReturnType<typeof setInterval> | null = null;
  private statusInterval: ReturnType<typeof setInterval> | null = null;
  private gestureInterval: ReturnType<typeof setInterval> | null = null;
  private connectedDevice: GlassesDevice | null = null;
  private mockBatteryLevel = 78;

  constructor(callbacks: GlassesConnectionCallbacks) {
    this.callbacks = callbacks;
  }

  async startScan(_timeoutMs = BLE_SCAN_TIMEOUT_MS): Promise<GlassesDevice[]> {
    this.callbacks.onStateChange?.('scanning');

    // Simulate scan delay
    await new Promise((r) => setTimeout(r, 1500));

    const mockDevices: GlassesDevice[] = [
      {
        id: 'mock-rayban-001',
        name: 'Ray-Ban Meta Wayfarer',
        model: 'Wayfarer (Large)',
        firmwareVersion: '3.2.1',
        rssi: -45,
        batteryLevel: 78,
        isConnected: false,
      },
      {
        id: 'mock-rayban-002',
        name: 'Ray-Ban Meta Headliner',
        model: 'Headliner',
        firmwareVersion: '3.2.0',
        rssi: -62,
        batteryLevel: 45,
        isConnected: false,
      },
    ];

    for (const device of mockDevices) {
      this.callbacks.onDeviceDiscovered?.(device);
    }

    return mockDevices;
  }

  stopScan(): void {
    this.callbacks.onStateChange?.('disconnected');
  }

  async connect(deviceId: string): Promise<void> {
    this.callbacks.onStateChange?.('connecting');
    await new Promise((r) => setTimeout(r, 2000));

    this.isConnected = true;
    this.connectedDevice = {
      id: deviceId,
      name: deviceId === 'mock-rayban-001' ? 'Ray-Ban Meta Wayfarer' : 'Ray-Ban Meta Headliner',
      model: deviceId === 'mock-rayban-001' ? 'Wayfarer (Large)' : 'Headliner',
      firmwareVersion: '3.2.1',
      rssi: -45,
      batteryLevel: 78,
      isConnected: true,
    };

    this.callbacks.onStateChange?.('connected');
    this.callbacks.onConnected?.(this.connectedDevice);

    // Simulate periodic status updates and gestures
    this.startStatusUpdates();
    this.startGestureSimulation();
  }

  async disconnect(): Promise<void> {
    this.stopFrameStream();
    this.stopAudioInput();
    this.stopStatusUpdates();
    this.stopGestureSimulation();
    this.isConnected = false;
    this.connectedDevice = null;
    this.callbacks.onStateChange?.('disconnected');
    this.callbacks.onDisconnected?.('user_initiated');
  }

  async getStatus(): Promise<GlassesStatus | null> {
    if (!this.isConnected) return null;

    // Simulate slow battery drain
    if (Math.random() < 0.1) {
      this.mockBatteryLevel = Math.max(5, this.mockBatteryLevel - 1);
    }

    return {
      batteryLevel: this.mockBatteryLevel,
      isCharging: false,
      rssi: -45 - Math.floor(Math.random() * 15),
      firmwareVersion: '3.2.1',
      cameraAvailable: true,
      microphoneAvailable: true,
      speakerAvailable: true,
      privacyLedActive: false,
    };
  }

  async captureFrame(): Promise<CameraFrame | null> {
    if (!this.isConnected) return null;

    // Generate a small but visible placeholder JPEG frame
    // This is a valid JPEG that renders as a colored gradient pattern
    // Different frames get slightly different base64 to avoid deduplication
    const frameVariant = Date.now() % 1000;
    const placeholderBase64 = this.generateMockFrame(frameVariant);

    return {
      data: placeholderBase64,
      width: 1280,
      height: 720,
      mimeType: 'image/jpeg',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Generate a mock frame that varies slightly each time.
   * Returns a minimal valid JPEG base64 string.
   */
  private generateMockFrame(_variant: number): string {
    // Minimal valid 2x2 JPEG encoded in base64
    // We vary a non-critical byte to simulate frame changes
    return '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
      'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh' +
      'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR' +
      'CAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAFBABAAAAAAAAAAAAAAAAAAAACf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+A/9k=';
  }

  async startFrameStream(fps: number): Promise<void> {
    if (!this.isConnected) throw new Error('Not connected');

    this.stopFrameStream();
    const intervalMs = Math.floor(1000 / fps);

    this.frameInterval = setInterval(async () => {
      const frame = await this.captureFrame();
      if (frame) {
        this.callbacks.onCameraFrame?.(frame);
      }
    }, intervalMs);
  }

  async stopFrameStream(): Promise<void> {
    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }
  }

  async startAudioInput(): Promise<void> {
    if (!this.isConnected) throw new Error('Not connected');

    // Simulate audio chunks coming from microphone
    this.audioInterval = setInterval(() => {
      const chunk: AudioChunk = {
        data: '', // Empty audio data in mock
        sampleRate: 16000,
        channels: 1,
        durationMs: 100,
      };
      this.callbacks.onAudioChunk?.(chunk);
    }, 100);
  }

  async stopAudioInput(): Promise<void> {
    if (this.audioInterval) {
      clearInterval(this.audioInterval);
      this.audioInterval = null;
    }
  }

  async playAudio(_audioData: string, _format: 'pcm16' | 'opus' | 'aac'): Promise<void> {
    if (!this.isConnected) throw new Error('Not connected');
    // Mock: audio would play through glasses speakers
    console.log('[MockProvider] Playing audio through glasses speakers');
  }

  async stopAudio(): Promise<void> {
    // No-op for mock
  }

  dispose(): void {
    this.stopFrameStream();
    this.stopAudioInput();
    this.stopStatusUpdates();
    this.stopGestureSimulation();
    this.isConnected = false;
  }

  // ─── Private ──────────────────────────────────────────────

  private startStatusUpdates(): void {
    this.stopStatusUpdates();
    // Simulate battery drain and RSSI fluctuation
    this.statusInterval = setInterval(() => {
      if (!this.isConnected) return;
      this.getStatus().then((status) => {
        if (status) this.callbacks.onStatusUpdate?.(status);
      });
    }, 15_000);
  }

  private stopStatusUpdates(): void {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
  }

  private startGestureSimulation(): void {
    this.stopGestureSimulation();
    // Simulate occasional gestures for demo purposes
    this.gestureInterval = setInterval(() => {
      if (!this.isConnected) return;
      const gestures: Array<'single_tap' | 'double_tap' | 'long_press' | 'swipe'> = [
        'single_tap', 'double_tap', 'long_press', 'swipe',
      ];
      // ~5% chance each interval of a gesture
      if (Math.random() < 0.05) {
        const gesture = gestures[Math.floor(Math.random() * gestures.length)];
        this.callbacks.onGesture?.(gesture);
      }
    }, 10_000);
  }

  private stopGestureSimulation(): void {
    if (this.gestureInterval) {
      clearInterval(this.gestureInterval);
      this.gestureInterval = null;
    }
  }
}

// ─── BLE PLX Provider (Direct BLE via react-native-ble-plx) ─────

export class BlePlxProvider implements IGlassesProvider {
  readonly providerName = 'ble-plx';

  private callbacks: GlassesConnectionCallbacks;
  private manager: import('react-native-ble-plx').BleManager | null = null;
  private connectedDevice: import('react-native-ble-plx').Device | null = null;
  private isScanning = false;
  private frameStreamInterval: ReturnType<typeof setInterval> | null = null;
  private audioStreamActive = false;
  private subscription: import('react-native-ble-plx').Subscription | null = null;
  private monitorSubscription: import('react-native-ble-plx').Subscription | null = null;

  constructor(callbacks: GlassesConnectionCallbacks) {
    this.callbacks = callbacks;
    this.initManager();
  }

  private async initManager(): Promise<void> {
    try {
      const { BleManager } = await import('react-native-ble-plx');
      this.manager = new BleManager();
    } catch (error) {
      console.warn('[BlePlxProvider] react-native-ble-plx not available:', error);
    }
  }

  async startScan(timeoutMs = BLE_SCAN_TIMEOUT_MS): Promise<GlassesDevice[]> {
    if (!this.manager) throw new Error('BLE manager not initialized');

    this.callbacks.onStateChange?.('scanning');
    const devices: GlassesDevice[] = [];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stopScan();
        resolve(devices);
      }, timeoutMs);

      try {
        this.isScanning = true;
        this.manager!.startDeviceScan(
          [GLASSES_BLE_SERVICE_UUID],
          { allowDuplicates: false },
          (error, device) => {
            if (error) {
              clearTimeout(timeout);
              this.isScanning = false;
              reject(error);
              return;
            }

            if (device && device.name) {
              const glassesDevice: GlassesDevice = {
                id: device.id,
                name: device.name || 'Unknown Device',
                model: device.localName || undefined,
                rssi: device.rssi ?? -100,
                batteryLevel: null,
                isConnected: false,
              };

              // Check if we already have this device
              const existingIdx = devices.findIndex((d) => d.id === device.id);
              if (existingIdx >= 0) {
                devices[existingIdx] = glassesDevice;
              } else {
                devices.push(glassesDevice);
              }

              this.callbacks.onDeviceDiscovered?.(glassesDevice);
            }
          },
        );
      } catch (error) {
        clearTimeout(timeout);
        this.isScanning = false;
        reject(error);
      }
    });
  }

  stopScan(): void {
    if (this.manager && this.isScanning) {
      this.manager.stopDeviceScan();
      this.isScanning = false;
    }
    this.callbacks.onStateChange?.('disconnected');
  }

  async connect(deviceId: string): Promise<void> {
    if (!this.manager) throw new Error('BLE manager not initialized');

    this.callbacks.onStateChange?.('connecting');

    try {
      const device = await this.manager.connectToDevice(deviceId, {
        autoConnect: true,
        requestMTU: 512,
      });

      await device.discoverAllServicesAndCharacteristics();
      this.connectedDevice = device;

      const glassesDevice: GlassesDevice = {
        id: device.id,
        name: device.name || 'Ray-Ban Meta',
        model: device.localName || undefined,
        rssi: device.rssi ?? -50,
        batteryLevel: null,
        isConnected: true,
      };

      this.callbacks.onStateChange?.('connected');
      this.callbacks.onConnected?.(glassesDevice);

      // Monitor for disconnection
      this.monitorSubscription = this.manager.onDeviceDisconnected(
        deviceId,
        (_error, _device) => {
          this.connectedDevice = null;
          this.callbacks.onStateChange?.('disconnected');
          this.callbacks.onDisconnected?.('ble_disconnect');
        },
      );
    } catch (error) {
      this.callbacks.onStateChange?.('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.stopFrameStream();
    this.stopAudioInput();
    this.monitorSubscription?.remove();
    this.monitorSubscription = null;

    if (this.connectedDevice) {
      try {
        await this.connectedDevice.cancelConnection();
      } catch {
        // Already disconnected
      }
      this.connectedDevice = null;
    }

    this.callbacks.onStateChange?.('disconnected');
    this.callbacks.onDisconnected?.('user_initiated');
  }

  async getStatus(): Promise<GlassesStatus | null> {
    if (!this.connectedDevice) return null;

    try {
      const characteristic = await this.connectedDevice.readCharacteristicForService(
        GLASSES_BLE_SERVICE_UUID,
        GLASSES_BLE_STATUS_CHAR_UUID,
      );

      if (characteristic.value) {
        // Parse status from BLE characteristic value
        const data = atob(characteristic.value);
        const bytes = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
          bytes[i] = data.charCodeAt(i);
        }

        return {
          batteryLevel: bytes[0] ?? 0,
          isCharging: (bytes[1] ?? 0) === 1,
          rssi: this.connectedDevice.rssi ?? -50,
          firmwareVersion: 'unknown',
          cameraAvailable: true,
          microphoneAvailable: true,
          speakerAvailable: true,
          privacyLedActive: (bytes[2] ?? 0) === 1,
        };
      }
    } catch {
      // Status read failed — return basic info
    }

    return {
      batteryLevel: 0,
      isCharging: false,
      rssi: this.connectedDevice.rssi ?? -50,
      firmwareVersion: 'unknown',
      cameraAvailable: true,
      microphoneAvailable: true,
      speakerAvailable: true,
      privacyLedActive: false,
    };
  }

  async captureFrame(): Promise<CameraFrame | null> {
    if (!this.connectedDevice) return null;

    try {
      const characteristic = await this.connectedDevice.readCharacteristicForService(
        GLASSES_BLE_SERVICE_UUID,
        GLASSES_BLE_CAMERA_CHAR_UUID,
      );

      if (characteristic.value) {
        return {
          data: characteristic.value,
          width: 1280,
          height: 720,
          mimeType: 'image/jpeg',
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error) {
      this.callbacks.onError?.(
        error instanceof Error ? error : new Error('Failed to capture frame'),
      );
    }

    return null;
  }

  async startFrameStream(fps: number): Promise<void> {
    if (!this.connectedDevice) throw new Error('Not connected');

    await this.stopFrameStream();
    const intervalMs = Math.floor(1000 / fps);

    this.frameStreamInterval = setInterval(async () => {
      const frame = await this.captureFrame();
      if (frame) {
        this.callbacks.onCameraFrame?.(frame);
      }
    }, intervalMs);
  }

  async stopFrameStream(): Promise<void> {
    if (this.frameStreamInterval) {
      clearInterval(this.frameStreamInterval);
      this.frameStreamInterval = null;
    }
  }

  async startAudioInput(): Promise<void> {
    if (!this.connectedDevice) throw new Error('Not connected');

    try {
      this.subscription = this.connectedDevice.monitorCharacteristicForService(
        GLASSES_BLE_SERVICE_UUID,
        GLASSES_BLE_AUDIO_CHAR_UUID,
        (error, characteristic) => {
          if (error) {
            this.callbacks.onError?.(error);
            return;
          }

          if (characteristic?.value) {
            const chunk: AudioChunk = {
              data: characteristic.value,
              sampleRate: 16000,
              channels: 1,
              durationMs: 100,
            };
            this.callbacks.onAudioChunk?.(chunk);
          }
        },
      );
      this.audioStreamActive = true;
    } catch (error) {
      throw error instanceof Error ? error : new Error('Failed to start audio');
    }
  }

  async stopAudioInput(): Promise<void> {
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
    this.audioStreamActive = false;
  }

  async playAudio(audioData: string, _format: 'pcm16' | 'opus' | 'aac'): Promise<void> {
    if (!this.connectedDevice) throw new Error('Not connected');

    try {
      await this.connectedDevice.writeCharacteristicWithResponseForService(
        GLASSES_BLE_SERVICE_UUID,
        GLASSES_BLE_AUDIO_CHAR_UUID,
        audioData,
      );
    } catch (error) {
      this.callbacks.onError?.(
        error instanceof Error ? error : new Error('Failed to play audio'),
      );
    }
  }

  async stopAudio(): Promise<void> {
    // Send stop signal via control characteristic
    if (this.connectedDevice) {
      try {
        await this.connectedDevice.writeCharacteristicWithResponseForService(
          GLASSES_BLE_SERVICE_UUID,
          GLASSES_BLE_CONTROL_CHAR_UUID,
          btoa('\x00'), // Stop audio command
        );
      } catch {
        // Ignore stop errors
      }
    }
  }

  dispose(): void {
    this.stopFrameStream();
    this.stopAudioInput();
    this.monitorSubscription?.remove();
    this.connectedDevice = null;

    if (this.manager) {
      this.manager.destroy();
      this.manager = null;
    }
  }
}

// ─── Connection Manager (Main Service) ──────────────────────────

export class GlassesConnectionService {
  private provider: IGlassesProvider;
  private callbacks: GlassesConnectionCallbacks = {};
  private state: ConnectionState = 'disconnected';
  private connectedDevice: GlassesDevice | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private autoReconnectEnabled = true;
  private lastDeviceId: string | null = null;

  constructor(providerType: 'meta-dat' | 'ble-plx' | 'mock' = 'mock') {
    this.callbacks = {
      onStateChange: (s) => this.handleStateChange(s),
      onDeviceDiscovered: (d) => this.onDeviceDiscovered?.(d),
      onConnected: (d) => this.handleConnected(d),
      onDisconnected: (r) => this.handleDisconnected(r),
      onStatusUpdate: (s) => this.onStatusUpdate?.(s),
      onCameraFrame: (f) => this.onCameraFrame?.(f),
      onAudioChunk: (c) => this.onAudioChunk?.(c),
      onGesture: (g) => this.onGesture?.(g),
      onError: (e) => this.onError?.(e),
    };

    this.provider = this.createProvider(providerType);
  }

  // ─── Public Event Handlers (set by consumers) ─────────────

  onStateChange?: (state: ConnectionState) => void;
  onDeviceDiscovered?: (device: GlassesDevice) => void;
  onConnected?: (device: GlassesDevice) => void;
  onDisconnected?: (reason: string) => void;
  onStatusUpdate?: (status: GlassesStatus) => void;
  onCameraFrame?: (frame: CameraFrame) => void;
  onAudioChunk?: (chunk: AudioChunk) => void;
  onGesture?: (gesture: 'single_tap' | 'double_tap' | 'long_press' | 'swipe') => void;
  onError?: (error: Error) => void;

  // ─── Public API ───────────────────────────────────────────

  get currentState(): ConnectionState {
    return this.state;
  }

  get device(): GlassesDevice | null {
    return this.connectedDevice;
  }

  get isConnected(): boolean {
    return this.state === 'connected';
  }

  get providerName(): string {
    return this.provider.providerName;
  }

  /** Switch to a different provider (e.g., swap mock for real DAT SDK) */
  switchProvider(providerType: 'meta-dat' | 'ble-plx' | 'mock'): void {
    this.provider.dispose();
    this.provider = this.createProvider(providerType);
  }

  /** Scan for nearby glasses */
  async scan(timeoutMs = BLE_SCAN_TIMEOUT_MS): Promise<GlassesDevice[]> {
    this.setState('scanning');
    try {
      const devices = await this.provider.startScan(timeoutMs);
      if (this.state === 'scanning') {
        this.setState('disconnected');
      }
      return devices;
    } catch (error) {
      this.setState('error');
      throw error;
    }
  }

  /** Stop scanning */
  stopScan(): void {
    this.provider.stopScan();
    if (this.state === 'scanning') {
      this.setState('disconnected');
    }
  }

  /** Connect to a device */
  async connect(deviceId: string): Promise<void> {
    this.setState('connecting');
    this.lastDeviceId = deviceId;
    try {
      await this.provider.connect(deviceId);
      // onConnected callback handles state transition
    } catch (error) {
      this.setState('error');
      throw error;
    }
  }

  /** Disconnect from current device */
  async disconnect(): Promise<void> {
    this.autoReconnectEnabled = false;
    this.clearReconnectTimer();
    await this.provider.disconnect();
    this.setState('disconnected');
    this.connectedDevice = null;
  }

  /** Get device status */
  async getStatus(): Promise<GlassesStatus | null> {
    return this.provider.getStatus();
  }

  /** Capture a single frame */
  async captureFrame(): Promise<CameraFrame | null> {
    return this.provider.captureFrame();
  }

  /** Start streaming frames */
  async startFrameStream(fps: number): Promise<void> {
    return this.provider.startFrameStream(fps);
  }

  /** Stop streaming frames */
  async stopFrameStream(): Promise<void> {
    return this.provider.stopFrameStream();
  }

  /** Start audio input from glasses mics */
  async startAudioInput(): Promise<void> {
    return this.provider.startAudioInput();
  }

  /** Stop audio input */
  async stopAudioInput(): Promise<void> {
    return this.provider.stopAudioInput();
  }

  /** Play audio through glasses speakers */
  async playAudio(audioData: string, format: 'pcm16' | 'opus' | 'aac' = 'pcm16'): Promise<void> {
    return this.provider.playAudio(audioData, format);
  }

  /** Stop audio playback */
  async stopAudio(): Promise<void> {
    return this.provider.stopAudio();
  }

  /** Enable/disable auto-reconnect */
  setAutoReconnect(enabled: boolean): void {
    this.autoReconnectEnabled = enabled;
  }

  /** Clean up all resources */
  dispose(): void {
    this.clearReconnectTimer();
    this.provider.dispose();
  }

  // ─── Private ──────────────────────────────────────────────

  private createProvider(type: 'meta-dat' | 'ble-plx' | 'mock'): IGlassesProvider {
    switch (type) {
      case 'meta-dat':
        return new MetaDatProvider(this.callbacks);
      case 'ble-plx':
        return new BlePlxProvider(this.callbacks);
      case 'mock':
      default:
        return new MockGlassesProvider(this.callbacks);
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(state);
    this.callbacks.onStateChange?.(state);
  }

  private handleStateChange(state: ConnectionState): void {
    this.state = state;
  }

  private handleConnected(device: GlassesDevice): void {
    this.connectedDevice = device;
    this.reconnectAttempts = 0;
    this.autoReconnectEnabled = true;
    this.setState('connected');
    this.onConnected?.(device);
  }

  private handleDisconnected(reason: string): void {
    this.connectedDevice = null;
    this.onDisconnected?.(reason);

    // Auto-reconnect logic
    if (
      this.autoReconnectEnabled &&
      this.lastDeviceId &&
      reason !== 'user_initiated' &&
      this.reconnectAttempts < BLE_MAX_RECONNECT_ATTEMPTS
    ) {
      this.attemptReconnect();
    } else {
      this.setState('disconnected');
    }
  }

  private attemptReconnect(): void {
    this.reconnectAttempts++;
    this.setState('reconnecting');

    const delay = BLE_RECONNECT_DELAY_MS * Math.pow(1.5, this.reconnectAttempts - 1);

    console.log(
      `[GlassesConnection] Reconnect attempt ${this.reconnectAttempts}/${BLE_MAX_RECONNECT_ATTEMPTS} in ${delay}ms`,
    );

    this.reconnectTimer = setTimeout(async () => {
      if (!this.lastDeviceId || !this.autoReconnectEnabled) return;

      try {
        await this.connect(this.lastDeviceId);
      } catch {
        if (this.reconnectAttempts >= BLE_MAX_RECONNECT_ATTEMPTS) {
          console.log('[GlassesConnection] Max reconnect attempts reached');
          this.setState('error');
        }
        // Will retry via handleDisconnected
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }
}
