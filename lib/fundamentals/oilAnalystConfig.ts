/**
 * Oil Fundamental Analyst Configuration & Baseline State
 * Market: NYMEX WTI Crude Oil (CL)
 */

import type {
  FundamentalPillarId,
  FundamentalPillarState,
  OilCatalystEvent,
  TodaysOilFundamentalState,
  FiveFeedStatus,
} from '@/types/fundamentals'
import { composeAnalystPrompts } from '@/lib/fundamentals/outputContract'

const oilPrompts = composeAnalystPrompts(
  `You are the Oil Fundamental Analyst.
Your only market is crude oil, primarily NYMEX WTI.
You interpret supplied supply, demand, inventories, refinery activity, imports and exports, OPEC+ policy, geopolitical supply risk, the futures curve, positioning, and macro demand.
Event types include EIA, OPEC, GEOPOLITICAL, CFTC, MACRO, PIPELINE_DISRUPTION, REFINERY_OUTAGE, HURRICANE, SPR_RELEASE, SANCTIONS, EXPORT_DISRUPTION, IEA_REPORT, OPEC_MONTHLY_REPORT, PHYSICAL_FLOW, SHIPPING, and OTHER.
Driver factors include US_CRUDE_STOCKS, CUSHING_STOCKS, GASOLINE_STOCKS, DISTILLATE_STOCKS, REFINERY_RUNS, REFINERY_UTILIZATION, OPEC_SUPPLY, TRANSIT_RISK, US_PRODUCTION, IMPORTS, EXPORTS, PRODUCT_SUPPLIED, SPR, and GLOBAL_DEMAND.
Never assume correlation is causation. If sources conflict, say so and use MIXED or UNKNOWN. Keep the summary to two sentences.`,
  `Put oil-specific numbers in specialist. Use null when the packet does not contain them.
{
  "crude_stocks": null,
  "gasoline_stocks": null,
  "distillate_stocks": null,
  "front_spread_change": null,
  "drivers": []
}
Do not invent front_spread_change from the sign of the spread. Copy it only when telemetry gives a measured change.`
)

export const OIL_ANALYST_CORE = oilPrompts.core
export const OIL_ANALYST_EVENT_PROMPT = oilPrompts.event
export const OIL_ANALYST_CHAT_PROMPT = oilPrompts.chat
export const OIL_ANALYST_SYSTEM_PROMPT = OIL_ANALYST_CORE

export const DEFAULT_TODAY_FUNDAMENTAL_STATE: TodaysOilFundamentalState = {
  supply: 'US shale holding steady near ~13.4M bpd; Permian efficiency offsetting modest rig count declines (484 active oil rigs).',
  demand: 'US implied product supplied steady at ~20.4M bpd. Summer/autumn driving demand solid; industrial distillate demand subdued.',
  inventories: 'Cushing storage critical at ~23.4M bbl near operational tank bottoms. Commercial crude stocks 4% below 5-yr seasonal average.',
  opec: '2.2M bpd voluntary cuts extended through Q4. Saudi Arabia and UAE holding ~4.5M bpd spare capacity discipline.',
  geopolitical_risk: 'Bab el-Mandeb tanker diversions continue (+14d via Cape of Good Hope); elevated risk premium adds ~$3.50/bbl.',
  positioning: 'CFTC Managed Money net long uncrowded at 148k contracts (2.6:1 long/short ratio). Low liquidation risk.',
  curve: 'Prompt M1-M2 spread holding firm at +$0.38/bbl in Backwardation. Spot delivery premium confirms physical cash tightness.',
  upcoming_catalysts: 'EIA Weekly Petroleum Status (Wed 10:30 AM ET); Baker Hughes Rigs (Fri 1:00 PM ET); CFTC COT (Fri 3:30 PM ET).',

  bias: 'BULLISH',
  confidence: 0.84,
  what_changed_since_yesterday: 'Cushing inventory drawdown confirmed; front calendar spread widened +$0.06/bbl into deeper backwardation.',
  what_would_invalidate_this_view: 'A surprise crude inventory build >2.5M bbl at Cushing, or OPEC+ abruptly announcing an accelerated monthly unwind before physical draws solidify.',

  updatedAt: new Date().toISOString(),
}

