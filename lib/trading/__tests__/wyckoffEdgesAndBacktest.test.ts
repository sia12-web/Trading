// @ts-ignore - vitest types resolved by vitest runner
import { describe, it, expect, beforeEach } from 'vitest';
import {
  analyzeAndBacktestBox,
  formatBoxAnalysisForLeo,
  format5mPhaseDEAnalysisForLeo,
} from '../boxRangeBacktester';
import {
  clearWyckoffEdges,
  loadWyckoffEdges,
  getWyckoffEdgesForMarket,
  getActiveLeoMemoryEdgeForMarket,
  toggleWyckoffEdgeMemory,
  updateWyckoffEdgeNotes,
  deleteWyckoffEdge,
  formatSavedEdgesForLeoPrompt,
} from '../wyckoffEdgesStore';

describe('4H Wyckoff Range Backtest, Saved Edges & Leo 5m Phase D/E Memory', () => {
  beforeEach(() => {
    clearWyckoffEdges();
  });

  it('automatically dates, writes Accumulation & Distribution behaviors, and saves to Edges when Leo backtests a 4H range', () => {
    const nowSec = 1760000000;
    const startSec = nowSec - 30 * 86400;

    const analysis = analyzeAndBacktestBox({
      id: 'test-gold-4h-1',
      market: 'GOLD',
      timeframe: '4H',
      startTime: startSec,
      endTime: nowSec,
      lowPrice: 2880,
      highPrice: 2950,
      label: 'GOLD 4H Macro Balance',
    });

    expect(analysis.market).toBe('GOLD');
    expect(analysis.timeframe).toBe('4H');
    expect(analysis.lowPrice).toBe(2880);
    expect(analysis.highPrice).toBe(2950);
    expect(analysis.accumulationCount + analysis.distributionCount).toBeGreaterThanOrEqual(2);

    // Verify it was automatically saved into wyckoffEdgesStore with date & written behaviors
    const allEdges = loadWyckoffEdges();
    expect(allEdges.length).toBe(1);

    const saved = allEdges[0]!;
    expect(saved.market).toBe('GOLD');
    expect(saved.timeframe).toBe('4H');
    expect(saved.isActiveInLeoMemory).toBe(true);
    expect(saved.createdAt).toBeTruthy();
    expect(saved.createdDateFormatted).toContain('ET');
    expect(saved.rangeStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(saved.rangeEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Written Accumulation & Distribution behaviors
    expect(saved.accumulationBehavior.summaryText).toContain('accumulation forms primarily via');
    expect(saved.accumulationBehavior.higherLowBaseRatePct).toBeGreaterThanOrEqual(0);
    expect(saved.accumulationBehavior.higherLowBaseRatePct).toBeLessThanOrEqual(100);
    expect(saved.accumulationBehavior.springRatePct).toBeGreaterThanOrEqual(0);
    expect(saved.accumulationBehavior.springRatePct).toBeLessThanOrEqual(100);

    expect(saved.distributionBehavior.summaryText).toContain('distribution forms primarily via');
    expect(saved.distributionBehavior.lowerHighLpsyRatePct).toBeGreaterThanOrEqual(0);
    expect(saved.distributionBehavior.lowerHighLpsyRatePct).toBeLessThanOrEqual(100);
    expect(saved.distributionBehavior.utadRatePct).toBeGreaterThanOrEqual(0);
    expect(saved.distributionBehavior.utadRatePct).toBeLessThanOrEqual(100);

    expect(saved.phaseDEExecutionPlan.phaseDOpportunityNote).toContain('Phase D');
    expect(saved.phaseDEExecutionPlan.phaseEOpportunityNote).toContain('Phase E');

    // Verify Leo report includes dated Edge confirmation
    const leoReport = formatBoxAnalysisForLeo(analysis);
    expect(leoReport).toContain('Saved to Dashboard → Edges & Leo Memory');
    expect(leoReport).toContain('Accumulation Behavior');
    expect(leoReport).toContain('Distribution Behavior');
  });

  it('handles edge cases: inverted startTime > endTime, inverted lowPrice > highPrice, and zero-span prices without NaN or Infinity', () => {
    // Case 1: Inverted timestamps and inverted prices
    const inverted = analyzeAndBacktestBox({
      id: 'edge-inverted',
      market: 'NASDAQ',
      timeframe: '4H',
      startTime: 1760000000,
      endTime: 1758000000, // earlier than startTime!
      lowPrice: 21900, // higher than highPrice!
      highPrice: 21200,
    });

    expect(inverted.lowPrice).toBe(21200);
    expect(inverted.highPrice).toBe(21900);
    expect(inverted.startTime).toBeLessThan(inverted.endTime);
    expect(inverted.durationDays).toBeGreaterThan(0);
    expect(Number.isFinite(inverted.poc)).toBe(true);
    expect(Number.isFinite(inverted.vah)).toBe(true);
    expect(Number.isFinite(inverted.val)).toBe(true);
    expect(Number.isFinite(inverted.h4Atr)).toBe(true);

    // Case 2: Equal lowPrice === highPrice (zero span) and zero prices
    const zeroSpan = analyzeAndBacktestBox({
      id: 'edge-zero-span',
      market: 'DOW',
      timeframe: '4H',
      startTime: 1759000000,
      endTime: 1759000000,
      lowPrice: 43500,
      highPrice: 43500,
    });

    expect(zeroSpan.highPrice).toBeGreaterThan(zeroSpan.lowPrice);
    expect(Number.isFinite(zeroSpan.poc)).toBe(true);
    expect(Number.isFinite(zeroSpan.confidencePct)).toBe(true);
    expect(Number.isNaN(zeroSpan.poc)).toBe(false);

    // Case 3: Negative or zero low/high fallback
    const zeroPrices = analyzeAndBacktestBox({
      id: 'edge-zero-px',
      market: 'CRUDE',
      timeframe: '4H',
      startTime: 0,
      endTime: 0,
      lowPrice: 0,
      highPrice: 0,
    });

    expect(zeroPrices.lowPrice).toBeGreaterThan(0);
    expect(zeroPrices.highPrice).toBeGreaterThan(zeroPrices.lowPrice);
    expect(Number.isFinite(zeroPrices.poc)).toBe(true);
  });

  it('deduplicates overlapping 4H ranges on the same market while preserving trader notes and isolating markets', () => {
    const nowSec = 1760000000;
    const startSec = nowSec - 25 * 86400;

    analyzeAndBacktestBox({
      id: 'gold-edge-a',
      market: 'GOLD',
      timeframe: '4H',
      startTime: startSec,
      endTime: nowSec,
      lowPrice: 2900,
      highPrice: 2960,
      label: 'GOLD Initial 4H Range',
    });

    const goldEdges1 = getWyckoffEdgesForMarket('GOLD');
    expect(goldEdges1.length).toBe(1);

    // Add custom trader notes
    updateWyckoffEdgeNotes(goldEdges1[0]!.id, 'Watch London Spring below 2900 before NYC markup');
    expect(getWyckoffEdgesForMarket('GOLD')[0]!.traderNotes).toBe(
      'Watch London Spring below 2900 before NYC markup'
    );

    // Re-backtest nearly identical GOLD 4H range -> should update in-place and preserve traderNotes
    analyzeAndBacktestBox({
      id: 'gold-edge-a-rerun',
      market: 'GOLD',
      timeframe: '4H',
      startTime: startSec + 3600,
      endTime: nowSec + 3600,
      lowPrice: 2900.1,
      highPrice: 2960.1,
      label: 'GOLD Updated 4H Range',
    });

    const goldEdges2 = getWyckoffEdgesForMarket('GOLD');
    expect(goldEdges2.length).toBe(1);
    expect(goldEdges2[0]!.label).toBe('GOLD Updated 4H Range');
    expect(goldEdges2[0]!.traderNotes).toBe('Watch London Spring below 2900 before NYC markup');

    // Backtest NASDAQ 4H range -> isolated from GOLD
    analyzeAndBacktestBox({
      id: 'nq-edge-1',
      market: 'NASDAQ',
      timeframe: '4H',
      startTime: startSec,
      endTime: nowSec,
      lowPrice: 21300,
      highPrice: 21850,
      label: 'NASDAQ 4H Macro Range',
    });

    expect(getWyckoffEdgesForMarket('GOLD').length).toBe(1);
    expect(getWyckoffEdgesForMarket('NASDAQ').length).toBe(1);
    expect(loadWyckoffEdges().length).toBe(2);
  });

  it('recalls the saved 4H Edge in Leo Memory when analyzing 5m Phase D & Phase E with 5D POC, Overnight Inventory, and Yesterday NYC', () => {
    const nowSec = 1760000000;
    const startSec = nowSec - 30 * 86400;

    // Step 1: Leo backtests the 4H range on GOLD -> saved to Leo Memory
    analyzeAndBacktestBox({
      id: 'gold-4h-macro',
      market: 'GOLD',
      timeframe: '4H',
      startTime: startSec,
      endTime: nowSec,
      lowPrice: 2890,
      highPrice: 2955,
      label: 'GOLD 4H Macro Range',
    });

    const activeEdge = getActiveLeoMemoryEdgeForMarket('GOLD');
    expect(activeEdge).not.toBeNull();

    // Step 2: Trader switches to 5m timeframe and monitors a 5m range for Phase D & Phase E
    const phaseDEReport = format5mPhaseDEAnalysisForLeo({
      market: 'GOLD',
      currentPrice: 2928.5, // Breaking out above 5m range high (Phase D / E)
      range: {
        id: 'r-5m-1',
        label: 'GOLD 5m Intraday Range',
        priceLow: 2912,
        priceHigh: 2926,
        midPrice: 2919,
        heightPts: 14,
        durationMin: 135,
        priceRelation: 'ABOVE',
        positionPct: 118,
        startTimeEt: '08:00 ET',
        endTimeEt: '10:15 ET',
        totalVolume: 48500,
        volumeRatePerMin: 359,
        buyRatioPct: 64,
        delta: 6400,
        poc: 2919,
      },
      poc5d: 2915,
      vah5d: 2932,
      val5d: 2902,
      ypoc: 2914,
      yhigh: 2930,
      ylow: 2900,
      yvah: 2924,
      yval: 2906,
      overnightBias: 'NET LONG (London Absorbed)',
      onpoc: 2918,
      onhigh: 2925,
      onlow: 2908,
      sessionName: 'NYC Cash Session (10:15 ET)',
      sessionPhase: 'MORNING_DRIVE',
    });

    // Verify 5m Phase D/E analysis recalls the dated 4H Edge from Leo Memory
    expect(phaseDEReport).toContain('Inherited 4-Hour (`4H`) Range Edge from Leo Memory');
    expect(phaseDEReport).toContain('Recalled from Leo 4H Edge Memory');
    expect(phaseDEReport).toContain('$2890.00 – $2955.00');
    expect(phaseDEReport).toContain('Written Accumulation Behavior');
    expect(phaseDEReport).toContain('Written Distribution Behavior');
    expect(phaseDEReport).toContain('Time as a Regulator & Session Cause → Effect (Last 5 Days 5m Context)');
    expect(phaseDEReport).toContain('5D POC: $2915.00');
    expect(phaseDEReport).toContain('ON-POC: $2918.00');
    expect(phaseDEReport).toContain('Y-POC: $2914.00');
    expect(phaseDEReport).toContain('The Two 5-Minute Execution Opportunities (Phase D & Phase E)');

    // Verify Leo system prompt memory formatter includes the GOLD 4H Edge
    const systemPromptMemory = formatSavedEdgesForLeoPrompt('GOLD');
    expect(systemPromptMemory).toContain('SAVED 4H ACCUMULATION & DISTRIBUTION BEHAVIORS FOR GOLD');
    expect(systemPromptMemory).toContain('2890.00 – $2955.00');

    // Step 3: Toggle memory off and verify getActiveLeoMemoryEdgeForMarket respects it
    toggleWyckoffEdgeMemory(activeEdge!.id, false);
    expect(getActiveLeoMemoryEdgeForMarket('GOLD')).toBeNull();

    // Toggle back on and delete
    toggleWyckoffEdgeMemory(activeEdge!.id, true);
    expect(getActiveLeoMemoryEdgeForMarket('GOLD')).not.toBeNull();
    deleteWyckoffEdge(activeEdge!.id);
    expect(getActiveLeoMemoryEdgeForMarket('GOLD')).toBeNull();
  });
});
