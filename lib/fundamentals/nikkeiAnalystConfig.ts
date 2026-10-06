/**
 * Nikkei 225 Fundamental Analyst Engine Configuration (NIKKEI_AGENT)
 *
 * Dedicated institutional domain knowledge for CME Nikkei 225 Futures (NKD - $5 Multiplier)
 * and Osaka Exchange (OSE) / Tokyo Stock Exchange (JPX) cash market.
 *
 * Pillars:
 * 1. Bank of Japan (BoJ) Monetary Policy (Call rate, YCC phase-out, ETF tapering, JGB yields)
 * 2. USD/JPY FX Pass-Through & Ministry of Finance (MoF) Intervention Risk
 * 3. Extreme Price-Weighting Leverage (Fast Retailing ~10%, Tokyo Electron ~7%, Advantest ~5%)
 * 4. Global Semiconductor & Tech Supply Chain Transmission (SOX, NVDA, TSMC, AI Capex)
 * 5. Tokyo Cash Session Structure (09:00-11:30 Morning, 11:30-12:30 Lunch, 12:30-15:00 Afternoon JST)
 * 6. Overnight US Market Spillover & Opening Gap Fade/Continuation
 */

import type {
  NikkeiConstituent,
  NikkeiDriverId,
  NikkeiDriverState,
  NikkeiFeedStatus,
  TodaysNikkeiFundamentalState,
} from '@/types/fundamentals'
import { composeAnalystPrompts } from '@/lib/fundamentals/outputContract'

export const NIKKEI_DIVISOR = 30.15 // Standard Nikkei 225 price-weight divisor

export const NKD_CONTRACT_MULTIPLIER = 5 // $5 per index point for CME NKD USD futures
export const NKD_TICK_SIZE = 5 // 5.0 index points per tick ($25/tick)

export const DEFAULT_NIKKEI_CONSTITUENTS: NikkeiConstituent[] = [
  {
    symbol: '9983.T',
    name: 'Fast Retailing (Uniqlo)',
    priceJpy: 48500,
    weightPct: 10.4,
    sector: 'Consumer Discretionary / Retail',
    betaToUsdJpy: 0.35,
    pointContributionPer100Yen: 3.32,
  },
  {
    symbol: '8035.T',
    name: 'Tokyo Electron',
    priceJpy: 26200,
    weightPct: 7.2,
    sector: 'Semiconductor Equipment',
    betaToUsdJpy: 0.85,
    pointContributionPer100Yen: 3.32,
  },
  {
    symbol: '6857.T',
    name: 'Advantest',
    priceJpy: 7950,
    weightPct: 5.1,
    sector: 'Semiconductor Testing (AI/GPU)',
    betaToUsdJpy: 0.8,
    pointContributionPer100Yen: 3.32,
  },
  {
    symbol: '9984.T',
    name: 'SoftBank Group',
    priceJpy: 8900,
    weightPct: 4.2,
    sector: 'Technology / AI Investment',
    betaToUsdJpy: 0.45,
    pointContributionPer100Yen: 3.32,
  },
  {
    symbol: '4063.T',
    name: 'Shin-Etsu Chemical',
    priceJpy: 6100,
    weightPct: 2.8,
    sector: 'Semiconductor Silicon Wafers',
    betaToUsdJpy: 0.65,
    pointContributionPer100Yen: 3.32,
  },
  {
    symbol: '6762.T',
    name: 'TDK Corp',
    priceJpy: 2150,
    weightPct: 2.4,
    sector: 'Electronic Components & Batteries',
    betaToUsdJpy: 0.7,
    pointContributionPer100Yen: 3.32,
  },
  {
    symbol: '6367.T',
    name: 'Daikin Industries',
    priceJpy: 19800,
    weightPct: 2.3,
    sector: 'Industrial Machinery / HVAC',
    betaToUsdJpy: 0.6,
    pointContributionPer100Yen: 3.32,
  },
  {
    symbol: '6954.T',
    name: 'Fanuc',
    priceJpy: 4300,
    weightPct: 2.1,
    sector: 'Industrial Robotics / Automation',
    betaToUsdJpy: 0.75,
    pointContributionPer100Yen: 3.32,
  },
  {
    symbol: '7203.T',
    name: 'Toyota Motor',
    priceJpy: 2750,
    weightPct: 1.4,
    sector: 'Automotive / Global Exporter',
    betaToUsdJpy: 0.95,
    pointContributionPer100Yen: 3.32,
  },
  {
    symbol: '8306.T',
    name: 'Mitsubishi UFJ Financial Group',
    priceJpy: 1680,
    weightPct: 0.9,
    sector: 'Mega Banking / Net Interest Margin',
    betaToUsdJpy: -0.4, // Benefits from BoJ rate hikes & higher JGB yields
    pointContributionPer100Yen: 3.32,
  },
]

