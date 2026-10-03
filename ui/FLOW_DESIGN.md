# Fast and Fraudless · UI flow design

Final spec for the redesign. Base concept: **One Wire**. Judge changes are marked ★.
All px values are measured at 1920×1080 and written as rem (px ÷ 16). The root clamp in `index.css` keeps
16 px at 1920 and 12 px at 1440, so the same layout scales.

## 1. Why and principles

The 9-panel grid moves about 9 things at once and has no reading order. The new UI tells the story of **one wire**
in six scenes, one hero at a time.

1. One focal point per scene. Never more than **two moving things** on screen.
2. Calm palette: dark neutral base and one blue accent. Red, amber and green mean only HOLD, VERIFY and NO_HOLD
   (plus DENIED and OFFLINE).
3. Summaries on stage. Raw logs, tables, timelines and breakdowns sit behind **Details (D)**.
4. Real data only: "—" until a value arrives, and nothing hard-coded. Honest labels: Synthetic, Replay, fallback.
5. Motion uses opacity and transform only, ease-out over 200-600 ms. Respect prefers-reduced-motion and hold 60 fps.

**P0** must ship for the recording. **P1** ships only if time is left.

## 2. The flow

| # | Scene | Hero | Auto-enter (only from the scene before) | Movers |
|---|---|---|---|---|
| 1 | Watching | 3-D bank map plus "31.9M transactions scanned on the GPU" | default on load | map drift |
| 2 | Call | voice orb plus live transcript | this screen starts a call (from **any** scene) | orb, transcript fade-in |
| 3 | Decision | verdict card "Hold this wire" while the customer is on the line | the story call's verdict first becomes HOLD or VERIFY, or the call ends with any verdict | mini orb |
| 4 | Investigation | one SAR draft with verified-citation chips | 3 s after the banker decides **and** the call has ended ★ (needs a SAR; otherwise the next SAR triggers it) | none |
| 5 | Proof | the number 0 (customer records sent out) plus the live DENIED line | 2 s after the shown SAR is approved or rejected. **E** from anywhere | none |
| 6 | Results | six score tiles, each with its denominator | manual only | none |

### Director rules (`useDirector`)

Story state lives in the store: `story = {scene, dir, auto, enteredAt, storyCallId, shownSarId, visited, dots,
details, help}`. Per-story `fired` flags and **one** pending timer live in module scope.

- **R0 Manual move** (keys, rail click, Next): sets `auto=false` and cancels the pending timer. **A** toggles auto.
- **R1 This screen starts a call** (`ctl.mode` leaves `idle`, or `activeCallId` changes): starts a new story. It sets
  `storyCallId`, clears `visited`, `dots`, `fired` and `shownSarId`, sets `auto=true`, and goes to Call at once.
- **R2 Foreign call** (a new `call_id` seen after hydrate that is not ours and has not ended): lights the Call dot
  only and **never moves the stage** ★. This keeps the recording safe while the red-team runs calls on the same box.
- **R3 Call → Decision:** in Call with auto on, once the verdict is HOLD or VERIFY, or the call has ended with any
  verdict. Fires once per story.
- **R4 Decision → Investigation:** in Decision with auto on, when `banker_decision` is set, `ended` is true and at least
  one SAR exists, wait 3 s and move. If no SAR exists yet, the first `sar` event (or a case moving to `sar_drafted`)
  triggers the move.
- **R5 Investigation → Proof:** in Investigation with auto on, 2 s after the shown SAR's `decision` is set.
- **R6:** Proof → Results is manual, and Results never auto-advances.
- **Minimum dwell ★:** R3-R5 never fire sooner than 6 s after entering the current scene; they wait. R1 is immediate.
- **Dots:** an event for a scene you are not on lights a 6 px dot on that rail step instead of moving the stage.
  The Decision dot takes the verdict colour (P0). The dots for a new SAR, a new DENIED and a foreign call are P1.
  Entering a scene clears its dot.

