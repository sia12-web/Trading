'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  parseLeoDirectives,
  type LeoChatContext,
  type LeoDataPoint,
  type LeoMessage,
  type LeoExecutionDirective,
} from '@/lib/ai/leoAssistant'
import { playTradingViewChime, primeAudioContext } from '@/lib/chart/soundEffects'
import { warningToast, successToast } from '@/lib/utils/toastUtils'
import type { TeamConsensusReport } from '@/lib/ai/stack/types'
import type { InstitutionalHedgingTelemetry } from '@/lib/ai/stack/models/institutionalHedgingModel'
import type { DayTypeEvaluation, MarketDayType } from '@/lib/chart/context55'
import { detectCandlestickPatterns, type Candle } from '@/lib/trading/candlestickPatterns'
import { isArmedRuleExpired, isNycSessionActive } from '@/lib/trading/sessionGate'
import { saveLongTermMemory, type LeoLongTermMemory } from '@/lib/trading/leoLongTermMemory'
import {
  formatRuleDate,
  listenToRuleUpdates,
  isEntrySituationRule,
  loadRulesForMarket,
  saveRulesForMarket,
  armMarketOneToOneSituation,
  addRule,
  updateRule,
  MARKET_DEFAULT_PARAMS,
  type MarketInstrument,
  type RuleConditionProgress,
} from '@/lib/trading/leoRules'
import {
  checkTrendlineBreakout,
  findInitiatingPoint,
  findBreakoutSwingAnchor,
  evaluateTrendBorningZone,
  detectFlagAndSecondaryBreakout,
  calculateDynamicTrendline,
  checkDynamicTrendlineExit,
  evaluateChopShield,
  resampleCandlesTo5M,
} from '@/lib/trading/trendlineStrategy'
import type { UserTrendline } from '@/lib/trading/userDrawings'

export interface ArmedDeskRule {
  id: string
  type: 'STAGNATION_TIMEOUT' | 'DESK_ALERT' | 'TELEGRAM_ALERT' | 'CONDITIONAL_ENTRY' | 'MARKET_SITUATION' | 'TRENDLINE_BREAKOUT_SYSTEMATIC'
  description: string
  userPrompt?: string
  instrument?: string
  direction?: 'LONG' | 'SHORT'
  targetReference?: string
  targetPrice?: number
  drawingId?: string
  drawingType?: 'TRENDLINE' | 'RANGE' | 'FRVP'
  lastEvaluatedBarTime?: number
  pattern?:
    | 'BULLISH_ENGULFING'
    | 'BEARISH_ENGULFING'
    | 'HAMMER'
    | 'INVERTED_HAMMER'
    | 'SHOOTING_STAR'
    | 'REJECTION_TAIL'
    | 'LEVEL_TOUCH'
    | 'TRENDLINE_BREAKOUT_5M'
    | string
  /** Chart timeframe user specified (e.g. '5', '15', '30'). null/undefined = any timeframe — Leo monitors all. */
  entryTimeframe?: string | null
  /** When true, Leo additionally requires CVD divergence at the level before triggering */
  cvdDivergence?: boolean
  stopLossMode?: 'BELOW_CANDLE_LOW' | 'ABOVE_CANDLE_HIGH' | 'FIXED_POINTS' | 'DOLLARS_50'
  stopLoss?: number
  takeProfitMode?: '1:1' | '1:2' | '1:3' | '1:5' | 'FIXED_POINTS'
  takeProfit?: number
  riskReward?: string
  size?: number
  maxMinutes?: number
  session?: string
  isLongTerm?: boolean
  requireHighVolume?: boolean
  requireConfidence?: boolean
  conditionProgress?: RuleConditionProgress
  trendlineId?: string
  conditions?: any
  borningZoneScore?: number
  borningZoneGrade?: string
  higherLowCount?: number
  dynamicSlope?: number
  dynamicExitArmed?: boolean
  createdAt: number
  createdDateFormatted?: string
  sessionDate?: string
  sessionTime?: string
  status: 'ARMED' | 'TRIGGERED' | 'EXECUTED' | 'SATISFIED' | 'CANCELLED' | 'EXPIRED'
  executedAt?: number
  executedPrice?: number
}

export interface LeoOrderResult {
  success: boolean
  message?: string
  error?: string
  position_id?: string
  order?: {
    instrument: string
    direction: 'LONG' | 'SHORT'
    price: number
    stopLoss: number
    profitTarget: number
    size?: number
    reason: string
  }
}

interface LeoAssistantPanelProps {
  context: LeoChatContext
  candles?: any[]
  isOpen?: boolean
  onToggleOpen?: () => void
  onClose?: () => void
  onSelectDataPoint?: (point: LeoDataPoint) => void
  externalAttachedPoints?: LeoDataPoint[]
  onClearExternalAttachedPoints?: () => void
  externalPrompt?: string | null
  onClearExternalPrompt?: () => void
  onClosePosition?: (reason: string) => Promise<boolean | void>
  onPlaceOrder?: (order: {
    instrument: string
    direction: 'LONG' | 'SHORT'
    price: number
    stopLoss: number
    profitTarget: number
    reason: string
    size?: number
  }) => Promise<LeoOrderResult>
  onOverrideDayType?: (evalResult: DayTypeEvaluation | null) => void
}

// Persistent in-memory session cache per instrument so switching charts retains each market's conversation
const leoHistoryByInstrument: Record<string, LeoMessage[]> = {}

function getWelcomeMessage(instrument: string): LeoMessage {
  return {
    id: `welcome-${instrument}`,
    role: 'assistant',
    content: `**Leo Online.** Institutional desk assistant calibrated to ${instrument}.\n\nMonitoring **Time & Sessions**, **Multi-Timeframe Money**, and **Auction Tails**.\n\nClick any arrow or reference directly on the chart, or speak hands-free via mic.`,
    timestamp: Date.now(),
  }
}