export const NIKKEI_FEEDS_INITIAL: NikkeiFeedStatus[] = [
  {
    id: 'boj_statement_feed',
    name: 'Bank of Japan Policy Board & Governor Statements',
    subtitle: 'Interest Rate Decision, Outlook for Economic Activity & Prices',
    category: 'BOJ_POLICY',
    status: 'ONLINE',
    latency: '340ms',
    lastSync: 'Live',
    primarySource: 'Bank of Japan (boj.or.jp) / Reuters Tokyo',
  },
  {
    id: 'fx_usdjpy_engine',
    name: 'USD/JPY Spot & Cross-Rate Transmission Hub',
    subtitle: 'Real-time FX tick pass-through & MoF intervention tracker',
    category: 'FX_MARKETS',
    status: 'ONLINE',
    latency: '12ms',
    lastSync: 'Live',
    primarySource: 'EBS / Reuters Dealing / CME Currency Ticks',
  },
  {
    id: 'semi_supply_chain_feed',
    name: 'Global Semiconductor Chain & AI Hardware Tape',
    subtitle: 'SOX Index, NVDA, TSMC, Tokyo Electron & Advantest telemetry',
    category: 'SEMICONDUCTOR_CHAIN',
    status: 'ONLINE',
    latency: '45ms',
    lastSync: 'Live',
    primarySource: 'Nasdaq Global Data / Tokyo Stock Exchange (JPX)',
  },
  {
    id: 'cme_nkd_tape',
    name: 'CME Globex NKD Futures Order Flow & Book',
    subtitle: 'Tick-by-tick trades, CVD delta, and Globex session VWAP',
    category: 'CME_GLOBEX',
    status: 'ONLINE',
    latency: '8ms',
    lastSync: 'Live',
    primarySource: 'CME Globex MDP 3.0 (NKD) / Databento',
  },
  {
    id: 'tse_cash_session_tape',
    name: 'Tokyo Stock Exchange Prime Market Cash Engine',
    subtitle: 'JPX cash open 09:00, lunch 11:30-12:30, close 15:00 JST',
    category: 'TSE_JPX_CASH',
    status: 'ONLINE',
    latency: '180ms',
    lastSync: 'Live',
    primarySource: 'JPX TSE Arrowhead / Nikkei Inc.',
  },
  {
    id: 'jpx_foreign_flows_feed',
    name: 'Ministry of Finance & JPX Foreign Investor Flow',
    subtitle: 'Weekly foreign equity net purchases and Toshin fund flows',
    category: 'FOREIGN_FLOWS',
    status: 'ACTIVE',
    latency: 'Periodic',
    lastSync: 'Weekly',
    primarySource: 'Japan Exchange Group (JPX) Flow Summary',
  },
]

