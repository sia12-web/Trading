# PRD: Systematic NY Desk + Directional Performance

**Status:** Slices 1–8 DONE. Slice 9 IN PROGRESS (engine stub on disk, not wired).
**Source:** Scout grill 2026-08-26 (directional performance pp. 157–177 + desk cut) + Scout grill 2026-08-26 (Bracket pp. 183–198 + Corrective action pp. 225–235)
**Instruments:** DOW · NASDAQ · GOLD · CRUDE only

---

## Problem Statement

The desk already answers Dalton’s Big Question 1 — which way the market is *attempting* (Open type, Control RF + dPOC, CALL). It does not honestly answer Big Question 2 — *is that attempt facilitating trade?* Volume in `evaluateDirectionalPerformanceMatrix` is hardcoded `HIGHER`, so every day can look strong, and every ticket stays 1.5R anyway. Meanwhile the chart is not a systematic engine: Leo, AI Level Finder, Highlight Time drawings, Regular CALL (any painted ±10), Simulation, and Nikkei sit beside the real ticket. Direction without facilitation is the April 15 bonds trap. Chatter beside the ticket is how fills leave the playbook.

## Proposed Solution

One live NY desk, four names, no models. Clock in → lock instrument → the engine hunts CALL-legal ±10 on the active range. Banner row is **Open · Ctrl · Call · Perf · Region**. Perf grades facilitation from attempted direction × developing 70% TPO value area vs yesterday NY cash VA × conviction (elapsed-matched cash volume if a real feed exists, else VA width). Region is the longer-term auction body (composite 70% TPO of last 5 completed NY cash days): **BRACKET vs TREND** + location **high / mid / low**. Advise only — Region does not pick CALL side. Better risk/reward in MVP means **skipping WEAK/UNCLEAR hunts after OR30 VA exists**, and **first legal hunt only** when BRACKET · mid after Open range. Not stretching 1.5R. Stops, 1.5R, $400→$250→$150, lunch flatten, 3 fills, and +$700 green lock stay. Perf/Control against an open book prints **LEAVE** on the manage bar. A sell-off (or rally) that still keeps value with the attempt is **HOLD** (disguised correction). Neither auto-flattens.

Strip Leo/live voice, AI Level Finder, AI-exit LLM, Highlight Time + saved highlights, the CALL-vs-regular picker (always CALL ON), Simulation (replay, journal sim tab, Sim buttons), and Nikkei from the live product.

## User Stories

- ✅ MVP: As the trader, I want only DOW / NASDAQ / GOLD / CRUDE on the live desk, so that Nikkei and Simulation cannot take a fill.
- ✅ MVP: As the trader, I clock in and the desk is always CALL ON, so that tickets only print on CALL-legal ±10.
- ✅ MVP: As the trader, I see Open · Ctrl · Call · Perf on one banner, so that attempt and facilitation are both visible without a voice.
- ✅ MVP: As the trader, I want Perf WEAK/UNCLEAR (after OR30 VA) to force CALL WAIT, so that I do not hunt attempts that are not facilitating.
- ✅ MVP: As the trader, I still get a Drive CALL in Open range before Perf can veto, so that one-timeframe opens are not skipped while VA is still narrow.
- ✅ MVP: As the trader, I keep 1.5R and the dollar ladder, so that facilitation changes *whether* I hunt, not ticket geometry.
- ✅ MVP: As the trader, I see LEAVE on the manage bar when Perf/Control say the attempt failed, without an extra auto-flatten.
- ✅ MVP: As the trader, I no longer see Leo, Level Finder cards, Highlight Time, Regular CALL, or Simulation.
- ✅ MVP: As the trader, I see a Region chip (`BRACKET · mid` / `TREND · with`) and dashed Rg H / Rg L, so that I know whether today is still inside the 5-day body.
- ✅ MVP: As the trader, after Open range, mid-bracket plus one legal hunt already used forces CALL WAIT (do not add), so that I do not scale in the middle of a two-timeframe region.
- ✅ MVP: As the trader, a poke outside the body that is not accepted stays BRACKET (REJECTED) — no reverse ticket.
- ✅ MVP: As the trader, a filled book that sells off with higher / overlapping-high value while Control is still with me prints HOLD, not LEAVE.
- 📦 PHASE 2: Full 30-row Table 4.1 labels on the LTAR recap.
- 📦 PHASE 2: Auto-stretch TP only on VERY STRONG + Control ONE-TF same side.
- 📦 PHASE 2: CME session volume as primary conviction if Architect later confirms a real feed (MVP may be width-only).