**Which call:** the story call is `calls[storyCallId]`, or else the newest call by `started_at`.
**Which SAR ★:** chosen once when Investigation is first entered in a story, then pinned in `story.shownSarId`:
1. the SAR whose `ring_id` equals the story call's `payee_check.ring_id`;
2. else the newest **undecided** SAR (ordered by its case's last timeline ts);
3. else the newest SAR.

Pinning stops the card from swapping right after Approve, and retakes still find a fresh SAR.

## 3. Navigation and keys (`useKeys`, one window keydown handler)

| Key | Action |
|---|---|
| ← / → | previous / next scene (no wrap) |
| 1-6 | jump to scene; Home = Watching, End = Results |
| D / Esc | details drawer toggle / close drawer or sheet |
| A | auto-advance on or off |
| Shift+1 / Shift+2 | replay CALL-01 Margaret / CALL-02 David. Match `e.code` `Digit1`/`Digit2` plus `shiftKey`, because `e.key` is `!` or `@` |
| M | mic call on or off (Watching and Call only) |
| E | go to Proof and run the exfiltration test |
| ? | shortcut sheet (P1) |

Guards: ignore `e.repeat`, Ctrl, Meta, Alt, and focus in input, textarea or contenteditable. **Bare digits never
start a replay.** Hold/Release and Approve/Reject are mouse-only. Every replay is a real call on the box, so test
scenes with `__ffInject` or `__ffDemo` (section 9).

## 4. Shell (every scene)

- **Header**, 4.5rem tall with 3rem side padding, one hairline bottom border and no effects.
  - Left: a 1.75rem accent mark, then `branding.product_name` ("Fast and Fraudless") at 18/600, then a meta
    outline chip "Synthetic data". Show `bank_name` only if it is not "Your Bank".
  - Centre: the **step rail**. Six buttons "1 Watching · 2 Call · 3 Decision · 4 Investigation · 5 Proof ·
    6 Results": body labels, a meta mono index, 2.5rem apart, joined by a 1px line. Each is a button with
    `aria-current="step"` on the active one.
  - Rail states: active is ink with a 2px accent underline, one element moved by transform over 400 ms. Visited is
    ink-2 with a small check. Upcoming is mute. Dots sit on top of the step.
  - Right: the net chip, "Online" (neutral, ink-2 dot) or "Offline · all inference local" in hold red. While SSE is
    not live, show "Reconnecting…" (meta mute). Then a divider, then "Customer data sent out" (meta) over
    `counters.customer_data_out` (lead, tabular).
  - No clock, no other counters, no footer.
- **Stage** (the rest of the screen): padding 2.5rem top, 3rem sides, 2.5rem bottom; a 12-column grid with 1.5rem
  gutters.
- **SceneFrame**, the same frame for every scene:
  - Headline (title, 700) and subline (body, ink-2) at top-left.
  - The body fills the middle (`flex-1 min-h-0`).
  - A 2.5rem bottom bar. Left: "Auto · A" or "Manual · A" (meta mute). Middle: the scene's own actions (e.g. End
    call). Right: "Next: Decision →" and a "Details  D" button.
- **Details drawer:** 37.5rem wide on the right, surface, a 1px left line, p-8, its own scroll. Sections have meta
  eyebrows and body rows. Lists are capped (10 rings, 6 cases, 10 egress rows). The scene behind (map included) dims
  to 35% opacity with no blur. The drawer closes on scene change.
- **Overlays:**
  - Offline: the header chip turns hold red, and a steady 2px hold inset frame fades in over 300 ms and stays. It
    never flashes.
  - Toasts: centred 1rem under the header. Surface-2, a 1px accent border, rounded-xl, body text. 300 ms fade with
    an 8px slide, hidden after 6 s, **queued** so that one shows at a time.
    - Restored, when `health.restored` turns true: "Restored from MongoDB after a restart · rings, cases, SARs and
      calls reloaded".
    - Self-healed, when `watchdog.recoveries` increases after its first seen value: "Self-healed ·
      {last_recovery.target} {last_recovery.action}".

## 5. Scenes

Grid columns are written as "cols a-b". Type tokens are defined in section 7.

### 1 · Watching
- **Map** (behind everything): from stage-left 35rem to the right edge, full stage height. Gradient overlays to
  `--bg` fade the left 12.5rem and the bottom 6rem (no blur). No text or panels sit on the canvas.