export const NIKKEI_DRIVERS_INITIAL: Record<NikkeiDriverId, NikkeiDriverState> = {
  boj_monetary_policy: {
    id: 'boj_monetary_policy',
    name: 'Bank of Japan Policy & 10Y JGB Yields',
    subtitle: 'Policy rate hikes, YCC dismantling, and bank vs exporter divergence',
    category: 'MONETARY',
    intradayStars: 5,
    longTermStars: 5,
    stance: 'MIXED',
    transmissionRole:
      'Rate hikes trigger Yen appreciation (hurting exporters) but ignite bank rally (MUFG/SMFG) and signify exit from deflation.',
    summary:
      'BoJ maintaining data-dependent rate normalization path toward 0.50%-0.75%. 10Y JGB yields trading near 0.95%-1.05%.',
    metrics: [
      {
        name: 'Policy Rate (Overnight Call)',
        currentValue: 0.25,
        priorValue: 0.1,
        unit: '%',
        trend: 'UP',
        stance: 'MIXED',
        description: 'Uncollateralized overnight call rate target',
      },
      {
        name: '10Y JGB Benchmark Yield',
        currentValue: 0.965,
        priorValue: 0.92,
        unit: '%',
        trend: 'UP',
        stance: 'MIXED',
        description: 'Benchmark 10-year Japanese Government Bond yield',
      },
    ],
    lastUpdated: 'Today 08:30 JST',
  },
  usdjpy_fx_flow: {
    id: 'usdjpy_fx_flow',
    name: 'USD/JPY Exchange Rate & MoF Intervention Watch',
    subtitle: 'Exporter earnings translation and carry-trade unwind velocity',
    category: 'CURRENCY',
    intradayStars: 5,
    longTermStars: 4,
    stance: 'BULLISH',
    transmissionRole:
      'Every 1 Yen move in USD/JPY impacts Nikkei operating profits by ~0.4%-0.6%; rapid Yen strength sparks futures liquidations.',
    summary:
      'USD/JPY holding above 151.50 provides solid baseline support for Tokyo Electron and Toyota repatriated profits.',
    metrics: [
      {
        name: 'USD/JPY Spot',
        currentValue: 152.4,
        priorValue: 151.8,
        unit: 'JPY',
        trend: 'UP',
        stance: 'BULLISH',
        description: 'Exchange rate of US Dollar against Japanese Yen',
      },
      {
        name: 'MoF Intervention Zone Proximity',
        currentValue: 'Moderate (155-160 alert)',
        priorValue: 'Low',
        unit: 'Level',
        trend: 'FLAT',
        stance: 'NEUTRAL',
        description: 'Verbal or direct intervention risk from Ministry of Finance',
      },
    ],
    lastUpdated: 'Live Tick',
  },
  tokyo_electron_semis: {
    id: 'tokyo_electron_semis',
    name: 'Semiconductor Hardware & AI Equipment Engine',
    subtitle: 'Tokyo Electron (8035), Advantest (6857) & global SOX correlation',
    category: 'TECH',
    intradayStars: 5,
    longTermStars: 5,
    stance: 'BULLISH',
    transmissionRole:
      'Semiconductor cluster makes up over 15% of the Nikkei 225 price index; moves in SOX directly gap open the morning session.',
    summary:
      'Advantest testing monopoly for Blackwell/H100 GPUs and Tokyo Electron fab equipment demand sustaining strong order backlogs.',
    metrics: [
      {
        name: 'SOX Index (Philadelphia Semi)',
        currentValue: 5240,
        priorValue: 5180,
        unit: 'pts',
        trend: 'UP',
        stance: 'BULLISH',
        description: 'US semiconductor barometer leading Tokyo morning open',
      },
      {
        name: 'Tokyo Electron (8035.T) Share Price',
        currentValue: 26200,
        priorValue: 25750,
        unit: 'JPY',
        trend: 'UP',
        stance: 'BULLISH',
        description: '7.2% weight in Nikkei 225',
      },
    ],
    lastUpdated: 'Live Cash',
  },
  fast_retailing_retail: {
    id: 'fast_retailing_retail',
    name: 'Fast Retailing (9983.T) Price-Weight Leverage',
    subtitle: 'Uniqlo parent. Its index weight stays unavailable until price and the official divisor are both on the feed.',
    category: 'PRICE_WEIGHTED',
    intradayStars: 4,
    longTermStars: 4,
    stance: 'BULLISH',
    transmissionRole:
      'Because the Nikkei is price-weighted, a move in Fast Retailing changes the index by that price change divided by the official divisor. The divisor is unavailable.',
    summary:
      'Robust international same-store sales in North America and Europe offsetting domestic weather swings.',
    metrics: [
      {
        name: 'Fast Retailing Price',
        currentValue: 48500,
        priorValue: 47900,
        unit: 'JPY',
        trend: 'UP',
        stance: 'BULLISH',
        description: 'Highest-priced stock in Nikkei 225 (~10.4% weight)',
      },
    ],
    lastUpdated: 'Live Cash',
  },
  global_risk_us_spillover: {
    id: 'global_risk_us_spillover',
    name: 'Overnight US Tech & Nasdaq-100 Spillover',
    subtitle: 'Late NY cash close and Globex overnight momentum pricing',
    category: 'GLOBAL',
    intradayStars: 4,
    longTermStars: 3,
    stance: 'BULLISH',
    transmissionRole:
      'Sets the opening auction imbalance (08:55-09:00 JST). Large US gaps often see opening OR15 exhaustion or trend continuation.',
    summary:
      'S&P 500 and Nasdaq closing near session highs provided bullish opening tailwind for Tokyo cash open.',
    metrics: [
      {
        name: 'Nasdaq-100 Close',
        currentValue: 20350,
        priorValue: 20180,
        unit: 'pts',
        trend: 'UP',
        stance: 'BULLISH',
        description: 'Overnight US lead',
      },
    ],
    lastUpdated: '06:00 JST',
  },
  japan_wage_inflation_shunto: {
    id: 'japan_wage_inflation_shunto',
    name: 'Shunto Spring Wage Negotiations & Real Incomes',
    subtitle: 'Virtuous wage-price spiral ending three decades of deflation',
    category: 'MACRO',
    intradayStars: 2,
    longTermStars: 5,
    stance: 'BULLISH',
    transmissionRole:
      'Wage gains >5% empower domestic consumer pricing power and corporate margin defense.',
    summary:
      'Rengo confederation confirming average wage hike agreements exceeding 5.1%, confirming sustained domestic inflation.',
    metrics: [
      {
        name: 'Rengo Shunto Wage Hike Agreement',
        currentValue: 5.25,
        priorValue: 3.8,
        unit: '%',
        trend: 'UP',
        stance: 'BULLISH',
        description: 'Highest Japanese wage expansion in 33 years',
      },
    ],
    lastUpdated: 'Monthly',
  },
  foreign_investor_inflows: {
    id: 'foreign_investor_inflows',
    name: 'Foreign Institutional Allocation & Corporate Governance Reform',
    subtitle: 'Tokyo Stock Exchange PBR > 1.0x reforms and Warren Buffett effect',
    category: 'FLOWS',
    intradayStars: 3,
    longTermStars: 5,
    stance: 'BULLISH',
    transmissionRole:
      'Foreign investors hold ~30% of Japanese equities and generate ~70% of cash trading volume.',
    summary:
      'TSE governance mandates driving share buybacks and dividend hikes, attracting continuous foreign capital accumulation.',
    metrics: [
      {
        name: 'Foreign Net Equity Purchases (Weekly)',
        currentValue: '+¥420B',
        priorValue: '+¥180B',
        unit: 'JPY',
        trend: 'UP',
        stance: 'BULLISH',
        description: 'Net overseas institutional investment flow',
      },
    ],
    lastUpdated: 'Weekly JPX',
  },
}

