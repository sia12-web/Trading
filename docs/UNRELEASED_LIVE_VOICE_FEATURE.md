# Unreleased Feature Specification: Live Voice AI Assistant

> [!IMPORTANT]
> **Deployment Status**: **Undeployed / Pre-Production (Local Feature)**.
> This feature is fully implemented in the codebase (database migrations, services, API routes, and UI components) but is currently **disabled in production deployment** (on Vercel/Railway). It can only be activated for local testing by enabling `LIVE_VOICE_DEV_BYPASS=true` in `.env.local`.

---

## 1. Feature Overview

The **Live Voice AI Assistant** is an interactive, voice-driven co-pilot designed for active trading sessions. It provides hands-free, real-time verbal audio feedback, distance-to-level alerts, open position stats, and conversational voice interaction during the 9:00 AM – 10:15 AM trading window.

### 1.1 The Hedge Fund Prop Partner Persona ("Leo")
Rather than functioning as a passive utility or standard virtual assistant, the Live Voice agent assumes the identity of **Leo**, a senior execution trader on a professional hedge fund prop desk:
* **Multi-Market Mastery (DOW, NASDAQ, & NIKKEI 225)**: Leo is equally proficient across all three desk instruments—DOW (US30), NASDAQ (NAS100), and NIKKEI 225 (JP225). For NIKKEI sessions, Leo adapts to Tokyo session hours (09:00–09:45 JST entry window), TSE cash open AVWAPs, and Tokyo market structure.
* **Full Chart Visibility ("Seeing Everything You See")**: Leo receives the exact ground-truth payload displayed on your chart canvas:
  - 5-Day Anchored VWAP (AVWAP) and standard deviation bands.
  - Yesterday/overnight session OHLC, gap percentages, and news headlines.
  - Volume Profile Point of Control (POC) and High Volume Nodes (HVN).
  - Identified support/resistance levels with conviction scores and reasoning.
  - Live open position P&L (pips/USD), entry rules, trade attempts, and stop hit limits.
* **Strict Anti-Hallucination Guardrails**:
  - *Zero Hallucination Rule*: Leo is hardcoded NEVER to invent prices, levels, or market data. Giving fake levels causes real trading losses.
  - *Context Anchoring*: Leo only discusses prices listed in ground-truth DESK CONTEXT or stated explicitly by the trader. If an unlisted level is asked about, Leo states: *"That level isn't in our desk context or AVWAP bounds right now, partner. Let me check our chart levels first."*
* **Peer-to-Peer Interaction**: Leo addresses the trader as "partner" or "mate", discussing positions using "our desk" and "our playbook".
* **Objective Idea Debating**: Leo proves or disproves trader level ideas:
  * *Alignment*: Validation against institutional nodes (e.g., *"Clean entry zone, partner. That aligns with our NIKKEI H4 Volume POC. Stops fit nicely below the overnight low."*).
  * *Disproof*: Defense against low-confluence zones (e.g., *"I don't see technical confluence at that level, mate. Entering there looks like catching a falling knife. Let's wait for a sweep of the H1 AVWAP."*).

* **TradePulse Co-Architect System Knowledge**: Leo operates as if sitting next to you, having co-created TradePulse with deep mastery of every session phase, risk constraint, and technical calculation:
  - *Prep Phase*: Pre-market candle analysis, AVWAP band calculation, Volume Profile POC/HVN extraction, and stop-pool liquidity sweeps.
  - *Instrument Lock*: NY 09:15–09:30 ET regime lock (DOW vs NASDAQ) and Tokyo 08:45–09:00 JST regime lock (NIKKEI).
  - *Core 45-Min Entry Window*: NY 09:30–10:15 ET and Tokyo 09:00–09:45 JST (fills strictly locked to chart tickets in this window).
  - *Lunch Flatten & Safety Freeze*: 11:30 AM local time position flatten and morning tip chart freeze to eliminate afternoon over-trading.
  - *Risk Discipline Architecture*: Enforces 1 active position lock, max 2 filled attempts / 2 stop-outs per morning (2 stop hits auto-locks desk to phase DONE), 5% risk on AI/structure levels vs 1% manual pins, and $\ge 2 / 3$ factor Confluence MVP filtering.