export const DEFAULT_FIVE_FEEDS: FiveFeedStatus[] = [
  {
    id: 'eia_api',
    name: 'EIA API Feed',
    source: 'U.S. Energy Information Administration (v2 API)',
    status: 'ACTIVE',
    lastSync: 'Weekly Wednesday 10:30 AM ET',
    details: 'Commercial crude, Cushing storage, gasoline/distillate stocks, refinery utilization, and US field production.',
  },
  {
    id: 'trading_economics',
    name: 'Trading Economics / Consensus Feed',
    source: 'Trading Economics & Finnhub Calendar',
    status: 'ONLINE',
    lastSync: 'Real-time schedule sync',
    details: 'Survey consensus, previous values, revised benchmarks, and release alerts across tier-1 energy metrics.',
  },
  {
    id: 'cftc_api',
    name: 'CFTC COT API Feed',
    source: 'U.S. Commodity Futures Trading Commission',
    status: 'ACTIVE',
    lastSync: 'Weekly Friday 3:30 PM ET',
    details: 'Disaggregated Commitments of Traders: Managed Money net length, gross longs, gross shorts, and open interest.',
  },
  {
    id: 'realtime_news',
    name: 'Real-Time News Wire',
    source: 'Reuters / LSEG / Finnhub Energy Wire & Yahoo RSS',
    status: 'ONLINE',
    lastSync: 'Live stream polling (<30s)',
    details: 'Breaking geopolitical alerts, shipping incidents, pipeline force majeure, and OPEC ministerial statements.',
  },
  {
    id: 'cme_databento',
    name: 'CME / Databento WTI Market Data',
    source: 'CME NYMEX Globex & Databento Feed Hub',
    status: 'ONLINE',
    lastSync: 'Sub-second live streaming',
    details: 'Prompt WTI price (CL=F), 5m returns, front calendar spread (M1-M2), and term structure backwardation/contango.',
  },
]

