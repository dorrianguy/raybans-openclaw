# Ray-Bans Companion App

React Native (Expo) mobile app that bridges Meta Ray-Ban smart glasses to the Siberius AI agent backend.

## Architecture

```
RAY-BAN META GLASSES (BLE)
         │
    COMPANION APP (this)
    ├── Glasses Connection (DAT SDK / BLE / Mock)
    ├── Camera Capture (frame buffering + streaming)
    ├── Voice Pipeline (Deepgram STT → VoiceCommandRouter)
    ├── TTS Engine (Cartesia Sonic → glasses speakers)
    └── Backend Client (WebSocket + REST)
         │
    AGENT BACKEND (raybans-openclaw)
    ├── Context Router → Specialist Agents
    ├── Vision Pipeline
    └── Dashboard API (port 3847)
```

## Quick Start

```bash
# Install dependencies
cd companion-app
npm install

# Start Expo dev server
npx expo start

# Run on Android
npx expo start --android

# Run on iOS
npx expo start --ios
```

## Project Structure

```
companion-app/
├── app/                          # Expo Router screens
│   ├── _layout.tsx               # Root layout (routing)
│   ├── onboarding.tsx            # First-run pairing flow
│   └── (tabs)/
│       ├── _layout.tsx           # Tab navigator
│       ├── index.tsx             # Home (connection + live feed + responses)
│       ├── agents.tsx            # Agent management
│       └── settings.tsx          # All settings
├── src/
│   ├── services/
│   │   ├── glasses-connection.ts # BLE/DAT SDK connection management
│   │   ├── camera-capture.ts     # Frame capture, buffering, quality
│   │   ├── voice-pipeline.ts     # Wake word → STT → command routing
│   │   ├── backend-client.ts     # WebSocket + REST to backend
│   │   └── tts-engine.ts         # Text-to-speech output
│   ├── stores/
│   │   ├── connection-store.ts   # Glasses connection state (Zustand)
│   │   ├── agent-store.ts        # Agent status & responses
│   │   └── settings-store.ts     # Persisted preferences (MMKV)
│   ├── hooks/
│   │   ├── useGlasses.ts         # Glasses connection hook
│   │   ├── useVoice.ts           # Voice pipeline hook
│   │   └── useAgents.ts          # Agent responses + backend hook
│   ├── components/
│   │   ├── ConnectionStatus.tsx  # BLE/backend status indicator
│   │   ├── AgentCard.tsx         # Agent enable/disable card
│   │   ├── LiveFeed.tsx          # Camera frame preview
│   │   └── ResponseBubble.tsx    # Agent response display
│   └── utils/
│       ├── constants.ts          # Colors, BLE UUIDs, defaults
│       └── audio.ts              # Audio utilities
└── native-modules/
    └── meta-dat/                 # Native bridge (stubbed)
        ├── index.ts              # TypeScript interfaces
        ├── android/              # Android native module (TBD)
        └── ios/                  # iOS native module (TBD)
```

## Configuration

### Backend Connection
Default: `http://localhost:3847` (DashboardApiServer port)

Set in Settings → Backend Connection, or during onboarding.

### Voice Pipeline
- **STT:** Deepgram Nova-3 (requires API key)
- **TTS:** Cartesia Sonic (requires API key)
- **Wake Word:** "Hey Siberius" (configurable)

### Glasses Connection Providers

| Provider | Use Case |
|----------|----------|
| `mock` | Development/testing without glasses |
| `ble-plx` | Direct BLE connection (experimental) |
| `meta-dat` | Real Meta DAT SDK (when SDK is available) |

## Backend Integration

The companion app adds a WebSocket endpoint to the existing backend:

- **`ws://host:3847/api/companion`** — Real-time frame streaming + agent responses
- **`GET /api/agents`** — List all agents with enabled/disabled status
- **`POST /api/agents/:id`** — Enable/disable a specific agent
- **`GET /api/routing/stats`** — Current routing mode and stats

See `src/dashboard/companion-ws.ts` in the backend for the WebSocket protocol.

## Meta DAT SDK Integration

The DAT SDK native module is stubbed with full TypeScript interfaces at
`native-modules/meta-dat/index.ts`. When the SDK is available:

1. Download from Meta developer portal
2. Add SDK AAR (Android) / Framework (iOS)
3. Implement native bridge methods
4. Switch provider to `meta-dat` in settings

## License

Private — Siberius Project