```mermaid
graph TD
    subgraph UI_Layer [Frontend - Next.js LiveVoicePanel]
        Mic[Microphone Input - Web Speech API / Audio Recording]
        Speaker[Audio Output - HTML5 Audio / SpeechSynthesis]
        Widget[LiveVoicePanel UI Component]
    end

    subgraph API_Layer [App Router API Endpoints]
        StatusRoute[/api/trading/live-voice/status]
        TurnRoute[/api/trading/live-voice/turn]
        ReactRoute[/api/trading/live-voice/react]
        SpeechRoute[/api/speech/synthesize]
    end

    subgraph Core_Services [Live Voice Service Modules]
        StatusGate[resolveLiveVoiceStatus Gate]
        ContextBuilder[buildLiveVoiceContext Builder]
        TurnManager[executeLiveVoiceTurn Core]
        AudioEngine[OpenAI Speech TTS / Web Speech Engine]
    end

    subgraph LLM_Storage [LLM & Database]
        Claude[Anthropic Claude API]
        DB[(Supabase: live_voice_sessions / turns / pins)]
    end

    Mic --> Widget
    Widget --> StatusRoute
    Widget --> TurnRoute
    StatusRoute --> StatusGate
    TurnRoute --> ContextBuilder
    ContextBuilder --> Claude
    Claude --> AudioEngine
    AudioEngine --> SpeechRoute
    SpeechRoute --> Speaker
    TurnRoute --> DB
```

---

## 2. Deployment & Access Controls

To protect server resources and prevent accidental streaming costs in production, the Live Voice feature operates under strict deployment gates ([`lib/trading/liveVoice.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/liveVoice.ts)):

### 2.1 Production Safety Lock
- In production (`NODE_ENV === 'production'`), `liveVoiceDevBypassEnabled()` returns `false` under all circumstances.
- Microphone access (`micAllowed: false`) is strictly disabled outside authorized live desk hours.

### 2.2 Local Development Bypass (`LIVE_VOICE_DEV_BYPASS`)
To test the voice assistant locally outside market hours:
1. Add the following key to `.env.local`:
   ```bash
   LIVE_VOICE_DEV_BYPASS=true
   ```
2. Set your `OPENAI_API_KEY` (required for TTS voice synthesis):
   ```bash
   OPENAI_API_KEY=sk-proj-...
   ```
3. When `LIVE_VOICE_DEV_BYPASS=true` is set on `localhost`, weekend and off-hour gates are bypassed, enabling the microphone and audio pipeline for development.

---

## 3. Operational Gating & Session Clock Rules

When deployed in production, Live Voice is controlled by a multi-tiered security gate:

| Rule / Condition | Status | `disableCode` | Reason Reported to User |
| :--- | :--- | :--- | :--- |
| **Weekend Check** | Closed | `weekend` | *"Weekend — Live Voice closed"* |
| **Before 30-Min Pre-Open (09:00 ET / 08:30 JST)** | Closed | `before_prep` | *"Live Voice opens 30 min before open (09:00 ET / 08:30 JST)"* |
| **After Entry Close (10:15 ET / 09:45 JST)** | Closed | `after_entry` | *"Live Voice closed after entry window ended"* |
| **Not Clocked In** | Disabled | `not_clocked_in` | *"Clock in ('Today I trade') to talk"* |
| **Authorized Window + Clocked In** | **Enabled** | `null` | Microphone active, audio streaming enabled |

---

## 4. Technical Architecture & Component Breakdown

### 4.1 Database Schema ([`supabase/migrations/20260719_live_voice_sessions.sql`](file:///c:/Users/shahb/myApplications/Trading/supabase/migrations/20260719_live_voice_sessions.sql))

The feature uses three dedicated Supabase PostgreSQL tables:

1. **`live_voice_sessions`**:
   - Tracks daily voice sessions per user, instrument (`DOW`, `NASDAQ`, `NIKKEI`), and market (`NY`, `TOKYO`).
   - Fields: `id`, `user_id`, `instrument`, `market`, `trade_date`, `status ('active'|'closed')`, `started_at`, `ended_at`.
2. **`live_voice_turns`**:
   - Audio conversation turn audit log storing complete transcript history.
   - Fields: `id`, `session_id`, `user_id`, `role ('user'|'assistant'|'system')`, `text`, `audio_ms`, `created_at`.
3. **`live_voice_pins`**:
   - Spoken level pins created by the trader verbally (e.g. *"Pin support at 39,200"*).
   - Fields: `id`, `session_id`, `user_id`, `price`, `side ('BUY'|'SHORT')`, `reason`, `source ('user_voice')`.

---

### 4.2 Conversational Context Engine ([`lib/trading/liveVoiceContext.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/liveVoiceContext.ts))

When the user speaks or requests an update, the context engine dynamically aggregates:
- **Live Price & Tick Delta**: Current instrument price and distance in pips to closest support/resistance level.
- **Active Position Geometry**: Entry price, side (`BUY`/`SHORT`), stop-loss level, take-profit level, unrealized P&L in pips and USD.
- **Session State**: Active session phase, locked instrument, time remaining in the entry window.
- **User Level Pins**: Active voice-created price pins from `live_voice_pins`.

---

### 4.3 Audio & Speech Synthesis Engine ([`lib/speech/openaiSpeech.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/speech/openaiSpeech.ts))

The voice pipeline supports dual audio execution:

1. **Primary Server Speech (OpenAI Speech API)**:
   - Uses `openaiSpeech.ts` to call OpenAI TTS (`gpt-4o-mini-tts` or `tts-1`).
   - Available voices: `alloy`, `echo`, `ash`.
   - Returns binary MP3 audio buffer streamed back to the browser.
2. **Client Fallback (Web Speech API)**:
   - Uses browser `window.speechSynthesis` if `OPENAI_API_KEY` is omitted or if network latency occurs.

---

### 4.4 API Endpoints Catalog

| Endpoint | HTTP Method | Purpose |
| :--- | :--- | :--- |
| `/api/trading/live-voice/status` | `GET` | Fetches current Live Voice status, window bounds, clock-in state, and `devBypass` state. |
| `/api/trading/live-voice/context` | `GET` | Fetches real-time prompt context payload (price, levels, open positions). |
| `/api/trading/live-voice/turn` | `POST` | Processes spoken user transcript, queries LLM, synthesizes audio, and logs turn. |
| `/api/trading/live-voice/react` | `POST` | Generates unsolicited verbal reaction when price approaches within 10 pips of a key level. |
| `/api/trading/live-voice/transcript` | `GET` / `POST` | Retrieves or saves session turn transcripts. |
| `/api/speech/synthesize` | `POST` | Accepts text string and returns synthesized MP3 audio. |

---

## 5. UI Component: `LiveVoicePanel.tsx`

Located at [`app/dashboard/chart/components/LiveVoicePanel.tsx`](file:///c:/Users/shahb/myApplications/Trading/app/dashboard/chart/components/LiveVoicePanel.tsx), this widget is rendered as a floating overlay on the chart desk:

- **Microphone Control**: Interactive push-to-talk or hands-free toggle button.
- **Visual Waveform / Audio Indicator**: Animated visualizer indicating when the assistant is speaking or listening.
- **Transcript History Stream**: Collapsible chat transcript showing turn-by-turn history.
- **Pinned Levels List**: Displays active voice pins created during the session.

---

## 6. Steps Required to Deploy to Production

To safely release the Live Voice feature in a future production release:

1. **Environment Variables**:
   - Ensure `OPENAI_API_KEY` is configured in production settings on Vercel/Railway.
2. **Database Migrations**:
   - Run `node scripts/run-migrations.mjs` to ensure migration `20260719_live_voice_sessions.sql` is applied to production PostgreSQL.
3. **Feature Flag Opt-In**:
   - Remove the `process.env.NODE_ENV === 'production'` hardlock in [`lib/trading/liveVoice.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/liveVoice.ts) or introduce a production feature flag (e.g. `ENABLE_LIVE_VOICE_PROD=true`).
4. **Browser Permissions**:
   - Ensure HTTPS is enabled on the domain (browsers block microphone access over unencrypted HTTP).

---

## 7. Resolved Technical Audit Bugs

The following 5 technical bugs were identified during system audit and have been resolved across the codebase:

1. **TypeScript `NODE_ENV` Read-Only Assignment Errors**:
   - *Fix*: Cast `(process.env as any).NODE_ENV = ...` in test suites (`__tests__/live_voice_status.test.ts`, `__tests__/sentinel_live_voice.test.ts`, `__tests__/edge_cases.test.ts`, `__tests__/sentinel_ib_afternoon.test.ts`), restoring clean `npm run type-check` compilation.
2. **Staging / Preview Deployment Bypass Overrides**:
   - *Fix*: Added `ALLOW_STAGING_VOICE_BYPASS=true` support in [`lib/trading/liveVoice.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/liveVoice.ts) to allow preview deployments to test Live Voice without running local development mode.
3. **Regex Spoken Price Pin Parsing**:
   - *Fix*: Enhanced price extraction regex in [`lib/trading/liveVoiceSession.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/liveVoiceSession.ts) (`\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{3,7}(?:\.\d+)?\b`) to handle 3-digit price levels (e.g. `450`), 5-digit index prices (e.g. `39250`), and comma-formatted inputs (`39,250`).
4. **Safari / iOS Autoplay Rejection Handling**:
   - *Fix*: Added `.catch()` handling to `audio.play()` inside [`LiveVoicePanel.tsx`](file:///c:/Users/shahb/myApplications/Trading/app/dashboard/chart/components/LiveVoicePanel.tsx) to resolve playback promises gracefully when mobile browsers enforce autoplay locks, preventing the UI from freezing in the `'speaking'` state.
5. **Memory Exhaustion Guard on Audio Payload Uploads**:
   - *Fix*: Added early `Content-Length` header verification in [`app/api/trading/live-voice/turn/route.ts`](file:///c:/Users/shahb/myApplications/Trading/app/api/trading/live-voice/turn/route.ts) to reject uploads over 10MB (`413 Payload Too Large`) before parsing form data into memory.