- **Left, cols 1-4:**
  - Headline "Watching every transaction for laundering rings". Subline "On one Dell Pro Max GB10, inside the bank."
  - Display numeral `compact(tick.tx_total)` with the body label "transactions scanned on the GPU". It updates in
    place with no animation and tabular numerals.
  - Two title stats: "rings found" (`eval.rings_found ?? ringOrder.length`) and "escalated"
    (`eval.rings_escalated`).
  - Status line (body, ink-2): "Replay complete" when `tx_per_sec==0 && tx_total>0`, else
    "{tx_per_sec} tx/s · replay clock {simClock}".
  - ★ A second status line: "GB10 · GPU {gpu_util}% · {mem_used_gb} of {mem_total_gb} GB in memory", plain text at
    1 Hz. It supports the "32 million transactions in GPU memory" voice-over.
  - `StartTray` at the bottom of the column: "Margaret · replay" ⇧1, "David · replay" ⇧2, "Microphone" M.
- **Map rules:**
  - Show the newest 50 rings plus the story payee ring (`useRing`).
  - Rendering: linkCurvature 0, nodeResolution 6, no particles, bloom off (or strength 0.3 at most), antialias off,
    pixelRatio capped at 1.5. autoRotateSpeed 0.15, cooldownTicks 80, d3AlphaDecay 0.05.
  - Coalesce ring events into one `graphData()` call every 1.5 s. ★ After `onEngineStop`, pin the settled nodes
    (fx/fy/fz) so later batches move only the new ring.
  - No camera fly-to.
  - Colours: nodes #5B6573, links in the accent at 28% alpha, hubs in the accent. A ring found in the last 20 s is
    drawn at full accent ("rings lighting up"); accessors are refreshed with each batch. No red on this map.
  - When inactive: fade to 0 over 400 ms, then `pauseAnimation()`. When active again: `resumeAnimation()`, then fade
    in. Under reduced motion: no drift; render once, then pause.
  - ★ P1 closing shot: entering Watching after a HOLD story turns the payee ring hold red, and the camera eases to it
    once (1.6 s).
- **Empty** (before hydrate): numerals show "—" and "Loading the ring graph…" appears under the map centre.
- **Details:** the newest 10 rings (id, type, tier, accounts, total USD), rings by type, replay clock and cycle time,
  and bench rows.

### 2 · Call
- **Headline:** "{customer.name} wants to wire {usd(amount)}", or "A customer is on the line" until data arrives.
  Subline: "Speech is transcribed and read on the GB10 while the call is live."
- **Left, cols 1-5:**
  - VoiceOrb at 20rem.
  - Status line (meta): "Listening · {asr} on the GB10", "Call ended · {m:ss of audio_s}", or `ctl.error` in plain
    words.
  - Facts on two lines (body, ink-2): "{age} years old · banked {tenure} years · first wire ever" and "Typical month
    {usd} · this wire {ratio}×".
  - The payee account (body, mono).
  - Chips on their own line: "Synthetic customer", "Replay" (if `source==='replay'`), "Keyword fallback" (if
    `cue_source` contains "fallback"). Names never truncate.
- **Right, cols 6-12:**
  - Transcript at lead 24/1.5 ink, bottom-anchored with overflow hidden and a 6rem top mask, newest text at the
    bottom. The partial is ink-2. Cue quotes get a 2px accent underline and a meta cue label. **No scroll box and no
    smooth-scroll.**
  - Chips for detected cues only (meta, 600, uppercase, accent outline). Each fades in over 300 ms and never
    re-lays out the others.
  - Payee line (body, neutral): "Checking the payee against the ring graph…", then "Payee {acct} is {hops} hops from
    ring {ring_id}" or "Payee is not linked to a known ring". The verdict colour is saved for Decision.
- **Bottom-bar action:** "End call" (ghost) while `ctl.mode !== 'idle'`.
- **Empty:** a static idle orb, "No call on the line" and `StartTray`.
- **Details:** full transcript; ASR windows (i, t0-t1, latency, fallback); cue quotes with reader; call id, clip and
  mic mode; errors.

### 3 · Decision
- **Top strip** instead of a headline (full width, 5.5rem, surface, line border, rounded-xl):
  - A 3.5rem mini orb, live while audio plays.
  - "{name} · on the line {m:ss}". ★ The time comes from `call.audio_s`, so there is no ticking timer.
  - The latest transcript sentence (lead, ink-2, one line, ellipsis at the start).
  - A right-aligned tag: "Provisional · call in progress" or "Final · whole call".