export const TODAYS_NIKKEI_FUNDAMENTAL_INITIAL: TodaysNikkeiFundamentalState = {
  market: 'CME_NKD',
  intraday_bias: 'BULLISH',
  short_term_bias: 'BULLISH',
  medium_term_bias: 'BULLISH',
  boj_policy_stance: 'NORMALIZING',
  fx_regime: 'YEN_WEAKNESS_EXPORTER_BOOST',
  semiconductor_tailwind: 'STRONG',
  domestic_macro_growth:
    'Japan GDP expanding at +1.2% annualized. Corporate capex resilient across automated manufacturing and EV retooling.',
  inflation_wages_shunto:
    'Core CPI holding at 2.7% YoY. Shunto wage agreements exceeding 5.1% solidify the sustainable wage-inflation feedback loop.',
  foreign_investor_flow: 'HEAVY_INFLOW',
  us_overnight_lead: 'STRONG_BULLISH',
  tokyo_cash_session_bias:
    'Bullish cash momentum with Tokyo Electron and Fast Retailing commanding institutional buying after strong overnight US tech prints.',
  key_risks: [
    'Sudden Ministry of Finance (MoF) Yen intervention if USD/JPY accelerates through 155.00-160.00',
    'Abrupt BoJ emergency rate hike rhetoric spiking 10Y JGB yields above 1.25%',
    'Global tech capex pause or US export curbs on deep-UV lithography tools to China',
  ],
  top_catalysts: [
    'Tokyo Stock Exchange morning cash open (09:00 JST) auction volume',
    'Bank of Japan Policy Board rate decision and Governor press conference (15:30 JST)',
    'Fast Retailing quarterly earnings and Tokyo Electron fab machinery order book',
    'US CPI and FOMC decisions driving USD/JPY interest rate differential',
  ],
  summary_narrative:
    'Nikkei 225 futures (NKD) benefit from a powerful macro convergence: USD/JPY stability near 152.40 boosting exporter earnings, booming AI demand for Advantest/Tokyo Electron chip test equipment, and Tokyo Stock Exchange governance reforms fueling global asset manager inflows. Tokyo morning cash session is set to test key overhead resistance.',
  updated_at: 'Live Session',
}