## Technical Decisions

**Stack:** Existing Next.js 14, TypeScript, Supabase, Tradovate/Tradeify live ticket. No new LLM provider. No new agent.

**Services:** Live futures data already on the desk (CME 5m for Control/Open). Architect decides per Slice 6 whether a real cash-session volume series exists; if not, VA width is the only conviction vote and UNCLEAR cannot print (UNCLEAR requires higher volume against value).

**Integrations:** Tradovate/Tradeify place from CALL + legal ±10. OANDA tick counts are **not** volume (existing `rangeBreakSignals` rule).

**Data:** Developing Perf is ephemeral (computed from closed letters + yesterday profile), same pattern as Control. Optional quiet LTAR row after cash close (reuse `ltarStore` if it fits; no trader worksheet). No new “AI conversation” tables.

**Ticket invariants (do not change in any slice):**
- SL beyond active range edge (or zone floor)
- TP = 1.5R
- Risk $400 → $250 → $150
- Entry only CALL-legal ±10 of active range H/L (LONG below low, SHORT above high)
- Magnets / yesterday band advise only; they do not set initial TP
- `computeDynamicRiskReward` must **not** invent 15m/30m “buy the floor” fills

## Data Model Overview

- **No required new table for MVP chip + gate.** Perf is derived like Control (`marketControl.ts`) from 5m desk bars + `computeYesterdayProfile`.
- **Reuse / fix:** `HTFDirectionalPerformanceGrade` in `htfSpecialist.ts` — add `UNCLEAR`, stop hardcoding `volumeRel = 'HIGHER'`, stop using that grade to change ticket R.
- **Optional persist:** `ltarStore` session recap (attempted dir, grade, volumeRel, vaPlacement, vaWidth, expectedResults). Architect confirms whether to keep or slim.
- **Attendance:** `desk_attendance.morning_journal.use_call` — MVP always `true`; remove the unset/regular branch.
- **Strip from live types/UI:** `NIKKEI` as a live instrument; sim call-mode sessionStorage; live-voice client; Level Finder chart cards.

Architect designs schema **per slice**, not all upfront.

## Key Screens / Flows

1. **Chart desk (only trader screen for this PRD)** — NY cash. Instrument switcher: four names. Banner: Open · Ctrl · Call · Perf · Region. Dashed Rg H / Rg L = 5-day 70% TPO body (not IB, not yesterday VA). No Leo, no level cards, no Highlight Time tool, no CALL/regular picker, no Simulation link.
2. **Clock-in** — instrument lock, 3-fill ladder shared across the four names. Immediately CALL ON.
3. **Flat / hunt** — CALL LONG/SHORT hunts legal ±10. CALL WAIT if Control not ONE-TF (existing), or Perf WEAK/UNCLEAR after OR30 VA exists (new).
4. **Open range (~first 10–20m)** — Perf chip may show WAIT (not enough letters). Drive/Test-Drive may still CALL. Perf does **not** veto until OR30 developing VA exists (~two 10m letters).
5. **Filled** — manage bar: value-acceptance text + Perf grade. LEAVE if WEAK/UNCLEAR or Control against the book. HOLD if value/Control still with the book (disguised correction). No LLM exit. Existing flatten jobs unchanged.
6. **Cash close** — optional quiet LTAR log. Not a modal.

## What's OUT of Scope

