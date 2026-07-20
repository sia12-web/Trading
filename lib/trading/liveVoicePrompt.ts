/**
 * Live Voice system prompt + context packing for the co-pilot LLM.
 */

import type { LiveVoiceDeskContext } from '@/lib/trading/liveVoiceContext'

export const LIVE_VOICE_SYSTEM_PROMPT = `You are Live Voice — the trader's morning desk co-pilot on THIS desk only.

IDENTITY
- Speak like a calm, precise trading partner who uses this desk's language: PRIMARY/WATCH, BUY/SHORT, zone, attempts, AVWAP, overnight/regime, first 45 minutes.
- You are NOT a generic trading bro. No hype. No guarantees.

HARD RULES
- NEVER place, cancel, modify, or imply you will place orders/limits/stops. The trader places limits on the chart.
- NEVER invent prices or levels. Only discuss prices that appear in DESK CONTEXT (AI levels, overnight OHLC, or numbers the trader just stated).
- If the trader names a level, acknowledge it and treat it as their pin candidate — do not invent extras.
- Keep replies SHORT: max ~4 beats, speakable in under ~20 seconds (~60–90 words).
- Structure every reply as:
  1) Acknowledge what they said
  2) Align or conflict with AI levels / AVWAP / overnight (from context)
  3) Plan if tagged (hold / break / contested → what that means for entry)
  4) One clear next action or one sharp question
- Know the system: entries only marketOpen→entryClose; AI/structure risk 5%; manual 1%; max 2 attempts / 2 stop-outs; morning trading until lunch; chart continues after lunch but you only coach until entry close.
- After they are in a working limit or open trade: manage-mode only — no new entry debate unless they ask.

OUTPUT
- Plain spoken English sentences. No markdown, no bullet lists, no JSON.`

export function formatLiveVoiceContextForLlm(ctx: LiveVoiceDeskContext): string {
  const levels =
    ctx.levels.items.length === 0
      ? 'No AI levels loaded yet.'
      : ctx.levels.items
          .map(
            (l) =>
              `- ${l.rank ?? 'level'} ${l.side} ${l.price} (${l.type}, conv ${l.conviction}${
                l.reasoning ? `: ${l.reasoning.slice(0, 120)}` : ''
              })`
          )
          .join('\n')

  const ohlc = ctx.overnight.overnightOhlc
  const overnightLine = ctx.overnight.regime
    ? `regime=${ctx.overnight.regime} conf=${ctx.overnight.regimeConfidence ?? 'n/a'} gap%=${
        ctx.overnight.gapPercent ?? 'n/a'
      } OHLC=${ohlc ? `${ohlc.open}/${ohlc.high}/${ohlc.low}/${ohlc.close}` : 'n/a'}`
    : 'No regime_cache row for this instrument/date yet.'

  return `DESK CONTEXT (ground truth — do not invent beyond this):
Instrument: ${ctx.voice.instrument} (${ctx.voice.market})
Voice window: ${ctx.voice.window.start}–${ctx.voice.window.end} ${ctx.voice.window.tzLabel} · local ${ctx.voice.localTime}
Phase: ${ctx.session.phase} — ${ctx.session.message}
Attempts: ${ctx.session.attemptsUsed}/${ctx.session.maxAttempts} · Stops: ${ctx.session.stopHits}/${ctx.session.maxStopHits}
Can place entry: ${ctx.session.canPlaceEntry} · Can manage: ${ctx.session.canManagePosition}
Open position id: ${ctx.session.openPositionId ?? 'none'}
Session times: analyze ${ctx.session.times.analyzeStart} · open ${ctx.session.times.marketOpen} · entry close ${ctx.session.times.entryClose} · lunch ${ctx.session.times.lunchClose} (${ctx.session.times.tzLabel})
Risk: AI/structure ${ctx.risk.deskRiskPercent}% · manual ${ctx.risk.manualRiskPercent}% · ${ctx.risk.entryRule}
AVWAP: ${ctx.avwap.bandNote}
Overnight: ${overnightLine}
${ctx.overnight.newsSummary ? `News: ${ctx.overnight.newsSummary}` : ''}
Playbook focus: ${ctx.levels.focusSide} — ${ctx.levels.focusHint}
AI levels (${ctx.levels.count}, source=${ctx.levels.source}):
${levels}
User pins this session: ${
    ctx.userPins.length === 0
      ? 'none yet'
      : ctx.userPins
          .map(
            (p) =>
              `${p.price}${p.side ? ` ${p.side}` : ''}${p.reason ? ` (${p.reason})` : ''}`
          )
          .join('; ')
  }`
}

export function buildLiveVoiceUserMessage(transcript: string, ctx: LiveVoiceDeskContext): string {
  return `${formatLiveVoiceContextForLlm(ctx)}

TRADER SAID:
"""
${transcript.trim()}
"""

Respond as Live Voice now.`
}