- **Verdict card, cols 1-7:**
  - Surface, a 1px border in the verdict colour at 45%, a 4px left bar in the verdict colour, rounded-xl, p-8, and
    the only shadow in the UI: `0 24px 48px -24px rgba(0,0,0,.6)`.
  - Title (hero, 700, verdict colour): "Hold this wire", "Verify before sending" or "No hold needed".
  - Amount line (title): "{usd(amount)} → {payee}", with the account in mono. Below it, meta mute: "Rules decide,
    not the model".
  - Eyebrow "Why", then the top 3 reasons (lead, 6px dots, line-clamp-2). The payee-ring reason (`/ring/i`) comes
    first, then backend order.
  - Buttons (lg) ★. HOLD and VERIFY: primary "Hold wire" (hold-fill, white text) plus ghost "Release". NO_HOLD:
    primary "Release wire" (ink) plus ghost "Hold". Note (meta): "The banker decides. Nothing is sent automatically."
  - After the banker acts, the buttons crossfade to "Held by the banker at hh:mm" or "Released by the banker at
    hh:mm" (lead, verdict colour).
  - **One card per call** (key = `call_id`). A verdict change, or provisional becoming final, crossfades the title
    and colour in place over 350 ms with no remount.
- **Right, cols 8-12:**
  - `PayeePath`, a deterministic SVG of about 46.6×22.5rem. Customer → payee → hub sit on one line, with up to 8
    ring members on an arc around the hub (members from `useRing(ring_id)`).
  - The hub and members take the verdict colour only if `payee_check.in_ring`; otherwise they stay neutral. No
    physics and no randomness.
  - Caption (body): "Payee feeds ring {ring_id}, found by the GPU · {hops} hops".
  - Eyebrow "Ask the customer", then 3 questions (body).
- **Empty:** "No decision yet · start a call" and `StartTray`.
- **Details:** all reasons and questions; features (first wire, amount ratio, high-risk cues); cue quotes with
  reader; the raw payee path; ★ the matching payment-rail screening (the `integration` whose `result.ring_id` equals
  the payee ring).

### 4 · Investigation
- **Headline:** "The agent drafted a report on ring {ring_id}". Subline: "The payee's ring from this call" when
  linked, else "The latest case the agent finished on its own" (honest about the link).
- **Left, cols 1-4:**
  - `CaseSteps`: 3-5 rows mapped from `case.timeline`. "Woke on its own (· after a restart)" → "Read the case file"
    → "Drafted the SAR" → "Checked {v}/{n} citations" → "Waiting for an analyst", "Approved" or "Rejected".
  - Each row is a meta mono time plus body text. An accent dot marks the current step, with no spinners.
  - Errors read "Agent run failed · will retry"; the raw text goes only in a `title` attribute or Details.
  - Check banner: a clear-green check, "{valid}/{total} citations verified" (lead) and "Every number checked against
    the database" (body).
- **Right, cols 5-12:**
  - `SarDocument` card: surface, rounded-xl, p-8. The SAR id (body, mono) and a "Draft · not filed" chip.
  - Narrative at lead 24/1.5. Lines that are only a transaction reference become **citation chips in a 3-column
    grid**, and ids inside prose become inline chips.
  - A chip is meta mono "T25805643 · 10,021.09" with ✓ (clear) or ✗ (hold outline, reason in `title`).
  - Overflow clamps with a bottom fade and "Full text in Details".
  - Buttons: "Approve SAR" (primary) and "Reject" (ghost), with the note "An analyst approves. Nothing is filed
    automatically." After a decision they show "Approved" (clear) or "Rejected" (hold).
- **Empty:** "The investigator agent has not drafted a report yet" and "{n} cases open".
- **Details:**
  - Up to 6 cases with summarised status (raw error in `title`).
  - The full timeline.
  - A citations table (txn, amount, valid, reason).
  - Export links `/api/integrations/sar/{id}/fincen.xml` and `.json`, and `/api/integrations/cases/export.csv`.

### 5 · Proof
- **Headline:** "Nothing about the customer leaves the bank". Subline: "Counted from the OpenShell egress log on the
  box."
