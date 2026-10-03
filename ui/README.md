# Fast and Fraudless · Control Room UI

One page, dark, built for 1920×1080 (also fine at 1440×900). React 19 + Vite 7 + TypeScript + Tailwind 4,
3d-force-graph / three.js (3-D bank map with bloom), cytoscape + fcose (payee check), ECharts (sparkline, gauges),
motion (springs), lucide-react. Fonts are bundled (no CDN at runtime).

## Run (dev, against the live box)

```bash
cd ui
npm install --cache D:\DellXNvidia\bundle\npm-cache --prefer-offline --no-audit --no-fund
npm run dev                         # http://localhost:5173, /api proxied to http://172.20.65.119:8790
VITE_BACKEND=http://127.0.0.1:8790 npm run dev   # point the proxy somewhere else
```

The proxy streams SSE (`/api/events`) without buffering. Check it with
`curl http://localhost:5173/api/state` and `curl -N http://localhost:5173/api/events`.

## Build (served by the backend)

```bash
npm run build                       # tsc --noEmit && vite build -> ui/dist
```

The backend mounts `ui/dist` at `/` (`TW_UI_DIST`), so every API path in the UI is relative.

## Data flow

`GET /api/state` hydrates the store, then `EventSource('/api/events')` applies `{type, ts, data}` messages
(auto-reconnect, re-hydrate after a reconnect). Anything not received yet renders as "—"; no numbers are hard-coded.

## Keys (for the recording)

| Key | Action |
|---|---|
| `1` | replay CALL-01 (Margaret): `POST /api/calls/start {scenario}` → `POST /api/calls/{id}/replay {clip}` + plays `/api/audio/CALL-01` |
| `2` | replay CALL-02 (David) |
| `M` | start / stop a mic call (16 kHz mono float32, ~2 s POSTs to `/api/calls/{id}/audio`) |
| `E` | `POST /api/demo/exfil` (DENIED line appears in the egress log) |

The microphone needs a secure context: open the UI on `localhost` (the box's own browser, or the dev server on
the laptop). On `http://<box-ip>:8790` from another machine the browser blocks `getUserMedia`; replay still works.

## Files

- `src/lib/store.ts`: hydrate + SSE store, selector hook, active call
- `src/lib/audio.ts`, `src/lib/mic.ts`: shared AudioContext/AnalyserNode, mic capture (AudioWorklet, ScriptProcessor fallback), resampling
- `src/components/BankMap.tsx`: 3-D ring map (newest 140 escalated rings, camera fly-to, particles = money flow)
- `src/components/VoiceOrb.tsx`: audio-reactive orb (mic and replay audio), tint follows the recommendation
- `src/components/LiveCall.tsx`, `Recommendation.tsx`, `PayeeGraph.tsx`: call guard
- `src/components/AgentPanel.tsx`, `EgressLog.tsx`, `Gauges.tsx`, `EvalStrip.tsx`, `TopBar.tsx`, `Banners.tsx`
