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
  supply: 'US production is not on this feed.',
  demand: 'Product supplied is not on this feed.',
  inventories: 'Cushing and commercial stocks are not on this feed.',
  opec: 'OPEC policy is not on this feed.',
  geopolitical_risk: 'No live geopolitical premium is computed here.',
  positioning: 'CFTC positioning is not on this feed.',
  curve: 'Front spread loads from the listed WTI months.',
  upcoming_catalysts: 'EIA Weekly Petroleum Status (Wed 10:30 AM ET); Baker Hughes rigs (Fri 1:00 PM ET); CFTC COT (Fri 3:30 PM ET).',

  bias: 'NEUTRAL',
  confidence: 0,
  what_changed_since_yesterday: 'No measured inventory or curve change until a live print arrives.',
  what_would_invalidate_this_view: 'A live inventory, OPEC, or curve print that contradicts the read.',

  updatedAt: new Date().toISOString(),
}

export const DEFAULT_FIVE_FEEDS: FiveFeedStatus[] = [
  {
    id: 'eia_api',
    name: 'EIA API Feed',
    source: 'U.S. Energy Information Administration (v2 API)',
    status: 'FALLBACK',
    lastSync: 'Not connected',
    details: 'This desk does not call the EIA API. Inventory figures are not a live print.',
  },
  {
    id: 'trading_economics',
    name: 'Trading Economics / Consensus Feed',
    source: 'Trading Economics & Finnhub Calendar',
    status: 'FALLBACK',
    lastSync: 'Not connected',
    details: 'This desk does not call a consensus calendar. Release times below are the regular schedule, not a live sync.',
  },
  {
    id: 'cftc_api',
    name: 'CFTC COT API Feed',
    source: 'U.S. Commodity Futures Trading Commission',
    status: 'FALLBACK',
    lastSync: 'Not connected',
    details: 'This desk does not call the CFTC API. Positioning is not a live print.',
  },
  {
    id: 'realtime_news',
    name: 'Real-Time News Wire',
    source: 'Reuters / LSEG / Finnhub Energy Wire & Yahoo RSS',
    status: 'FALLBACK',
    lastSync: 'Not connected',
    details: 'Headlines load from Finnhub and Yahoo when this page refreshes. This is not a streaming wire.',
  },
  {
    id: 'cme_databento',
    name: 'CME / Databento WTI Market Data',
    source: 'Yahoo CL=F, the next listed month, BZ=F, RB=F, HO=F',
    status: 'FALLBACK',
    lastSync: 'Not connected',
    details: 'Prompt WTI, the next listed month, Brent, RBOB, and heating oil. Yahoo futures are delayed.',
  },
]

function unpublishedPillar(
  id: FundamentalPillarId,
  name: string,
  subtitle: string,
  metrics: FundamentalPillarState['metrics'],
  horizon: FundamentalPillarState['horizon'] = 'DAYS_WEEKS'
): FundamentalPillarState {
  return {
    id,
    name,
    subtitle,
    bias: 'NEUTRAL',
    statusSummary: 'Not on this feed.',
    metrics,
    horizon,
    confidence: 0,
    reliability: 0,
    keyTakeaway: 'No live series is connected for this pillar.',
    lastUpdated: '',
    primarySource: 'Not connected',
  }
}

const unavailable = (label: string, unit?: string): FundamentalPillarState['metrics'][number] => ({
  label,
  value: '—',
  unit,
  trend: 'FLAT',
  note: 'Not on this feed',
})

export const DEFAULT_PILLARS_STATE: Record<FundamentalPillarId, FundamentalPillarState> = {
  crude_supply: unpublishedPillar('crude_supply', 'Crude Supply', 'US production and rigs are not on this feed', [
    unavailable('US Field Production', 'bpd'),
    unavailable('Baker Hughes Oil Rigs', 'rigs'),
  ], 'MONTHS'),
  petroleum_demand: unpublishedPillar('petroleum_demand', 'Petroleum Demand', 'Product supplied is not on this feed', [
    unavailable('Total Product Supplied', 'bpd'),
    unavailable('Motor Gasoline Supplied', 'bpd'),
    unavailable('Distillate Supplied', 'bpd'),
  ]),
  inventories: unpublishedPillar('inventories', 'Inventories & Cushing Hub', 'Weekly stocks load only when FRED prints', [
    unavailable('Cushing Hub Storage', 'thousand bbl'),
    unavailable('US Commercial Crude', 'bbl'),
    unavailable('SPR Reserves', 'bbl'),
    unavailable('Gasoline Stocks', 'bbl'),
  ]),
  refinery_activity: unpublishedPillar('refinery_activity', 'Refinery Activity', 'Utilization is not on this feed. Crack uses RBOB and heating oil.', [
    unavailable('Refinery Utilization'),
    unavailable('Gross Crude Inputs', 'bpd'),
    unavailable('3:2:1 Crack Spread', '/bbl'),
  ]),
  imports_exports: unpublishedPillar('imports_exports', 'Imports & Exports', 'Customs flows are not on this feed. Brent-WTI is a live spread.', [
    unavailable('Brent-WTI Spread', '/bbl'),
    unavailable('US Crude Exports', 'bpd'),
    unavailable('US Crude Imports', 'bpd'),
  ]),
  opec_policy: unpublishedPillar('opec_policy', 'OPEC+ Production Policy', 'Quotas and compliance are not on this feed', [
    unavailable('Voluntary Cuts'),
    unavailable('Compliance'),
    unavailable('Spare Capacity'),
  ], 'MONTHS'),
  geopolitical_risk: unpublishedPillar('geopolitical_risk', 'Geopolitical Supply Risk', 'No risk premium is computed on this desk', [
    unavailable('Risk Premium', '/bbl'),
  ]),
  curve_structure: unpublishedPillar('curve_structure', 'Futures Curve Structure', 'Front month versus the next listed month', [
    unavailable('Prompt Spread (M1-M2)', '/bbl'),
    unavailable('Next Contract'),
    unavailable('Curve Regime'),
  ]),
  speculative_positioning: unpublishedPillar('speculative_positioning', 'Speculative Positioning', 'CFTC positioning is not on this feed', [
    unavailable('Managed Money Net Long', 'contracts'),
  ]),
  macro_drivers: unpublishedPillar('macro_drivers', 'Macroeconomic Drivers', 'DXY loads from Yahoo. PMI and the policy rate do not.', [
    unavailable('US Dollar Index (DXY)', 'index'),
    unavailable('Global Mfg PMI'),
    unavailable('Fed Policy Bias'),
  ], 'MONTHS'),
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
    lastActual: 'Not on this feed',
    lastSurprise: 'Not on this feed',
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
    lastActual: 'Not on this feed',
    lastSurprise: 'Not on this feed',
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
    lastActual: 'Not on this feed',
    lastSurprise: 'Not on this feed',
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
    lastActual: 'Not on this feed',
    lastSurprise: 'Not on this feed',
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
    lastActual: 'Not on this feed',
    lastSurprise: 'Not on this feed',
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
    lastActual: 'Not on this feed',
    lastSurprise: 'Not on this feed',
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