export const NIKKEI_EVALUATION_PRESETS = [
  {
    id: 'preset_1_boj_rate_hike_bank_rally',
    title: 'Bank of Japan Hikes Rates +25 bps: Yen Surges, Banks Rally, Exporters Drop',
    category: 'BOJ_MONETARY_POLICY',
    source: 'Bank of Japan Monetary Policy Statement',
    rawText: `TOKYO (Reuters) - The Bank of Japan raised its uncollateralized overnight call rate by 25 basis points to 0.50% in a 7-2 vote, stating that wages and services inflation have sustainably anchored the 2% price target. Governor Ueda signaled further rate increases could follow if economic projections are met. In immediate reaction, USD/JPY tumbled from 153.20 to 150.80 as Yen short positions unwound. Nikkei 225 futures initially dropped 650 points led by automakers and exporters, while Mitsubishi UFJ Financial Group (8306) and Sumitomo Mitsui (8316) surged over 6% to multi-year highs on expanding net interest margins.`,
  },
  {
    id: 'preset_2_tokyo_electron_ai_boom',
    title: 'Tokyo Electron & Advantest Explode Higher Following Nvidia Semiconductor Wave',
    category: 'TECH_SEMICONDUCTORS',
    source: 'JPX Market Tape & Nikkei Quick News',
    rawText: `TOKYO - Semiconductor equipment giants Tokyo Electron (8035.T) and Advantest (6857.T) surged 5.8% and 8.2% respectively at the Tokyo cash open, following a 4.5% rally in the Philadelphia Semiconductor Index overnight. Advantest reported unprecedented bookings for extreme-density AI chip testing systems. Due to the Nikkei 225's price-weighted structure, the joint rally in these two high-priced semiconductor components contributed over +380 points to the Nikkei 225 index, pushing NKD futures through 39,200 despite flat performance across broader domestic consumer equities.`,
  },
  {
    id: 'preset_3_mof_fx_intervention_shock',
    title: 'Ministry of Finance Direct Currency Intervention: Yen Surges 400 Pips',
    category: 'FX_USD_JPY',
    source: 'Ministry of Finance (MoF) & Tokyo Foreign Exchange Desk',
    rawText: `TOKYO - Japan's Ministry of Finance conducted large-scale currency market intervention after USD/JPY crossed 156.50. The currency plummeted over 450 pips in under 15 minutes down to 151.90. CME Nikkei 225 futures (NKD) experienced severe automated liquidation, diving 920 points as algorithmic carry trade and currency-hedged equity funds dumped index futures contracts. CVD turned sharply negative with heavy delta selling at market, breaking through the Tokyo session low.`,
  },
  {
    id: 'preset_4_fast_retailing_earnings_distortion',
    title: 'Fast Retailing Jumps 9% on Record Global Uniqlo Profits (Price-Weight Leverage)',
    category: 'EARNINGS_EXPORTERS',
    source: 'Tokyo Stock Exchange Earnings Disclosure',
    rawText: `TOKYO - Fast Retailing (9983.T) reported all-time record operating profits, driven by strong Uniqlo sales growth across Europe and North America, and raised its full-year guidance by 15%. Shares surged 9.2% to ¥51,500. Because Fast Retailing represents over 10% of the entire Nikkei 225 price-weighted calculation, this single stock's ¥4,350 gain injected +144 points into the index, masking decliners across 140 other Nikkei constituents and lifting NKD futures into fresh session highs.`,
  },
  {
    id: 'preset_5_us_overnight_gap_fade',
    title: 'Massive Overnight US Tech Gap Meets Tokyo Opening Seller Absorption & Reversal',
    category: 'MARKET_STRUCTURE',
    source: 'CME NKD Globex & Tokyo Opening Auction Tape',
    rawText: `TOKYO - Following a 350-point late-day rally in the US S&P 500, Nikkei 225 futures opened 500 points higher at 39,600 JST 09:00. However, domestic institutional investors used the euphoric opening gap to execute pre-planned profit-taking. Heavy sell delta absorbed all aggressive retail market buy orders within the first 15 minutes (OR15). The tape failed to break the 39,650 level, roll-reversed below the open, and triggered an intraday mean-reversion move down toward the prior US session VWAP at 39,120.`,
  },
]

