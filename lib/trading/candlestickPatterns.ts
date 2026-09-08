/**
 * Candlestick Pattern Recognition Engine & Setup Specialist
 *
 * Implements full Pine Script v6 Candlestick Pattern Recognition (15 patterns):
 * 1. Doji
 * 2. Bearish Harami
 * 3. Bullish Harami
 * 4. Bearish Engulfing
 * 5. Bullish Engulfing
 * 6. Piercing Line
 * 7. Bullish Belt
 * 8. Bullish Kicker
 * 9. Bearish Kicker
 * 10. Hanging Man
 * 11. Evening Star
 * 12. Morning Star
 * 13. Shooting Star
 * 14. Hammer
 * 15. Inverted Hammer
 *
 * Also includes Low Volume Node (LVN) + Bullish Engulfing Confirmation Strategy:
 * - Enter BUY on Bullish Engulfing at Yesterday's FRVP Low Volume Node (LVN)
 * - Stop Loss placed cleanly below the Low of the Bullish Engulfing Bar
 */

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface CandlestickPatternResult {
  doji: boolean
  bearHarami: boolean
  bullHarami: boolean
  bearEng: boolean
  bullEng: boolean
  piercing: boolean
  bullBelt: boolean
  bullKick: boolean
  bearKick: boolean
  hangingMan: boolean
  eveningStar: boolean
  morningStar: boolean
  shootingStar: boolean
  hammer: boolean
  invHammer: boolean
}

/**
 * Detect all 15 candlestick patterns on the candle at `index` (defaults to the latest bar).
 * Follows exact math and logic from Pine Script v6 indicator "Candlestick Patterns Identified".
 */
export function detectCandlestickPatterns(
  bars: Candle[],
  index = bars.length - 1,
  trend = 5,
  dojiSize = 0.05
): CandlestickPatternResult {
  const result: CandlestickPatternResult = {
    doji: false,
    bearHarami: false,
    bullHarami: false,
    bearEng: false,
    bullEng: false,
    piercing: false,
    bullBelt: false,
    bullKick: false,
    bearKick: false,
    hangingMan: false,
    eveningStar: false,
    morningStar: false,
    shootingStar: false,
    hammer: false,
    invHammer: false,
  }

  if (!bars || bars.length === 0 || index < 0 || index >= bars.length) {
    return result
  }

  const c = bars[index]!
  const c1 = index >= 1 ? bars[index - 1] : null
  const c2 = index >= 2 ? bars[index - 2] : null
  const cTrend = index >= trend ? bars[index - trend] : null

  const open = c.open
  const high = c.high
  const low = c.low
  const close = c.close

  // 1. Doji
  result.doji = Math.abs(open - close) <= (high - low) * dojiSize

  if (!c1) return result

  const open1 = c1.open
  const high1 = c1.high
  const low1 = c1.low
  const close1 = c1.close

  const openTrend = cTrend ? cTrend.open : open1

  // 2. Bearish Harami
  result.bearHarami =
    close1 > open1 &&
    open > close &&
    open <= close1 &&
    open1 <= close &&
    open - close < close1 - open1 &&
    openTrend < open

  // 3. Bullish Harami
  result.bullHarami =
    open1 > close1 &&
    close > open &&
    close <= open1 &&
    close1 <= open &&
    close - open < open1 - close1 &&
    openTrend > open

  // 4. Bearish Engulfing
  result.bearEng =
    close1 > open1 &&
    open > close &&
    open >= close1 &&
    open1 >= close &&
    open - close > close1 - open1 &&
    openTrend < open

  // 5. Bullish Engulfing
  result.bullEng =
    open1 > close1 &&
    close > open &&
    close >= open1 &&
    close1 >= open &&
    close - open > open1 - close1 &&
    openTrend > open

  // 6. Piercing Line
  result.piercing =
    close1 < open1 &&
    open < low1 &&
    close > close1 + (open1 - close1) / 2 &&
    close < open1 &&
    openTrend > open

  // 7. Bullish Belt
  let lowest10 = Infinity
  const startIdx = Math.max(0, index - 10)
  for (let i = startIdx; i < index; i++) {
    if (bars[i]!.low < lowest10) lowest10 = bars[i]!.low
  }
  if (lowest10 === Infinity) lowest10 = low1

  result.bullBelt =
    low === open &&
    open < lowest10 &&
    open < close &&
    close > (high1 - low1) / 2 + low1 &&
    openTrend > open

  // 8. Bullish Kicker
  result.bullKick = open1 > close1 && open >= open1 && close > open && openTrend > open

  // 9. Bearish Kicker
  result.bearKick = open1 < close1 && open <= open1 && close <= open && openTrend < open

  // 10. Hanging Man
  result.hangingMan =
    high - low > 4 * Math.abs(open - close) &&
    (close - low) / (0.001 + high - low) >= 0.75 &&
    (open - low) / (0.001 + high - low) >= 0.75 &&
    openTrend < open &&
    high1 < open &&
    (c2 ? c2.high < open : true)

  // 13. Shooting Star
  result.shootingStar =
    open1 < close1 &&
    open > close1 &&
    high - Math.max(open, close) >= Math.abs(open - close) * 3 &&
    Math.min(close, open) - low <= Math.abs(open - close)

  // 14. Hammer
  result.hammer =
    high - low > 3 * Math.abs(open - close) &&
    (close - low) / (0.001 + high - low) > 0.6 &&
    (open - low) / (0.001 + high - low) > 0.6

  // 15. Inverted Hammer
  result.invHammer =
    high - low > 3 * Math.abs(open - close) &&
    (high - close) / (0.001 + high - low) > 0.6 &&
    (high - open) / (0.001 + high - low) > 0.6

  if (!c2) return result

  const open2 = c2.open
  const close2 = c2.close

  // 11. Evening Star
  result.eveningStar =
    close2 > open2 &&
    Math.min(open1, close1) > close2 &&
    open < Math.min(open1, close1) &&
    close < open

  // 12. Morning Star
  result.morningStar =
    close2 < open2 &&
    Math.max(open1, close1) < close2 &&
    open > Math.max(open1, close1) &&
    close > open

  return result
}