- ❌ Leo / live voice / any LLM on the desk
- ❌ AI Level Finder cards and click-to-fill from levels
- ❌ AI-exit model (pullback vs reversal from the model)
- ❌ Highlight Time drawing tool and saved highlights
- ❌ Regular CALL (any painted playbook ±10)
- ❌ Simulation product (`/dashboard/simulation`, replay desk, journal `?tab=sim`)
- ❌ Nikkei / Tokyo cash path
- ❌ Changing 1.5R, dollar ladder, or ±10 geometry
- ❌ Auto-flatten from Perf or Region
- ❌ Region as a fifth CALL side, fade against Control, or 15m “buy the floor”
- ❌ Treating IB or yesterday VA as the long-term bracket
- ❌ Auto-stretch TP (Phase 2)
- ❌ Full 30-row live chip labels (Phase 2)
- ❌ 15m/30m preferred entry locations from `computeDynamicRiskReward`
- ❌ New markets (Russell, Euro, Silver, etc.)

## Success Metrics

- 20 sessions: hunts blocked as WEAK/UNCLEAR should show value **not** migrating with the attempt after the fact (or volume/width below average). If those skipped days would have been clean 1.5R winners, loosen the gate (Slowing stays hunt-ok; only Weak/Unclear block).
- Zero live fills from Level Finder, Highlight Time, Regular ±10, Simulation, or Nikkei.
- Open-range Drive fills still occur (Perf did not veto before OR30 VA).
- Ticket on every fill: 1.5R, ladder dollars, CALL-legal band only.

## Open Questions (Architect, not product)

- Real CME/index volume on 5m desk bars for the four names, or width-only MVP?
- Delete live-voice API routes vs hide UI only? **Product: trader must not see or trigger Leo.** Prefer delete chart wiring; dead API routes can go in the same slice if small.
- Keep `NIKKEI` in internal unions for tests vs purge? **Product: not on live desk.** Prefer purge live paths; leftover types only if tests would explode — Architect calls it per slice.
- Slim vs keep `htfSpecialist` stand-aside / special situations? **Product this PRD: Perf + CALL. Do not expand HTF special situations.** Stand-aside that already blocks Regular should block CALL hunts if it is already live; do not build new HTF setups.

## Perf grade contract (MVP)

Chip values: `WAIT` · `VERY STRONG` · `STRONG` · `SLOWING` · `BALANCING` · `WEAK` · `UNCLEAR`  
Optional side suffix: `· buyer` / `· seller` = **who is doing the good job** (other-TF can disagree with Control; CALL side does not flip from Perf).

| Grade | New hunt | Open book |
|---|---|---|
| VERY STRONG / STRONG | CALL may hunt | Hold. No TP stretch. |
| SLOWING | CALL may hunt | Scratch if value-acceptance `looking_accepted`. |
| BALANCING | First legal hunt only | Do not add. |
| WEAK | CALL WAIT **after OR30 VA exists** | LEAVE (banner). |
| UNCLEAR | CALL WAIT **after OR30 VA exists** | LEAVE (banner). |
| PERF WAIT | No veto | — |

Placement: today’s developing 70% TPO VA (Control letters) vs yesterday NY cash VAH/VAL.  
Conviction: elapsed-matched volume vs same clock yesterday, else VA width vs last 20 completed cash VA widths. Width upgrades STRONG↔VERY STRONG or STRONG↔SLOWING only; it does not override Higher/Lower placement.  
TWO-TF Control → Perf BALANCING, stop.  
Same NY 09:30 ET clock for all four instruments.

## Scout alignment (locked)

- Filter-first R:R; ticket stays 1.5R
- Other-timeframe named on Perf chip; CALL side stays with Control
- OANDA ticks are not volume
- Always CALL ON; legal ±10 keep; Highlight Time go
- Live Tradovate/Tradeify only
- LEAVE is banner-only
- No Leo sentence — chip + CALL WAIT *are* the sentence

## Slice 9 — Bracket + Corrective Action (locked Scout)

Advise only. Does not flip CALL. Does not stretch 1.5R. Does not auto-flatten. Does not restore Leo / Highlight Time / Sim.

**Region ≠ IB ≠ Yday VA.** MVP body = composite 70% TPO of last **5 completed NY cash days** (same 09:30 ET clock for all four names). Paint **dashed Rg H / Rg L = VAH / VAL of that body (not tails)**. Chip: `TREND · with` vs `BRACKET · high|mid|low`. Stays BRACKET until **today’s developing 70% VA is fully outside** the old body (acceptance). A poke is **REJECTED**, not a reverse ticket. Open-range Drive still CALL on a breakout morning (no morning veto from region).