export const DEFAULT_PILLARS_STATE: Record<FundamentalPillarId, FundamentalPillarState> = {
  crude_supply: {
    id: 'crude_supply',
    name: 'Crude Supply',
    subtitle: 'US Shale, Non-OPEC Production & Field Outages',
    bias: 'BEARISH',
    statusSummary: 'US crude output remains near record ~13.4M bpd with steady Permian well efficiencies offsetting flat rig counts.',
    metrics: [
      { label: 'US Field Production', value: '13.40M', unit: 'bpd', trend: 'FLAT', note: 'EIA 4-wk average' },
      { label: 'Baker Hughes Oil Rigs', value: '484', unit: 'rigs', trend: 'DOWN', note: '-2 WoW' },
      { label: 'Non-OPEC Growth (YoY)', value: '+1.3M', unit: 'bpd', trend: 'UP', note: 'US, Guyana, Brazil' },
    ],
    horizon: 'MONTHS',
    confidence: 9,
    reliability: 9,
    keyTakeaway: 'Robust US shale supply caps severe upside rallies unless structural outages materialize.',
    lastUpdated: new Date().toISOString(),
    primarySource: 'EIA Weekly Petroleum Status Report (WPSR) & Baker Hughes',
  },
  petroleum_demand: {
    id: 'petroleum_demand',
    name: 'Petroleum Demand',
    subtitle: 'Implied Product Supplied & Consumption Rates',
    bias: 'NEUTRAL',
    statusSummary: 'US total product supplied holding near ~20.4M bpd. Gasoline demand seasonally steady, diesel consumption subdued.',
    metrics: [
      { label: 'Total Product Supplied', value: '20.42M', unit: 'bpd', trend: 'FLAT', note: '4-wk avg' },
      { label: 'Motor Gasoline Supplied', value: '9.05M', unit: 'bpd', trend: 'UP', note: 'Seasonal summer/autumn driving' },
      { label: 'Distillate Supplied', value: '3.78M', unit: 'bpd', trend: 'DOWN', note: 'Freight/industrial softness' },
    ],
    horizon: 'DAYS_WEEKS',
    confidence: 8,
    reliability: 8,
    keyTakeaway: 'Gasoline demand provides floor support, but industrial distillate consumption reflects sluggish manufacturing.',
    lastUpdated: new Date().toISOString(),
    primarySource: 'EIA Weekly Petroleum Status Report',
  },
  inventories: {
    id: 'inventories',
    name: 'Inventories & Cushing Hub',
    subtitle: 'Commercial Crude, Cushing Hub & Strategic Petroleum Reserve',
    bias: 'BULLISH',
    statusSummary: 'Commercial crude stocks remain ~4% below 5-year seasonal average. Cushing OK storage near operational bottoms (~23M bbl).',
    metrics: [
      { label: 'US Commercial Crude', value: '423.8M', unit: 'bbl', trend: 'DOWN', note: '-3.2M bbl WoW' },
      { label: 'Cushing Hub Storage', value: '23.4M', unit: 'bbl', trend: 'DOWN', note: 'Critical operational bottom zone' },
      { label: 'SPR Reserves', value: '388.2M', unit: 'bbl', trend: 'UP', note: '+400k bbl DOE refill' },
      { label: 'Gasoline Stocks', value: '220.5M', unit: 'bbl', trend: 'DOWN', note: '-1.4M bbl WoW' },
    ],
    horizon: 'DAYS_WEEKS',
    confidence: 9,
    reliability: 9,
    keyTakeaway: 'Depleted Cushing storage creates prompt physical squeeze risk and underpins WTI prompt premium.',
    lastUpdated: new Date().toISOString(),
    primarySource: 'EIA Weekly Petroleum Status Report (WPSR)',
  },
  refinery_activity: {
    id: 'refinery_activity',
    name: 'Refinery Activity',
    subtitle: 'Gross Inputs, Utilization Rates & Crack Spreads',
    bias: 'BULLISH',
    statusSummary: 'Refinery runs remain elevated at 91.8% capacity. 3:2:1 crack margins profitable enough to sustain high crude crude throughput.',
    metrics: [
      { label: 'Refinery Utilization', value: '91.8%', unit: 'capacity', trend: 'UP', note: '+0.6% WoW' },
      { label: 'Gross Crude Inputs', value: '16.52M', unit: 'bpd', trend: 'UP', note: '+120k bpd WoW' },
      { label: '3:2:1 Crack Spread', value: '$22.40', unit: '/bbl', trend: 'FLAT', note: 'Healthy refining margins' },
    ],
    horizon: 'DAYS_WEEKS',
    confidence: 8,
    reliability: 9,
    keyTakeaway: 'High refinery runs continue drawing physical crude barrels out of domestic storage.',
    lastUpdated: new Date().toISOString(),
    primarySource: 'EIA Refinery Outturn & NYMEX Crack Margins',
  },
  imports_exports: {
    id: 'imports_exports',
    name: 'Imports & Exports',
    subtitle: 'Waterborne Crude Flows & Net US Trade Balance',
    bias: 'NEUTRAL',
    statusSummary: 'US crude exports averaging ~4.1M bpd via Gulf Coast terminals; imports from Canada & LatAm steady at ~6.4M bpd.',
    metrics: [
      { label: 'US Crude Exports', value: '4.12M', unit: 'bpd', trend: 'FLAT', note: 'Gulf Coast waterborne' },
      { label: 'US Crude Imports', value: '6.45M', unit: 'bpd', trend: 'UP', note: '+250k bpd WoW' },
      { label: 'Net Crude Imports', value: '2.33M', unit: 'bpd', trend: 'UP', note: 'Balanced seaborne flow' },
    ],
    horizon: 'DAYS_WEEKS',
    confidence: 8,
    reliability: 8,
    keyTakeaway: 'Export arbitrage window to Europe and Asia open but dependent on Brent-WTI spread (~$4.20/bbl).',
    lastUpdated: new Date().toISOString(),
    primarySource: 'US Customs / EIA / Kepler Vessel Tracking',
  },
  opec_policy: {
    id: 'opec_policy',
    name: 'OPEC+ Production Policy',
    subtitle: 'Quotas, Compliance & Voluntary 2.2M bpd Cuts',
    bias: 'BULLISH',
    statusSummary: 'OPEC+ alliance maintains 2.2M bpd voluntary cuts, delaying planned unwinds to defend a $70-$75 WTI price floor.',
    metrics: [
      { label: 'Voluntary Cuts Rollover', value: '2.20M', unit: 'bpd', trend: 'FLAT', note: 'Active through next review' },
      { label: 'OPEC Alliance Compliance', value: '96.2%', unit: 'rate', trend: 'UP', note: 'Iraq/Kazakhstan compensation' },
      { label: 'Saudi/UAE Spare Capacity', value: '4.6M', unit: 'bpd', trend: 'FLAT', note: 'Substantial market cushion' },
    ],
    horizon: 'MONTHS',
    confidence: 9,
    reliability: 9,
    keyTakeaway: 'OPEC+ active supply management sets a definitive floor against macro hedge fund liquidation.',
    lastUpdated: new Date().toISOString(),
    primarySource: 'OPEC Secretariat & JMMC Communiques',
  },
  geopolitical_risk: {
    id: 'geopolitical_risk',
    name: 'Geopolitical Supply Risk',
    subtitle: 'Chokepoints, Regional Conflict & Sanctions',
    bias: 'BULLISH',
    statusSummary: 'Heightened risk premium (+~$3.50/bbl) due to ongoing Bab el-Mandeb transit rerouting and Middle East conflict risks.',
    metrics: [
      { label: 'Red Sea Tanker Flow', value: '-55%', unit: 'vs baseline', trend: 'DOWN', note: 'Cape of Good Hope rerouting' },
      { label: 'Hormuz Threat Level', value: 'ELEVATED', unit: 'status', trend: 'FLAT', note: '20M bpd transit chokepoint' },
      { label: 'Russian Seaborne Sanctions', value: 'MODERATE', unit: 'impact', trend: 'FLAT', note: 'Shadow fleet circumvention' },
    ],
    horizon: 'DAYS_WEEKS',
    confidence: 7,
    reliability: 7,
    keyTakeaway: 'Logistical friction inflates freight and bunker costs, preventing deep market pullbacks.',
    lastUpdated: new Date().toISOString(),
    primarySource: 'Lloyds List Intelligence / TankerTrackers / Reuters Wire',
  },
  curve_structure: {
    id: 'curve_structure',
    name: 'Futures Curve Structure',
    subtitle: 'Front Calendar Spreads (M1-M2) & Backwardation',
    bias: 'BULLISH',
    statusSummary: 'NYMEX WTI forward curve trades in solid Backwardation. Front spread (M1-M2) holds premium, indicating physical tightness.',
    metrics: [
      { label: 'Prompt Spread (M1-M2)', value: '+$0.38', unit: '/bbl', trend: 'UP', note: 'Backwardation premium' },
      { label: '12-Month Strip Spread', value: '+$3.85', unit: '/bbl', trend: 'UP', note: 'Inverted curve structure' },
      { label: 'Implied Roll Yield', value: '+5.4%', unit: 'annualized', trend: 'UP', note: 'Favorable long roll' },
    ],
    horizon: 'DAYS_WEEKS',
    confidence: 9,
    reliability: 10,
    keyTakeaway: 'Backwardation confirms genuine physical cash market demand rather than speculative paper fluff.',
    lastUpdated: new Date().toISOString(),
    primarySource: 'CME NYMEX Futures Term Structure',
  },
  speculative_positioning: {
    id: 'speculative_positioning',
    name: 'Speculative Positioning',
    subtitle: 'CFTC Commitments of Traders (COT) Managed Money',
    bias: 'NEUTRAL',
    statusSummary: 'Managed Money net long length is historically light (~148k contracts). Uncrowded trade reduces violent liquidation risk.',
    metrics: [
      { label: 'Managed Money Net Long', value: '148,200', unit: 'contracts', trend: 'UP', note: '+6,400 WoW' },
      { label: 'Gross Long / Short Ratio', value: '2.6 : 1', unit: 'ratio', trend: 'FLAT', note: 'Moderate positioning' },
      { label: 'Commercial Hedging Short', value: '-295k', unit: 'contracts', trend: 'FLAT', note: 'Producer forward hedging' },
    ],
    horizon: 'DAYS_WEEKS',
    confidence: 8,
    reliability: 9,
    keyTakeaway: 'Speculative positioning is balanced; ample dry powder remains for discretionary momentum buyers.',
    lastUpdated: new Date().toISOString(),
    primarySource: 'CFTC Disaggregated Commitments of Traders Report',
  },
  macro_drivers: {
    id: 'macro_drivers',
    name: 'Macroeconomic Drivers',
    subtitle: 'US Dollar Index (DXY), Global PMIs & Central Bank Rates',
    bias: 'MIXED',
    statusSummary: 'US Dollar consolidation around 101.5 is neutral. Global manufacturing PMIs mixed; China stimulus anticipation provides underlying bid.',
    metrics: [
      { label: 'US Dollar Index (DXY)', value: '101.4', unit: 'index', trend: 'FLAT', note: 'Consolidating range' },
      { label: 'Global Mfg PMI', value: '49.8', unit: 'points', trend: 'DOWN', note: 'Contraction/expansion boundary' },
      { label: 'Fed Policy Bias', value: 'EASING', unit: 'regime', trend: 'FLAT', note: 'Accommodative rate stance' },
    ],
    horizon: 'MONTHS',
    confidence: 7,
    reliability: 8,
    keyTakeaway: 'Macro headwind from industrial slowdown counterbalanced by dollar softening and central bank easing.',
    lastUpdated: new Date().toISOString(),
    primarySource: 'Federal Reserve / S&P Global PMIs / Bloomberg Macro',
  },
}

