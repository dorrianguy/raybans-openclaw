# Deployment Guide — Ray-Bans × OpenClaw Backend

Deploy the backend so it's accessible from anywhere over the internet (mobile app over cellular, etc.).

## Prerequisites

1. **API Keys** — You need at minimum:
   - `OPENAI_API_KEY` — [Get one](https://platform.openai.com/api-keys)
   - `DEEPGRAM_API_KEY` — [Get one](https://console.deepgram.com/) (optional, for voice)
   - `CARTESIA_API_KEY` — [Get one](https://play.cartesia.ai/) (optional, for TTS)

2. **Local build test** — Make sure it builds cleanly first:
   ```bash
   npm ci
   npm run build
   ```

---

## Option 1: Railway (Recommended — Easiest)

**Cost:** ~$5/month for hobby plan (enough for this). Pay-per-use after that.

### Steps

1. **Install Railway CLI:**
   ```bash
   npm i -g @railway/cli
   railway login
   ```

2. **Initialize project:**
   ```bash
   cd raybans-openclaw
   railway init
   ```
   - Choose "Empty Project" when prompted

3. **Set environment variables:**
   ```bash
   railway variables set OPENAI_API_KEY=sk-...
   railway variables set DEEPGRAM_API_KEY=...
   railway variables set CARTESIA_API_KEY=...
   railway variables set NODE_ENV=production
   railway variables set PORT=3847
   railway variables set DATA_DIR=/app/data
   railway variables set LOG_JSON=true
   railway variables set RATE_LIMIT_RPM=120
   ```

4. **Add persistent volume** (for SQLite data):
   - Go to Railway dashboard → your service → Settings → Volumes
   - Mount path: `/app/data`
   - This persists your SQLite database across deploys

5. **Deploy:**
   ```bash
   railway up
   ```

6. **Get your URL:**
   ```bash
   railway domain
   ```
   Railway gives you a URL like `raybans-backend-production.up.railway.app`

7. **Test:**
   ```bash
   curl https://your-app.up.railway.app/api/health
   ```

### Railway: Subsequent Deploys
```bash
railway up
```
That's it. Or connect your GitHub repo for auto-deploy on push.

### Railway Networking Notes
- Railway natively supports WebSocket connections
- The `PORT` variable is automatically set by Railway (but we set 3847 as default)
- HTTPS is automatic with Railway-provided domains
- WebSocket URL: `wss://your-app.up.railway.app/api/companion`

---

## Option 2: Fly.io (Edge Deployment)

**Cost:** Free tier available (3 shared-cpu-1x VMs). ~$3-5/month for a dedicated micro VM.

### Steps

1. **Install Fly CLI:**
   ```bash
   # macOS
   brew install flyctl

   # Windows
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"

   # Linux
   curl -L https://fly.io/install.sh | sh

   fly auth login
   ```

2. **Launch app:**
   ```bash
   cd raybans-openclaw
   fly launch
   ```
   - It will detect the `fly.toml` and Dockerfile
   - Choose the region closest to you (e.g., `dfw` for Dallas)
   - Say **Yes** to creating a Postgres database? → **No** (we use SQLite)

3. **Create persistent volume** (for SQLite):
   ```bash
   fly volumes create raybans_data --region dfw --size 1
   ```
   The `fly.toml` already mounts this at `/app/data`.

4. **Set secrets (environment variables):**
   ```bash
   fly secrets set OPENAI_API_KEY=sk-...
   fly secrets set DEEPGRAM_API_KEY=...
   fly secrets set CARTESIA_API_KEY=...
   fly secrets set API_AUTH_TOKEN=your-secret-token
   fly secrets set RATE_LIMIT_RPM=120
   ```

5. **Deploy:**
   ```bash
   fly deploy
   ```

6. **Get your URL:**
   ```bash
   fly status
   ```
   Your app will be at `raybans-backend.fly.dev`

7. **Test:**
   ```bash
   curl https://raybans-backend.fly.dev/api/health
   ```

### Fly.io: Scale to Zero
The `fly.toml` is configured with `auto_stop_machines = 'stop'` and `min_machines_running = 0`. This means:
- When no requests come in for ~5 minutes, the machine stops (no charges)
- First request after idle takes ~2-3 seconds to boot (cold start)
- Great for development/testing to minimize costs

To keep always-on:
```toml
min_machines_running = 1
auto_stop_machines = 'off'
```

### Fly.io Networking Notes
- WebSocket connections work out of the box
- HTTPS is automatic
- The 25s keepalive ping in the server prevents Fly's 60s idle timeout from killing WS connections

---

## Option 3: Manual Docker

For self-hosting or any Docker-compatible platform.

### Build & Run

```bash
# Build the image
docker build -t raybans-backend .

# Run with environment variables
docker run -d \
  --name raybans-backend \
  -p 3847:3847 \
  -v raybans-data:/app/data \
  -e OPENAI_API_KEY=sk-... \
  -e DEEPGRAM_API_KEY=... \
  -e CARTESIA_API_KEY=... \
  -e NODE_ENV=production \
  -e LOG_JSON=true \
  -e RATE_LIMIT_RPM=120 \
  raybans-backend

# Or use an env file
docker run -d \
  --name raybans-backend \
  -p 3847:3847 \
  -v raybans-data:/app/data \
  --env-file .env \
  raybans-backend
```

### Docker Compose (optional)

```yaml
version: '3.8'
services:
  raybans-backend:
    build: .
    ports:
      - "3847:3847"
    volumes:
      - raybans-data:/app/data
    env_file:
      - .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3847/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  raybans-data:
```

### Check Logs
```bash
docker logs -f raybans-backend
```

---

## Connecting the Companion App

Once deployed, update your companion app to point at the cloud backend:

```typescript
// In your companion app config:
const BACKEND_URL = 'https://your-app.up.railway.app';  // or .fly.dev
const WS_URL = 'wss://your-app.up.railway.app/api/companion';
```

The WebSocket connection will work over cellular data because:
- Cloud platforms provide HTTPS/WSS termination
- The 25s keepalive ping prevents idle disconnects
- Automatic reconnection should be handled in the companion app client

---

## Cost Estimates

| Platform | Idle (scale-to-zero) | Light use (few hrs/day) | Always-on |
|----------|---------------------|------------------------|-----------|
| Railway  | ~$0/month (hobby)   | ~$2-5/month            | ~$5-10/month |
| Fly.io   | ~$0/month (free)    | ~$2-3/month            | ~$3-7/month |
| Docker (VPS) | N/A             | $5-10/month (Hetzner/DigitalOcean) | Same |

**Notes:**
- OpenAI API costs are separate (~$0.01-0.03 per GPT-4o vision call)
- Deepgram STT: ~$0.0059/min
- Cartesia TTS: varies by plan
- Storage for SQLite is negligible (<100MB typically)

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | ✅ | — | OpenAI API key for GPT-4o vision |
| `DEEPGRAM_API_KEY` | ⬜ | — | Deepgram API key for speech-to-text |
| `CARTESIA_API_KEY` | ⬜ | — | Cartesia API key for text-to-speech |
| `PORT` | ⬜ | `3847` | Server port (auto-set by Railway/Fly) |
| `NODE_ENV` | ⬜ | `development` | Environment mode |
| `DATA_DIR` | ⬜ | `./data` | SQLite & image storage directory |
| `CORS_ORIGINS` | ⬜ | `*` | Allowed CORS origins (comma-separated) |
| `API_AUTH_TOKEN` | ⬜ | — | Bearer token for API auth |
| `RATE_LIMIT_RPM` | ⬜ | `0` (off) | Max requests/minute per IP |
| `LOG_JSON` | ⬜ | `false` | Structured JSON logging |
| `LOG_LEVEL` | ⬜ | `info` | Log verbosity: debug/info/warn/error |

---

## Troubleshooting

### WebSocket connections dropping
- Ensure the 25s keepalive ping is active (check server logs for "keepalive ping sent")
- Railway/Fly have ~60s idle timeouts — the ping keeps it alive
- Check client reconnection logic

### SQLite errors on Fly.io
- Make sure you created a volume: `fly volumes create raybans_data --region dfw --size 1`
- Verify mount in `fly.toml` matches

### Health check failing
- Check logs: `railway logs` or `fly logs`
- Verify PORT is set correctly
- Test locally: `curl http://localhost:3847/api/health`

### CORS errors from companion app
- Set `CORS_ORIGINS` to your companion app's origin
- For Capacitor/mobile: include `capacitor://localhost`
- For dev: use `*`

### Container won't build (native modules)
- `better-sqlite3` and `sharp` need native compilation
- The Dockerfile includes `python3`, `make`, `g++` for this
- If on ARM (M1/M2 Mac), build with: `docker build --platform linux/amd64 -t raybans-backend .`
