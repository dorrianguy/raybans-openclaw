# Ray-Bans Companion App — Requirements Spec

## Overview

React Native mobile app that bridges Meta Ray-Ban smart glasses to the existing `raybans-openclaw` agent backend. This is the missing middle piece — glasses stream camera/audio to the phone app, the app routes to the backend agents, and responses come back as audio through the glasses speakers.

## Architecture

```
RAY-BAN META GLASSES
  ├─ Camera (720p/30fps via BLE)
  ├─ 5 Microphones
  ├─ Speakers
  └─ Temple tap gesture
         │
    BLE / WiFi
         │
COMPANION APP (React Native)
  ├─ Meta Wearables DAT SDK integration
  ├─ Camera frame capture & streaming
  ├─ Audio I/O (glasses mics/speakers as BLE headset)
  ├─ Wake word detection (local, on-phone)
  ├─ Voice-to-text (Deepgram Nova-3 or Whisper)
  ├─ Context Router client (routes to backend)
  ├─ TTS playback (Cartesia Sonic or system TTS)
  ├─ Connection status & settings UI
  └─ Local frame buffer & offline queue
         │
    HTTPS / WebSocket
         │
AGENT BACKEND (existing raybans-openclaw)
  ├─ Context Router
  ├─ Vision Pipeline
  ├─ Networking Agent
  ├─ Deal Analysis Agent
  ├─ Security Agent
  ├─ Meeting Agent
  ├─ Inspection Agent
  ├─ Memory Agent
  └─ Inventory Agent
```

## Target Platforms

- **Primary:** Android (Meta DAT SDK for Android is v0.4, more mature)
- **Secondary:** iOS (Meta DAT SDK for iOS is v0.3)
- **Framework:** React Native with Expo (for fast iteration)

## Core Features (MVP)

### F1: Glasses Connection Management
- Detect nearby Ray-Ban Meta glasses via BLE
- Pair and maintain connection
- Auto-reconnect on disconnect
- Show connection status (battery, signal strength)
- Use Meta Wearables DAT SDK for device communication

### F2: Camera Frame Capture
- Capture photos on demand (voice trigger or app button)
- Stream video frames at configurable FPS (1-30fps)
- Auto-downgrade quality on poor BLE connection
- Buffer frames locally when backend is unreachable
- Support both single-shot and continuous capture modes

### F3: Voice I/O Pipeline
- Glasses mics → BLE audio stream → phone
- Wake word detection ("Hey Siberius" or configurable)
- Voice-to-text transcription (Deepgram streaming or local Whisper)
- Route transcribed text through VoiceCommandRouter (existing)
- TTS response → BLE audio → glasses speakers
- Support for interrupt ("stop", "cancel")

### F4: Backend Communication
- WebSocket connection to agent backend for real-time streaming
- REST fallback for single-shot requests
- Send captured frames + voice context to Context Router
- Receive agent responses (text + priority + suggested action)
- Handle concurrent responses from multiple agents

### F5: Agent Response Audio
- Convert agent text responses to speech (Cartesia Sonic preferred, system TTS fallback)
- Play through glasses speakers via BLE audio
- Priority queue for responses (security alerts interrupt everything)
- Configurable voice (persona, speed, language)

### F6: Minimal Settings UI
- Backend URL configuration
- Wake word selection
- Capture mode (manual / auto / voice-triggered)
- Auto-snap interval
- Agent enable/disable toggles
- Audio volume and voice selection
- Privacy mode toggle (pauses all capture)

## Backend Integration Points

The app communicates with the existing `raybans-openclaw` backend:

### Existing APIs to use:
- `DashboardApiServer` — REST API already built (port 3847)
- `ContextRouter` — routes images to specialist agents
- `VoiceCommandRouter` — parses voice commands
- `ImageScheduler` — manages capture timing
- `NodeBridge` — existing OpenClaw node integration

### New APIs needed on backend:
- WebSocket endpoint for real-time frame streaming
- Audio response endpoint (returns TTS audio buffer)
- Connection status/heartbeat endpoint
- Settings sync endpoint

## Technical Stack

- **React Native** with **Expo** (SDK 51+)
- **Meta Wearables DAT SDK** (native module bridge)
- **react-native-ble-plx** (BLE communication)
- **@react-native-voice/voice** or **expo-speech** (voice I/O)
- **zustand** (state management)
- **react-native-mmkv** (fast local storage)
- **expo-av** (audio playback)

## File Structure

```
companion-app/
├── app/                    # Expo Router screens
│   ├── (tabs)/
│   │   ├── index.tsx       # Main screen (connection + live feed)
│   │   ├── agents.tsx      # Agent status & controls
│   │   └── settings.tsx    # Settings
│   ├── _layout.tsx
│   └── onboarding.tsx      # First-run pairing flow
├── src/
│   ├── services/
│   │   ├── glasses-connection.ts   # DAT SDK + BLE management
│   │   ├── camera-capture.ts       # Frame capture & buffering
│   │   ├── voice-pipeline.ts       # Voice I/O pipeline
│   │   ├── backend-client.ts       # WebSocket + REST to backend
│   │   └── tts-engine.ts           # Text-to-speech output
│   ├── stores/
│   │   ├── connection-store.ts     # Glasses connection state
│   │   ├── agent-store.ts          # Agent status & responses
│   │   └── settings-store.ts       # User preferences
│   ├── hooks/
│   │   ├── useGlasses.ts           # Glasses connection hook
│   │   ├── useVoice.ts             # Voice pipeline hook
│   │   └── useAgents.ts            # Agent responses hook
│   ├── components/
│   │   ├── ConnectionStatus.tsx    # Glasses connection indicator
│   │   ├── AgentCard.tsx           # Individual agent status
│   │   ├── LiveFeed.tsx            # Camera frame preview
│   │   └── ResponseBubble.tsx      # Agent response display
│   └── utils/
│       ├── audio.ts                # Audio utilities
│       └── constants.ts            # App constants
├── native-modules/
│   └── meta-dat/                   # Native bridge for DAT SDK
│       ├── android/
│       └── ios/
├── app.json
├── package.json
└── tsconfig.json
```

## Acceptance Criteria

1. ✅ App connects to Ray-Ban Meta glasses via BLE
2. ✅ Can capture a single photo from glasses camera
3. ✅ Can stream video frames at 5+ FPS
4. ✅ Voice commands are transcribed and routed to backend
5. ✅ Agent responses play as audio through glasses speakers
6. ✅ Security alerts interrupt other audio (priority routing)
7. ✅ App reconnects automatically after BLE disconnect
8. ✅ Works offline (queues frames, processes when connected)
9. ✅ Settings persist across app restarts
10. ✅ First-run onboarding guides through pairing

## Constraints

- **No Meta AI voice commands** — SDK doesn't expose them yet; build custom wake word
- **No HUD display output** — all output must be audio
- **No Neural Band gestures** — use voice + temple tap only
- **BLE bandwidth** — may need to downsample frames for real-time streaming
- **Battery** — aggressive frame capture drains glasses battery fast; default to conservative

## Phase 2 (After MVP)

- Android XR SDK support (when glasses ship)
- HUD display output (when Meta opens API)
- On-device ML for pre-filtering frames
- Offline agent processing (small models on phone)
- Multi-device support (multiple glasses)
- Apple N50 support (2027)