**First legal hunt only** (like Perf BALANCING / do not add): `playbookMode !== 'morning'` AND location is mid AND `attemptsUsed >= 1` → CALL WAIT. Morning/Open range is sacred. If Perf already WEAK/UNCLEAR after OR30 VA, that WAIT wins — one stacked gate, not two sides.

**Extreme + CALL** = hunt as today. Extreme against CALL = still CALL’s side; chip explains poor location; Perf/LEAVE handle failure.

**Corrective action:** manage bar + quiet LTAR sentence, **not a fifth chip, not a new Perf grade**. Sell-off with **higher / overlapping-high value** + Control still with the book → **HOLD** (`correction with value`). LEAVE only when value/Control **against** the book. GOLD/CRUDE: width/TPO only (no fake volume). UNCLEAR still requires higher volume.

### Builder handoff (Slice 9) — start here in a fresh session

**Already on disk (stub — review, do not rewrite from scratch):**
- `lib/trading/longTermBracket.ts` — `computeLongTermRegion`, `deskRegionBadgeText`, `longTermRegionLineSpecs` (`Rg H` / `Rg L`), `disguisedCorrectionHold`.

**Fix before wiring:** `disguisedCorrectionHold` currently treats empty `placement` as WITH-value (`place === ''`). That is too loose. HOLD only when placement is `HIGHER` or `OL_HIGH` (long) / `LOWER` or `OL_LOW` (short), Control is not against the book, and `leaveBook` is false. Empty placement → no HOLD claim.

**Wire (do not change ticket geometry):**
1. `lib/trading/deskCall.ts` — import `DeskPlaybookMode` (currently used, missing import). Attach region fields on `DeskCall` (`regionBadge`, `regionMode`, `regionLocation`, `regionHigh`/`regionLow`, `firstLegalOnly`, `regionPlayLine`, `perfPlacement`). Pass `attemptsUsed` into `computeDeskCall`. Compute region even on WAIT so dashed lines can paint. After Perf veto, apply mid-bracket first-legal WAIT. Hover: region line + first-legal BLOCK only when it is the gate (Perf BLOCK wins if both).
2. `app/dashboard/chart/components/TradingChart.tsx` — chip after Perf; always-on dashed `Rg H`/`Rg L` (not a toggle); reset lines + badge on instrument switch; pass `attemptsUsed` into both `computeDeskCall` call sites (~1931 and ~2640). Extend `onDeskPerf` with `correctionHold`, `perfPlacement`, region play line.
3. `ManageDeskBar.tsx` + `chart/page.tsx` — HOLD copy when disguised correction; do not override LEAVE. Quiet LTAR (`persistQuietDeskPerfLtar` in `paintDeskCall`) may append the HOLD/region sentence; pass real `placement` (today it is hardcoded `null`).
4. `lib/trading/manageOpenBook.ts` — optional `correctionHold` factor; must not flip `perfLeave` to true.

**Tests:**
- New `__tests__/long_term_bracket.test.ts` — not enough days → WAIT; 5 days mid → BRACKET · mid; poke not accepted → REJECTED not TREND; today’s VA fully outside → TREND; `disguisedCorrectionHold` true only with value-with + Control-with, false when `leaveBook`.
- `__tests__/desk_call.test.ts` — morning Drive not blocked by bracket even with mid + `attemptsUsed >= 1`; after morning, mid + `attemptsUsed >= 1` → WAIT; existing WEAK-after-OR30 and Drive-before-OR30 tests still pass.
- `__tests__/sentinel_desk_call_overlay.test.ts` — Region chip after Perf; `Rg H` / `Rg L`; chip is not `onClick`.
- `__tests__/manage_signals.test.ts` — disguised correction does not set `leaveBook` / does not print LEAVE over HOLD.

**Run:** `npx tsx __tests__/long_term_bracket.test.ts` then `desk_call`, `directional_performance`, `sentinel_desk_call_overlay`, `manage_signals`. Do not commit or deploy unless asked. Verify UI in browser if tools exist; otherwise say what could not be verified.