const nikkeiPrompts = composeAnalystPrompts(
  `You are NIKKEI_AGENT, the Nikkei 225 macro, Bank of Japan, currency, and technology analyst.
Your market is CME Nikkei 225 futures (NKD) and the Tokyo cash session.
The Nikkei is price-weighted. Cite only contributor weights and point contributions that appear in the supplied packet. If they say UNAVAILABLE, do not recall a percentage for Fast Retailing, Tokyo Electron, Advantest, or any other name.
Do not confuse advancers versus decliners with price-weighted contribution.
BoJ policy is not a single direction. A hawkish shift can weigh on exporters and help bank margins. A dovish shift can weaken the yen. Say which channel the supplied evidence supports, and use UNKNOWN when the packet does not.
Yen weakness can help translated exporter earnings. It is not a law. MOF_INTERVENTION_RISK, when supplied, is LOW, MEDIUM, HIGH, or UNKNOWN. A spot level is not a contract to intervene. Do not use a fixed 155-160 zone.
Semiconductor names matter when their supplied weights and the supplied SOX or capex evidence say so. Do not assign the technology cluster a memorized share of the index.
Tokyo cash hours, when you refer to the session, are 09:00-11:30 JST, lunch 11:30-12:30 JST, and afternoon 12:30-15:00 JST. The prior US session is context for the gap, not a trigger.`,
  `confidence is HIGH, MEDIUM, LOW, or UNKNOWN.
Do not return actionable_takeaway. Use specialist.desk_context for what to watch. It is not a trade instruction.
estimated point impact is specialist.nkd_point_impact and is null unless precomputed.
{
  "mof_intervention_risk": null,
  "desk_context": null,
  "nkd_point_impact": null,
  "contributors": null
}`
)

export const NIKKEI_ANALYST_CORE = nikkeiPrompts.core
export const NIKKEI_ANALYST_EVENT_PROMPT = nikkeiPrompts.event
export const NIKKEI_ANALYST_CHAT_PROMPT = nikkeiPrompts.chat
export const NIKKEI_ANALYST_SYSTEM_PROMPT = NIKKEI_ANALYST_CORE