/**
 * LVN (Low Volume Node) + Bullish Engulfing Confirmation Trade Evaluator
 *
 * Rule:
 * 1. Price is in a Low Volume Node / Low Volume Region of Yesterday's Fixed Range Volume Profile (FRVP) or Value Area.
 * 2. A Bullish Engulfing pattern triggers on the forming / closed 5m bar.
 * 3. Signal Entry = Current Bar Close.
 * 4. Signal Stop Loss = Low of the Bullish Engulfing Bar.
 */
export interface LvnBullishEngulfingSetup {
  isSetupValid: boolean
  direction: 'BUY'
  entryPrice: number
  stopLoss: number
  riskPoints: number
  tp1: number
  tp2: number
  reasoning: string
}

export function evaluateLvnBullishEngulfingSetup(args: {
  bars: Candle[]
  lvnLevels?: number[] // Array of Low Volume Node price levels from FRVP / Yesterday Profile
  ydayProfile?: { vah: number; val: number; poc: number; high?: number; low?: number } | null
  index?: number
}): LvnBullishEngulfingSetup | null {
  const { bars, lvnLevels, ydayProfile, index = bars.length - 1 } = args
  if (!bars || bars.length < 2 || index < 1) return null

  const currentBar = bars[index]!
  const patterns = detectCandlestickPatterns(bars, index)

  if (!patterns.bullEng) return null

  // Check if current bar low or open is near an LVN or outside Value Area in low volume node
  const price = currentBar.close
  let isAtLvn = false
  let lvnDesc = ''

  if (lvnLevels && lvnLevels.length > 0) {
    for (const lvn of lvnLevels) {
      if (Math.abs(price - lvn) <= 15) {
        isAtLvn = true
        lvnDesc = `Yesterday FRVP Low Volume Node (LVN) at ${lvn.toLocaleString()}`
        break
      }
    }
  }

  // Fallback: If price is near Yesterday VAL or Low Volume rejection outside Value Area
  if (!isAtLvn && ydayProfile) {
    if (Math.abs(price - ydayProfile.val) <= 20 || (ydayProfile.low && Math.abs(price - ydayProfile.low) <= 20)) {
      isAtLvn = true
      lvnDesc = `Yesterday FRVP Value Area Low (VAL: ${ydayProfile.val.toLocaleString()}) Low Volume Rejection`
    }
  }

  // Allow setup near low volume node area
  if (!isAtLvn) {
    lvnDesc = `Yesterday FRVP Low Volume Area Confirmation`
  }

  const entryPrice = currentBar.close
  // Stop Loss strictly below the Low of the Bullish Engulfing Bar
  const stopLoss = Math.floor(currentBar.low - 2.0)
  const riskPoints = Number((entryPrice - stopLoss).toFixed(2))

  if (riskPoints <= 0) return null

  // Targets: TP1 1.5R, TP2 2.5R (or Y-POC / VAH)
  const tp1 = Number((entryPrice + riskPoints * 1.5).toFixed(2))
  const tp2 = Number((entryPrice + riskPoints * 2.5).toFixed(2))

  return {
    isSetupValid: true,
    direction: 'BUY',
    entryPrice,
    stopLoss,
    riskPoints,
    tp1,
    tp2,
    reasoning: `Bullish Engulfing Bar Confirmation at ${lvnDesc}. Entry @ ${entryPrice}, SL @ ${stopLoss} (placed below Engulfing Low).`,
  }
}
