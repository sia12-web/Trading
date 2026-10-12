# ⏱️ 09. Trader Workstation Operational Runbook & Cheatsheet

> **Daily Trading Schedule, Pre-Flight Checklist, Audio Chime Index, and Emergency Troubleshooting**  
> **Source Files**: [`SYSTEM_EXECUTION_AND_STRATEGY_GUIDE.md`](file:///c:/Users/shahb/myApplications/Trading/SYSTEM_EXECUTION_AND_STRATEGY_GUIDE.md), [`lib/chart/sessionVwap.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/chart/sessionVwap.ts), [`lib/trading/sessionGate.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/sessionGate.ts), [`lib/trading/deskExitGuard.ts`](file:///c:/Users/shahb/myApplications/Trading/lib/trading/deskExitGuard.ts)

---

## 1. Master Operational Clock & Session Timeline

All desk operations align to **Montreal Time (EDT/EST / `America/Toronto`)** and **New York Time (`America/New_York`)**:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ MASTER 24-HOUR TRADING WORKSTATION TIMELINE                                           │
├──────────────┬──────────────────┬──────────────────────────────────────────────────────┤
│ Time (ET)    │ Session Stage    │ Core Desk Operational Action                         │
├──────────────┼──────────────────┼──────────────────────────────────────────────────────┤
│ **18:00**    │ **Globex Open**  │ CME Globex opens. New 24-hour Tradeify session rolls.│
│ **20:00**    │ **Tokyo Open**   │ TSE Cash Open (09:00 JST). Nikkei map freezes.       │
│ **02:00**    │ **Asia Scan**    │ Dow Asia Narrow Range scan (<80 pts compression).    │
│ **03:00**    │ **London Open**  │ London financial session opens. Track ONH/ONL.       │
│ **08:30**    │ **US Macro**     │ CPI, NFP, PPI releases. Stand aside if high-impact.  │
│ **09:00**    │ **Pre-Market**   │ Build Tier-1 zones (5D FRVP, Yesterday, Overnight).  │
│ **09:30**    │ **RTH Open**     │ US Cash Open. FREEZE MAP PERMANENTLY. Dalton Open.   │
│ **09:45**    │ **OR15 Window**  │ OR15 Breakout window opens (09:45–10:00 ET).         │
│ **10:00**    │ **OR30 Window**  │ OR30 Midpoint Continuation window (10:00–10:30 ET).  │
│ **10:30**    │ **IB Window**    │ 60-min Initial Balance established. Fade/expand IB.  │
│ **11:30**    │ **Lunch Zone**   │ NY Lunch doldrums (11:30–13:30). Manage-only.        │
│ **15:15**    │ **Last Entry**   │ Final entry cutoff. No new trade entries permitted.  │
│ **16:00**    │ **Cash Close**   │ US Equity Cash Close. Settle Dalton Day Type.        │
│ **16:59**    │ **HARD FLATTEN** │ Tradeify Mandatory Flatten. Liquidate all positions. │
│ **17:00**    │ **CME Halt**     │ Daily 60-minute CME maintenance shutdown.            │
└──────────────┴──────────────────┴──────────────────────────────────────────────────────┘
```

---

## 2. Step-by-Step Daily Trading Protocol

### Phase 1: Pre-Flight Routine (08:45 – 09:25 ET)
1. **Clock In**: Log into workstation and click `[Clock In]` on the top HUD bar.
2. **Economic Calendar Audit**:
   - Check the **Desk News Hazard Banner**.
   - If a Red/Tier-1 release is scheduled for 08:30 or 10:00 ET (e.g. CPI, Non-Farm Payrolls, FOMC, ISM), verify whether the desk is in `careful` or `stand_aside` mode.
3. **Build the Tier-1 Zone Map**:
   - Mark **Yesterday's Value Area**: VAH, POC, VAL, High, Low.
   - Mark **5-Day Rolling Volume Profile (5D FRVP)**: 5D POC, 5D HVN, 5D LVN.
   - Mark **Overnight Context**: Overnight High (ONH), Overnight Low (ONL), Overnight POC (ONPOC).
   - Combine nearby levels into **ZONES** (e.g., 20 pts on NQ, 40 pts on YM).
4. **Inspect Tier-3 Context (Inspection Modal)**:
   - Click `[5M AVWAP]` on the top HUD to inspect distance from the 5-Month Anchored VWAP and its $\pm1\sigma/\pm2\sigma$ bands.
   - Check the **Cross-Market Volatility Radar**: `VIX1D` for equities, `OVX` for crude, `GVZ` for gold.
5. **Check Account Capacity**:
   - Verify remaining Tradeify $50k DLL Room ($1,250 limit) and Floor Room ($48,000 baseline).
   - Verify Attempt Ladder: 0/3 trades used. Next Risk: **$400 (1R)**.

---

### Phase 2: Cash Open & The Freeze Map Rule (09:30 ET)
1. **FREEZE THE MAP**:
   - At 09:30:00 ET sharp, the map is locked permanently.
   - **Do NOT invent new levels mid-session.** If price consolidates in the middle of nowhere, **IGNORE IT**.
2. **Identify Dalton Opening Activity**:
   - Monitor the first two 5-minute bars (09:30–09:40 ET):
     - `OPEN_DRIVE`: Immediate aggressive one-directional initiative.
     - `OPEN_TEST_DRIVE`: Quick test of Yesterday extreme followed by sharp reversal drive.
     - `OPEN_REJECTION_REVERSE`: Failed drive into key zone, reversed violently through open.
     - `OPEN_AUCTION`: Chopping inside yesterday's range.

---

### Phase 3: Trade Execution Windows (09:45 – 15:15 ET)
1. **OR15 Window (09:45 – 10:00 ET)**:
   - Evaluates high/low of first 15 minutes.
   - Triggers breakout stop if initiative volume confirms. (Max 2 probes).
2. **OR30 Window (10:00 – 10:30 ET)**:
   - Calculates 50% midpoint of the first 30 minutes.
   - Trades pullback retest to midpoint in direction of One-Time Framing (OTF). (Max 2 probes).
3. **Initial Balance (IB) Window (10:30 – 15:15 ET)**:
   - Initial Balance high and low established by the first 60 minutes (09:30–10:30 ET).
   - Fades extremes if POC rejects expansion; trades breakout retest if initiative volume confirms.
4. **Enforce the 8-Step Screen Reading Sequence**:
   - Before taking ANY fill: `LOCATION` $\rightarrow$ `REACTION` $\rightarrow$ `RESULT` $\rightarrow$ `CVD + VOLUME` $\rightarrow$ `TRIGGER` $\rightarrow$ `RISK` $\rightarrow$ `2R ROOM` $\rightarrow$ `ENTER`.
5. **Enforce Sizing Progression**:
   - Fill #1: **$400 Risk**
   - Fill #2: **$250 Risk**
   - Fill #3: **$150 Risk**
   - After Fill #3: **DESK LOCKS PERMANENTLY FOR THE DAY**.

---

### Phase 4: Lunch Doldrums & Management (11:30 – 13:30 ET)
1. **Manage Only**: Stand aside on new trade entries unless a rare Grade-A setup forms at a Tier-1 extreme.
2. **Value Acceptance Monitoring**:
   - If an open position has lingered within $\pm0.3R$ of entry for $> 15\text{ minutes}$, heed the alert: *"Price is building value at entry — not confirming."* Consider flattening early at breakeven.

---

### Phase 5: Cash Close Hard Flatten Protocol (16:55 – 16:59 ET)
1. **16:55 ET**: Warning chime sounds. Prepare to flatten all open risk.
2. **16:59:00 ET**: **MANDATORY HARD FLATTEN DEADLINE**.
   - Liquidate all active market positions.
   - Cancel all pending working limit orders.
   - Never hold futures contracts into the 17:00–18:00 ET CME maintenance halt.
   - *(Holiday sessions: Hard flatten cutoff is 12:59:00 ET).*

---

### Phase 6: Post-Session Journaling & Ledger Reconcile (17:00 ET)
1. Verify Supabase `trades_journal` records match broker statements.
2. Note Dalton Day Type (`NORMAL_VARIATION`, `TREND_DAY`, `DOUBLE_DISTRIBUTION`).
3. Log emotional discipline score and any trade mistakes.

---

## 3. Web Audio Synthesis Index & Chime Frequencies

The workstation synthesizes low-latency dual-tone chimes using the browser's native **Web Audio API**:

| Sound Event | Primary Tone | Harmonic Tone | Waveform | Duration | Purpose / Meaning |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Setup Alert** | **880 Hz** (A5) | **1320 Hz** (E6) | Sine Wave | 250 ms | High-conviction Tier-1 setup triggering at key level. |
| **Level Touch** | **659 Hz** (E5) | **987 Hz** (B5) | Sine Wave | 180 ms | Live price interacting with pre-marked zone. |
| **Take Profit Fill** | **523 Hz** (C5) | **1046 Hz** (C6) | Triangle | 400 ms | Trade reached $\ge 2.0\text{R}$ target successfully. |
| **Stop Loss Invalidation**| **220 Hz** (A3) | **165 Hz** (E3) | Sawtooth | 350 ms | Structural invalidation hit; cut loss immediately. |
| **Flatten Cutoff Warning**| **440 Hz** (A4) | Pulsed 8 Hz | Square | 1000 ms | 16:55 ET approaching; mandatory flatten imminent. |

---

## 4. Emergency Troubleshooting & Fallback Procedures

```
┌──────────────────────────────────────┬─────────────────────────────────────────────────┐
│ System Anomaly                       │ Immediate Corrective Action                     │
├──────────────────────────────────────┼─────────────────────────────────────────────────┤
│ **Databento CME Feed Disconnects**   │ System auto-switches to Yahoo Finance streaming.│
│                                      │ If chart freezes, click [Refresh Feeds] on HUD. │
│ **Broker API Order Rejection**       │ Check Tick Snapping: ensure price is on legal   │
│                                      │ tick increment (0.25 NQ, 1.0 YM, 0.10 GC).      │
│ **Accidental Stop Widening Urge**    │ REMEMBER RULE 19: Invalidation is final. Never  │
│                                      │ turn -1R into -3R. Close position immediately. │
│ **High-Impact News Spike**           │ Do not chase initial spike candle. Wait for     │
│                                      │ reaction candle close and reclaim of Tier-1 zone│
│ **DLL Approaching (-$1,000 loss)**   │ Reduce next trade size to $150 or lock desk.    │
└──────────────────────────────────────┴─────────────────────────────────────────────────┘
```