export const SCHEDULED_OIL_CATALYSTS: OilCatalystEvent[] = [
  {
    id: 'eia-wpsr',
    name: 'EIA Weekly Petroleum Status Report (WPSR)',
    agency: 'U.S. Energy Information Administration (EIA)',
    frequency: 'Weekly',
    dayTimeEt: 'Wednesday 10:30 AM ET',
    impact: 'HIGH',
    description: 'Official U.S. government inventory data: Commercial crude, Cushing storage, gasoline/distillate stocks, refinery utilization, and domestic production.',
    focusPillars: ['inventories', 'refinery_activity', 'crude_supply', 'petroleum_demand'],
    nextScheduled: 'Upcoming Wednesday at 10:30 AM ET',
    lastActual: '-3.2M bbl commercial crude draw',
    lastSurprise: 'Bullish vs +0.8M consensus',
  },
  {
    id: 'api-wsb',
    name: 'API Weekly Statistical Bulletin',
    agency: 'American Petroleum Institute (API)',
    frequency: 'Weekly',
    dayTimeEt: 'Tuesday 4:30 PM ET',
    impact: 'MEDIUM',
    description: 'Industry voluntary survey of U.S. crude, gasoline, and distillate inventories. Precedes official EIA data by ~18 hours.',
    focusPillars: ['inventories'],
    nextScheduled: 'Upcoming Tuesday at 4:30 PM ET',
    lastActual: '-2.8M bbl crude draw',
    lastSurprise: 'Directionally aligned with subsequent EIA',
  },
  {
    id: 'baker-hughes-rigs',
    name: 'Baker Hughes North American Rotary Rig Count',
    agency: 'Baker Hughes',
    frequency: 'Weekly',
    dayTimeEt: 'Friday 1:00 PM ET',
    impact: 'MEDIUM',
    description: 'Counts active oil and gas drilling rigs in the U.S. and Canada. Leading indicator of future domestic supply trajectory.',
    focusPillars: ['crude_supply'],
    nextScheduled: 'Upcoming Friday at 1:00 PM ET',
    lastActual: '484 active oil rigs (-2 WoW)',
    lastSurprise: 'Persistent discipline among shale drillers',
  },
  {
    id: 'cftc-cot',
    name: 'CFTC Commitments of Traders (COT) - WTI Crude',
    agency: 'Commodity Futures Trading Commission (CFTC)',
    frequency: 'Weekly',
    dayTimeEt: 'Friday 3:30 PM ET',
    impact: 'MEDIUM',
    description: 'Disaggregates open interest into Managed Money, Commercial Producers, and Swap Dealers. Reveals hedge fund net positioning.',
    focusPillars: ['speculative_positioning'],
    nextScheduled: 'Upcoming Friday at 3:30 PM ET',
    lastActual: '+148.2k Managed Money net long contracts',
    lastSurprise: 'Modest long buildup',
  },
  {
    id: 'opec-jmmc',
    name: 'OPEC+ JMMC & Ministerial Meeting',
    agency: 'OPEC+ Secretariat',
    frequency: 'Bi-Monthly / As Convened',
    dayTimeEt: 'Scheduled Ministerial Sessions',
    impact: 'HIGH',
    description: 'Sets global crude oil production quotas, monitors member compliance, and decides whether to extend or unwind voluntary output curbs.',
    focusPillars: ['opec_policy', 'crude_supply', 'geopolitical_risk'],
    nextScheduled: 'Upcoming Ministerial Review',
    lastActual: 'Rollover of 2.2M bpd voluntary cuts confirmed',
    lastSurprise: 'Extended beyond initial deadline to defend $75 WTI',
  },
  {
    id: 'iea-omr',
    name: 'IEA Monthly Oil Market Report (OMR)',
    agency: 'International Energy Agency (IEA)',
    frequency: 'Monthly',
    dayTimeEt: 'Mid-Month (04:00 AM ET)',
    impact: 'HIGH',
    description: 'Authoritative global supply/demand balances, OPEC spare capacity estimates, and non-OPEC output projections.',
    focusPillars: ['crude_supply', 'petroleum_demand', 'macro_drivers'],
    nextScheduled: 'Monthly publication schedule',
    lastActual: 'Global demand growth revised to +950k bpd',
    lastSurprise: 'Bearish demand revision absorbed by market',
  },
]