**Do not:** change 1.5R, ±10, ladder, CALL side from Control/Drive; auto-fade bracket extremes; auto-flatten; new LLM; restore Leo/Highlight/Sim; treat IB as the long-term bracket.

---

## Kanban (vertical slices)

Slices 1–8 DONE. Slice 9 IN PROGRESS (engine stub only).

1. Always CALL ON — DONE
2. Remove Highlight Time — DONE
3. Remove Leo / live voice from chart — DONE
4. Remove Level Finder + AI-exit from desk — DONE
5. Remove SIM + Nikkei from live product — DONE
6. Perf chip (compute + banner, advise only) — DONE
7. Perf WAIT gate after OR30 VA — DONE
8. Open-book LEAVE + quiet LTAR log — DONE
9. Region chip + dashed H/L + first-legal mid WAIT + HOLD (disguised correction) — IN PROGRESS (engine stub)
10. Special Situations Sit chip (Gaps / Spikes / 3-to-1 next-open) — BUILD NOW

## Slice 10 — Special Situations (locked Scout 2026-08-27)

Advise only. **Never a CALL WAIT gate.** One `Sit` chip. No overnight hold. No live 94% odds. Do not restore HTF `computeSpecialSituations` / `targetMultiplier` on the live desk.

**Yesterday** = last completed NY cash day (same as Yday chip: YH/YL + 70% TPO VAH/VAL). Gap vs **YH/YL**. VA-rule vs **VAH/VAL**. 3-to-1 “better than value” vs **VA**. Balance breakout = Region TREND (Sit `BAL · with` only if Region is already TREND; else NONE). Do not block Sit on Slice 9.

**Priority (one name):** Gap → Spike → 3:1/NEUT (next-open, first ~90m) → VA-rule → BAL.

**Gap:** cash open outside YH/YL. `hold` while price has not traded through the gapped-away extreme. `test` if auctioning back toward the edge. `dead` when the gap is erased (p. 262). First hour is hover, not a timer that changes CALL.

**Spike:** last **two 30m TPO letters** of yesterday; extension ≥ ~40% of day range. Today’s open **in / beyond (with) / opposite base (rej)**. Optional dashed `Sp H` / `Sp L`.

**3-to-1:** scored on the **completed** cash day (quiet LTAR + next morning): initiative tail + TPO count + IB range extension, same direction. Chip until ~90m or until Gap/Spike/VA/BAL takes priority. 2I-to-1R is not 3-to-1.

**Neutral-extreme:** yesterday RE both sides of IB + close in top/bottom 20% of day range. Same 90m window.

**VA-rule:** open outside yday VA + two closed 30m letters inside VA = `VA · thru` **advise**. No fade against CALL.

**Manage:** gap holding with the book → HOLD sentence. Gap dead / spike reject → sentence only; LEAVE still only from Perf/Control. Ticket stays 1.5R.

**GOLD/CRUDE:** same 09:30 ET clock, TPO/price only.

**Phase 2:** News-inventory days, sentiment table (auction × news × day direction), long-term nontrend, crude ±10 rescale, break-away vs exhaustion gap types.

### Slice 11: Markets to stay out of + 20-day A/B — BUILD
**Dependencies:** Slices 6–10 (CALL, Perf, Region, Sit). Scout 2026-08-27 (Dalton pp. 265–267).
**Type:** AFK

**Testable outcome:** `OUT · NTREND` / `OUT · NCONV` chip. That name CALL WAITs for the rest of the NY day after OR30. Morning Drive still hunts. Open tickets stay 1.5R. Yahoo 5m 20-session A/B (baseline vs stay-out) with computed numbers only. Headline = DOW+NASDAQ+GOLD.

**Acceptance criteria:**
- [ ] Per-name gate, not board lock, not clock-out
- [ ] NTREND: today range ≤ 10-day 25th percentile AND elapsed volume LOWER; earliest OR30
- [ ] NCONV: Open-Auction + IN_VALUE + Control not ONE-TF + still inside yVA; OR30+
- [ ] Morning (`playbookMode === morning`) never stay-out
- [ ] No new chart lines, no telegram
- [ ] Gate ships only if three-name E[R] does not drop more than 0.1R vs baseline on that tape
- [ ] Ticket stays 1.5R, ±10, $400→$250→$150