- **Left, cols 1-6:**
  - Display numeral `counters.customer_data_out` (ink) with the lead label "customer records sent out".
  - Two title stats: `denied_total` "outbound attempts denied" and `alerts_sent` "alerts sent · content-free".
  - Self-healing row (body): "{watchdog.recoveries} automatic recoveries · last {hh:mm} ({target})". Add "Survived a
    restart: state restored from MongoDB" when `health.restored`.
- **Right, cols 7-12, the `LeakTest` card:**
  - Body: "The sandboxed agent tries to send data to the internet."
  - Button (lg) "Simulate exfiltration  E", which calls `runExfil()`.
  - Result: the newest DENIED egress row, with "DENIED" in hold red plus the dest (lead, mono) and policy · reason
    (body). Show "Trying…" as static text while running. Before any denial: "No leak attempt yet in this session.
    Press E to try one."
  - Under the card, two dim meta lines: "Telegram long-poll · {n} allowed · content-free" (`kind==='poll'`) and
    "Other allowed events · {n}".
- **Details:** the newest 10 egress rows as plain divs, with a "Hide polls" toggle that is on by default; policy
  names; watchdog checks, recoveries and last_recovery; uptime.

### 6 · Results
- **Headline:** "How well it works". Subline: "Measured on labelled synthetic data. Every number has its
  denominator."