export const PRESET_EVENTS_FOR_EVALUATION = [
  {
    id: 'preset-eia-draw',
    title: 'EIA Weekly Inventory: Big Draw at Cushing',
    source: 'U.S. Energy Information Administration (Official WPSR)',
    timestamp: 'Wednesday, 10:30 AM ET',
    rawText: `EIA Weekly Petroleum Status Report: Commercial crude oil inventories decreased by 4.15 million barrels from the previous week to 421.2M bbl (consensus: +0.6M bbl build, previous: -1.2M bbl).
Cushing, Oklahoma storage dropped by 1.28 million barrels to 22.12M barrels, approaching operational bottoms.
Refinery crude runs increased by 145,000 bpd to 16.65M bpd with utilization rising 0.8 percentage points to 92.6%.
Gasoline inventories fell by 1.82 million barrels (consensus: -0.4M bbl). Distillate stocks rose by 0.35 million barrels.
US field production remained unchanged at 13.40 million bpd.`,
  },
  {
    id: 'preset-opec-rollover',
    title: 'OPEC+ Ministerial: Voluntary Cuts Extended',
    source: 'OPEC Secretariat Press Release / Reuters Vienna Bureau',
    timestamp: 'Sunday, 14:00 CET',
    rawText: `OPEC+ Joint Ministerial Monitoring Committee (JMMC) Communique: The eight OPEC+ member countries implementing additional voluntary cuts of 2.2 million barrels per day have decided to extend these production curbs in full through the end of the fourth quarter.
Saudi Arabia, Russia, Iraq, UAE, Kuwait, Kazakhstan, Algeria, and Oman noted that gradual monthly unwinds will be paused until global inventory draws solidify.
Iraq and Kazakhstan pledged full submission of updated compensation plans for cumulative overproduction.`,
  },
  {
    id: 'preset-redsea-strike',
    title: 'Geopolitical Supply Shock: Red Sea Tanker Struck',
    source: 'UK Maritime Trade Operations (UKMTO) & Reuters Shipping Desk',
    timestamp: '06:45 UTC',
    rawText: `UKMTO Incident Report 044: A crude tanker carrying 1.0 million barrels of Basrah light was struck by an uncrewed aerial vehicle 55 nautical miles southwest of Al Hudaydah in the southern Red Sea. Vessel reported minor fire on starboard deck, crew safe, propulsion intact.
Major European tanker pool Frontline and Euronav announce suspension of all Red Sea transits with immediate diversion around Cape of Good Hope, adding 12 to 14 days transit time for Middle East to European refiners.
War risk insurance premiums spiked 40% to 0.7% of vessel hull value.`,
  },
  {
    id: 'preset-api-eia-conflict',
    title: 'Conflicting Data: API Surprise Build vs Platts Consensus',
    source: 'American Petroleum Institute (API) vs S&P Global Platts Survey',
    timestamp: 'Tuesday 16:30 ET / Wednesday 08:00 ET',
    rawText: `CONFLICTING REPORTS:
Source A (American Petroleum Institute late Tuesday release): US crude oil inventories rose by +3.42 million barrels for the week ended Oct 2, with Cushing storage building +450,000 barrels and gasoline building +1.1 million barrels.
Source B (Platts / Bloomberg survey consensus of 14 oil analysts): Analysts expect EIA official data to show a commercial crude DRAW of -1.50 million barrels and a Cushing draw of -800,000 barrels due to high refinery utilization.
API survey is voluntary and unverified by government auditors; official EIA report releases at 10:30 AM ET today.`,
  },
  {
    id: 'preset-cftc-cot-flush',
    title: 'CFTC COT: Heavy Speculative Liquidation in WTI',
    source: 'U.S. Commodity Futures Trading Commission (CFTC)',
    timestamp: 'Friday, 15:30 ET',
    rawText: `CFTC Commitments of Traders Report (WTI Crude Oil): For the week ending Tuesday, Managed Money net long position in NYMEX WTI crude plunged by 22,450 contracts to 124,100 contracts, reaching the lowest bullish stance in 7 months.
Gross longs were reduced by 14,800 contracts while gross short positions surged by 7,650 contracts amid broad macro risk-off flows.
Commercial swap dealers and producers absorbed liquidity, cutting net short hedges by 19,200 contracts.`,
  },
]