### Slice 9: Region + corrective HOLD — IN PROGRESS
**Dependencies:** Slices 6–8 (Perf chip, WAIT gate, manage LEAVE)
**Type:** AFK

**Testable outcome:** Banner shows Region after Perf. Chart paints dashed Rg H / Rg L. Mid-bracket after Open range with a used hunt → CALL WAIT. Filled book with value still with the attempt → HOLD, not LEAVE.

**Acceptance criteria:**
- [ ] Region chip: `WAIT` / `BRACKET · high|mid|low` / `TREND · with`
- [ ] Dashed Rg H / Rg L = 5-day 70% TPO body, reset on instrument switch
- [ ] Morning Drive still CALL (region does not veto Open range)
- [ ] After morning, BRACKET · mid + `attemptsUsed >= 1` → CALL WAIT
- [ ] Perf WEAK/UNCLEAR WAIT wins if both gates fire
- [ ] Poke outside body without accepted VA stays BRACKET (no reverse ticket)
- [ ] HOLD on manage bar for disguised correction; LEAVE still wins when Perf/Control against
- [ ] Ticket stays 1.5R, ±10, $400→$250→$150

### Slice 10: Sit chip — BUILD
**Dependencies:** Slice 6 (Perf chip pattern). Not blocked by Slice 9.
**Type:** AFK

**Testable outcome:** Sit chip after Perf. Optional dashed Sp H/L. Gap/Spike/3:1 never flip CALL. Manage HOLD when gap holds; LEAVE still Perf-only.

**Acceptance criteria:**
- [ ] One Sit chip; never onClick; never CALL WAIT from Sit
- [ ] Gap vs yday YH/YL; dead when erased
- [ ] Spike from last two 30m letters; Sp H/L dashed
- [ ] 3:1 / NEUT next-open only until ~90m
- [ ] VA · thru does not fade CALL
- [ ] No 94% / no HTF situation chip
- [ ] Ticket stays 1.5R

### Slice 12: Session STAY/EXIT (open book) — BUILD
**Dependencies:** Slice 8 (manage LEAVE), Slice 10 (sit HOLD). Scout 2026-08-27 Rounds 1–3.
**Type:** AFK

**Testable outcome:** Filled NY/Asia book shows one manage-bar word **STAY** or **EXIT**. Trader confirms. Stop / 1.5R / cash-close flatten unchanged. No new chip. Out stays entry-only.

**Rules:**
- Clock starts at fill. Arm = 30m in the trade **and** (OR30 locked **or** Asia book). IB fills arm at 30m.
- R vs stop distance (not points / not $). Closed 5m bars + live tip for “now.”
- Expanding green (new MFE, R > 0) → always STAY.
- Stalled EXIT: armed, no new MFE for 15m, current R ≤ +0.3R.
- Red EXIT: armed, minutes red > green, red now.
- NY lunch 11:30: EXIT if R < +0.5R (or ≥ +0.5R but MFE not expanding). Asia: no lunch wall; flatten wall = Asia 10:25 Montreal; last 20m same.
- Last 20m to flatten: EXIT unless R ≥ +0.8R.
- Current R ≤ −0.7R: clock suppressed (stop owns). Perf LEAVE can still EXIT.
- Sticky EXIT until flatten/SL/TP; one un-stick on a new MFE after EXIT.
- Clock wins vs Drive after arm. Sit HOLD cannot override EXIT. Working limit: no line.
- Advise only — never auto-flatten.

**Acceptance criteria:**
- [ ] Manage bar: `STAY · …` / `EXIT · stalled|red|lunch|last 20m|Perf`
- [ ] Sit HOLD hidden when EXIT
- [ ] No auto-flatten, no Telegram, no new chart paint, no day-lock
- [ ] Ticket stays 1.5R, ±10, $400→$250→$150
- [ ] Unit tests: arm, stall, red clock, lunch, last 20m, stop-owns, expanding, sticky unstick, Asia walls

