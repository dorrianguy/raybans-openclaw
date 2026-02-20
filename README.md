# Meta Ray-Bans × OpenClaw — Vision Platform

AI-powered smart glasses platform. Turn Meta Ray-Ban glasses into a wearable AI agent with vision, voice, and intelligence.

## 🔥 Inventory Vision

The flagship feature: **Walk through a store wearing Ray-Bans. AI counts every product on every shelf.** What takes a team 2-4 days now takes one person 3-6 hours.

```
Store Owner → Puts on glasses → Walks aisles → AI identifies + counts everything
→ Export to CSV/Excel → Done. Inventory complete.
```

### Quick Start

```typescript
import { InventoryAgent } from '@openclaw/raybans-vision';

// Initialize the agent
const agent = new InventoryAgent({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',
  debug: true,
});

// Start an inventory session
agent.start('Evening Count', { storeName: "Mike's Hardware" });

// Listen for voice responses (send to glasses speaker via TTS)
agent.on('voice:response', (text) => {
  console.log(`🔊 ${text}`);
});

// Process images from the glasses camera
await agent.processImage(capturedImage);

// Handle voice commands
agent.handleVoice('Aisle 3');
agent.handleVoice("That's 24 cases of Coca-Cola");
agent.handleVoice('Status report');

// Stop and get the report
agent.stop();
const csv = agent.exportCsv();
const report = agent.generateReport();
```

## Architecture

```
Ray-Ban Glasses → OpenClaw Node → Vision Pipeline → Specialist Agents
       ↓                              ↓                    ↓
   Camera + Mic          Image Analysis (GPT-4o)    Inventory / Memory / Networking
       ↓                              ↓                    ↓
   Voice I/O              Products + Barcodes       Reports + Exports
```

### Modules

| Module | Description |
|--------|-------------|
| `VisionPipeline` | Image → structured analysis via vision models |
| `InventoryStateManager` | Running inventory tracking with dedup + counting |
| `ProductDatabase` | UPC/barcode → product info lookups |
| `ExportService` | CSV, TSV, JSON, markdown report generation |
| `VoiceCommandRouter` | Voice command parsing + intent classification |
| `InventoryAgent` | Main orchestrator tying everything together |

### Voice Commands

| Command | What It Does |
|---------|-------------|
| "Start inventory" | Begin a new inventory session |
| "Aisle 3" | Set current location |
| "This shelf is 3 deep" | Set shelf depth multiplier |
| "That's 24 of the Tide Pods" | Manual count override |
| "Note: water damage on ceiling" | Voice annotation |
| "Status report" | Hear current progress |
| "Pause" / "Resume" | Pause/resume session |
| "Stop inventory" | Complete session + generate report |

## Development

```bash
npm install
npm test          # Run 144+ tests
npm run build     # TypeScript → dist/
npm run dev       # Watch mode
```

## Revenue Features

See [REVENUE-FEATURES.md](./REVENUE-FEATURES.md) for the full monetization strategy — 22+ revenue-generating use cases across retail, field service, real estate, healthcare, and more.

## License

MIT

---

Built by [Dorrian Guy](https://github.com/dorrianguy) • Powered by [OpenClaw](https://openclaw.ai)
