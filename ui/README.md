# Fast and Fraudless · UI

The story of one wire in six scenes, one focal point at a time: **Watching → Call → Decision → Investigation →
Proof → Results**. Built for 1920×1080 (also fine at 1440×900). React 19 + Vite 7 + TypeScript + Tailwind 4,
3d-force-graph / three.js (the bank map), motion, lucide-react. Fonts are bundled (no CDN at runtime).
The design spec is [FLOW_DESIGN.md](FLOW_DESIGN.md).

## Look

A calm racing theme: asphalt base `#0A0C0F`, carbon panels `#12151A` / `#171B21`, chrome text `#D7DCE3` and one
nitro-blue accent `#19B5FE`. Red `#FF2D3D`, amber `#FFB000` and green `#22D37A` mean only HOLD, VERIFY and NO_HOLD
(plus DENIED and OFFLINE). Racing Sans One (`font-race`) is for the wordmark and scene titles, Teko (`font-num`) for
big numbers, rail steps and badges, and Inter for everything you read. Badges and rail steps are slanted decals
(`.decal`, -8°). A scene change is one 320 ms speed-streak wipe; nothing else moves on its own except the map in
Watching and the voice orb while audio plays. Reduced motion turns the wipe into a short crossfade.

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

`GET /api/state` hydrates the store, then `EventSource('/api/events')` applies `{type, ts, data}` messages.
Messages that arrive while a snapshot is loading are buffered and replayed on top of it; after a reconnect the
store hydrates again. Store notifications are coalesced to one per animation frame. Anything not received yet
renders as "—"; no numbers are hard-coded. Branding comes from `GET /api/integrations/branding` (optional).

## How the stage moves

The director (`src/flow/useDirector.ts`) moves the stage on real events, never sooner than 6 s after a scene was
entered:

- A call started from this screen (keys, buttons or the mic) starts a new story and goes to **Call** at once.
- A call started anywhere else only lights a dot on the Call step.
- **Call → Decision** when the verdict becomes HOLD or VERIFY, or the call ends with any verdict.
- **Decision → Investigation** 3 s after the banker decides, once the call has ended and a SAR exists.
- **Investigation → Proof** 2 s after the shown SAR is approved or rejected.
- Results is manual. Any manual move switches auto-advance off (**A** turns it back on).

Events for a scene you are not on light a small dot on the rail instead of moving the stage.

## Keys (for the recording)

| Key | Action |
|---|---|
| ← / → | previous / next scene (no wrap) |
| 1-6, Home, End | jump to a scene |
| Shift+1 | replay CALL-01 (Margaret): `POST /api/calls/start {scenario}` → `POST /api/calls/{id}/replay` + plays `/api/audio/CALL-01` |
| Shift+2 | replay CALL-02 (David) |
| M | mic call on or off (Watching and Call only; 16 kHz mono float32 POSTs to `/api/calls/{id}/audio`) |
| E | go to Proof and run the leak test (`POST /api/demo/exfil`; the DENIED line appears) |
| A | auto-advance on or off |
| D / Esc | details drawer for the scene / close the drawer or sheet |
| ? | shortcut sheet |

Bare digits never start a replay. Hold, Release, Approve and Reject are mouse only. Every replay is a real call on
the box, so test scenes with the dev hooks below.

The microphone needs a secure context: open the UI on `localhost` (the box's own browser, or the dev server on
the laptop). On `http://<box-ip>:8790` from another machine the browser blocks `getUserMedia`; replay still works.

## Dev hooks (dev server only)

- `__ffDemo('margaret' | 'david' | 'sar' | 'denied' | 'offline' | 'online' | 'restored' | 'healed')` plays a timed
  fixture through the store. The call fixtures count as "started on this screen", so the director runs the story.
- `__ffInject(msg)` applies one SSE message, `__ffLocal(patch)` patches local state, `__ffGo(sceneId)` moves the
  stage and `__ffState()` returns the store.

## Files

- `src/App.tsx`, `src/main.tsx`: call controls provider, keys, director, shell layout; `MotionConfig` reduced motion
- `src/lib/store.ts`: hydrate + SSE store (per-frame notifications, buffered hydrate), story and leak-test state
- `src/lib/types.ts`, `src/lib/api.ts`, `src/lib/format.ts`: backend shapes, REST calls, number and time formats
- `src/lib/branding.ts`: optional white-label name and accent
- `src/lib/useCallControls.ts`, `src/lib/audio.ts`, `src/lib/mic.ts`: replay and mic calls, shared AnalyserNode
- `src/flow/scenes.ts`, `story.ts`, `derive.ts`: scene list, story state and actions, derived data (story call,
  shown SAR, ring by id, plain-word errors)
- `src/flow/useDirector.ts`, `useKeys.ts`, `CtlProvider.tsx`: auto-advance rules, keyboard, call controls context
- `src/shell/`: `Header`, `StepRail`, `Stage`, `SceneFrame`, `StartTray`, `DetailsDrawer`, `SystemOverlays`
  (offline frame, toasts), `ShortcutSheet`
- `src/ui/primitives.tsx`, `src/ui/tokens.ts`: Button, Chip, Kbd, Eyebrow, Stat, CountUp, Reveal, Empty; verdict
  copy and colours, easing, reduced motion
- `src/scenes/registry.ts`: scene id → `{ Stage, Details }`
- `src/scenes/watching/`: `WatchingScene`, `MapLayer` (3-D bank map), `mapModel`
- `src/scenes/call/`: `CallScene`, `Transcript`, `cues`; `src/components/VoiceOrb.tsx` (audio-reactive orb)
- `src/scenes/decision/`: `DecisionScene` (each new verdict first plays the rules pipeline, then the verdict card),
  `VerdictCard`, `PayeePath`
- `src/components/pipeline/`: `DecisionPipeline` (queue, checks, decision), `adapter`, `types`, `usePipelineData`
- `src/components/magicui/`: animated beam, animated list, number ticker, border beam and blur fade (MIT), used by
  the pipeline
- `src/scenes/investigation/`: `InvestigationScene`, `SarDocument`, `CaseSteps`
- `src/scenes/proof/`: `ProofScene`, `LeakTest`, `egressSummary`
- `src/scenes/results/`: `ResultsScene`, `Tiles`
- `src/dev/fixtures.ts`: dev-only demo fixtures
- `pipeline-demo.html`, `src/pipeline-demo.tsx`: dev page for the decision pipeline (`/pipeline-demo.html`)
- `src/types/modules.d.ts`: typings for untyped modules