- **Tiles:** a 3×2 grid (col-span-4, about 20.6rem tall, surface, line, rounded-xl, p-8). Each has a label (body,
  ink-2), a value (hero, 700) with its denominator (title, mute), and a note (meta).
  1. Scam calls held: `scam_caught / scam_total` (note: `eval.label`).
  2. False holds on normal calls: `false_holds / normal_total`.
  3. Laundering attempts recovered: `rings_recovered / rings_total` (note: "{rings_recovered_escalated} via
     escalated rings").
  4. Escalated precision: `pct(flagged_precision)` (note: "all flagged {pct(flagged_precision_all)}").
  5. Injection attempts that changed a decision: `redteam_decision_changed / redteam_attempts` (note: "customer data
     out {redteam_data_out} · invented facts passed {redteam_invented_facts_passed}").
  6. GPU vs CPU on the same pandas code: "{cpu_s/gpu_s}× faster", with two static SVG bars (gpu_s, cpu_s in s).
- **Bottom line** (meta, mute): "GB10 now: GPU {gpu_util}% · {temp_c} °C · {power_w} W · memory {used}/{total} GB ·
  Payment rails: last ISO 20022 screening {screening} ({ring_id})".
- **Values:** `CountUp` once on entry (600 ms, through a ref), then they update instantly. Missing values show "—".
- **Details:** recall by ring type (`by_type`), the per-call eval table, the bench split (load vs detect) and
  integration status.

## 6. Motion rules

- **Easing:** `--ease-calm` = cubic-bezier(0.22, 1, 0.36, 1) for every entrance. Exits are opacity-only over 200 ms.
- **Scene change:** scenes are absolutely positioned in `AnimatePresence initial={false}`.
  - The outgoing scene fades out over 200 ms.
  - The incoming scene fades in and slides 2rem along the rail direction over 400 ms, starting 80 ms later.
  - The rail underline moves over 400 ms.
- **Inside a scene:** at most two entrance groups (`Reveal order 0` and `order 1` at +120 ms), each opacity plus
  translateY 12px → 0 over 400 ms. After that the scene is still.
- **Continuous movers:** Watching has the map drift. Call has the orb plus transcript fade-ins. Decision has the mini
  orb while audio plays. Investigation, Proof and Results have none.
- **One-shots:** citation chips stagger 50 ms (done within 500 ms); a new DENIED row fades in over 300 ms;
  CountUp runs once on Results entry.
- **Map:** mounted once and live only in Watching (fade, then pause).
- **Orb:**
  - Its rAF loop runs only while replay audio plays or the mic is live, and only while it is mounted. Otherwise it
    draws one static frame.
  - 2 layers, wobble at most 6% of the radius, gradients cached per radius, tone colour easing over 600 ms.
- **Banned:**
  - `backdrop-filter`, glows and coloured shadows.
  - `animate-ping`, `animate-pulse` and `animate-spin`; spinners become static "Checking…" text.
  - A seconds clock.
  - `layout` props on lists, and animating layout, size, box-shadow or filter.
  - Per-frame `setState` (count-ups write `textContent` through a ref).
- **Reduced motion:** wrap the app in `<MotionConfig reducedMotion="user">` and use `prefersReducedMotion()` in the
  canvas loops.
  - Scene changes become 150 ms crossfades.
  - Count-ups, staggers and map drift are off; the map renders once.
  - The orb is a static ring whose opacity follows the level, updated at most 10 times a second.
- **Budget:** at most one WebGL loop or one 2D-canvas loop alive at a time, never both. Target 60 fps at 1920.

## 7. Visual tokens (`index.css` `@theme`)

| Token | Value | Use |
|---|---|---|
| bg | #0B0D10 | page |
| surface / surface-2 | #121519 / #181C21 | cards, drawer / buttons, chips, toast |
| line / line-2 | #23282F / #2F3540 | hairlines / ghost borders, hover |
| ink / ink-2 / mute / faint | #EDEFF2 / #A9B0BA / #7A828E / #3A414B | text; mute is the 14 px minimum (5:1 on bg); faint only for disabled |
| accent | #8AB4FF | rail, focus, map, cue underline |
| hold / hold-fill | #F0524F / #D93A37 | HOLD text, DENIED, OFFLINE / Hold button fill with white text |
| verify | #F2B544 | VERIFY |
| clear | #3DD68C | NO_HOLD, valid citation, Approved |

- **Tints:** semantic backgrounds at 10% and borders at 45%.
- **Old Tailwind names:** remap them onto the new values so untouched files still render: panel → surface,
  panel-2 → surface-2, danger and danger-ink → hold, safe → clear, amber → verify, nv → accent, dim → faint.
- **Branding:** fetch `GET /api/integrations/branding` once; it is 200 today. Use its `product_name`. Adopt
  `accent_color` only if its hue is 180-320° (today it is #76b900, green, so it is ignored). Fall back silently on
  any error.
- **Type:** six sizes only, as named utilities. Never `text-[…]` in new files.
  - `text-meta` 0.875rem (14): labels, chips, meta.
  - `text-body` 1.125rem (18): body, buttons.
  - `text-lead` 1.5rem (24): transcript, reasons, narrative.
  - `text-title` 2.5rem (40): headlines, secondary stats.
  - `text-hero` 4.5rem (72): verdict, Results values.
  - `text-display` 8rem (128): at most one per scene.
  - Inter for the UI, JetBrains Mono only for ids, accounts, txn ids and egress. Tabular numerals everywhere.
  - Weights 400/600/700. Line height 1.5 for body, 1.2 for headings, 1 for numerals.
  - Sentence case. Uppercase only for meta eyebrows and cue chips, with 0.08em tracking.
- **Spacing:** 4/8/12/16/24/32/48/64 px (Tailwind steps 1, 2, 3, 4, 6, 8, 12, 16). Card padding p-8, gap-6 between
  groups, gap-12 between blocks.
- **Radii:** 8 px (rounded-lg) for buttons, chips and inputs; 12 px (rounded-xl) for cards, drawer and toast; full
  for dots.
- **Elevation:** flat. One 1px line per surface: no gradients, no glass, no glows.
- **Buttons:** 3rem tall (lg is 3.5rem), body 600. Primary is ink with bg text (Hold uses hold-fill with white).
  Ghost is transparent with a line-2 border. Focus ring: 2px accent with a 2px offset.

## 8. Disclosure and copy rules

- **On stage:**
  - Summaries, one hero, at most 3 reasons, at most 3 questions, and only the detected cues.
  - One SAR, never a case list. No raw stderr, ever; errors read like "Agent run failed · will retry".
  - Polls are collapsed into one dim line.
- **In Details:** everything raw, in capped lists. The drawer closes on scene change.
- **Copy:**
  - The product name is always "Fast and Fraudless". Plain verbs, sentence case.
  - Missing data shows "—". Honest labels: Synthetic, Replay, Keyword fallback, Draft · not filed.

## 9. Files, ownership and contracts

One owner per file. Old files stay untouched until a single cleanup commit after merge (ownership of dead files then
passes to F). The foundation creates the scene stubs; each bundle then rewrites its own stubs, keeping the export
names.

**F, Foundation (built first):**
- Entry and shell: `index.html` (title "Fast and Fraudless"), `src/main.tsx`, `src/index.css`, `src/App.tsx`.
- Lib: `src/lib/store.ts`, `src/lib/types.ts`, `src/lib/branding.ts`, `src/lib/useCallControls.ts` (keep its API).
- Flow: `src/flow/scenes.ts`, `src/flow/story.ts`, `src/flow/derive.ts`, `src/flow/useDirector.ts`,
  `src/flow/useKeys.ts`, `src/flow/CtlProvider.tsx`.
- Shell components: `src/shell/Header.tsx`, `src/shell/StepRail.tsx`, `src/shell/Stage.tsx`,
  `src/shell/SceneFrame.tsx`, `src/shell/StartTray.tsx`, `src/shell/DetailsDrawer.tsx`,
  `src/shell/SystemOverlays.tsx`, `src/shell/ShortcutSheet.tsx` (P1).
- UI and dev: `src/ui/primitives.tsx`, `src/ui/tokens.ts`, `src/scenes/registry.ts`, `src/dev/fixtures.ts`
  (dev-only), and later `ui/README.md`.
- Old files F owns: `components/TopBar.tsx`, `components/Banners.tsx`, `components/ui.tsx`.

**A, Watching + Results:**
- Rewrites its stubs `src/scenes/watching/WatchingScene.tsx` and `src/scenes/watching/MapLayer.tsx`.
- New files `src/scenes/watching/mapModel.ts` and `src/scenes/results/Tiles.tsx`.
- Rewrites its stub `src/scenes/results/ResultsScene.tsx`.
- Old files it owns: `BankMap.tsx`, `Throughput.tsx`, `Gauges.tsx`, `EvalStrip.tsx`, `lib/useEChart.ts`.

**B, Call + Decision:**
- Rewrites its stubs `src/scenes/call/CallScene.tsx` and `src/scenes/decision/DecisionScene.tsx`.
- New files `src/scenes/call/Transcript.tsx`, `src/scenes/call/cues.ts`, `src/scenes/decision/VerdictCard.tsx` and
  `src/scenes/decision/PayeePath.tsx`.
- Rewrites `src/components/VoiceOrb.tsx` in place. Its props stay compatible: `{tone, active, size?}`.
- Old files it owns: `LiveCall.tsx`, `Recommendation.tsx`, `PayeeGraph.tsx`.

**C, Investigation + Proof:**
- Rewrites its stubs `src/scenes/investigation/InvestigationScene.tsx` and `src/scenes/proof/ProofScene.tsx`.
- New files `src/scenes/investigation/SarDocument.tsx`, `src/scenes/investigation/CaseSteps.tsx`,
  `src/scenes/proof/LeakTest.tsx` and `src/scenes/proof/egressSummary.ts`.
- Old files it owns: `AgentPanel.tsx`, `EgressLog.tsx`.

**Contracts (F exports; names are fixed):**
```ts
// flow/scenes.ts
type SceneId = 'watching'|'call'|'decision'|'investigation'|'proof'|'results'
const SCENES: readonly { id: SceneId; label: string }[]            // rail order; index+1 = key
// flow/story.ts
interface Story { scene: SceneId; dir: 1|-1; auto: boolean; enteredAt: number; storyCallId?: string;
  shownSarId?: string; visited: Partial<Record<SceneId, true>>;
  dots: Partial<Record<SceneId, 'new'|'HOLD'|'VERIFY'|'NO_HOLD'>>; details: boolean; help: boolean }
interface ExfilState { status: 'idle'|'running'|'done'|'error'; at?: number; blocked?: boolean|null; message?: string }
useStory(): Story;  useScene(): SceneId
goTo(id: SceneId, how?: 'manual'|'auto'): void;  next(): void;  prev(): void
setAuto(on: boolean): void;  setDetails(open: boolean): void;  toggleDetails(): void
runExfil(): Promise<void>            // writes store.exfil; E key and the Proof button both call it
// flow/derive.ts
type Verdict = 'HOLD'|'VERIFY'|'NO_HOLD'
useStoryCall(): Call|undefined;  verdictOf(c?: Call): Verdict|null
useShownSar(): { sar?: Sar; kase?: Case; linked: boolean }      // reads story.shownSarId
useRing(id?: string|null): Ring|undefined   // store ring, else GET /api/rings/{id} once (module cache)
summariseError(msg?: string): string         // "Agent run failed · will retry"
// flow/CtlProvider.tsx
useCtl(): Omit<CallControls,'level'>         // mode, error, micMode, replay, startMicCall, toggleMic, end, audioEl
// shell
SceneFrame({ headline, subline?, actions?, children })   StartTray({ compact? })
// ui/primitives.tsx
Button({ variant:'primary'|'ghost'|'hold'; size?:'md'|'lg'; kbd?: string; ...buttonProps })
Chip({ tone?:'neutral'|'accent'|'hold'|'verify'|'clear'; children })   Kbd   Eyebrow
Stat({ value, label, den?, size?:'display'|'hero'|'title', note? })
CountUp({ value?: number|null; format:(v:number)=>string; className? })   // once on mount, then instant
Reveal({ order?: 0|1; className?; children })   Empty({ title, sub?, children? })
// ui/tokens.ts
VERDICT: Record<Verdict,{ title: string; short: string; color: string /* css var */ }>
EASE; DUR = { fast: .2, base: .4, slow: .6 };  prefersReducedMotion(); usePrefersReducedMotion()
// store State additions
story; exfil; watchdog?; integration?; integrations (newest first, max 10); branding?
// scene modules (registry.ts imports these exact names; no props)
WatchingScene, WatchingDetails, MapLayer({ active }), CallScene, CallDetails, DecisionScene, DecisionDetails,
InvestigationScene, InvestigationDetails, ProofScene, ProofDetails, ResultsScene, ResultsDetails
```

**Store fixes F ships:**
- Hoist one module-level `subscribe`.
- Coalesce emits per animation frame (use `setTimeout` while `document.hidden`).
- Cache `found_at` in ms.
- Buffer SSE messages while a hydrate is in flight, apply the snapshot, then replay the buffer.
- Add `watchdog` and `integration` slices and hydrate keys.
- Type `Egress.kind` and the `redteam_*` eval fields.
- Remove `lastEventAt`.
- `CtlProvider` holds `useCallControls` and passes `children` through, so the mic level (about 16 updates per second)
  never re-renders the app.

**Testing without real calls** (dev only):
- `window.__ffInject(msg)` applies an SSE message.
- `window.__ffLocal(patch)` calls `patchLocal`.
- `window.__ffDemo('margaret'|'david'|'sar'|'denied'|'offline'|'restored'|'healed')` plays timed fixture sequences.
  The call fixtures set `activeCallId` so they count as "this screen started it".
- Real replays: at most 2 per agent.

**Commit rules:**
- Run `npx tsc --noEmit -p .` in `ui/`; never `npm run build` except F's final check.
- `git add <own new files>`, then `git commit -m "<msg>" -- <own paths>`. Never `-A`, amend, rebase, stash, checkout
  or push.
- On an `index.lock` error, wait and retry.
- Never write the assistant vendor's name, and add no co-author trailers.

## 10. Run of show (for the lead to fold into VIDEO_SCRIPT.md)

| Script beat | Scene | Presenter action |
|---|---|---|
| 0:08 map turning | Watching | nothing (fresh replay with `RF_ARGS=--reset`, so rings light up) |
| 0:20 Wi-Fi off | Watching | the header chip goes "Offline · all inference local" and the frame appears |
| 0:30 Margaret's call | Call | **Shift+1** (was "1") or click "Margaret · replay" |
| ~0:48 verdict | Decision (auto, about 17 s into the call) | the payee path and "Hold this wire" |
| 1:20 banker holds | Decision | click Hold wire |
| 1:30 David's call | Call → Decision (when his call ends, about 23 s) | **Shift+2**; then click Release wire |
| ~1:58 agent | Investigation (auto 3 s after Release) | optionally click Approve SAR |
| 2:05 leak test | Proof | **E** |
| 2:15 kill and resume | Proof | the Restored and Self-healed toasts queue; the Proof row updates |
| 2:45 eval | Results | **6** or → |
