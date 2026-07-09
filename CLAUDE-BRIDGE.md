# Claude Code Bridge

Connect the glasses/companion app **directly to Claude Code** (VSCode session on the PC), instead of only the OpenClaw backend.

## How it works

```
Glasses / Companion App
      │  WebSocket  wss://<backend>/api/companion?token=<API_AUTH_TOKEN>
      ▼
Backend (Render)
      │  relays companion:voice / companion:frame events
      ▼
SSE stream  GET /api/events   (Authorization: Bearer <token>)
      │
      ▼
Claude Code (VSCode) — persistent Monitor on the SSE stream.
Each spoken command wakes Claude, who answers with:
      POST /api/companion/say  { "text": "..." }
      │
      ▼
Backend broadcasts agent_response → companion app speaks it via TTS.
```

## Claude Code side (paste into any session)

Ask Claude: *"Listen to my glasses"* — or have it run:

- Monitor (persistent) on:
  `curl -N -s -H "Authorization: Bearer $TOKEN" https://raybans-openclaw.onrender.com/api/events | grep --line-buffered "companion:voice"`
- Reply with:
  `curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"text":"<answer>"}' https://raybans-openclaw.onrender.com/api/companion/say`

## Auth

Set `API_AUTH_TOKEN` in the Render dashboard (Environment tab). The same token goes in
the companion app's Settings → Auth Token field. Without it, auth is disabled
(dev mode). `/api/health` is always open (Docker/Render health checks + wake-up pings).

Also recommended on Render: `RATE_LIMIT_RPM=120`.

## Notes

- The backend's own voice fallback (direct Claude API via `ANTHROPIC_API_KEY`) still
  answers unknown commands if the key is set; the bridge response arrives in addition.
- Render free tier cold-starts in ~50s; the app now pings `/api/health` to wake it and
  retries WS with capped backoff (15s cap, 20 attempts).
- Smoke test: `smoke-bridge.mjs` (session scratchpad) — 10 checks, run against a local
  server started with `PORT=3999 API_AUTH_TOKEN=testtoken node dist/server.js`.