export function LeoAssistantPanel({
  context,
  candles,
  isOpen: controlledIsOpen,
  onToggleOpen,
  onClose,
  externalAttachedPoints,
  onClearExternalAttachedPoints,
  externalPrompt,
  onClearExternalPrompt,
  onClosePosition,
  onPlaceOrder,
  onOverrideDayType,
}: LeoAssistantPanelProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false)
  const isPanelOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen
  const candlesRef = useRef<any[]>(candles || [])

  useEffect(() => {
    candlesRef.current = candles || []
  }, [candles])

  const togglePanel = () => {
    if (onToggleOpen) {
      onToggleOpen()
    } else {
      setInternalIsOpen((prev) => !prev)
    }
  }

  const handleClose = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }
    if (onClose) {
      onClose()
    } else if (onToggleOpen) {
      onToggleOpen()
    } else {
      setInternalIsOpen(false)
    }
  }

  const [messages, setMessagesState] = useState<LeoMessage[]>(() => {
    return leoHistoryByInstrument[context.instrument]?.length
      ? leoHistoryByInstrument[context.instrument]!
      : [getWelcomeMessage(context.instrument)]
  })

  // Synchronize when the user switches tabs to a different instrument
  useEffect(() => {
    const existing = leoHistoryByInstrument[context.instrument]
    if (existing && existing.length > 0) {
      setMessagesState(existing)
    } else {
      const welcome = [getWelcomeMessage(context.instrument)]
      leoHistoryByInstrument[context.instrument] = welcome
      setMessagesState(welcome)
    }
    setAttachedPoints([])

    // Sync saved armed rules for this instrument from central manager & subscribe to cross-tab updates
    const syncRules = () => {
      if (typeof window !== 'undefined') {
        try {
          const rules = loadRulesForMarket(context.instrument as MarketInstrument)
          setArmedRulesState(rules as any)
        } catch {}
      }
    }
    syncRules()
    const unsubscribe = listenToRuleUpdates((market) => {
      if (!market || market === context.instrument) {
        syncRules()
      }
    })
    return () => {
      unsubscribe()
    }
  }, [context.instrument])

  const setMessages = (updater: LeoMessage[] | ((prev: LeoMessage[]) => LeoMessage[])) => {
    setMessagesState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      leoHistoryByInstrument[context.instrument] = next
      return next
    })
  }

  const [inputPrompt, setInputPrompt] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [attachedPoints, setAttachedPoints] = useState<LeoDataPoint[]>([])
  const [armedRules, setArmedRulesState] = useState<ArmedDeskRule[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      return loadRulesForMarket(context.instrument as MarketInstrument) as any
    } catch {}
    return []
  })

  const setArmedRules = (updater: ArmedDeskRule[] | ((prev: ArmedDeskRule[]) => ArmedDeskRule[])) => {
    setArmedRulesState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (typeof window !== 'undefined') {
        try {
          saveRulesForMarket(context.instrument as MarketInstrument, next as any)
        } catch {}
      }
      return next
    })
  }
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Prime Web Audio API AudioContext on first user interaction anywhere on the window
  useEffect(() => {
    const handleGesture = () => {
      primeAudioContext()
    }
    window.addEventListener('pointerdown', handleGesture, { passive: true })
    window.addEventListener('keydown', handleGesture, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', handleGesture)
      window.removeEventListener('keydown', handleGesture)
    }
  }, [])

  // Auto-resize textarea to fit multiline input dynamically up to max 130px
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const scrollH = textareaRef.current.scrollHeight
      const clamped = Math.min(Math.max(scrollH, 38), 130)
      textareaRef.current.style.height = `${clamped}px`
    }
  }, [inputPrompt])

  // Session playbook lifecycle window: Pre-market playbook valid until 09:15 ET; NYC live reaction testing after 09:15 ET
  const isPreSessionPlaybookWindow = (() => {
    try {
      const nyTime = new Date().toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      })
      const [hh, mm] = nyTime.split(':').map(Number)
      const nyDec = (hh || 0) + (mm || 0) / 60
      return nyDec < 9.25 // Before 09:15 AM ET
    } catch {
      return false
    }
  })()

  // Multi-Agent Stack (AI Stacked) State
  const [activeTab, setActiveTab] = useState<'CHAT' | 'AI_STACK'>('CHAT')
  const [teamReport, setTeamReport] = useState<TeamConsensusReport | null>(null)
  const [hedgingTelemetry, setHedgingTelemetry] = useState<InstitutionalHedgingTelemetry | null>(null)
  const [isLoadingTeam, setIsLoadingTeam] = useState(false)
  const [teamError, setTeamError] = useState<string | null>(null)

  const fetchAiTeamConsensus = async () => {
    setIsLoadingTeam(true)
    setTeamError(null)
    try {
      const res = await fetch('/api/trading/ai-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrument: context.instrument,
          livePrice: context.currentPrice,
          chartContext: context,
        }),
      })
      const data = await res.json()
      if (data.success && data.report) {
        setTeamReport(data.report)
        setHedgingTelemetry(data.telemetry)
      } else {
        setTeamError(data.error || 'Failed to synthesize team consensus')
      }
    } catch (e: any) {
      setTeamError(e?.message || 'Network error fetching team consensus')
    } finally {
      setIsLoadingTeam(false)
    }
  }

  // Refetch when switching instruments if AI Stack tab is active
  useEffect(() => {
    setTeamReport(null)
    setHedgingTelemetry(null)
    if (activeTab === 'AI_STACK') {
      fetchAiTeamConsensus()
    }
  }, [context.instrument, activeTab])

  // Voice state (Web Speech Recognition - Continuous Mode)
  const [isListening, setIsListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const recognitionRef = useRef<any>(null)
  const isListeningRef = useRef(false)
  const sessionBaseTranscriptRef = useRef('')
  const inputPromptRef = useRef('')
  const restartTimerRef = useRef<any>(null)
  const executingRuleIdsRef = useRef<Set<string>>(new Set())
  const activeAbortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    inputPromptRef.current = inputPrompt
  }, [inputPrompt])

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Sync external attached data points (clicked directly on chart arrows / canvas)
  useEffect(() => {
    if (externalAttachedPoints && externalAttachedPoints.length > 0) {
      setAttachedPoints((prev) => {
        const ids = new Set(prev.map((p) => p.id))
        const combined = [...prev]
        for (const p of externalAttachedPoints) {
          if (!ids.has(p.id)) {
            combined.push(p)
            ids.add(p.id)
          }
        }
        return combined
      })
      if (!isPanelOpen) {
        setInternalIsOpen(true)
      }
      onClearExternalAttachedPoints?.()
    }
  }, [externalAttachedPoints, isPanelOpen, onClearExternalAttachedPoints])

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  // Initialize Web Speech API for voice recognition (Continuous & Keep-Alive)
  useEffect(() => {
    if (typeof window === 'undefined') return

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    setSpeechSupported(true)
    const recog = new SpeechRecognition()
    recog.continuous = true
    recog.interimResults = true
    recog.lang = 'en-US'
    recog.maxAlternatives = 1

    recog.onresult = (event: any) => {
      let sessionTranscript = ''
      for (let i = 0; i < event.results.length; i++) {
        const item = event.results[i]
        if (item && item[0]) {
          sessionTranscript += item[0].transcript
        }
      }
      const base = sessionBaseTranscriptRef.current.trim()
      const combined = base ? `${base} ${sessionTranscript.trim()}` : sessionTranscript.trim()
      setInputPrompt(combined)
    }

    recog.onerror = (event: any) => {
      console.warn('[Leo Voice] Recognition event error:', event.error)
      // Do not stop for 'no-speech' — user simply paused to think, look at the chart, or breathe!
      if (event.error === 'no-speech') {
        return
      }
      // Fatal permission or device errors
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        isListeningRef.current = false
        setIsListening(false)
      }
    }

    recog.onend = () => {
      // If user still wants to listen, browser simply dropped due to silence/network timeout
      if (isListeningRef.current) {
        // Save whatever has been recognized so far as base for the next chunk
        sessionBaseTranscriptRef.current = inputPromptRef.current.trim()
        clearTimeout(restartTimerRef.current)
        restartTimerRef.current = setTimeout(() => {
          if (isListeningRef.current) {
            try {
              recog.start()
            } catch {
              // Ignore if already active
            }
          }
        }, 150)
      } else {
        setIsListening(false)
      }
    }

    recognitionRef.current = recog

    return () => {
      clearTimeout(restartTimerRef.current)
      isListeningRef.current = false
      try {
        recog.abort()
      } catch {}
    }
  }, [])

  // Start continuous voice recognition
  const startListening = () => {
    if (!recognitionRef.current) return
    clearTimeout(restartTimerRef.current)
    isListeningRef.current = true
    setIsListening(true)
    sessionBaseTranscriptRef.current = inputPromptRef.current.trim()
    try {
      recognitionRef.current.start()
    } catch (err) {
      console.warn('[Leo Voice] Start error:', err)
    }
  }

  // Stop continuous voice recognition
  const stopListening = () => {
    clearTimeout(restartTimerRef.current)
    isListeningRef.current = false
    setIsListening(false)
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        // Ignore stop errors
      }
    }
  }

  // Toggle voice recognition
  const toggleListening = () => {
    if (isListeningRef.current) {
      stopListening()
    } else {
      startListening()
    }
  }

  // Toggle attached data point
  const handleRemoveDataPoint = (pointId: string) => {
    setAttachedPoints((prev) => prev.filter((p) => p.id !== pointId))
  }

  // Speak text aloud using Web Speech Synthesis
  const speakText = (text: string) => {
    if (!ttsEnabled || typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    // Clean markdown, brackets, and execute tags for smooth speech
    const clean = text
      .replace(/<execute>[\s\S]*?<\/execute>/gi, '')
      .replace(/[*#`_>-]/g, ' ')
      .replace(/\[.*?\]/g, ' ')
      .slice(0, 280)
    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.rate = 1.05
    utterance.pitch = 1.0
    window.speechSynthesis.speak(utterance)
  }

  // Execute immediate position close
  const executeClosePosition = async (reason: string) => {
    try {
      if (onClosePosition) {
        await onClosePosition(reason)
      } else if (context.activePosition) {
        await fetch('/api/trading/positions/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            position_id: context.activePosition.positionId,
            instrument: context.activePosition.instrument,
            exit_price: context.currentPrice ?? context.activePosition.entryPrice,
            exit_reason: 'manual',
            exit_notes: reason,
          }),
        })
      }
      // Telegram notifications removed per desk protocol
    } catch (err) {
      console.error('[Leo] Close failed:', err)
    }
  }

  // Execute order placed by Leo with audio chime, speech, DB journal, and chart tracking
  const executePlaceOrder = async (order: {
    instrument: string
    direction: 'LONG' | 'SHORT'
    price: number
    stopLoss: number
    profitTarget: number
    size?: number
    reason: string
  }) => {
    // 0. Safety Parameter Validation Guard: Reject invalid / NaN / non-positive numbers
    if (
      !order.price ||
      !Number.isFinite(order.price) ||
      order.price <= 0 ||
      !Number.isFinite(order.stopLoss) ||
      order.stopLoss <= 0 ||
      !Number.isFinite(order.profitTarget) ||
      order.profitTarget <= 0
    ) {
      warningToast('⚠️ [LEO DESK ERROR]: Aborted order with invalid or non-finite price parameters.', 8000)
      return
    }

    // Directional Bracket Sanity Guard
    const dir = order.direction.toUpperCase() as 'LONG' | 'SHORT'
    let sl = order.stopLoss
    let tp = order.profitTarget
    const { slDist } = getInstrumentDefaultDistances(order.instrument)

    if (dir === 'LONG') {
      if (sl >= order.price) sl = Number((order.price - slDist).toFixed(2))
      if (tp <= order.price) tp = Number((order.price + slDist * 2.0).toFixed(2))
    } else {
      if (sl <= order.price) sl = Number((order.price + slDist).toFixed(2))
      if (tp >= order.price) tp = Number((order.price - slDist * 2.0).toFixed(2))
    }

    order.stopLoss = sl
    order.profitTarget = tp

    // 1. Audio notifications: TradingView procedural chime & speech synthesis
    playTradingViewChime()
    speakText(
      `Order placed: ${order.direction} ${order.instrument} at ${order.price.toLocaleString()}. Stop ${order.stopLoss.toLocaleString()}, target ${order.profitTarget.toLocaleString()}.`
    )

    // 2. Transmit to execution desk via onPlaceOrder prop or /api/trading/positions/open
    let success = false
    let errMsg = ''
    try {
      if (onPlaceOrder) {
        const res = await onPlaceOrder(order)
        success = res.success
        if (!success) errMsg = res.message || 'Desk rejected order'
      } else {
        const res = await fetch('/api/trading/positions/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instrument: order.instrument,
            entry_price: order.price,
            entry_direction: order.direction,
            entry_window: 1,
            account_size: 50000,
            regime: order.direction === 'LONG' ? 'bullish' : 'bearish',
            regime_confidence: 90,
            entry_source: 'ai',
            is_leo_order: true,
            stop_loss_price: order.stopLoss,
            profit_target_price: order.profitTarget,
            entry_reason: `Leo AI Order: ${order.direction} ${order.instrument} @ ${order.price}. ${order.reason}`,
            auction_ticket: true,
            risk_profile: 'tradeify_growth_50k',
          }),
        })
        const json = await res.json()
        success = res.ok && json.success
        if (!success) errMsg = json.message || 'Desk rejected order'
      }
    } catch (err: any) {
      errMsg = err?.message || 'Network error'
    }

    // 3. Append execution note card into chat
    const slPts = Math.abs(order.price - order.stopLoss).toFixed(1)
    const tpPts = Math.abs(order.profitTarget - order.price).toFixed(1)

    setMessages((prev) => [
      ...prev,
      {
        id: `exec-order-${Date.now()}`,
        role: 'assistant',
        content: success
          ? `### 🚀 **[LEO ORDER EXECUTED & JOURNALED]**
- **Instrument:** ${order.instrument}
- **Direction:** **${order.direction}**
- **Entry Price:** **${order.price.toLocaleString()}**
- **Stop Loss:** **${order.stopLoss.toLocaleString()}** (-${slPts} pts)
- **Profit Target:** **${order.profitTarget.toLocaleString()}** (+${tpPts} pts)
- **Execution Notes:** ${order.reason}
- **Order History:** ✅ Saved to database (\`trades_journal\`)
- **Live Chart:** ✅ Active position overlay mounted on chart. Tracking live price & P&L.

*(AI never auto-exits; only you can close or adjust brackets).*`
          : `⚠️ **[LEO ORDER NOTICE]**
Attempted to place **${order.direction} ${order.instrument}** at ${order.price.toLocaleString()}, but desk returned: ${errMsg}`,
        timestamp: Date.now(),
      },
    ])
  }

  // Dispatch a Desk alert (Plays chime, triggers top-right notification toast, posts in Leo chat & speaks)
  const dispatchDeskAlert = (rule: ArmedDeskRule) => {
    try {
      if (isArmedRuleExpired(rule)) return
      const curPrice = context.currentPrice ?? rule.targetPrice ?? 0

      // 1. Play authentic chime sound
      playTradingViewChime()

      // 2. Display desk notification toast at top-right of screen
      warningToast(
        `🔔 Desk Alert: Price reached ${rule.targetReference} @ ${curPrice.toFixed(2)} (${rule.session ?? 'Session'}) with high volume & confidence.`,
        9000
      )

      // 3. Post to Leo chat history
      setMessages((prev) => [
        ...prev,
        {
          id: `desk-alert-${Date.now()}`,
          role: 'assistant',
          content: `🔔 **[DESK ALERT FIRED]:** Alert triggered for **${rule.targetReference}** at **${curPrice.toFixed(2)}** in ${rule.session ?? 'Session'}.\n\nHigh volume & execution confidence criteria satisfied.`,
          timestamp: Date.now(),
        },
      ])

      // 4. Voice announcement
      speakText(`Desk alert fired for ${rule.targetReference}`)
    } catch (e) {
      console.error('[Leo] Desk alert dispatch failed:', e)
    }
  }

  // Canonicalize instrument symbols to desk standards
  const canonicalizeInstrument = (sym?: string): string => {
    if (!sym) return 'NASDAQ'
    const s = sym.toUpperCase().trim()
    if (s === 'NQ' || s === 'MNQ' || s.includes('NAS')) return 'NASDAQ'
    if (s === 'YM' || s === 'MYM' || s.includes('DOW')) return 'DOW'
    if (s === 'GC' || s === 'MGC' || s.includes('GOLD')) return 'GOLD'
    if (s === 'CL' || s === 'MCL' || s.includes('CRUDE') || s.includes('OIL')) return 'CRUDE'
    if (s === 'NKD' || s.includes('NIKKEI')) return 'NIKKEI'
    return s
  }

  // Get default protective bracket distances per instrument
  const getInstrumentDefaultDistances = (inst: string): { slDist: number; tpDist: number } => {
    switch (inst) {
      case 'DOW':
        return { slDist: 60, tpDist: 120 }
      case 'CRUDE':
        return { slDist: 0.5, tpDist: 1.0 }
      case 'GOLD':
        return { slDist: 5.0, tpDist: 10.0 }
      case 'NIKKEI':
        return { slDist: 100, tpDist: 200 }
      case 'NASDAQ':
      default:
        return { slDist: 25, tpDist: 50 }
    }
  }

  // Proximity tolerances, touch threshold, and risk multiplier per instrument
  const getInstrumentTolerances = (
    inst: string
  ): { proximity: number; touch: number; multiplier: number } => {
    switch (inst) {
      case 'DOW':
        return { proximity: 45.0, touch: 8.0, multiplier: 0.5 }
      case 'GOLD':
        return { proximity: 1.5, touch: 0.3, multiplier: 10.0 }
      case 'CRUDE':
        return { proximity: 0.25, touch: 0.05, multiplier: 100.0 }
      case 'NIKKEI':
        return { proximity: 50.0, touch: 10.0, multiplier: 1.0 }
      case 'NASDAQ':
      default:
        return { proximity: 15.0, touch: 3.0, multiplier: 2.0 }
    }
  }

  // Check if current time is inside Globex maintenance window (17:00–18:00 ET) where spreads blowout
  const isGlobexMaintenanceWindow = (): boolean => {
    try {
      const nyTime = new Date().toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      })
      const [hh, mm] = nyTime.split(':').map(Number)
      const nyDec = (hh || 0) + (mm || 0) / 60
      return nyDec >= 17.0 && nyDec < 18.0
    } catch {
      return false
    }
  }

  // Apply parsed directives
  const applyDirectives = (directives: LeoExecutionDirective[]) => {
    for (const d of directives) {
      if (d.action === 'CLOSE_POSITION') {
        // AI Safety Protocol: AI never auto-exits positions autonomously
        const reason = d.reason || 'Playbook target or stop condition met'
        const inst = canonicalizeInstrument(d.instrument || context.instrument)
        setMessages((prev) => [
          ...prev,
          {
            id: `advisory-exit-${Date.now()}`,
            role: 'assistant',
            content: `⚠️ **[LEO EXIT ADVISORY - MANUAL ACTION REQUIRED]**\n\nLeo recommends closing the **${context.activePosition?.instrument || inst}** position.\n\n- **Reason:** ${reason}\n- **Current Price:** ${context.currentPrice != null ? context.currentPrice.toLocaleString() : 'N/A'}\n- **Current P&L:** ${context.activePosition ? `${context.activePosition.unrealizedPnlPoints >= 0 ? '+' : ''}${context.activePosition.unrealizedPnlPoints.toFixed(1)} pts` : 'Flat'}\n\n*(Desk Safety Protocol: AI never auto-exits positions. Please use the Close/Flatten button on your chart toolbar if you wish to exit).*`,
            timestamp: Date.now(),
          },
        ])
        speakText(`Leo recommends closing position: ${reason}. Manual confirmation required.`)
      } else if (d.action === 'PLACE_ORDER' || d.action === 'OPEN_POSITION') {
        const inst = canonicalizeInstrument(d.instrument || context.instrument)
        const dir = (d.direction || 'LONG').toUpperCase() as 'LONG' | 'SHORT'
        const px = Number(d.price || context.currentPrice || 0)

        // Prevent order placement without a valid live price
        if (!px || px <= 0) {
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: 'assistant',
              content: `⚠️ **[LEO ORDER BLOCKED]**\nUnable to execute ${dir} on **${inst}** because live price is currently unavailable. Order aborted for risk safety.`,
              timestamp: Date.now(),
            },
          ])
          speakText(`Order blocked: live price unavailable for ${inst}`)
          continue
        }

        const { slDist, tpDist } = getInstrumentDefaultDistances(inst)
        let sl = d.stopLoss ? Number(d.stopLoss) : undefined
        let tp = d.profitTarget ? Number(d.profitTarget) : undefined

        // Validate and prevent bracket inversion
        if (dir === 'LONG') {
          if (!sl || sl >= px) {
            sl = Number((px - slDist).toFixed(2))
          }
          if (!tp || tp <= px) {
            tp = Number((px + tpDist).toFixed(2))
          }
        } else {
          // SHORT
          if (!sl || sl <= px) {
            sl = Number((px + slDist).toFixed(2))
          }
          if (!tp || tp >= px) {
            tp = Number((px - tpDist).toFixed(2))
          }
        }

        const reason = d.reason || 'Trader voice/chat command'
        void executePlaceOrder({
          instrument: inst,
          direction: dir,
          price: px,
          stopLoss: sl,
          profitTarget: tp,
          size: d.size ?? 1,
          reason,
        })
      } else if (d.action === 'ARM_CONDITIONAL_ENTRY' || d.action === 'ARM_LVN_BULL_ENG_RULE') {
        const inst = canonicalizeInstrument(d.instrument || context.instrument)
        const dir: 'LONG' | 'SHORT' = (d.direction || 'LONG').toUpperCase() as 'LONG' | 'SHORT'

        let targetPx = d.targetPrice && d.targetPrice > 0 ? d.targetPrice : undefined
        let targetRef = d.targetReference || 'Target Level'
        let drawingId: string | undefined
        let drawingType: 'TRENDLINE' | 'RANGE' | 'FRVP' | undefined

        if (attachedPoints.length > 0) {
          const pt = attachedPoints[0]!
          const num =
            typeof pt.value === 'number'
              ? pt.value
              : parseFloat(String(pt.value).replace(/[^0-9.]/g, ''))
          if (Number.isFinite(num) && num > 0 && !targetPx) {
            targetPx = num
            targetRef = pt.label || targetRef
          }
          if (pt.id.startsWith('user-tl-')) {
            drawingId = pt.id.replace('user-tl-', '')
            drawingType = 'TRENDLINE'
          } else if (pt.id.startsWith('user-range-')) {
            drawingId = pt.id.replace('user-range-', '')
            drawingType = 'RANGE'
          } else if (pt.id.startsWith('user-frvp-')) {
            drawingId = pt.id.replace('user-frvp-', '')
            drawingType = 'FRVP'
          }
        }

        if (!drawingId && context.userDrawings) {
          if (context.userDrawings.frvps.length > 0) {
            const f = context.userDrawings.frvps[0]!
            drawingId = f.id
            drawingType = 'FRVP'
            if (!targetPx) {
              targetPx = f.val
              targetRef = `Manual FRVP (${f.label || 'LVN'})`
            }
          } else if (context.userDrawings.trendlines.length > 0) {
            const t = context.userDrawings.trendlines[0]!
            drawingId = t.id
            drawingType = 'TRENDLINE'
            if (!targetPx) {
              targetPx = t.projectedPrice
              targetRef = `${t.label || 'Trendline'} Support`
            }
          } else if (context.userDrawings.ranges.length > 0) {
            const r = context.userDrawings.ranges[0]!
            drawingId = r.id
            drawingType = 'RANGE'
            if (!targetPx) {
              targetPx = dir === 'LONG' ? r.priceLow : r.priceHigh
              targetRef = `${r.label || 'Range'} Boundary`
            }
          }
        }

        if (!targetPx) {
          const defaultPrice =
            inst === 'DOW' ? 52500 : inst === 'GOLD' ? 4350 : inst === 'CRUDE' ? 104 : 29500
          targetPx = context.shortTermMoney?.yval ?? context.currentPrice ?? defaultPrice
        }

        const userSaid =
          d.userPrompt ||
          inputPromptRef.current ||
          `Monitor ${targetRef} and enter ${dir} on pattern confirmation`
        const pat = d.pattern || 'LEVEL_TOUCH'
        const slMode = d.stopLossMode || (dir === 'LONG' ? 'BELOW_CANDLE_LOW' : 'ABOVE_CANDLE_HIGH')
        const tpMode = d.takeProfitMode || '1:2'
        const size = d.size ?? 1
        const entryTf: string | null = (d as any).entryTimeframe ?? null   // null = any TF
        const cvdDiv: boolean = Boolean((d as any).cvdDivergence)

        const isLongTerm = Boolean((d as any).isLongTerm || (d as any).longTermMemory)
        const now = Date.now()
        const dateMeta = formatRuleDate(now)

        const tfLabel = entryTf ? ` on ${entryTf}m TF` : ''
        const cvdLabel = cvdDiv ? ' + CVD divergence' : ''
        const entryLabel =
          pat === 'LEVEL_TOUCH' ? 'price touch at level' : pat.replace(/_/g, ' ').toLowerCase()

        const newRule: ArmedDeskRule = {
          id: `rule-${now}`,
          type: 'CONDITIONAL_ENTRY',
          description:
            d.description ||
            `${dir} 1 ${inst} — ${entryLabel}${tfLabel}${cvdLabel} @ ${targetRef} (${targetPx.toLocaleString()})${isLongTerm ? ' [Long-Term Memory]' : ' [NYC Session]'}`,
          userPrompt: userSaid,
          instrument: inst,
          direction: dir,
          targetReference: targetRef,
          targetPrice: targetPx,
          drawingId,
          drawingType,
          pattern: pat,
          entryTimeframe: entryTf,
          cvdDivergence: cvdDiv,
          stopLossMode: slMode,
          stopLoss: d.stopLoss,
          takeProfitMode: tpMode,
          takeProfit: d.takeProfit,
          size,
          session: (d as any).session ?? 'NYC',
          isLongTerm,
          createdAt: now,
          createdDateFormatted: dateMeta.formatted,
          sessionDate: dateMeta.sessionDate,
          sessionTime: dateMeta.sessionTime,
          status: 'ARMED',
        }

        if ((pat as string) === 'TRENDLINE_BREAKOUT_5M') {
          newRule.type = 'TRENDLINE_BREAKOUT_SYSTEMATIC'
          newRule.trendlineId = drawingId
          newRule.conditions = {
            trendlineId: drawingId,
            pattern: 'TRENDLINE_BREAKOUT_5M',
            stopLossMode: 'BELOW_CANDLE_LOW',
            takeProfitMode: 'FIXED_POINTS',
            takeProfit: d.takeProfit || 50,
            size,
          }
        }

        setArmedRules((prev) => [...prev, newRule])
        playTradingViewChime()
        warningToast(
          `🎯 Armed: ${dir} on ${entryLabel}${tfLabel}${cvdLabel} @ ${targetPx.toLocaleString()}${isLongTerm ? ' (Long-Term Memory)' : ' (NYC Session Only)'}`,
          8000
        )
        speakText(`Strategy rule armed for ${dir} ${inst}. Monitoring ${entryLabel}${cvdDiv ? ' with CVD divergence' : ''}.`)
      } else if ((d as any).action === 'ARM_TRENDLINE_STRATEGY') {
        const inst = ((d as any).instrument || context.instrument || 'GOLD') as MarketInstrument
        const tl =
          (context.userDrawings?.trendlines || []).find((t: any) => t.id === (d as any).trendlineId && (t.isActionTrendline || t.isInitialOvernight)) ||
          (context.userDrawings?.trendlines || []).find((t: any) => t.isActionTrendline || t.isInitialOvernight)
        if (!tl) {
          console.warn('[LeoAssistantPanel] ARM_TRENDLINE_STRATEGY ignored: No Action Trendline found on chart.')
          return
        }
        const targetPx = tl ? tl.projectedPrice || tl.endPrice : context.currentPrice
        const tlId = tl?.id || (d as any).trendlineId || 'user-tl'
        const tradeDir: 'LONG' | 'SHORT' =
          (d as any).direction ||
          (tl?.direction === 'BULLISH' ? 'SHORT' : tl?.direction === 'BEARISH' ? 'LONG' : (tl?.slopeDirection === 'ASCENDING' ? 'SHORT' : 'LONG'))
        const isShort = tradeDir === 'SHORT'
        const isAction = Boolean(tl?.isActionTrendline || tl?.isInitialOvernight)
        const tlLabel = tl?.label || (isAction ? `Action Trendline (${isShort ? 'Bullish Initial' : 'Bearish Initial'})` : (isShort ? 'Bullish Trendline' : 'Bearish Trendline'))
        const actionVerb = isShort ? 'Short' : 'Long'
        const breakSide = isShort ? 'below' : 'above'
        const slMode = isShort ? 'ABOVE_CANDLE_HIGH' : 'BELOW_CANDLE_LOW'

        const newRule = addRule({
          instrument: inst,
          type: 'TRENDLINE_BREAKOUT_SYSTEMATIC',
          direction: tradeDir,
          description: (d as any).description || `${actionVerb} 1 ${inst} on 5m Candle Close ${breakSide} ${tlLabel} (Trend-Borning Zone)`,
          userPrompt: (d as any).userPrompt || `Monitor ${tlLabel}. Enter ${actionVerb} 1 ${inst} when 5m candle closes ${breakSide} trendline.`,
          targetReference: tlLabel,
          targetPrice: targetPx ?? undefined,
          pattern: 'TRENDLINE_BREAKOUT_5M',
          stopLossMode: slMode,
          takeProfitMode: 'FIXED_POINTS',
          takeProfit: 50,
          size: 1,
          isLongTerm: true,
          session: '24H',
          status: 'ARMED',
          trendlineId: tlId,
          conditions: {
            trendlineId: tlId,
            pattern: 'TRENDLINE_BREAKOUT_5M',
            stopLossMode: slMode,
            takeProfitMode: 'FIXED_POINTS',
            takeProfit: 50,
            size: 1,
          },
        })
        setArmedRules((prev) => [newRule as any, ...prev.filter((r) => r.id !== newRule.id)])
        playTradingViewChime()
        warningToast(`🎯 Armed Trendline Strategy (${tradeDir}) for ${inst}`, 8000)
        speakText(`Trendline breakout strategy armed for ${tradeDir} ${inst}. Monitoring confirmed 5-minute candle close.`)
      } else if (d.action === 'ARM_STAGNATION_RULE') {
        const now = Date.now()
        const dateMeta = formatRuleDate(now)
        const newRule: ArmedDeskRule = {
          id: `stag-${now}`,
          type: 'STAGNATION_TIMEOUT',
          description: d.description ?? `Close if not in profit after ${d.maxMinutes}m`,
          maxMinutes: d.maxMinutes,
          createdAt: now,
          createdDateFormatted: dateMeta.formatted,
          sessionDate: dateMeta.sessionDate,
          sessionTime: dateMeta.sessionTime,
          status: 'ARMED',
        }
        setArmedRules((prev) => [...prev.filter((r) => r.type !== 'STAGNATION_TIMEOUT'), newRule])
      } else if (d.action === 'ARM_DESK_ALERT' || d.action === 'ARM_TELEGRAM_ALERT') {
        const isLongTerm = Boolean(d.isLongTerm || (d as any).longTermMemory)
        let resolvedPx = Number(d.targetPrice)
        if (!Number.isFinite(resolvedPx) || resolvedPx <= 0) {
          const refLower = (d.targetReference || '').toLowerCase()
          if (refLower.includes('low volume') || refLower.includes('y-val') || refLower.includes('val')) {
            resolvedPx = context.shortTermMoney?.yval ?? context.currentPrice ?? 0
          } else if (refLower.includes('y-poc') || refLower.includes('poc')) {
            resolvedPx = context.shortTermMoney?.ypoc ?? context.intermediateMoney?.poc5d ?? context.currentPrice ?? 0
          } else if (refLower.includes('y-low') || refLower.includes('low')) {
            resolvedPx = context.shortTermMoney?.ylow ?? context.currentPrice ?? 0
          } else {
            resolvedPx = context.currentPrice ?? 0
          }
        }
        const now = Date.now()
        const dateMeta = formatRuleDate(now)
        const newRule: ArmedDeskRule = {
          id: `desk-alert-${now}`,
          type: 'DESK_ALERT',
          description: `Desk alert when price tests ${d.targetReference} (${resolvedPx ? resolvedPx.toLocaleString() : 'Level'})${isLongTerm ? ' [Long-Term Memory]' : ' [NYC Session]'}`,
          targetPrice: resolvedPx > 0 ? resolvedPx : undefined,
          targetReference: d.targetReference,
          session: d.session ?? 'NYC',
          isLongTerm,
          requireHighVolume: d.requireHighVolume,
          requireConfidence: d.requireConfidence,
          createdAt: now,
          createdDateFormatted: dateMeta.formatted,
          sessionDate: dateMeta.sessionDate,
          sessionTime: dateMeta.sessionTime,
          status: 'ARMED',
        }
        setArmedRules((prev) => [...prev, newRule])
        playTradingViewChime()
        warningToast(
          `🔔 Desk Alert Armed: ${d.targetReference} @ ${d.targetPrice.toLocaleString()}${isLongTerm ? ' (Long-Term Memory)' : ' (NYC Session Only)'}`,
          8000
        )
        speakText(`Desk alert armed for ${d.targetReference}${isLongTerm ? ' in Long-Term Memory' : ''}`)
      } else if (d.action === 'SAVE_LONG_TERM_MEMORY') {
        const low = Math.min(d.priceLow, d.priceHigh)
        const high = Math.max(d.priceLow, d.priceHigh)
        const mem: LeoLongTermMemory = {
          id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          instrument: canonicalizeInstrument(d.instrument),
          timeframe: d.timeframe || '1D',
          priceLow: low,
          priceHigh: high,
          purpose: d.purpose || 'HTF observation zone',
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          triggerCount: 0,
          alarmSoundEnabled: true,
          isLongTerm: true,
        }
        saveLongTermMemory(mem)
        playTradingViewChime()
        warningToast(`🧠 Saved ${mem.instrument} level to Long-Term Memory`, 8000)
        speakText(`Saved ${mem.instrument} level to Long-Term Memory`)
        setMessages((prev) => [
          ...prev,
          {
            id: `ltm-saved-${Date.now()}`,
            role: 'assistant',
            content: `🧠 **[LONG-TERM MEMORY ACTIVATED]**\n\nZone **${low.toFixed(2)} – ${high.toFixed(2)}** on **${mem.instrument}** has been saved to persistent memory.\n\n*Purpose:* "${mem.purpose}"\n*Persistence:* Active indefinitely across all sessions (Asia, London, NYC) with TradingView audible alarms.`,
            timestamp: Date.now(),
          },
        ])
      } else if (d.action === 'SET_DAY_TYPE' || (d as any).action === 'OVERRIDE_DAY_TYPE') {
        const rawType = ((d as any).dayType || 'DOUBLE_DISTRIBUTION').toUpperCase()
        let mappedType: MarketDayType = 'DOUBLE_DISTRIBUTION'
        let badge = 'Double Distribution'
        let title = 'Double Distribution Day (AI Overwrite)'
        let desc = (d as any).reason || 'Auction structure transition confirmed by separating LVN and two distinct value areas.'

        if (rawType.includes('DOUBLE')) {
          mappedType = 'DOUBLE_DISTRIBUTION'
          badge = 'Double Distribution'
          title = 'Double Distribution Day (AI Overwrite)'
        } else if (rawType.includes('TREND_BULL') || rawType === 'BULL') {
          mappedType = 'TREND_BULL'
          badge = 'Trend Day (Bull)'
          title = 'Bullish Trend Day (AI Overwrite)'
        } else if (rawType.includes('TREND_BEAR') || rawType === 'BEAR') {
          mappedType = 'TREND_BEAR'
          badge = 'Trend Day (Bear)'
          title = 'Bearish Trend Day (AI Overwrite)'
        } else if (rawType.includes('NORMAL_VAR') || rawType === 'VARIATION') {
          mappedType = 'NORMAL_VARIATION'
          badge = 'Normal Variation'
          title = 'Normal Variation Day (AI Overwrite)'
        } else if (rawType.includes('NORMAL')) {
          mappedType = 'NORMAL'
          badge = 'Normal Day'
          title = 'Normal Day (AI Overwrite)'
        } else if (rawType.includes('NEUTRAL')) {
          mappedType = 'NEUTRAL'
          badge = 'Neutral Day'
          title = 'Neutral Day (AI Overwrite)'
        }

        const overrideEval: DayTypeEvaluation = {
          type: mappedType,
          badgeText: badge,
          title,
          description: desc,
        }

        onOverrideDayType?.(overrideEval)
        speakText(`Day type updated to ${badge}.`)
        playTradingViewChime()
        warningToast(`🤖 Leo AI updated Day Type to: ${badge}`, 6000)
      } else if (d.action === 'CANCEL_RULES') {
        setArmedRules([])
        speakText('All rules cancelled.')
      }
    }
  }

  // ─── Real-time 1-Second Desk Rule Evaluation Loop ────────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      const pos = context.activePosition
      const curPrice = context.currentPrice

      setArmedRules((prevRules) => {
        let changed = false
        const nextRules = prevRules.map((rule) => {
          if (rule.status !== 'ARMED') return rule

          // 0. Session Expiration Guard:
          // If not explicitly marked as Long-Term Memory, check if NYC session has ended.
          // If ended, mark EXPIRED so it does NOT fire any notifications or place orders!
          if (isArmedRuleExpired(rule)) {
            changed = true
            return { ...rule, status: 'EXPIRED' as const }
          }

          // 1. Stagnation Timeout Rule
          if (rule.type === 'STAGNATION_TIMEOUT') {
            if (!pos) {
              // Position closed externally
              changed = true
              return { ...rule, status: 'SATISFIED' as const }
            }

            const entryTime = new Date(pos.entryTimestamp).getTime()
            const elapsedMinutes = (Date.now() - entryTime) / 60000
            const maxM = rule.maxMinutes ?? 5

            if (elapsedMinutes >= maxM) {
              if (pos.unrealizedPnlPoints <= 0) {
                // Stagnation timeout reached - Advisory alert (AI never auto-exits)
                changed = true
                const reason = `Stagnation timeout reached after ${maxM} minutes without positive profit`
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `stag-${Date.now()}`,
                    role: 'assistant',
                    content: `🛑 **[LEO ADVISORY - STAGNATION TIMEOUT REACHED]**\n\nPosition on **${pos.instrument}** was open for **${elapsedMinutes.toFixed(1)}m** without moving into profit (P&L: **${pos.unrealizedPnlPoints.toFixed(1)} pts**).\n\n**Playbook Advisory**: ${reason}. Recommendation is to manually flatten or tighten protective stop.\n\n*(Desk Safety Protocol: AI never auto-exits; please execute manual exit on your chart toolbar if desired).*`,
                    timestamp: Date.now(),
                  },
                ])
                speakText(`Stagnation timeout reached after ${maxM} minutes. Manual review required.`)
                return { ...rule, status: 'TRIGGERED' as const }
              } else {
                // Moved into profit! Rule satisfied
                changed = true
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `sat-${Date.now()}`,
                    role: 'assistant',
                    content: `✅ **[LEO STAGNATION RULE SATISFIED]**\n\nTrade is positive (+${pos.unrealizedPnlPoints.toFixed(1)} pts) after ${maxM} minutes. Holding trade per playbook.`,
                    timestamp: Date.now(),
                  },
                ])
                speakText('Trade moved into profit. Stagnation rule cleared.')
                return { ...rule, status: 'SATISFIED' as const }
              }
            }
          }

          // 2. Desk Alert Rule
          if (
            (rule.type === 'DESK_ALERT' || (rule.type as any) === 'TELEGRAM_ALERT') &&
            curPrice != null
          ) {
            let effectiveTargetPx = rule.targetPrice
            if ((effectiveTargetPx == null || effectiveTargetPx <= 0) && rule.targetReference) {
              const refLower = rule.targetReference.toLowerCase()
              if (refLower.includes('low volume') || refLower.includes('y-val') || refLower.includes('val')) {
                effectiveTargetPx = context.shortTermMoney?.yval ?? undefined
              } else if (refLower.includes('y-poc') || refLower.includes('poc')) {
                effectiveTargetPx = context.shortTermMoney?.ypoc ?? context.intermediateMoney?.poc5d ?? undefined
              } else if (refLower.includes('y-low') || refLower.includes('low')) {
                effectiveTargetPx = context.shortTermMoney?.ylow ?? undefined
              } else if (refLower.includes('5d poc')) {
                effectiveTargetPx = context.intermediateMoney?.poc5d ?? undefined
              }
            }

            if (effectiveTargetPx != null && effectiveTargetPx > 0) {
              const tolerances = getInstrumentTolerances(rule.instrument || context.instrument)
              const dist = Math.abs(curPrice - effectiveTargetPx)
              const alertTolerance = Math.max(tolerances.touch * 1.5, 5.0)

              if (dist <= alertTolerance) {
                // Target price reached!
                changed = true
                dispatchDeskAlert({ ...rule, targetPrice: effectiveTargetPx })
                return { ...rule, status: 'TRIGGERED' as const }
              }
            }
          }

          // 3. Conditional Strategy Entry & Market Situation Rules
          if (isEntrySituationRule(rule.type) && curPrice != null) {
            // Guard: Globex 17:00–18:00 ET maintenance pause
            if (isGlobexMaintenanceWindow()) return rule

            const dir = (rule.direction || 'LONG').toUpperCase() as 'LONG' | 'SHORT'

            // Guard: Opposing Position / Hedging Conflict Protection
            if (pos && pos.direction !== dir) {
              changed = true
              warningToast(
                `⚠️ [LEO DESK CONFLICT]: Cannot execute ${dir} on ${rule.instrument}. Opposing ${pos.direction} position active. Disarmed rule for capital safety.`,
                9000
              )
              speakText(`Rule cancelled: Opposing position active on ${rule.instrument}.`)
              return { ...rule, status: 'CANCELLED' as const }
            }

            // Resolve target price from rule, conditions, or key reference levels
            let currentTargetPx = rule.targetPrice ?? (rule as any).conditions?.targetPrice
            if ((currentTargetPx == null || currentTargetPx <= 0) && (rule.targetReference || (rule as any).conditions?.targetReference)) {
              const refText = String(rule.targetReference || (rule as any).conditions?.targetReference).toLowerCase()
              if (refText.includes('low volume') || refText.includes('y-val') || refText.includes('val')) {
                currentTargetPx = context.shortTermMoney?.yval ?? undefined
              } else if (refText.includes('y-poc') || refText.includes('poc')) {
                currentTargetPx = context.shortTermMoney?.ypoc ?? context.intermediateMoney?.poc5d ?? undefined
              } else if (refText.includes('y-low') || refText.includes('low')) {
                currentTargetPx = context.shortTermMoney?.ylow ?? undefined
              } else if (refText.includes('5d poc')) {
                currentTargetPx = context.intermediateMoney?.poc5d ?? undefined
              } else if (refText.includes('y-vah') || refText.includes('vah')) {
                currentTargetPx = context.shortTermMoney?.yvah ?? undefined
              } else if (refText.includes('y-high') || refText.includes('high')) {
                currentTargetPx = context.shortTermMoney?.yhigh ?? undefined
              }
            }
            if (!currentTargetPx || currentTargetPx <= 0) {
              currentTargetPx = curPrice
            }

            // Dynamic Trendline Re-Projection Over Time
            if (rule.drawingType === 'TRENDLINE' && rule.drawingId && context.userDrawings) {
              const activeTl = context.userDrawings.trendlines.find((t) => t.id === rule.drawingId)
              if (activeTl && Number.isFinite(activeTl.projectedPrice) && activeTl.projectedPrice > 0) {
                currentTargetPx = activeTl.projectedPrice
              }
            }

            // Instrument-calibrated proximity & touch tolerances
            const tolerances = getInstrumentTolerances(rule.instrument || context.instrument)
            const dist = Math.abs(curPrice - currentTargetPx)

            const rawPattern = (rule.pattern || (rule as any).conditions?.pattern || '').trim().toUpperCase()
            const isTouchOnly = !rawPattern || rawPattern === 'LEVEL_TOUCH' || rawPattern === 'TOUCH' || rawPattern === 'NONE'

            const rawBars: Candle[] =
              candlesRef.current && candlesRef.current.length > 0
                ? candlesRef.current.map((c: any) => ({
                    time: typeof c.time === 'number' ? c.time : 0,
                    open: Number(c.open),
                    high: Number(c.high),
                    low: Number(c.low),
                    close: Number(c.close),
                    volume: Number(c.volume || 1),
                  }))
                : []
            const bars: Candle[] = resampleCandlesTo5M(rawBars)

            let signalBar: Candle | null = bars.length > 0 ? bars[bars.length - 1]! : null

            // ── TRENDLINE_BREAKOUT_SYSTEMATIC Rule Handler ──
            if (rule.type === 'TRENDLINE_BREAKOUT_SYSTEMATIC') {
              const tlId = rule.trendlineId || rule.conditions?.trendlineId
              const activeTl = (context.userDrawings?.trendlines || []).find((t: any) => t.id === tlId)
              if (activeTl && Boolean(activeTl.isActionTrendline || activeTl.isInitialOvernight) && bars.length > 0) {
                const candleTl: UserTrendline = {
                  id: activeTl.id,
                  type: 'TRENDLINE',
                  p1: { time: (activeTl as any).p1?.time ?? (bars[0]?.time || 0), price: activeTl.startPrice },
                  p2: { time: (activeTl as any).p2?.time ?? (bars[bars.length - 1]?.time || 0), price: activeTl.endPrice },
                  direction: activeTl.direction,
                  sessionOrigin: activeTl.sessionOrigin,
                  isCarriedFromOvernight: activeTl.isCarriedFromOvernight,
                  breakCountOvernight: activeTl.breakCountOvernight,
                  isActionTrendline: activeTl.isActionTrendline,
                  isInitialOvernight: activeTl.isInitialOvernight,
                }
                const tradeDir: 'LONG' | 'SHORT' =
                  rule.direction ||
                  (activeTl.direction === 'BULLISH' ? 'SHORT' : activeTl.direction === 'BEARISH' ? 'LONG' : (activeTl.endPrice > activeTl.startPrice ? 'SHORT' : 'LONG'))

                const ruleCreatedSec = rule.createdAt ? Math.floor(new Date(rule.createdAt).getTime() / 1000) : 0
                const minBrkTime = (rule as any).conditions?.minBreakoutTime ?? ruleCreatedSec
                const nowSec = Math.floor(Date.now() / 1000)

                const brkCheck = checkTrendlineBreakout(candleTl, bars, {
                  direction: tradeDir,
                  minBreakoutTime: minBrkTime,
                  currentTimeSec: nowSec,
                  barDurationSec: 300,
                })
                const initPt = findInitiatingPoint(candleTl, bars, brkCheck.breakoutCandleIndex ?? bars.length - 1, { direction: tradeDir })
                let borningScore = 80
                let borningGrade: any = 'A'

                if (initPt) {
                  const borningRes = evaluateTrendBorningZone({
                    initiatingPoint: initPt,
                    bars,
                    chartContext: context as any,
                    direction: tradeDir,
                  })
                  borningScore = borningRes.compositeScore
                  borningGrade = borningRes.grade
                }

                // Evaluate Dalton Balance Day Chop Shield
                const chopShield = evaluateChopShield({
                  bars,
                  yVal: context.shortTermMoney?.yval ?? (context as any).yesterday?.val,
                  yVah: context.shortTermMoney?.yvah ?? (context as any).yesterday?.vah,
                  dayType: (context as any).dayType ?? undefined,
                })

                const prevProg = rule.conditionProgress || {}
                const newProg: RuleConditionProgress = {
                  ...prevProg,
                  trendlineCrossed: brkCheck.isCrossed,
                  trendlineCrossedAt: brkCheck.isCrossed ? (prevProg.trendlineCrossedAt || Date.now()) : undefined,
                  bar5mCloseConfirmed: brkCheck.isConfirmed5mClose,
                  bar5mCloseConfirmedAt: brkCheck.isConfirmed5mClose ? (prevProg.bar5mCloseConfirmedAt || Date.now()) : undefined,
                  borningZoneInitiated: Boolean(initPt),
                  borningZoneScore: borningScore,
                  borningZoneGrade: borningGrade,
                  chopShieldActive: chopShield.isChopShieldActive,
                  chopShieldThreshold: chopShield.minScoreRequired,
                  levelReached: brkCheck.isCrossed,
                  patternConfirmed: brkCheck.isConfirmed5mClose,
                  sessionConfirmed: true,
                }

                if (
                  newProg.trendlineCrossed !== prevProg.trendlineCrossed ||
                  newProg.bar5mCloseConfirmed !== prevProg.bar5mCloseConfirmed ||
                  newProg.chopShieldActive !== prevProg.chopShieldActive
                ) {
                  changed = true
                  rule = { ...rule, conditionProgress: newProg }
                }

                if (brkCheck.isConfirmed5mClose) {
                  // Session Gating: Action Trendlines and NY-restricted rules only execute live orders in NYC Cash Session
                  const isNyActive = isNycSessionActive()
                  const isNyRestricted = rule.session === 'NY' || Boolean(activeTl.isActionTrendline || activeTl.isInitialOvernight)

                  if (isNyRestricted && !isNyActive) {
                    // Break occurred during overnight (Asia/London): notify trader to redraw new line, do NOT fire live order!
                    if (!(rule.conditionProgress as any)?.overnightBreakAlertFired) {
                      changed = true
                      rule = {
                        ...rule,
                        conditionProgress: {
                          ...newProg,
                          overnightBreakAlertFired: true,
                          overnightBreakCount: ((prevProg as any).overnightBreakCount || 0) + 1,
                        } as any,
                      }
                      playTradingViewChime()
                      warningToast(
                        `🌙 [OVERNIGHT BREAK DETECTED]: ${activeTl.label || 'Action Trendline'} broken during overnight. No live orders executed. Redraw new initial line for NYC session.`,
                        10000
                      )
                      speakText(`Overnight trendline break detected on ${rule.instrument}. Redraw initial line for New York.`)
                    }
                    return rule
                  }

                  if (executingRuleIdsRef.current.has(rule.id)) {
                    return rule
                  }

                  // Chop Shield Filter: require minimum composite score (75 during chop, 60 normal)
                  if (borningScore < chopShield.minScoreRequired) {
                    warningToast(
                      `⚠️ [CHOP SHIELD]: Trendline break score (${borningScore}/100) below required threshold (${chopShield.minScoreRequired}). Trade filtered to protect capital: ${chopShield.reason}`,
                      10000
                    )
                    return rule
                  }

                  executingRuleIdsRef.current.add(rule.id)
                  changed = true

                  const entryPx = brkCheck.entryPrice ?? curPrice
                  const slPx = brkCheck.defaultStopLoss ?? (tradeDir === 'SHORT' ? Number((entryPx + 10).toFixed(2)) : Number((entryPx - 10).toFixed(2)))
                  const tpPx = brkCheck.defaultTakeProfitFixed50 ?? (tradeDir === 'SHORT' ? Number((entryPx - 50).toFixed(2)) : Number((entryPx + 50).toFixed(2)))

                  void executePlaceOrder({
                    instrument: rule.instrument || context.instrument,
                    direction: tradeDir,
                    price: entryPx,
                    stopLoss: slPx,
                    profitTarget: tpPx,
                    size: rule.size || 1,
                    reason: `Systematic Trendline Breakout (${tradeDir}) (Trend-Borning Score: ${borningScore}/100 Grade ${borningGrade})`,
                  })

                  rule = {
                    ...rule,
                    status: 'TRIGGERED',
                    executedAt: Date.now(),
                    executedPrice: entryPx,
                  }
                }
              }
              return rule
            }

            // 1. Level Reached / Price Touch Condition
            const isLevelReached =
              dist <= tolerances.touch ||
              (dir === 'LONG' ? curPrice <= currentTargetPx + tolerances.touch : curPrice >= currentTargetPx - tolerances.touch) ||
              Boolean(rule.conditionProgress?.levelReached)

            // 2. Candlestick Pattern Condition
            let patternMatched = false
            let matchedPatternName = ''

            if (isTouchOnly) {
              if (isLevelReached) {
                patternMatched = true
                matchedPatternName = 'LEVEL_TOUCH'
              }
            } else if (dist <= tolerances.proximity || isLevelReached) {
              if (bars.length >= 2) {
                const lastIdx = bars.length - 1
                const lastBar = bars[lastIdx]!
                const prevBar = bars[lastIdx - 1]!

                const pResCurr = detectCandlestickPatterns(bars, lastIdx)
                const pResPrev = detectCandlestickPatterns(bars, lastIdx - 1)

                const testPat = (res: any, bar: Candle, prev: Candle | null) => {
                  if (rawPattern === 'BULLISH_ENGULFING' && res.bullEng) return true
                  if (rawPattern === 'BEARISH_ENGULFING' && res.bearEng) return true
                  if (rawPattern === 'HAMMER' && res.hammer) return true
                  if (rawPattern === 'INVERTED_HAMMER' && res.invHammer) return true
                  if (rawPattern === 'SHOOTING_STAR' && res.shootingStar) return true
                  if (rawPattern === 'REJECTION_TAIL' && (dir === 'LONG' ? res.buyingExcess : res.sellingExcess)) return true
                  if (rawPattern === 'SWEEP_REVERSAL') {
                    if (dir === 'LONG') {
                      return res.buyingExcess || res.hammer || (prev != null && bar.low < prev.low && bar.close > bar.open)
                    } else {
                      return res.sellingExcess || res.shootingStar || (prev != null && bar.high > prev.high && bar.close < bar.open)
                    }
                  }
                  if (rawPattern === 'ABSORPTION_REVERSAL') {
                    if (dir === 'LONG') return res.buyingExcess || res.hammer || res.bullEng
                    else return res.sellingExcess || res.shootingStar || res.bearEng
                  }
                  if (rawPattern === 'BREAKOUT_RETEST') {
                    if (dir === 'LONG') return bar.low <= currentTargetPx + tolerances.touch && bar.close >= currentTargetPx
                    else return bar.high >= currentTargetPx - tolerances.touch && bar.close <= currentTargetPx
                  }
                  if (rawPattern === 'MOMENTUM_EXPANSION') {
                    if (dir === 'LONG') return bar.close > bar.open && (prev != null ? bar.close > prev.high : true)
                    else return bar.close < bar.open && (prev != null ? bar.close < prev.low : true)
                  }
                  return false
                }

                if (testPat(pResCurr, lastBar, prevBar)) {
                  patternMatched = true
                  matchedPatternName = rawPattern
                  signalBar = lastBar
                } else if (testPat(pResPrev, prevBar, bars[lastIdx - 2] ?? null)) {
                  patternMatched = true
                  matchedPatternName = rawPattern
                  signalBar = prevBar
                } else if (dist <= tolerances.touch) {
                  const matchesDir = dir === 'LONG' ? lastBar.close >= lastBar.open : lastBar.close <= lastBar.open
                  if (matchesDir) {
                    patternMatched = true
                    matchedPatternName = rawPattern
                    signalBar = lastBar
                  }
                }
              } else if (dist <= tolerances.touch) {
                patternMatched = true
                matchedPatternName = rawPattern || 'LEVEL_TOUCH'
                signalBar = bars.length > 0 ? bars[0]! : null
              }
            }

            // 3. CVD Divergence Condition
            const needsCvd = Boolean(rule.cvdDivergence || (rule as any).conditions?.cvdDivergence)
            let cvdMatched = true
            if (needsCvd) {
              const flow = context.orderFlow
              if (flow) {
                if (dir === 'LONG') {
                  cvdMatched = flow.divergence === 'BULLISH_ABSORPTION' || flow.trend === 'BUYER_DOMINANT' || flow.latestBarDelta > 0
                } else {
                  cvdMatched = flow.divergence === 'BEARISH_EXHAUSTION' || flow.trend === 'SELLER_DOMINANT' || flow.latestBarDelta < 0
                }
              } else {
                cvdMatched = Boolean(rule.conditionProgress?.cvdConfirmed)
              }
            }

            // 4. Volume Condition
            const needsVol = Boolean(rule.requireHighVolume || (rule as any).conditions?.requireHighVolume)
            let volMatched = true
            if (needsVol && bars.length >= 5) {
              const avgVol = bars.slice(-10).reduce((acc, b) => acc + b.volume, 0) / Math.min(10, bars.length)
              volMatched = (signalBar?.volume ?? 0) >= avgVol * 1.15
            }

            // 5. Session Gate
            const sessUpper = (rule.session || '').toUpperCase()
            const isSessionActive =
              rule.isLongTerm ||
              !rule.session ||
              sessUpper === 'NYC' ||
              sessUpper === '24H' ||
              sessUpper === 'ASIA' ||
              sessUpper === 'ALL' ||
              sessUpper === 'LTM'

            // Track Condition Checklist Progress
            const prevProg = rule.conditionProgress || {}
            const newProgress: RuleConditionProgress = {
              levelReached: isLevelReached,
              levelReachedAt: isLevelReached ? (prevProg.levelReachedAt || Date.now()) : undefined,
              levelReachedPrice: isLevelReached ? (prevProg.levelReachedPrice || curPrice) : undefined,
              patternConfirmed: patternMatched || Boolean(prevProg.patternConfirmed && isTouchOnly),
              patternConfirmedAt: patternMatched ? (prevProg.patternConfirmedAt || Date.now()) : prevProg.patternConfirmedAt,
              patternName: matchedPatternName || prevProg.patternName || rawPattern,
              cvdConfirmed: cvdMatched,
              cvdConfirmedAt: cvdMatched && needsCvd ? (prevProg.cvdConfirmedAt || Date.now()) : prevProg.cvdConfirmedAt,
              volumeConfirmed: volMatched,
              volumeConfirmedAt: volMatched && needsVol ? (prevProg.volumeConfirmedAt || Date.now()) : prevProg.volumeConfirmedAt,
              timeframeConfirmed: true,
              sessionConfirmed: isSessionActive,
            }

            // Check if progress state updated
            if (
              newProgress.levelReached !== prevProg.levelReached ||
              newProgress.patternConfirmed !== prevProg.patternConfirmed ||
              newProgress.cvdConfirmed !== prevProg.cvdConfirmed ||
              newProgress.volumeConfirmed !== prevProg.volumeConfirmed
            ) {
              changed = true
              rule = { ...rule, conditionProgress: newProgress }
            }

            // Check if all conditions are satisfied to fire order execution
            const patternFired =
              newProgress.levelReached &&
              newProgress.patternConfirmed &&
              (!needsCvd || newProgress.cvdConfirmed) &&
              (!needsVol || newProgress.volumeConfirmed) &&
              isSessionActive

            if (patternFired) {
              if (executingRuleIdsRef.current.has(rule.id)) {
                return rule
              }
              executingRuleIdsRef.current.add(rule.id)
              changed = true
              const entryPx = curPrice
              const { slDist } = getInstrumentDefaultDistances(
                rule.instrument || context.instrument
              )
              const tickCushion =
                rule.instrument === 'GOLD' ? 0.3 : rule.instrument === 'CRUDE' ? 0.05 : 2.0

              const userSl = rule.stopLoss ?? (rule as any).conditions?.stopLoss
              let sl = userSl != null && Number.isFinite(Number(userSl)) && Number(userSl) > 0 ? Number(userSl) : undefined

              if (!sl) {
                if (rule.stopLossMode === 'BELOW_CANDLE_LOW' && signalBar) {
                  sl = Number((signalBar.low - tickCushion).toFixed(2))
                } else if (rule.stopLossMode === 'ABOVE_CANDLE_HIGH' && signalBar) {
                  sl = Number((signalBar.high + tickCushion).toFixed(2))
                } else if (rule.stopLossMode === 'DOLLARS_50') {
                  const pts50 = Number(
                    (50.0 / (tolerances.multiplier * (rule.size || 1))).toFixed(2)
                  )
                  sl = Number((dir === 'LONG' ? entryPx - pts50 : entryPx + pts50).toFixed(2))
                } else {
                  sl = Number((dir === 'LONG' ? entryPx - slDist : entryPx + slDist).toFixed(2))
                }
              }

              // 1. Bracket Inversion Protection
              if (dir === 'LONG' && sl >= entryPx) {
                sl = Number((entryPx - slDist).toFixed(2))
              } else if (dir === 'SHORT' && sl <= entryPx) {
                sl = Number((entryPx + slDist).toFixed(2))
              }

              const finalRiskPts = Math.max(
                rule.instrument === 'CRUDE' ? 0.05 : rule.instrument === 'GOLD' ? 0.2 : 1.0,
                Math.abs(entryPx - sl)
              )

              // 2. Take Profit Calculation & Inversion Guard
              const isOneToOne = rule.takeProfitMode === '1:1' || (rule as any).conditions?.takeProfitMode === '1:1' || rule.riskReward === '1:1' || (rule as any).conditions?.riskReward === '1:1'
              const userTp = rule.takeProfit ?? (rule as any).conditions?.takeProfit
              let tp = userTp != null && Number.isFinite(Number(userTp)) && Number(userTp) > 0 ? Number(userTp) : undefined
              if (!tp || isOneToOne) {
                let mult = 2.0
                if (isOneToOne) mult = 1.0
                else if (rule.takeProfitMode === '1:2') mult = 2.0
                else if (rule.takeProfitMode === '1:3') mult = 3.0
                else if (rule.takeProfitMode === '1:5') mult = 5.0
                tp = Number(
                  (dir === 'LONG'
                    ? entryPx + finalRiskPts * mult
                    : entryPx - finalRiskPts * mult
                  ).toFixed(2)
                )
              }

              if (dir === 'LONG' && tp <= entryPx) {
                tp = Number((entryPx + finalRiskPts * 2.0).toFixed(2))
              } else if (dir === 'SHORT' && tp >= entryPx) {
                tp = Number((entryPx - finalRiskPts * 2.0).toFixed(2))
              }

              // ACTUALLY PLACE THE ORDER ON THE DESK!
              void executePlaceOrder({
                instrument: rule.instrument || context.instrument,
                direction: dir,
                price: entryPx,
                stopLoss: sl,
                profitTarget: tp,
                size: rule.size || (rule as any).conditions?.size || 1,
                reason: `Situation Triggered: ${rawPattern || 'Level Touch'} confirmed at ${rule.targetReference || 'Target'} (${currentTargetPx.toLocaleString()}). ${rule.userPrompt || rule.description}`,
              })

              playTradingViewChime()
              warningToast(
                `⚡ [LEO AUTO-ORDER EXECUTED]: ${dir} ${rule.instrument} @ ${entryPx.toFixed(2)} | SL: ${sl.toFixed(2)} | TP: ${tp.toFixed(2)}`,
                10000
              )
              speakText(
                `Situation triggered! Order placed for ${dir} ${rule.instrument}.`
              )

              return {
                ...rule,
                conditionProgress: newProgress,
                targetPrice: currentTargetPx,
                lastEvaluatedBarTime: signalBar?.time,
                status: 'EXECUTED' as const,
                executedAt: Date.now(),
                executedPrice: entryPx,
              }
            }
          }

          return rule
        })

        // Check dynamic responsive trendline breakdown exit while in position
        if (context.activePosition && candlesRef.current.length > 0) {
          const bars: Candle[] = candlesRef.current.map((c: any) => ({
            time: typeof c.time === 'number' ? c.time : 0,
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume || 1),
          }))

          const trendlineRules = (prevRules || []).filter(
            (r) => r.type === 'TRENDLINE_BREAKOUT_SYSTEMATIC' && r.status === 'TRIGGERED'
          )

          for (const tr of trendlineRules) {
            const tlId = tr.trendlineId || tr.conditions?.trendlineId
            const activeTl = (context.userDrawings?.trendlines || []).find((t: any) => t.id === tlId)
            if (activeTl && bars.length > 0) {
              const candleTl: UserTrendline = {
                id: activeTl.id,
                type: 'TRENDLINE',
                p1: { time: (activeTl as any).p1?.time ?? (bars[0]?.time || 0), price: activeTl.startPrice },
                p2: { time: (activeTl as any).p2?.time ?? (bars[bars.length - 1]?.time || 0), price: activeTl.endPrice },
                direction: activeTl.direction,
                sessionOrigin: activeTl.sessionOrigin,
                isCarriedFromOvernight: activeTl.isCarriedFromOvernight,
                breakCountOvernight: activeTl.breakCountOvernight,
              }
              const trDir: 'LONG' | 'SHORT' =
                tr.direction ||
                (activeTl.direction === 'BULLISH' ? 'SHORT' : activeTl.direction === 'BEARISH' ? 'LONG' : (activeTl.endPrice > activeTl.startPrice ? 'SHORT' : 'LONG'))
              const initPt = findInitiatingPoint(candleTl, bars, bars.length - 1, { direction: trDir })
              if (initPt) {
                const borningRes = evaluateTrendBorningZone({
                  initiatingPoint: initPt,
                  bars,
                  chartContext: context as any,
                  direction: trDir,
                })
                const breakoutCheck = checkTrendlineBreakout(candleTl, bars, { direction: trDir })
                const breakoutCandle = breakoutCheck.breakoutCandle || bars[Math.max(0, bars.length - 1)]!
                const flagState = detectFlagAndSecondaryBreakout({
                  origin: initPt,
                  breakoutCandle,
                  bars,
                  direction: trDir,
                  structuralZone: borningRes.structuralZone,
                })
                const localSwingAnchor = findBreakoutSwingAnchor({
                  bars,
                  breakoutIndex: breakoutCheck.breakoutCandleIndex ?? bars.length - 1,
                  direction: trDir,
                  macroOrigin: initPt,
                })

                const curPrice = context.currentPrice ?? bars[bars.length - 1]!.close
                const dynLine = calculateDynamicTrendline({
                  origin: initPt,
                  compositeScore: borningRes.compositeScore,
                  higherLows: flagState.confirmedPivots,
                  currentPrice: curPrice,
                  currentTime: Math.floor(Date.now() / 1000),
                  bars,
                  direction: trDir,
                  breakoutCandle,
                  flagState,
                  structuralZone: borningRes.structuralZone,
                  reactionAnchor: localSwingAnchor,
                })
                const latestCompletedBar = bars[bars.length - 1]!
                const nowSec = Math.floor(Date.now() / 1000)
                const exitCheck = checkDynamicTrendlineExit(dynLine, latestCompletedBar, {
                  currentTimeSec: nowSec,
                  barDurationSec: 300,
                  structuralZone: borningRes.structuralZone,
                })
                if (exitCheck.shouldExit) {
                  const exitReason = `Systematic Dynamic Trendline Breakdown (${trDir})`

                  // 1. Cancel working brackets on broker to eliminate orphaned limit orders
                  void fetch('/api/trading/positions/cancel-working', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ instrument: context.instrument }),
                  }).catch(() => {})

                  if (onClosePosition) {
                    onClosePosition(exitReason)
                  } else {
                    void fetch('/api/trading/positions/close', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        position_id: (pos as any)?.id || 'active',
                        instrument: context.instrument,
                        exit_price: latestCompletedBar.close,
                        exit_reason: 'ai_signal',
                        exit_notes: exitReason,
                      }),
                    })
                  }
                  updateRule(tr.instrument as MarketInstrument, tr.id, { status: 'EXECUTED' })
                  const sideText = trDir === 'SHORT' ? 'above' : 'below'
                  warningToast(
                    `🚨 [SYSTEMATIC EXIT]: 5m candle closed ${sideText} dynamic trendline @ ${latestCompletedBar.close.toFixed(2)}. Position flattened ("We are out").`,
                    10000
                  )
                  speakText('Systematic exit triggered. Position flattened.')
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `leo-exit-${Date.now()}`,
                      role: 'assistant',
                      content: `🚨 **[SYSTEMATIC EXIT EXECUTED]**\n5-minute candle closed ${sideText} dynamic responsive trendline at **${latestCompletedBar.close.toFixed(2)}**.\nPosition flattened cleanly per strategy protocol: *"We are out."*`,
                      timestamp: Date.now(),
                    },
                  ])
                }
              }
            }
          }
        }

        return changed ? nextRules : prevRules
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [context.activePosition, context.currentPrice, context.instrument])

  // Send message to Leo via streaming API
  const handleSendMessage = async (textToSend?: string, pointsToSend?: LeoDataPoint[]) => {
    if (isListeningRef.current) {
      stopListening()
    }
    const text = textToSend ?? inputPrompt
    if (!text.trim()) return

    // Abort active prior streaming request if running
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort()
      activeAbortControllerRef.current = null
    }

    const abortController = new AbortController()
    activeAbortControllerRef.current = abortController

    const points = pointsToSend !== undefined ? pointsToSend : attachedPoints

    const userMessage: LeoMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachedPoints: [...points],
    }

    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)

    // Clear state & voice transcript refs synchronously upon message send
    setInputPrompt('')
    inputPromptRef.current = ''
    sessionBaseTranscriptRef.current = ''
    if (textareaRef.current) {
      textareaRef.current.style.height = '38px'
    }
    setIsStreaming(true)

    // Append streaming assistant placeholder
    const assistantId = `leo-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      },
    ])

    try {
      const response = await fetch('/api/trading/leo/chat', {
        method: 'POST',
        signal: abortController.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content:
              m.attachedPoints && m.attachedPoints.length > 0
                ? `${m.content}\n\n[Attached Data Points: ${m.attachedPoints
                    .map(
                      (p) =>
                        `${p.label}=${p.value}${p.session ? ` (${p.session})` : ''}${
                          p.volume ? ` vol=${p.volume}` : ''
                        }${p.retestRatio ? ` retest=${p.retestRatio}x` : ''}`
                    )
                    .join(', ')}]`
                : m.content,
          })),
          chartContext: {
            ...context,
            selectedDataPoints: points,
          },
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response stream body')

      const decoder = new TextDecoder()
      let accumulated = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const dataStr = trimmed.slice(6)
          if (dataStr === '[DONE]') continue

          try {
            const parsed = JSON.parse(dataStr)
            if (parsed.text) {
              accumulated += parsed.text
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId ? { ...msg, content: accumulated } : msg
                )
              )
            }
          } catch {
             // Ignore parse errors
          }
        }
      }

      // Parse and execute directives (<execute>)
      const directives = parseLeoDirectives(accumulated)
      if (directives.length > 0) {
        applyDirectives(directives)
      }

      // Voice readout if enabled
      speakText(accumulated)
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                content: `⚠️ **Leo Desk Error:** Unable to stream response (${err?.message ?? 'Network error'}).`,
              }
            : msg
        )
      )
    } finally {
      if (activeAbortControllerRef.current === abortController) {
        activeAbortControllerRef.current = null
      }
      setIsStreaming(false)
      setAttachedPoints([]) // reset attached after sending
    }
  }

  // Auto-fill & auto-submit external prompt (e.g. Questioning desk "Ask Leo to Critique Price")
  useEffect(() => {
    if (externalPrompt && externalPrompt.trim()) {
      const promptToSend = externalPrompt.trim()
      const points =
        externalAttachedPoints && externalAttachedPoints.length > 0
          ? externalAttachedPoints
          : attachedPoints

      if (!isPanelOpen) {
        if (onToggleOpen) {
          onToggleOpen()
        } else {
          setInternalIsOpen(true)
        }
      }

      onClearExternalPrompt?.()
      if (externalAttachedPoints && externalAttachedPoints.length > 0) {
        onClearExternalAttachedPoints?.()
      }

      handleSendMessage(promptToSend, points)
    }
  }, [
    externalPrompt,
    externalAttachedPoints,
    attachedPoints,
    isPanelOpen,
    onToggleOpen,
    onClearExternalPrompt,
    onClearExternalAttachedPoints,
  ])

  const activePos = context.activePosition

  return (
    <>
      {/* ─── Compact Minimized Dock Button ──────────────────────────────────── */}
      {!isPanelOpen && (
        <button
          type="button"
          onClick={togglePanel}
          className="group absolute bottom-12 right-3 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md bg-neutral-950/85 border border-purple-500/40 text-neutral-200 shadow-xl transition-all duration-200 hover:border-purple-400 hover:bg-neutral-900/90 hover:scale-105 active:scale-95 select-none"
          title="Open Leo AI Desk Assistant (Click to enable chart reference points)"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-purple-500" />
          </span>
          <span className="font-mono text-xs font-semibold tracking-wide text-purple-200 flex items-center gap-1">
            <span>🎙️</span>
            <span>Leo AI</span>
          </span>
          {activePos && (
            <span
              className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                activePos.isInProfit
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700'
                  : 'bg-rose-950/80 text-rose-300 border border-rose-700'
              }`}
            >
              {activePos.direction} {activePos.unrealizedPnlPoints >= 0 ? '+' : ''}
              {activePos.unrealizedPnlPoints.toFixed(1)}pt
            </span>
          )}
          {context.shortTermMoney?.ypoc != null && (
            <span className="hidden sm:inline font-mono text-[10px] text-neutral-400 border-l border-neutral-700 pl-1.5">
              Y-POC {context.shortTermMoney.ypoc}
            </span>
          )}
          <span className="text-[9px] text-purple-300 font-bold bg-purple-950/60 border border-purple-800/60 rounded px-1.5 py-0.5">
            AI Live
          </span>
        </button>
      )}

      {/* ─── Expanded Glassmorphism Assistant Panel ───────────────────────── */}
      {isPanelOpen && (
        <div className="absolute top-2 bottom-2 right-2 z-[60] w-full max-w-[395px] flex flex-col rounded-2xl backdrop-blur-xl bg-neutral-950/90 border border-purple-500/35 shadow-2xl overflow-hidden transition-all duration-300">
          {/* Header Bar */}
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-neutral-800/80 bg-neutral-900/60">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-xs text-purple-200 tracking-wider">
                    LEO DESK ASSISTANT
                  </span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-950/80 border border-purple-700/60 text-purple-300 font-mono">
                    AI Live
                  </span>
                </div>
                <div className="text-[10px] text-neutral-400 font-mono">
                  {context.instrument} · {context.currentPrice ? context.currentPrice.toFixed(2) : '---'} ·{' '}
                  {context.currentTimeEt || '9:30 ET'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* TTS Voice Toggle */}
              <button
                type="button"
                onClick={() => setTtsEnabled(!ttsEnabled)}
                className={`p-1.5 rounded-lg border text-xs transition-colors ${
                  ttsEnabled
                    ? 'border-purple-500 bg-purple-950/70 text-purple-300'
                    : 'border-neutral-800 bg-neutral-900/50 text-neutral-500 hover:text-neutral-300'
                }`}
                title={ttsEnabled ? 'Voice readout enabled' : 'Voice readout muted'}
              >
                {ttsEnabled ? '🔊' : '🔇'}
              </button>

              {/* Close Panel */}
              <button
                type="button"
                onClick={handleClose}
                className="p-1.5 rounded-lg border border-neutral-800 bg-neutral-900/50 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700 transition-colors text-xs cursor-pointer z-10"
                title="Close panel"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Time, Session & Market Telemetry Bar */}
          <div className="px-3 py-1.5 bg-neutral-900/50 border-b border-neutral-800/60 flex items-center justify-between text-[10px] font-mono text-neutral-300">
            <span className="flex items-center gap-1">
              <span className="text-neutral-500">Session:</span>
              <span className="text-amber-300 font-semibold">
                {context.sessionDetails?.sessionName ?? context.dayType ?? 'Active'}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-sky-300 font-semibold">
                {context.sessionDetails?.sessionElapsedMinutes != null
                  ? `${context.sessionDetails.sessionElapsedMinutes}m in`
                  : context.openingType ?? 'Open Auction'}
              </span>
            </span>
            {context.sessionDetails?.barCountdown && (
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {context.sessionDetails.barCountdown}
              </span>
            )}
          </div>

          {/* ── Mode Switcher Tabs (Leo Chat vs AI Stack & Big Money) ── */}
          <div className="flex items-center border-b border-neutral-800/80 bg-neutral-950/90 px-2.5 py-1.5 gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('CHAT')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-[10.5px] font-mono font-bold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'CHAT'
                  ? 'bg-purple-950/80 text-purple-200 border border-purple-500/60 shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60 border border-transparent'
              }`}
            >
              <span>🎙️</span>
              <span>Leo Order Flow</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('AI_STACK')
                if (!teamReport && !isLoadingTeam) {
                  fetchAiTeamConsensus()
                }
              }}
              className={`flex-1 py-1.5 px-2 rounded-lg text-[10.5px] font-mono font-bold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'AI_STACK'
                  ? 'bg-gradient-to-r from-amber-950/80 to-purple-950/80 text-amber-200 border border-amber-500/60 shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60 border border-transparent'
              }`}
            >
              <span>🛡️</span>
              <span>AI Stacked & Hedging</span>
            </button>
          </div>

          {/* ── Active Position Management Card (When In Trade) ── */}
          {activePos && (
            <div className="px-3 py-2 border-b border-neutral-800/80 bg-neutral-900/80">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                      activePos.direction === 'LONG'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-700'
                        : 'bg-rose-950 text-rose-400 border border-rose-700'
                    }`}
                  >
                    {activePos.direction} {activePos.positionSize}x
                  </span>
                  <span className="text-xs font-mono font-bold text-white">
                    @{activePos.entryPrice.toFixed(2)}
                  </span>
                </div>
                <div
                  className={`text-xs font-mono font-extrabold ${
                    activePos.isInProfit ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {activePos.unrealizedPnlPoints >= 0 ? '+' : ''}
                  {activePos.unrealizedPnlPoints.toFixed(1)} pts
                  {activePos.unrealizedPnlCad != null && (
                    <span className="text-[10px] ml-1 opacity-80">
                      ({activePos.unrealizedPnlCad >= 0 ? '+' : ''}
                      {activePos.unrealizedPnlCad.toFixed(2)}$)
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400 mt-1">
                <span>⏱️ {activePos.durationMinutes.toFixed(1)}m in trade</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      handleSendMessage(
                        'Leo if we are in this position and we have not moved to profit after 5 minutes, close the position.'
                      )
                    }
                    className="px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-700/60 text-amber-300 hover:bg-amber-900/90 text-[9px]"
                    title="Arm 5-minute stagnation exit rule"
                  >
                    ⏳ Arm 5m Timeout
                  </button>
                  <button
                    type="button"
                    onClick={() => executeClosePosition('Trader button click: Close position')}
                    className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[9px] shadow"
                  >
                    ⚡ Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Armed Strategy Rules & Entry Monitor Review Tray ── */}
          {armedRules.filter((r) => r.status === 'ARMED' || r.status === 'EXECUTED').length > 0 && (
            <div className="border-b border-purple-900/60 bg-neutral-950/90 divide-y divide-purple-950/60 max-h-[220px] overflow-y-auto">
              <div className="px-3 py-1 bg-purple-950/60 flex items-center justify-between text-[9px] font-mono text-purple-300">
                <span className="font-bold flex items-center gap-1">
                  <span>🎯</span>
                  <span>
                    ARMED STRATEGIES & ENTRY RULES (
                    {armedRules.filter((r) => r.status === 'ARMED').length} active)
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setArmedRules((prev) =>
                      prev.map((r) => (r.status === 'ARMED' ? { ...r, status: 'CANCELLED' as const } : r))
                    )
                  }
                  className="text-[8.5px] text-neutral-400 hover:text-rose-400 font-bold underline"
                >
                  Clear All
                </button>
              </div>

              {armedRules
                .filter((r) => r.status === 'ARMED' || r.status === 'EXECUTED')
                .map((rule) => {
                  const isConditional = rule.type === 'CONDITIONAL_ENTRY'
                  const curPx = context.currentPrice ?? 0
                  const targetPx = rule.targetPrice ?? 0
                  const dist = Math.abs(curPx - targetPx)

                  if (!isConditional) {
                    return (
                      <div
                        key={rule.id}
                        className="px-3 py-1.5 flex items-center justify-between text-[10px] font-mono text-purple-200 border-b border-purple-900/30"
                      >
                        <span className="flex items-center gap-1.5 truncate max-w-[280px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse shrink-0" />
                          <span className="truncate">{rule.description}</span>
                          {rule.isLongTerm ? (
                            <span className="px-1 py-0.5 rounded text-[8px] bg-purple-900/70 text-purple-300 border border-purple-700/60 font-bold shrink-0">
                              🧠 Long-Term
                            </span>
                          ) : (
                            <span className="px-1 py-0.5 rounded text-[8px] bg-amber-900/40 text-amber-300 border border-amber-700/50 font-bold shrink-0">
                              ⏱️ NYC Only
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {!rule.isLongTerm && rule.status === 'ARMED' && (
                            <button
                              type="button"
                              onClick={() =>
                                setArmedRules((prev) =>
                                  prev.map((r) =>
                                    r.id === rule.id
                                      ? {
                                          ...r,
                                          isLongTerm: true,
                                          description: r.description.replace(' [NYC Session]', ' [Long-Term Memory]'),
                                        }
                                      : r
                                  )
                                )
                              }
                              className="text-[8.5px] text-purple-400 hover:text-purple-300 font-bold underline mr-1"
                              title="Make this alarm persist across sessions as Long-Term Memory"
                            >
                              Make Long-Term
                            </button>
                          )}
                          {rule.status === 'ARMED' && (
                            <button
                              type="button"
                              onClick={() =>
                                setArmedRules((prev) =>
                                  prev.map((r) => (r.id === rule.id ? { ...r, status: 'CANCELLED' as const } : r))
                                )
                              }
                              className="text-[9px] text-neutral-400 hover:text-rose-400 font-bold ml-1 underline"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  }

                  // Rich Conditional Strategy Review Card
                  return (
                    <div
                      key={rule.id}
                      className={`p-2.5 space-y-1.5 text-xs font-sans transition-all ${
                        rule.status === 'EXECUTED'
                          ? 'bg-purple-950/30 border-l-2 border-purple-500'
                          : 'bg-neutral-900/80 border-l-2 border-emerald-500'
                      }`}
                    >
                      {/* Card Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {rule.status === 'ARMED' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-950/90 border border-emerald-500/60 text-[9px] font-mono font-bold text-emerald-300">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                              SCANNING ({dist.toFixed(1)} pts away)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-purple-950 border border-purple-500/70 text-[9px] font-mono font-bold text-purple-300">
                              ⚡ EXECUTED @ {rule.executedPrice?.toFixed(2)}
                            </span>
                          )}
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                              rule.direction === 'LONG'
                                ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60'
                                : 'bg-rose-900/60 text-rose-300 border border-rose-700/60'
                            }`}
                          >
                            {rule.direction} {rule.size || 1}x {rule.instrument}
                          </span>
                          {rule.isLongTerm ? (
                            <span className="px-1.5 py-0.5 rounded text-[8.5px] font-mono font-bold bg-purple-900/60 text-purple-300 border border-purple-700/60">
                              🧠 Long-Term
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[8.5px] font-mono font-bold bg-amber-900/40 text-amber-300 border border-amber-700/50">
                              ⏱️ NYC Only
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          {!rule.isLongTerm && rule.status === 'ARMED' && (
                            <button
                              type="button"
                              onClick={() =>
                                setArmedRules((prev) =>
                                  prev.map((r) =>
                                    r.id === rule.id
                                      ? {
                                          ...r,
                                          isLongTerm: true,
                                          description: r.description.replace(' [NYC Session]', ' [Long-Term Memory]'),
                                        }
                                      : r
                                  )
                                )
                              }
                              className="px-1.5 py-0.5 rounded bg-purple-950/80 hover:bg-purple-900 border border-purple-700/70 text-purple-300 text-[8.5px] font-mono font-bold transition"
                              title="Promote to Long-Term Memory (persist across sessions)"
                            >
                              Make Long-Term
                            </button>
                          )}
                          {rule.status === 'ARMED' && (
                            <button
                              type="button"
                              onClick={() =>
                                setArmedRules((prev) =>
                                  prev.map((r) => (r.id === rule.id ? { ...r, status: 'CANCELLED' as const } : r))
                                )
                              }
                              className="px-1.5 py-0.5 rounded bg-rose-950/80 hover:bg-rose-900 border border-rose-700/70 text-rose-300 text-[9px] font-mono font-bold transition"
                              title="Disarm this entry strategy"
                            >
                              Cancel Rule
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Saved User Prompt (What Was Said) */}
                      {rule.userPrompt && (
                        <div className="p-1.5 rounded bg-neutral-950/80 border border-neutral-800 text-[10px] text-purple-200 font-mono italic flex items-start gap-1">
                          <span className="text-purple-400 not-italic shrink-0">💬</span>
                          <span className="line-clamp-2">&quot;{rule.userPrompt}&quot;</span>
                        </div>
                      )}

                      {/* Conditions Key-Value Grid with Live Ticking */}
                      <div className="grid grid-cols-2 gap-1 text-[9.5px] font-mono pt-0.5">
                        <div className="flex items-center justify-between text-neutral-300 pr-1">
                          <span className="text-neutral-500 truncate">📍 Level:</span>
                          <span className="flex items-center gap-1 shrink-0">
                            <span className="text-amber-300 font-semibold" title={rule.targetReference}>
                              {targetPx.toLocaleString()}
                            </span>
                            <span className={`text-[8.5px] px-1 py-0.2 rounded font-bold ${
                              rule.conditionProgress?.levelReached || rule.status === 'EXECUTED'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                                : 'bg-neutral-800 text-neutral-400'
                            }`}>
                              {rule.conditionProgress?.levelReached || rule.status === 'EXECUTED' ? '✓' : '○'}
                            </span>
                          </span>
                        </div>

                        {rule.pattern && rule.pattern !== 'LEVEL_TOUCH' ? (
                          <div className="flex items-center justify-between text-neutral-300 pr-1">
                            <span className="text-neutral-500 truncate">⚡ Pattern:</span>
                            <span className="flex items-center gap-1 shrink-0">
                              <span className="text-sky-300 font-semibold truncate max-w-[80px]">
                                {rule.pattern.replace(/_/g, ' ')}
                              </span>
                              <span className={`text-[8.5px] px-1 py-0.2 rounded font-bold ${
                                rule.conditionProgress?.patternConfirmed || rule.status === 'EXECUTED'
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                                  : 'bg-neutral-800 text-neutral-400'
                              }`}>
                                {rule.conditionProgress?.patternConfirmed || rule.status === 'EXECUTED' ? '✓' : '○'}
                              </span>
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between text-neutral-300 pr-1">
                            <span className="text-neutral-500 truncate">📍 Entry:</span>
                            <span className="flex items-center gap-1 shrink-0">
                              <span className="text-cyan-400 font-semibold">Price Touch</span>
                              <span className={`text-[8.5px] px-1 py-0.2 rounded font-bold ${
                                rule.conditionProgress?.levelReached || rule.status === 'EXECUTED'
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                                  : 'bg-neutral-800 text-neutral-400'
                              }`}>
                                {rule.conditionProgress?.levelReached || rule.status === 'EXECUTED' ? '✓' : '○'}
                              </span>
                            </span>
                          </div>
                        )}

                        <div className="flex items-center justify-between text-neutral-300 pr-1">
                          <span className="text-neutral-500 truncate">⏱️ TF:</span>
                          <span className="flex items-center gap-1 shrink-0">
                            <span className={`font-semibold ${rule.entryTimeframe ? 'text-amber-300' : 'text-neutral-400'}`}>
                              {rule.entryTimeframe ? `${rule.entryTimeframe}m` : 'Multi-TF'}
                            </span>
                            <span className="text-[8.5px] px-1 py-0.2 rounded font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/60">
                              ✓
                            </span>
                          </span>
                        </div>

                        {rule.cvdDivergence ? (
                          <div className="flex items-center justify-between text-neutral-300 pr-1">
                            <span className="text-neutral-500 truncate">📊 CVD:</span>
                            <span className="flex items-center gap-1 shrink-0">
                              <span className="text-emerald-400 font-semibold">Divergence</span>
                              <span className={`text-[8.5px] px-1 py-0.2 rounded font-bold ${
                                rule.conditionProgress?.cvdConfirmed || rule.status === 'EXECUTED'
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                                  : 'bg-neutral-800 text-neutral-400'
                              }`}>
                                {rule.conditionProgress?.cvdConfirmed || rule.status === 'EXECUTED' ? '✓' : '○'}
                              </span>
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between text-neutral-300 pr-1">
                            <span className="text-neutral-500 truncate">🛡️ SL:</span>
                            <span className="text-neutral-300 truncate">
                              {rule.stopLossMode === 'BELOW_CANDLE_LOW'
                                ? 'Bar Low (-2p)'
                                : rule.stopLossMode === 'ABOVE_CANDLE_HIGH'
                                ? 'Bar High (+2p)'
                                : 'Bracket'}
                            </span>
                          </div>
                        )}

                        {rule.cvdDivergence && (
                          <div className="flex items-center justify-between text-neutral-300 pr-1">
                            <span className="text-neutral-500 truncate">🛡️ SL:</span>
                            <span className="text-neutral-300 truncate">
                              {rule.stopLossMode === 'BELOW_CANDLE_LOW'
                                ? 'Bar Low (-2p)'
                                : rule.stopLossMode === 'ABOVE_CANDLE_HIGH'
                                ? 'Bar High (+2p)'
                                : 'Bracket'}
                            </span>
                          </div>
                        )}

                        <div className="flex items-center justify-between text-neutral-300 pr-1">
                          <span className="text-neutral-500 truncate">🎯 Target:</span>
                          <span className="text-emerald-300 font-semibold truncate">
                            {rule.takeProfitMode || '1:2'} R:R
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          )}

          {activeTab === 'CHAT' ? (
            <>
              {/* ── User Drawn Tools Quick-Attach Strip ── */}
          {context.userDrawings &&
            (context.userDrawings.trendlines.length > 0 ||
              context.userDrawings.ranges.length > 0 ||
              context.userDrawings.frvps.length > 0) && (
              <div className="px-3 py-1.5 border-b border-neutral-800/60 bg-neutral-950/60 flex flex-wrap items-center gap-1.5">
                <span className="text-[9px] text-cyan-400 font-mono font-semibold flex items-center gap-1">
                  <span>🎨</span> Drawn:
                </span>
                {context.userDrawings.trendlines.map((t) => (
                  <div key={t.id} className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (attachedPoints.some((p) => p.id === `user-tl-${t.id}`)) return
                        setAttachedPoints((prev) => [
                          ...prev,
                          {
                            id: `user-tl-${t.id}`,
                            label: t.label || 'Trendline',
                            value: `${t.startPrice.toLocaleString()} → ${t.endPrice.toLocaleString()}`,
                            tier: 'DRAWING',
                            category: 'TRENDLINE',
                            description: `${t.slopeDirection} trendline (${t.slopePtsPer5mBar} pts/5m). Price is ${t.priceRelation}.`,
                          },
                        ])
                      }}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-950/60 hover:bg-sky-900/80 border border-sky-600/50 text-[9.5px] font-mono text-sky-200 transition shadow-sm"
                      title="Click to attach this trendline to your message"
                    >
                      <span>📐</span> {t.label || 'Trendline'}
                    </button>
                    {t.slopeDirection === 'DESCENDING' && (
                      <button
                        type="button"
                        onClick={() => {
                          const inst = (context.instrument || 'GOLD') as MarketInstrument
                          const newRule = addRule({
                            instrument: inst,
                            type: 'TRENDLINE_BREAKOUT_SYSTEMATIC',
                            direction: 'LONG',
                            description: `Long 1 ${inst} on 5m Candle Close above ${t.label || 'Bearish Trendline'} (Trend-Borning Zone)`,
                            userPrompt: `Monitor ${t.label || 'Bearish Trendline'}. Enter Long 1 ${inst} when 5m candle closes above trendline. SL below breakout candle low, TP +50 pts (or 1:2 R:R), exit on 5m candle close below dynamic responsive trendline.`,
                            targetReference: t.label || 'Bearish Trendline',
                            targetPrice: t.projectedPrice || t.endPrice,
                            pattern: 'TRENDLINE_BREAKOUT_5M',
                            stopLossMode: 'BELOW_CANDLE_LOW',
                            takeProfitMode: 'FIXED_POINTS',
                            takeProfit: 50,
                            size: 1,
                            isLongTerm: true,
                            session: '24H',
                            status: 'ARMED',
                            trendlineId: t.id,
                            conditions: {
                              trendlineId: t.id,
                              pattern: 'TRENDLINE_BREAKOUT_5M',
                              stopLossMode: 'BELOW_CANDLE_LOW',
                              takeProfitMode: 'FIXED_POINTS',
                              takeProfit: 50,
                              size: 1,
                            },
                          })
                          setArmedRules((prev) => [newRule as any, ...prev.filter((r) => r.id !== newRule.id)])
                          setMessages((prev) => [
                            ...prev,
                            {
                              id: `leo-arm-${Date.now()}`,
                              role: 'assistant',
                              content: `🎯 **[TRENDLINE STRATEGY ARMED]**\nMonitoring **${t.label || 'Bearish Trendline'}** on **${inst}**.\n• **Entry Trigger**: Strict 5-minute candle close strictly above trendline.\n• **Trend-Borning Zone**: Lowest pivot low evaluated across 7 institutional factors (POCs, RVOL, Rejection Tails, 5M AVWAP, Round Handles, Liquidity, Time).\n• **Default Risk**: Stop Loss below breakout candle low · Take Profit: +50.0 pts.\n• **Dynamic Exit**: Trailing responsive trendline with time-decay acceleration on range chop.`,
                              timestamp: Date.now(),
                            },
                          ])
                        }}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-950/80 hover:bg-amber-900 border border-amber-500/60 text-[9px] font-mono font-bold text-amber-300 transition shadow-sm"
                        title="Arm Systematic Trendline Breakout & Trend-Borning Zone Strategy"
                      >
                        <span>⚡</span> Arm Borning Strategy
                      </button>
                    )}
                  </div>
                ))}
                {context.userDrawings.ranges.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      if (attachedPoints.some((p) => p.id === `user-range-${r.id}`)) return
                      setAttachedPoints((prev) => [
                        ...prev,
                        {
                          id: `user-range-${r.id}`,
                          label: r.label || 'Range Box',
                          value: `${r.priceLow.toLocaleString()} – ${r.priceHigh.toLocaleString()}`,
                          tier: 'DRAWING',
                          category: 'RANGE',
                          description: `${r.heightPts} pts span (${r.durationMin}m). Price is ${r.priceRelation} range.`,
                        },
                      ])
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-950/60 hover:bg-purple-900/80 border border-purple-600/50 text-[9.5px] font-mono text-purple-200 transition shadow-sm"
                    title="Click to attach this range box to your message"
                  >
                    <span>⬛</span> {r.label || 'Range'} ({r.heightPts}p)
                  </button>
                ))}
                {context.userDrawings.frvps.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      if (attachedPoints.some((p) => p.id === `user-frvp-${f.id}`)) return
                      setAttachedPoints((prev) => [
                        ...prev,
                        {
                          id: `user-frvp-${f.id}`,
                          label: f.label || 'Manual FRVP',
                          value: `POC ${f.poc.toLocaleString()}`,
                          tier: 'DRAWING',
                          category: 'FRVP',
                          volume: f.totalVolume,
                          description: `Manual FRVP: POC ${f.poc} | VAH ${f.vah} | VAL ${f.val}. Price is ${f.priceRelation.replace('_', ' ')}.`,
                        },
                      ])
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/60 hover:bg-amber-900/80 border border-amber-600/50 text-[9.5px] font-mono text-amber-200 transition shadow-sm"
                    title="Click to attach this manual FRVP to your message"
                  >
                    <span>📊</span> FRVP (POC {f.poc.toLocaleString()})
                  </button>
                ))}
              </div>
            )}

          {/* ── Clean Clicked Chart Reference Pill (Direct from Canvas Arrows) ── */}
          {attachedPoints.length > 0 && (
            <div className="px-3 py-1.5 border-b border-neutral-800/70 bg-neutral-900/70 flex flex-wrap items-center gap-1">
              <span className="text-[9px] text-neutral-400 font-mono">Attached:</span>
              {attachedPoints.map((pt) => (
                <span
                  key={pt.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-950/90 border border-purple-500/70 text-[10px] font-mono text-purple-200 shadow-sm"
                >
                  <span className="font-bold">
                    {pt.category === 'TRENDLINE'
                      ? '📐'
                      : pt.category === 'RANGE'
                        ? '⬛'
                        : pt.category === 'FRVP'
                          ? '📊'
                          : '📍'}{' '}
                    {pt.label}:
                  </span>
                  <span className="text-amber-300 font-semibold">{pt.value}</span>
                  {pt.volume && <span className="text-neutral-400">({pt.volume})</span>}
                  {pt.retestRatio != null && (
                    <span className="text-sky-300 font-semibold">[{pt.retestRatio}x]</span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveDataPoint(pt.id)}
                    className="hover:text-rose-400 font-bold ml-1 text-xs"
                    title="Remove attached point"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => setAttachedPoints([])}
                className="text-[8px] text-neutral-500 hover:text-neutral-300 underline ml-1"
              >
                Clear
              </button>
            </div>
          )}

          {/* Quick Prompt Strip */}
              <div className="px-3 py-1.5 border-b border-neutral-800/60 bg-neutral-950/40 flex items-center gap-1.5 overflow-x-auto shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('AI_STACK')
                    if (!teamReport && !isLoadingTeam) fetchAiTeamConsensus()
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-950/60 hover:bg-amber-900/80 border border-amber-500/50 text-[9.5px] font-mono text-amber-200 shrink-0 transition shadow-sm"
                >
                  <span>🛡️</span> Where big guys hedge?
                </button>
                <button
                  type="button"
                  onClick={() => handleSendMessage(`Leo, analyze order flow delta vs VWAP on ${context.instrument} and advise trade setup.`)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-950/60 hover:bg-purple-900/80 border border-purple-500/50 text-[9.5px] font-mono text-purple-200 shrink-0 transition shadow-sm"
                >
                  <span>⚡</span> Order Flow Setup
                </button>
                <button
                  type="button"
                  onClick={() => handleSendMessage(`Leo, summarize key auction tails and Dalton day type for ${context.instrument}.`)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-950/60 hover:bg-sky-900/80 border border-sky-500/50 text-[9.5px] font-mono text-sky-200 shrink-0 transition shadow-sm"
                >
                  <span>📊</span> Dalton Day Type
                </button>
              </div>

              {/* Conversation History */}
              <div className="flex-1 p-3 overflow-y-auto space-y-3 font-sans text-xs min-h-[160px]">
            {messages.map((msg) => {
              const isUser = msg.role === 'user'
              // Strip <execute> block from regular visual chat text
              const displayContent = (msg.content || '').replace(/<execute>[\s\S]*?<\/execute>/gi, '').trim()

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="font-mono text-[9px] text-neutral-400 uppercase">
                      {isUser ? 'Trader' : 'Leo AI'}
                    </span>
                    <span className="font-mono text-[8px] text-neutral-600">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>

                  <div
                    className={`max-w-[92%] px-3.5 py-2.5 rounded-xl border leading-relaxed ${
                      isUser
                        ? 'bg-purple-900/40 border-purple-500/50 text-purple-100 rounded-br-sm'
                        : 'bg-neutral-900/80 border-neutral-800 text-neutral-200 rounded-bl-sm shadow-md'
                    }`}
                  >
                    {/* Attached Data Point Chips on User Messages */}
                    {msg.attachedPoints && msg.attachedPoints.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2 pb-1.5 border-b border-purple-700/40">
                        {msg.attachedPoints.map((pt) => (
                          <span
                            key={pt.id}
                            className="px-1.5 py-0.2 rounded bg-purple-950/80 border border-purple-600/60 text-[9px] font-mono text-purple-300"
                          >
                            {pt.category === 'TRENDLINE'
                              ? '📐'
                              : pt.category === 'RANGE'
                                ? '⬛'
                                : pt.category === 'FRVP'
                                  ? '📊'
                                  : '📍'}{' '}
                            {pt.label}: {pt.value} {pt.volume ? `(${pt.volume})` : ''}{' '}
                            {pt.retestRatio != null ? `[${pt.retestRatio}x]` : ''}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Message Body */}
                    <div className="whitespace-pre-wrap select-text selection:bg-purple-500/30">
                      {displayContent || (
                        <span className="inline-flex items-center gap-1 text-purple-400 animate-pulse font-mono text-[11px]">
                          Leo thinking...
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Voice Feedback Preview if Listening */}
          {isListening && (
            <div className="px-3 py-2 bg-purple-950/80 border-t border-purple-600/60 flex items-center justify-between text-xs font-mono text-purple-200">
              <div className="flex items-center gap-2 min-w-0">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                <span className="font-semibold text-purple-100 truncate">
                  Listening continuously... Speak naturally (won&apos;t disconnect)
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {inputPrompt.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      stopListening()
                      handleSendMessage()
                    }}
                    className="px-2 py-0.5 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold text-[11px] shadow-sm transition-all"
                  >
                    Done & Send ↵
                  </button>
                )}
                <button
                  type="button"
                  onClick={stopListening}
                  className="px-1.5 py-0.5 text-[11px] text-neutral-400 hover:text-neutral-200"
                >
                  Stop
                </button>
              </div>
            </div>
          )}

          {/* Input & Voice Controls Bar */}
          <div className="p-2.5 border-t border-neutral-800/80 bg-neutral-900/70 space-y-1.5">
            {/* Quick Action Suggestion Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 text-[9.5px] font-mono">
              <button
                type="button"
                onClick={() => {
                  const inst = (context.instrument || 'NASDAQ') as MarketInstrument
                  const meta = MARKET_DEFAULT_PARAMS[inst] || { defaultPrice: 29450, defaultPoints: 20 }
                  const targetPx = context.currentPrice ?? meta.defaultPrice
                  const pts = meta.defaultPoints
                  armMarketOneToOneSituation(inst, {
                    price: targetPx,
                    direction: 'LONG',
                    points: pts,
                  })
                  playTradingViewChime()
                  const sl = Number((targetPx - pts).toFixed(2))
                  const tp = Number((targetPx + pts).toFixed(2))
                  successToast(
                    `⚡ [1:1 ${inst} ARMED]: Long @ ${targetPx.toLocaleString()} | SL: ${sl.toLocaleString()} | TP: ${tp.toLocaleString()}`,
                    8000
                  )
                  speakText(`Armed one to one ${inst} situation at ${targetPx.toLocaleString()}.`)
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `sit-chip-${Date.now()}`,
                      role: 'assistant',
                      content: `⚡ **[1:1 ${inst} SITUATION ARMED]**\n\n- **Instrument**: ${inst}\n- **Target Entry**: **${targetPx.toLocaleString()}** (Price Touch)\n- **Stop Loss**: **${sl.toLocaleString()}** (-${pts} pts)\n- **Take Profit**: **${tp.toLocaleString()}** (+${pts} pts)\n- **Risk:Reward**: **1:1**\n\n*Condition is set to immediate level touch. Leo is evaluating price and will fire the order directly onto the chart canvas.*`,
                      timestamp: Date.now(),
                    },
                  ])
                }}
                className="px-2 py-0.5 rounded-md bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-600/70 hover:border-emerald-500 text-emerald-200 hover:text-white shrink-0 transition font-bold flex items-center gap-1 shadow-sm"
                title={`Arm 1:1 Risk-to-Reward ${context.instrument} situation right now at market price`}
              >
                <span>⚡</span> 1:1 {context.instrument} Live
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSendMessage(
                    `Leo, what are our must-act levels, dealer gamma walls, and CTA triggers for ${context.instrument}?`
                  )
                }
                className="px-2 py-0.5 rounded-md bg-neutral-800/80 hover:bg-purple-950/60 border border-neutral-700/60 hover:border-purple-600/60 text-neutral-300 hover:text-purple-200 shrink-0 transition"
                title="Quick query Big Money levels"
              >
                🎯 Big Money Triggers
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSendMessage(
                    `Leo, audit our session market structure, opening type, and CVD order flow for ${context.instrument}.`
                  )
                }
                className="px-2 py-0.5 rounded-md bg-neutral-800/80 hover:bg-purple-950/60 border border-neutral-700/60 hover:border-purple-600/60 text-neutral-300 hover:text-purple-200 shrink-0 transition"
                title="Audit active session and order flow"
              >
                📊 Session & CVD
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSendMessage(
                    `Leo, evaluate current position risk, rule status, and proximity to major reference magnets.`
                  )
                }
                className="px-2 py-0.5 rounded-md bg-neutral-800/80 hover:bg-purple-950/60 border border-neutral-700/60 hover:border-purple-600/60 text-neutral-300 hover:text-purple-200 shrink-0 transition"
                title="Evaluate trade risk and rules"
              >
                🛡️ Risk & Rules
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (isListeningRef.current) {
                  stopListening()
                }
                handleSendMessage()
              }}
              className="flex items-end gap-1.5"
            >
              {/* Mic Voice Button */}
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`relative p-2 rounded-xl border transition-all shrink-0 mb-0.5 ${
                    isListening
                      ? 'border-red-500 bg-red-950/80 text-red-200 ring-2 ring-red-400 ring-offset-1 ring-offset-neutral-950'
                      : 'border-neutral-800 bg-neutral-800/60 text-neutral-400 hover:text-purple-300 hover:border-purple-600 hover:bg-neutral-800'
                  }`}
                  title={isListening ? 'Click to stop listening' : 'Click to speak to Leo (Voice Chat)'}
                >
                  {isListening ? (
                    <span className="flex items-center justify-center w-4 h-4 text-xs animate-bounce">
                      🎙️
                    </span>
                  ) : (
                    <span className="flex items-center justify-center w-4 h-4 text-xs">
                      🎤
                    </span>
                  )}
                </button>
              )}

              {/* Multiline Interactive Textarea with Clear Button */}
              <div className="relative flex-1 flex items-center min-w-0">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (inputPrompt.trim()) {
                        if (isListeningRef.current) {
                          stopListening()
                        }
                        handleSendMessage()
                      }
                    }
                  }}
                  placeholder={
                    isListening
                      ? 'Listening to speech...'
                      : 'Ask Leo anything, discuss setups, or give trade commands...'
                  }
                  className="w-full px-3 py-2 pr-7 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-purple-500 transition-colors font-sans resize-none overflow-y-auto min-h-[38px] max-h-[130px] leading-relaxed"
                />
                {inputPrompt.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setInputPrompt('')
                      inputPromptRef.current = ''
                      sessionBaseTranscriptRef.current = ''
                      if (textareaRef.current) textareaRef.current.style.height = '38px'
                    }}
                    className="absolute right-2 top-2.5 text-neutral-500 hover:text-neutral-200 text-xs transition z-10"
                    title="Clear input"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Send Button */}
              <button
                type="submit"
                disabled={!inputPrompt.trim()}
                className="px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white font-mono text-xs font-semibold shadow-md transition-all active:scale-95 flex items-center justify-center shrink-0 mb-0.5 min-h-[38px]"
              >
                {isStreaming ? (
                  <span className="animate-spin text-[10px]">⟳</span>
                ) : (
                  <span>Send</span>
                )}
              </button>
            </form>

            <div className="flex items-center justify-between px-1 text-[8.5px] font-mono text-neutral-500">
              <span>Enter ↵ to send • Shift + Enter for new line</span>
              <span>{inputPrompt.length > 0 ? `${inputPrompt.length} chars` : ''}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-3 font-sans text-xs flex flex-col min-h-0 select-text">
          {/* Loading state */}
          {isLoadingTeam && (
            <div className="flex flex-col items-center justify-center py-16 space-y-3 text-neutral-400 my-auto">
              <div className="w-8 h-8 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
              <div className="font-mono text-xs text-purple-300 font-bold">
                Synthesizing AI Stack & Big Money Telemetry...
              </div>
              <div className="text-[10px] text-neutral-500 text-center max-w-[280px]">
                Auditing dealer gamma, systematic CTA bands, basis arbitrage, and running anti-hallucination verification
              </div>
            </div>
          )}

          {/* Error state */}
          {!isLoadingTeam && teamError && (
            <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-800/60 text-rose-300 space-y-2">
              <div className="font-mono font-bold flex items-center gap-1.5">
                <span>⚠️</span> Team Consensus Error
              </div>
              <div className="text-[11px] text-rose-200">{teamError}</div>
              <button
                type="button"
                onClick={fetchAiTeamConsensus}
                className="px-2.5 py-1 rounded bg-rose-900 hover:bg-rose-800 text-white font-mono text-[10px]"
              >
                Retry Consensus
              </button>
            </div>
          )}

          {/* Empty / Not Loaded Yet */}
          {!isLoadingTeam && !teamReport && !teamError && (
            <div className="flex flex-col items-center justify-center py-12 space-y-3 text-neutral-400 my-auto text-center">
              <span className="text-3xl">🛡️</span>
              <div className="font-mono text-xs text-neutral-200 font-bold">
                Institutional Hedging Stack
              </div>
              <div className="text-[10px] text-neutral-400 max-w-[260px]">
                Detect where market makers and systematic CTAs must hedge futures positions on {context.instrument}.
              </div>
              <button
                type="button"
                onClick={fetchAiTeamConsensus}
                className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-semibold shadow-md transition-all"
              >
                Run Team Audit
              </button>
            </div>
          )}

          {/* Report Loaded */}
          {!isLoadingTeam && teamReport && (
            <>
              {/* 0. Session Playbook Lifecycle Window Banner */}
              <div
                className={`p-2.5 rounded-xl border space-y-1 shrink-0 ${
                  isPreSessionPlaybookWindow
                    ? 'bg-emerald-950/40 border-emerald-800/60'
                    : 'bg-amber-950/40 border-amber-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`font-mono text-[10px] font-bold flex items-center gap-1.5 ${
                      isPreSessionPlaybookWindow ? 'text-emerald-300' : 'text-amber-300'
                    }`}
                  >
                    <span>{isPreSessionPlaybookWindow ? '🟢' : '🟡'}</span>
                    {isPreSessionPlaybookWindow
                      ? 'Pre-Session Playbook Window (Active until 09:15 ET)'
                      : 'NYC Session Active (Pre-Session Closed at 09:15 ET)'}
                  </span>
                  <span
                    className={`text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                      isPreSessionPlaybookWindow
                        ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700/60'
                        : 'bg-amber-900/60 text-amber-300 border-amber-700/60'
                    }`}
                  >
                    {isPreSessionPlaybookWindow ? 'PLANNING PHASE' : 'REACTION VERIFICATION'}
                  </span>
                </div>
                <div
                  className={`text-[10px] leading-tight ${
                    isPreSessionPlaybookWindow ? 'text-emerald-200/80' : 'text-amber-200/80'
                  }`}
                >
                  {isPreSessionPlaybookWindow
                    ? 'Big Money dealer gamma & CTA triggers establish the pre-market blueprint. Use "Discuss Playbook" to lock your execution plan before cash open.'
                    : 'Pre-market levels are theoretical until price approaches. Only when the market actually reacts (holds or breaches) does a level become actionable.'}
                </div>
              </div>

              {/* 1. Executive Team Consensus Hero Card */}
              <div className="p-3 rounded-xl bg-neutral-900/90 border border-neutral-800/90 space-y-2 shadow-lg shrink-0">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-400 font-bold flex items-center gap-1">
                    <span>🏛️</span> Executive Consensus
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-extrabold border ${
                      teamReport.consensusBias === 'BULLISH'
                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
                        : teamReport.consensusBias === 'BEARISH'
                        ? 'bg-rose-950/80 text-rose-300 border-rose-700/80'
                        : teamReport.consensusBias === 'VOLATILE'
                        ? 'bg-amber-950/80 text-amber-300 border-amber-700/80'
                        : 'bg-sky-950/80 text-sky-300 border-sky-700/80'
                    }`}
                  >
                    {teamReport.consensusBias} ({teamReport.consensusConfidence}% Conviction)
                  </span>
                </div>

                {/* Anti-Hallucination & Consequence Verifier Badge */}
                <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-neutral-950/80 border border-neutral-800 text-[10px] font-mono">
                  <div className="flex items-center gap-1.5">
                    <span className={teamReport.verification.passedVerification ? 'text-emerald-400' : 'text-amber-400'}>
                      {teamReport.verification.passedVerification ? '🛡️' : '⚠️'}
                    </span>
                    <span className="text-neutral-300 font-semibold">Verifier Critic:</span>
                    <span className={teamReport.verification.passedVerification ? 'text-emerald-300' : 'text-amber-300'}>
                      {teamReport.verification.passedVerification ? 'Ground Truth Verified' : 'Flags Raised'}
                    </span>
                  </div>
                  <span className="text-neutral-400 font-bold">
                    {teamReport.verification.groundingScore}% Grounded
                  </span>
                </div>

                {/* Any Contradictions / Warnings Detected */}
                {teamReport.verification.riskConsequences.length > 0 && (
                  <div className="p-2 rounded-lg bg-amber-950/40 border border-amber-800/50 space-y-1">
                    <span className="text-[10px] font-mono font-bold text-amber-300 flex items-center gap-1">
                      <span>⚠️</span> Risk & Contradiction Alerts:
                    </span>
                    {teamReport.verification.riskConsequences.map((c, idx) => (
                      <div key={idx} className="text-[10px] text-amber-200/90 leading-tight">
                        • {c}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. PLACES THEY MUST ACT (Big Money Institutional Hedging) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="font-mono text-[10.5px] font-bold text-amber-300 flex items-center gap-1.5">
                    <span>🎯</span> Places They Must Act (CME Big Money)
                  </span>
                  <span className="text-[9px] font-mono text-neutral-500">
                    Dealer & CTA Triggers
                  </span>
                </div>

                {teamReport.placesTheyMustAct.length === 0 ? (
                  <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 text-neutral-400 text-center text-xs">
                    No critical must-act threshold within immediate range.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {teamReport.placesTheyMustAct.map((place, idx) => {
                      const diff = (context.currentPrice || teamReport.livePrice) - place.price
                      const diffFormatted = diff >= 0 ? `+${diff.toFixed(1)}` : `${diff.toFixed(1)}`

                      return (
                        <div
                          key={idx}
                          className="p-2.5 rounded-xl bg-neutral-900/80 border border-neutral-800 hover:border-amber-500/50 transition-all space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-extrabold text-sm text-white">
                                {place.price.toLocaleString()}
                              </span>
                              <span
                                className={`font-mono text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                  place.urgency === 'EXTREME'
                                    ? 'bg-rose-950 text-rose-300 border-rose-700'
                                    : place.urgency === 'HIGH'
                                    ? 'bg-amber-950 text-amber-300 border-amber-700'
                                    : 'bg-sky-950 text-sky-300 border-sky-700'
                                }`}
                              >
                                {place.urgency}
                              </span>
                              <span className="font-mono text-[9px] text-purple-300 bg-purple-950/60 border border-purple-800/60 px-1 py-0.5 rounded">
                                {place.type.replace('_', ' ')}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <span
                                className={`font-mono text-[10px] font-bold ${
                                  diff >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {diffFormatted} pts
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setAttachedPoints((prev) => [
                                    ...prev,
                                    {
                                      id: `must-act-${place.price}-${idx}`,
                                      label: place.type,
                                      value: place.price,
                                      tier: 'ST',
                                      category: 'EXTREME',
                                      description: place.description,
                                    },
                                  ])
                                  setActiveTab('CHAT')
                                }}
                                className="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-[9px] font-mono text-neutral-200 transition"
                                title="Attach this level to Leo Chat"
                              >
                                📌 Attach
                              </button>
                            </div>
                          </div>

                          <div className="text-[10px] text-neutral-300 leading-relaxed font-sans">
                            {place.description}
                          </div>

                          {/* Live Market Reaction Status */}
                          {place.reactionStatus && (
                            <div className="flex items-center justify-between mt-1 pt-1 border-t border-neutral-800/70 text-[9px] font-mono">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[8px] font-extrabold border shrink-0 ${
                                    place.reactionStatus === 'HELD'
                                      ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                                      : place.reactionStatus === 'BREACHED'
                                      ? 'bg-rose-950 text-rose-300 border-rose-700'
                                      : place.reactionStatus === 'TESTING'
                                      ? 'bg-amber-950 text-amber-300 border-amber-700 animate-pulse'
                                      : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                                  }`}
                                >
                                  {place.reactionStatus === 'HELD'
                                    ? '🛡️ HELD / DEFENDED'
                                    : place.reactionStatus === 'BREACHED'
                                    ? '⚠️ BREACHED'
                                    : place.reactionStatus === 'TESTING'
                                    ? '🎯 TESTING NOW'
                                    : '⏳ PENDING TEST'}
                                </span>
                                <span className="text-neutral-400 truncate">{place.reactionDetail}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 3. MULTI-AGENT SPECIALIST BREAKDOWN */}
              <div className="space-y-2 pt-1">
                <div className="font-mono text-[10.5px] font-bold text-purple-300 flex items-center gap-1.5 px-1">
                  <span>🤖</span> Specialist Breakdown Matrix
                </div>

                {/* Aegis: Hedging & Gamma */}
                <div className="p-2.5 rounded-xl bg-neutral-900/70 border border-purple-900/40 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold text-purple-200">
                      Aegis (Hedging & Dealer Positioning)
                    </span>
                    <span className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-purple-950 text-purple-300 border border-purple-800">
                      {teamReport.agentBreakdowns.institutionalHedging.bias}
                    </span>
                  </div>
                  {hedgingTelemetry && (
                    <div className="grid grid-cols-2 gap-1.5 text-[9.5px] font-mono">
                      <div className="p-1.5 rounded bg-neutral-950/70 border border-neutral-800/80">
                        <div className="text-neutral-500 text-[8.5px]">Dealer Gamma</div>
                        <div className="text-amber-300 font-bold">{hedgingTelemetry.dealerGamma.currentRegime}</div>
                        <div className="text-neutral-400 text-[8.5px]">Zero: {hedgingTelemetry.dealerGamma.zeroGammaLevel}</div>
                      </div>
                      <div className="p-1.5 rounded bg-neutral-950/70 border border-neutral-800/80">
                        <div className="text-neutral-500 text-[8.5px]">CTA Systematic</div>
                        <div className="text-sky-300 font-bold">{hedgingTelemetry.ctaBands.trendBias}</div>
                        <div className="text-neutral-400 text-[8.5px]">Liq: {hedgingTelemetry.ctaBands.ctaLiquidationTrigger}</div>
                      </div>
                    </div>
                  )}
                  <div className="text-[10px] text-neutral-300 leading-snug">
                    {teamReport.agentBreakdowns.institutionalHedging.suggestedAction}
                  </div>
                </div>

                {/* Leo: Order Flow Microstructure */}
                <div className="p-2.5 rounded-xl bg-neutral-900/70 border border-sky-900/40 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold text-sky-200">
                      Leo (Microstructure & Order Flow)
                    </span>
                    <span className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-800">
                      {teamReport.agentBreakdowns.microstructure.bias}
                    </span>
                  </div>
                  <div className="text-[10px] text-neutral-300 leading-snug">
                    {teamReport.agentBreakdowns.microstructure.thesis}
                  </div>
                </div>

                {/* News AI: Macro Sentiment */}
                <div className="p-2.5 rounded-xl bg-neutral-900/70 border border-amber-900/40 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold text-amber-200">
                      News AI (Macro Catalysts)
                    </span>
                    <span className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800">
                      {teamReport.agentBreakdowns.macroNews.bias}
                    </span>
                  </div>
                  <div className="text-[10px] text-neutral-300 leading-snug">
                    {teamReport.agentBreakdowns.macroNews.thesis}
                  </div>
                </div>
              </div>

              {/* Cost & Refresh Information */}
              <div className="pt-2 flex items-center justify-between text-[9px] font-mono text-neutral-400 px-1 mt-auto">
                <span className="flex items-center gap-1">
                  <span className="text-emerald-400 font-bold">⚡</span>
                  <span>Free Local Engine ($0.00 API Cost)</span>
                </span>
                {teamReport && (
                  <span className="text-neutral-500">
                    Computed {new Date(teamReport.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
              </div>

              {/* Bottom Actions */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchAiTeamConsensus}
                  disabled={isLoadingTeam}
                  className="flex-1 py-2 px-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 font-mono text-[10.5px] font-semibold transition flex items-center justify-center gap-1.5 active:scale-95"
                  title="Re-evaluates dealer gamma, CTA bands, and live market reactions locally ($0.00 API cost)"
                >
                  <span>⚡</span>
                  <span>Refresh Consensus</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('CHAT')
                    if (isPreSessionPlaybookWindow) {
                      handleSendMessage(
                        `Leo, walk me through our pre-session hedging playbook around the ${teamReport.placesTheyMustAct.length} must-act levels and our execution rules for ${context.instrument} before the NYC open.`
                      )
                    } else {
                      handleSendMessage(
                        `Leo, the NYC session is active (pre-session window closed at 09:15 ET). Review how the market is actually reacting to our must-act levels: which levels have held, which have breached, and how does this affect our active trade management on ${context.instrument}?`
                      )
                    }
                  }}
                  className="flex-1 py-2 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-mono text-[10.5px] font-bold transition flex items-center justify-center gap-1.5 active:scale-95 shadow-md"
                  title={
                    isPreSessionPlaybookWindow
                      ? 'Discuss pre-session game plan before cash open'
                      : 'Discuss live market reactions to must-act levels (pre-session window closed at 09:15 ET)'
                  }
                >
                  <span>💬</span>
                  <span>{isPreSessionPlaybookWindow ? 'Discuss Playbook' : 'Discuss Live Reactions'}</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )}
</>
  )
}
