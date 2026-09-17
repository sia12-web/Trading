/**
 * Real company and asset names dictionary for US equities, ETFs, futures, and options.
 * Helps traders immediately understand what company or asset a ticker symbol represents.
 */

export type AssetType = 'stock' | 'etf' | 'option' | 'future' | 'index' | 'crypto'

export interface SymbolMetadata {
  symbol: string
  name: string
  shortName: string
  sector?: string
  assetType: AssetType
}

/**
 * Built-in dictionary of major traded US stocks, mega-caps, tech leaders,
 * ETFs, Dow 30, S&P 500 components, growth stocks, crypto proxies, and indices.
 */
export const KNOWN_SYMBOLS: Record<string, { name: string; shortName?: string; sector?: string; assetType?: AssetType }> = {
  // Mega-Cap & Tech Leaders
  AAPL: { name: 'Apple Inc.', shortName: 'Apple', sector: 'Technology', assetType: 'stock' },
  MSFT: { name: 'Microsoft Corporation', shortName: 'Microsoft', sector: 'Technology', assetType: 'stock' },
  NVDA: { name: 'NVIDIA Corporation', shortName: 'NVIDIA', sector: 'Semiconductors', assetType: 'stock' },
  GOOGL: { name: 'Alphabet Inc. (Class A)', shortName: 'Google', sector: 'Technology', assetType: 'stock' },
  GOOG: { name: 'Alphabet Inc. (Class C)', shortName: 'Google', sector: 'Technology', assetType: 'stock' },
  AMZN: { name: 'Amazon.com Inc.', shortName: 'Amazon', sector: 'Consumer Discretionary', assetType: 'stock' },
  META: { name: 'Meta Platforms Inc.', shortName: 'Meta / Facebook', sector: 'Technology', assetType: 'stock' },
  TSLA: { name: 'Tesla Inc.', shortName: 'Tesla', sector: 'Automotive / EV', assetType: 'stock' },
  AVGO: { name: 'Broadcom Inc.', shortName: 'Broadcom', sector: 'Semiconductors', assetType: 'stock' },
  ORCL: { name: 'Oracle Corporation', shortName: 'Oracle', sector: 'Technology', assetType: 'stock' },
  CRM: { name: 'Salesforce Inc.', shortName: 'Salesforce', sector: 'Software', assetType: 'stock' },
  ADBE: { name: 'Adobe Inc.', shortName: 'Adobe', sector: 'Software', assetType: 'stock' },
  AMD: { name: 'Advanced Micro Devices Inc.', shortName: 'AMD', sector: 'Semiconductors', assetType: 'stock' },
  INTC: { name: 'Intel Corporation', shortName: 'Intel', sector: 'Semiconductors', assetType: 'stock' },
  QCOM: { name: 'Qualcomm Inc.', shortName: 'Qualcomm', sector: 'Semiconductors', assetType: 'stock' },
  TXN: { name: 'Texas Instruments Inc.', shortName: 'Texas Instruments', sector: 'Semiconductors', assetType: 'stock' },
  IBM: { name: 'International Business Machines', shortName: 'IBM', sector: 'Technology', assetType: 'stock' },
  CSCO: { name: 'Cisco Systems Inc.', shortName: 'Cisco', sector: 'Networking', assetType: 'stock' },
  NFLX: { name: 'Netflix Inc.', shortName: 'Netflix', sector: 'Entertainment', assetType: 'stock' },
  NOW: { name: 'ServiceNow Inc.', shortName: 'ServiceNow', sector: 'Software', assetType: 'stock' },
  INTU: { name: 'Intuit Inc.', shortName: 'Intuit', sector: 'Software', assetType: 'stock' },
  AMAT: { name: 'Applied Materials Inc.', shortName: 'Applied Materials', sector: 'Semiconductors', assetType: 'stock' },
  MU: { name: 'Micron Technology Inc.', shortName: 'Micron', sector: 'Semiconductors', assetType: 'stock' },
  LRCX: { name: 'Lam Research Corp.', shortName: 'Lam Research', sector: 'Semiconductors', assetType: 'stock' },
  ASML: { name: 'ASML Holding NV', shortName: 'ASML', sector: 'Semiconductors', assetType: 'stock' },
  TSM: { name: 'Taiwan Semiconductor Manufacturing', shortName: 'TSMC', sector: 'Semiconductors', assetType: 'stock' },
  ARM: { name: 'Arm Holdings plc', shortName: 'Arm', sector: 'Semiconductors', assetType: 'stock' },
  SMCI: { name: 'Super Micro Computer Inc.', shortName: 'Supermicro', sector: 'Hardware', assetType: 'stock' },
  PLTR: { name: 'Palantir Technologies Inc.', shortName: 'Palantir', sector: 'AI / Data Analytics', assetType: 'stock' },

  // Software & Cloud & Cybersecurity
  PANW: { name: 'Palo Alto Networks Inc.', shortName: 'Palo Alto', sector: 'Cybersecurity', assetType: 'stock' },
  CRWD: { name: 'CrowdStrike Holdings Inc.', shortName: 'CrowdStrike', sector: 'Cybersecurity', assetType: 'stock' },
  FTNT: { name: 'Fortinet Inc.', shortName: 'Fortinet', sector: 'Cybersecurity', assetType: 'stock' },
  ZS: { name: 'Zscaler Inc.', shortName: 'Zscaler', sector: 'Cybersecurity', assetType: 'stock' },
  NET: { name: 'Cloudflare Inc.', shortName: 'Cloudflare', sector: 'Cloud / Security', assetType: 'stock' },
  SNOW: { name: 'Snowflake Inc.', shortName: 'Snowflake', sector: 'Data Cloud', assetType: 'stock' },
  MDB: { name: 'MongoDB Inc.', shortName: 'MongoDB', sector: 'Database Software', assetType: 'stock' },
  DDOG: { name: 'Datadog Inc.', shortName: 'Datadog', sector: 'Cloud Monitoring', assetType: 'stock' },
  TEAM: { name: 'Atlassian Corporation', shortName: 'Atlassian', sector: 'Software', assetType: 'stock' },
  WDAY: { name: 'Workday Inc.', shortName: 'Workday', sector: 'Software', assetType: 'stock' },
  SHOP: { name: 'Shopify Inc.', shortName: 'Shopify', sector: 'E-Commerce', assetType: 'stock' },
  TTD: { name: 'The Trade Desk Inc.', shortName: 'Trade Desk', sector: 'AdTech', assetType: 'stock' },
  SPOT: { name: 'Spotify Technology SA', shortName: 'Spotify', sector: 'Music Streaming', assetType: 'stock' },
  UBER: { name: 'Uber Technologies Inc.', shortName: 'Uber', sector: 'Rideshare / Delivery', assetType: 'stock' },
  ABNB: { name: 'Airbnb Inc.', shortName: 'Airbnb', sector: 'Travel / Lodging', assetType: 'stock' },
  DASH: { name: 'DoorDash Inc.', shortName: 'DoorDash', sector: 'Food Delivery', assetType: 'stock' },
  RBLX: { name: 'Roblox Corporation', shortName: 'Roblox', sector: 'Gaming / Metaverse', assetType: 'stock' },
  U: { name: 'Unity Software Inc.', shortName: 'Unity', sector: 'Gaming Engine', assetType: 'stock' },
  SNAP: { name: 'Snap Inc.', shortName: 'Snapchat', sector: 'Social Media', assetType: 'stock' },
  PINS: { name: 'Pinterest Inc.', shortName: 'Pinterest', sector: 'Social Media', assetType: 'stock' },
  RDDT: { name: 'Reddit Inc.', shortName: 'Reddit', sector: 'Social Media', assetType: 'stock' },
  APP: { name: 'AppLovin Corporation', shortName: 'AppLovin', sector: 'AdTech / Mobile', assetType: 'stock' },
  DUOL: { name: 'Duolingo Inc.', shortName: 'Duolingo', sector: 'EdTech', assetType: 'stock' },

  // Fintech & Crypto Proxies
  COIN: { name: 'Coinbase Global Inc.', shortName: 'Coinbase', sector: 'Crypto Exchange', assetType: 'stock' },
  HOOD: { name: 'Robinhood Markets Inc.', shortName: 'Robinhood', sector: 'Brokerage / Fintech', assetType: 'stock' },
  SOFI: { name: 'SoFi Technologies Inc.', shortName: 'SoFi', sector: 'Digital Banking', assetType: 'stock' },
  SQ: { name: 'Block Inc. (Square)', shortName: 'Block / Square', sector: 'Fintech', assetType: 'stock' },
  PYPL: { name: 'PayPal Holdings Inc.', shortName: 'PayPal', sector: 'Fintech / Payments', assetType: 'stock' },
  MSTR: { name: 'MicroStrategy Inc.', shortName: 'MicroStrategy', sector: 'Bitcoin Treasury / Enterprise Software', assetType: 'stock' },
  MARA: { name: 'MARA Holdings Inc.', shortName: 'Marathon Digital', sector: 'Bitcoin Mining', assetType: 'stock' },
  RIOT: { name: 'Riot Platforms Inc.', shortName: 'Riot', sector: 'Bitcoin Mining', assetType: 'stock' },
  CLSK: { name: 'CleanSpark Inc.', shortName: 'CleanSpark', sector: 'Bitcoin Mining', assetType: 'stock' },
  CIFR: { name: 'Cipher Mining Inc.', shortName: 'Cipher Mining', sector: 'Bitcoin Mining', assetType: 'stock' },
  HUT: { name: 'Hut 8 Corp.', shortName: 'Hut 8', sector: 'Bitcoin Mining', assetType: 'stock' },
  AFRM: { name: 'Affirm Holdings Inc.', shortName: 'Affirm', sector: 'Fintech / BNPL', assetType: 'stock' },
  UPST: { name: 'Upstart Holdings Inc.', shortName: 'Upstart', sector: 'AI Lending', assetType: 'stock' },

  // Financial Giants & Berkshire
  JPM: { name: 'JPMorgan Chase & Co.', shortName: 'JPMorgan', sector: 'Banking', assetType: 'stock' },
  BAC: { name: 'Bank of America Corp.', shortName: 'Bank of America', sector: 'Banking', assetType: 'stock' },
  WFC: { name: 'Wells Fargo & Co.', shortName: 'Wells Fargo', sector: 'Banking', assetType: 'stock' },
  C: { name: 'Citigroup Inc.', shortName: 'Citigroup', sector: 'Banking', assetType: 'stock' },
  GS: { name: 'The Goldman Sachs Group Inc.', shortName: 'Goldman Sachs', sector: 'Investment Banking', assetType: 'stock' },
  MS: { name: 'Morgan Stanley', shortName: 'Morgan Stanley', sector: 'Investment Banking', assetType: 'stock' },
  BLK: { name: 'BlackRock Inc.', shortName: 'BlackRock', sector: 'Asset Management', assetType: 'stock' },
  SCHW: { name: 'The Charles Schwab Corporation', shortName: 'Charles Schwab', sector: 'Brokerage', assetType: 'stock' },
  'BRK.A': { name: 'Berkshire Hathaway Inc. (Class A)', shortName: 'Berkshire Hathaway', sector: 'Conglomerate', assetType: 'stock' },
  'BRK.B': { name: 'Berkshire Hathaway Inc. (Class B)', shortName: 'Berkshire Hathaway', sector: 'Conglomerate', assetType: 'stock' },
  'BRK-B': { name: 'Berkshire Hathaway Inc. (Class B)', shortName: 'Berkshire Hathaway', sector: 'Conglomerate', assetType: 'stock' },
  V: { name: 'Visa Inc.', shortName: 'Visa', sector: 'Payment Networks', assetType: 'stock' },
  MA: { name: 'Mastercard Incorporated', shortName: 'Mastercard', sector: 'Payment Networks', assetType: 'stock' },
  AXP: { name: 'American Express Company', shortName: 'American Express', sector: 'Financial Services', assetType: 'stock' },

  // Healthcare & Pharma
  LLY: { name: 'Eli Lilly and Company', shortName: 'Eli Lilly', sector: 'Pharmaceuticals', assetType: 'stock' },
  NVO: { name: 'Novo Nordisk A/S', shortName: 'Novo Nordisk', sector: 'Pharmaceuticals', assetType: 'stock' },
  JNJ: { name: 'Johnson & Johnson', shortName: 'Johnson & Johnson', sector: 'Healthcare', assetType: 'stock' },
  UNH: { name: 'UnitedHealth Group Inc.', shortName: 'UnitedHealth', sector: 'Health Insurance', assetType: 'stock' },
  ABBV: { name: 'AbbVie Inc.', shortName: 'AbbVie', sector: 'Biopharmaceuticals', assetType: 'stock' },
  MRK: { name: 'Merck & Co. Inc.', shortName: 'Merck', sector: 'Pharmaceuticals', assetType: 'stock' },
  PFE: { name: 'Pfizer Inc.', shortName: 'Pfizer', sector: 'Pharmaceuticals', assetType: 'stock' },
  BMY: { name: 'Bristol-Myers Squibb Co.', shortName: 'Bristol Myers', sector: 'Pharmaceuticals', assetType: 'stock' },
  AMGN: { name: 'Amgen Inc.', shortName: 'Amgen', sector: 'Biotechnology', assetType: 'stock' },
  GILD: { name: 'Gilead Sciences Inc.', shortName: 'Gilead', sector: 'Biotechnology', assetType: 'stock' },
  ISRG: { name: 'Intuitive Surgical Inc.', shortName: 'Intuitive Surgical', sector: 'Medical Robotics', assetType: 'stock' },
  MDT: { name: 'Medtronic plc', shortName: 'Medtronic', sector: 'Medical Devices', assetType: 'stock' },
  TMO: { name: 'Thermo Fisher Scientific Inc.', shortName: 'Thermo Fisher', sector: 'Life Sciences', assetType: 'stock' },

  // Consumer, Retail & Entertainment
  WMT: { name: 'Walmart Inc.', shortName: 'Walmart', sector: 'Retail', assetType: 'stock' },
  COST: { name: 'Costco Wholesale Corporation', shortName: 'Costco', sector: 'Retail', assetType: 'stock' },
  TGT: { name: 'Target Corporation', shortName: 'Target', sector: 'Retail', assetType: 'stock' },
  HD: { name: 'The Home Depot Inc.', shortName: 'Home Depot', sector: 'Home Improvement', assetType: 'stock' },
  LOW: { name: 'Lowe\'s Companies Inc.', shortName: 'Lowe\'s', sector: 'Home Improvement', assetType: 'stock' },
  MCD: { name: 'McDonald\'s Corporation', shortName: 'McDonald\'s', sector: 'Restaurants', assetType: 'stock' },
  SBUX: { name: 'Starbucks Corporation', shortName: 'Starbucks', sector: 'Coffee / Restaurants', assetType: 'stock' },
  NKE: { name: 'NIKE Inc.', shortName: 'Nike', sector: 'Apparel / Footwear', assetType: 'stock' },
  LULU: { name: 'Lululemon Athletica Inc.', shortName: 'Lululemon', sector: 'Apparel', assetType: 'stock' },
  DIS: { name: 'The Walt Disney Company', shortName: 'Disney', sector: 'Entertainment', assetType: 'stock' },
  CMG: { name: 'Chipotle Mexican Grill Inc.', shortName: 'Chipotle', sector: 'Restaurants', assetType: 'stock' },
  PG: { name: 'The Procter & Gamble Company', shortName: 'Procter & Gamble', sector: 'Consumer Goods', assetType: 'stock' },
  KO: { name: 'The Coca-Cola Company', shortName: 'Coca-Cola', sector: 'Beverages', assetType: 'stock' },
  PEP: { name: 'PepsiCo Inc.', shortName: 'PepsiCo', sector: 'Beverages / Snacks', assetType: 'stock' },
  PM: { name: 'Philip Morris International Inc.', shortName: 'Philip Morris', sector: 'Tobacco', assetType: 'stock' },
  MO: { name: 'Altria Group Inc.', shortName: 'Altria', sector: 'Tobacco', assetType: 'stock' },

  // Energy & Industrials & Aerospace
  XOM: { name: 'Exxon Mobil Corporation', shortName: 'ExxonMobil', sector: 'Oil & Gas', assetType: 'stock' },
  CVX: { name: 'Chevron Corporation', shortName: 'Chevron', sector: 'Oil & Gas', assetType: 'stock' },
  COP: { name: 'ConocoPhillips', shortName: 'ConocoPhillips', sector: 'Oil & Gas', assetType: 'stock' },
  SLB: { name: 'SLB (Schlumberger Ltd.)', shortName: 'Schlumberger', sector: 'Oilfield Services', assetType: 'stock' },
  EOG: { name: 'EOG Resources Inc.', shortName: 'EOG Resources', sector: 'Oil & Gas', assetType: 'stock' },
  OXY: { name: 'Occidental Petroleum Corp.', shortName: 'Occidental', sector: 'Oil & Gas', assetType: 'stock' },
  CAT: { name: 'Caterpillar Inc.', shortName: 'Caterpillar', sector: 'Heavy Machinery', assetType: 'stock' },
  DE: { name: 'Deere & Company', shortName: 'John Deere', sector: 'Agricultural Machinery', assetType: 'stock' },
  BA: { name: 'The Boeing Company', shortName: 'Boeing', sector: 'Aerospace & Defense', assetType: 'stock' },
  GE: { name: 'GE Aerospace (General Electric)', shortName: 'GE Aerospace', sector: 'Aerospace', assetType: 'stock' },
  RTX: { name: 'RTX Corporation (Raytheon)', shortName: 'Raytheon / RTX', sector: 'Aerospace & Defense', assetType: 'stock' },
  LMT: { name: 'Lockheed Martin Corporation', shortName: 'Lockheed Martin', sector: 'Defense', assetType: 'stock' },
  HON: { name: 'Honeywell International Inc.', shortName: 'Honeywell', sector: 'Conglomerate', assetType: 'stock' },
  UNP: { name: 'Union Pacific Corporation', shortName: 'Union Pacific', sector: 'Railroads', assetType: 'stock' },
  UPS: { name: 'United Parcel Service Inc.', shortName: 'UPS', sector: 'Logistics', assetType: 'stock' },
  FDX: { name: 'FedEx Corporation', shortName: 'FedEx', sector: 'Logistics', assetType: 'stock' },
  F: { name: 'Ford Motor Company', shortName: 'Ford', sector: 'Automotive', assetType: 'stock' },
  GM: { name: 'General Motors Company', shortName: 'General Motors', sector: 'Automotive', assetType: 'stock' },
  RIVN: { name: 'Rivian Automotive Inc.', shortName: 'Rivian', sector: 'Electric Vehicles', assetType: 'stock' },
  LCID: { name: 'Lucid Group Inc.', shortName: 'Lucid', sector: 'Electric Vehicles', assetType: 'stock' },

  // Chinese Equities & Global ADRs
  BABA: { name: 'Alibaba Group Holding Ltd.', shortName: 'Alibaba', sector: 'E-Commerce / Cloud', assetType: 'stock' },
  JD: { name: 'JD.com Inc.', shortName: 'JD.com', sector: 'E-Commerce', assetType: 'stock' },
  PDD: { name: 'PDD Holdings Inc. (Temu/Pinduoduo)', shortName: 'PDD / Temu', sector: 'E-Commerce', assetType: 'stock' },
  BIDU: { name: 'Baidu Inc.', shortName: 'Baidu', sector: 'Search / AI', assetType: 'stock' },
  NIO: { name: 'NIO Inc.', shortName: 'NIO', sector: 'Electric Vehicles', assetType: 'stock' },
  SE: { name: 'Sea Limited (Shopee/Garena)', shortName: 'Sea Ltd', sector: 'E-Commerce / Gaming', assetType: 'stock' },

  // Major ETFs
  SPY: { name: 'SPDR S&P 500 ETF Trust', shortName: 'S&P 500 ETF', sector: 'Broad Market', assetType: 'etf' },
  QQQ: { name: 'Invesco QQQ Trust (Nasdaq 100)', shortName: 'Nasdaq 100 ETF', sector: 'Tech / Large Cap', assetType: 'etf' },
  DIA: { name: 'SPDR Dow Jones Industrial Average ETF', shortName: 'Dow Jones ETF', sector: 'Blue Chip', assetType: 'etf' },
  IWM: { name: 'iShares Russell 2000 ETF', shortName: 'Russell 2000 ETF', sector: 'Small Cap', assetType: 'etf' },
  VOO: { name: 'Vanguard S&P 500 ETF', shortName: 'Vanguard S&P 500', sector: 'Broad Market', assetType: 'etf' },
  VTI: { name: 'Vanguard Total Stock Market ETF', shortName: 'Vanguard Total Market', sector: 'Total Market', assetType: 'etf' },
  SOXL: { name: 'Direxion Daily Semiconductor Bull 3X', shortName: 'Semi 3X Bull ETF', sector: 'Semiconductors (Leveraged)', assetType: 'etf' },
  SOXS: { name: 'Direxion Daily Semiconductor Bear 3X', shortName: 'Semi 3X Bear ETF', sector: 'Semiconductors (Leveraged)', assetType: 'etf' },
  TQQQ: { name: 'ProShares UltraPro QQQ (3X Nasdaq Bull)', shortName: 'Nasdaq 3X Bull ETF', sector: 'Tech (Leveraged)', assetType: 'etf' },
  SQQQ: { name: 'ProShares UltraPro Short QQQ (3X Nasdaq Bear)', shortName: 'Nasdaq 3X Bear ETF', sector: 'Tech (Leveraged)', assetType: 'etf' },
  SPXL: { name: 'Direxion Daily S&P 500 Bull 3X', shortName: 'S&P 3X Bull ETF', sector: 'Broad Market (Leveraged)', assetType: 'etf' },
  SPXS: { name: 'Direxion Daily S&P 500 Bear 3X', shortName: 'S&P 3X Bear ETF', sector: 'Broad Market (Leveraged)', assetType: 'etf' },
  UVXY: { name: 'ProShares Ultra VIX Short-Term Futures', shortName: 'Ultra VIX ETF', sector: 'Volatility', assetType: 'etf' },
  VXX: { name: 'iPath Series B S&P 500 VIX Short-Term Futures', shortName: 'VIX ETN', sector: 'Volatility', assetType: 'etf' },
  TLT: { name: 'iShares 20+ Year Treasury Bond ETF', shortName: '20+ Yr Treasury ETF', sector: 'Bonds', assetType: 'etf' },
  HYG: { name: 'iShares iBoxx $ High Yield Corporate Bond ETF', shortName: 'High Yield Bond ETF', sector: 'Bonds', assetType: 'etf' },
  GLD: { name: 'SPDR Gold Shares', shortName: 'Gold ETF', sector: 'Commodities', assetType: 'etf' },
  SLV: { name: 'iShares Silver Trust', shortName: 'Silver ETF', sector: 'Commodities', assetType: 'etf' },
  USO: { name: 'United States Oil Fund', shortName: 'Crude Oil ETF', sector: 'Commodities', assetType: 'etf' },
  UNG: { name: 'United States Natural Gas Fund', shortName: 'Natural Gas ETF', sector: 'Commodities', assetType: 'etf' },
  XLE: { name: 'Energy Select Sector SPDR Fund', shortName: 'Energy Sector ETF', sector: 'Energy', assetType: 'etf' },
  XLF: { name: 'Financial Select Sector SPDR Fund', shortName: 'Financial Sector ETF', sector: 'Financials', assetType: 'etf' },
  XLK: { name: 'Technology Select Sector SPDR Fund', shortName: 'Tech Sector ETF', sector: 'Technology', assetType: 'etf' },
  XLV: { name: 'Health Care Select Sector SPDR Fund', shortName: 'Healthcare Sector ETF', sector: 'Healthcare', assetType: 'etf' },
  XLI: { name: 'Industrial Select Sector SPDR Fund', shortName: 'Industrial Sector ETF', sector: 'Industrials', assetType: 'etf' },
  XLP: { name: 'Consumer Staples Select Sector SPDR Fund', shortName: 'Staples Sector ETF', sector: 'Consumer Staples', assetType: 'etf' },
  XLY: { name: 'Consumer Discretionary Select Sector SPDR', shortName: 'Discretionary Sector ETF', sector: 'Consumer Discretionary', assetType: 'etf' },
  XLU: { name: 'Utilities Select Sector SPDR Fund', shortName: 'Utilities Sector ETF', sector: 'Utilities', assetType: 'etf' },
  XLRE: { name: 'Real Estate Select Sector SPDR Fund', shortName: 'Real Estate Sector ETF', sector: 'Real Estate', assetType: 'etf' },
  XBI: { name: 'SPDR S&P Biotech ETF', shortName: 'Biotech ETF', sector: 'Biotech', assetType: 'etf' },
  ARKK: { name: 'ARK Innovation ETF', shortName: 'ARK Innovation ETF', sector: 'Disruptive Innovation', assetType: 'etf' },

  // Spot / Crypto ETFs
  IBIT: { name: 'iShares Bitcoin Trust ETF', shortName: 'iShares Bitcoin ETF', sector: 'Bitcoin ETF', assetType: 'crypto' },
  FBTC: { name: 'Fidelity Wise Origin Bitcoin Fund', shortName: 'Fidelity Bitcoin ETF', sector: 'Bitcoin ETF', assetType: 'crypto' },
  BITO: { name: 'ProShares Bitcoin Strategy ETF', shortName: 'Bitcoin Strategy ETF', sector: 'Bitcoin ETF', assetType: 'crypto' },
  ETHA: { name: 'iShares Ethereum Trust ETF', shortName: 'iShares Ethereum ETF', sector: 'Ethereum ETF', assetType: 'crypto' },

  // Futures & Desk Instruments
  DOW: { name: 'Dow Jones Industrial Average (E-mini/Micro)', shortName: 'Dow Futures', sector: 'Index Futures', assetType: 'future' },
  YM: { name: 'E-mini Dow Jones ($5) Futures', shortName: 'E-mini Dow', sector: 'Index Futures', assetType: 'future' },
  MYM: { name: 'Micro E-mini Dow Jones Futures', shortName: 'Micro Dow', sector: 'Index Futures', assetType: 'future' },
  NASDAQ: { name: 'Nasdaq 100 Index (E-mini/Micro)', shortName: 'Nasdaq Futures', sector: 'Index Futures', assetType: 'future' },
  NQ: { name: 'E-mini Nasdaq 100 Futures', shortName: 'E-mini Nasdaq', sector: 'Index Futures', assetType: 'future' },
  MNQ: { name: 'Micro E-mini Nasdaq 100 Futures', shortName: 'Micro Nasdaq', sector: 'Index Futures', assetType: 'future' },
  SP500: { name: 'S&P 500 Index (E-mini/Micro)', shortName: 'S&P 500 Futures', sector: 'Index Futures', assetType: 'future' },
  ES: { name: 'E-mini S&P 500 Futures', shortName: 'E-mini S&P', sector: 'Index Futures', assetType: 'future' },
  MES: { name: 'Micro E-mini S&P 500 Futures', shortName: 'Micro S&P', sector: 'Index Futures', assetType: 'future' },
  RUSSELL: { name: 'Russell 2000 Index Futures', shortName: 'Russell Futures', sector: 'Index Futures', assetType: 'future' },
  RTY: { name: 'E-mini Russell 2000 Futures', shortName: 'E-mini Russell', sector: 'Index Futures', assetType: 'future' },
  M2K: { name: 'Micro E-mini Russell 2000 Futures', shortName: 'Micro Russell', sector: 'Index Futures', assetType: 'future' },
  GOLD: { name: 'Gold Futures (GC/MGC)', shortName: 'Gold Futures', sector: 'Commodity Futures', assetType: 'future' },
  GC: { name: 'Gold Futures (100 oz)', shortName: 'Gold 100oz', sector: 'Commodity Futures', assetType: 'future' },
  MGC: { name: 'Micro Gold Futures (10 oz)', shortName: 'Micro Gold', sector: 'Commodity Futures', assetType: 'future' },
  CRUDE: { name: 'Crude Oil Futures (CL/MCL)', shortName: 'Crude Oil Futures', sector: 'Commodity Futures', assetType: 'future' },
  CL: { name: 'Crude Oil Futures (1,000 bbl)', shortName: 'Crude 1000bbl', sector: 'Commodity Futures', assetType: 'future' },
  MCL: { name: 'Micro WTI Crude Oil Futures', shortName: 'Micro Crude', sector: 'Commodity Futures', assetType: 'future' },
  NIKKEI: { name: 'Nikkei 225 Index Futures', shortName: 'Nikkei Futures', sector: 'Index Futures', assetType: 'future' },
  NKD: { name: 'Nikkei 225 (USD) Futures', shortName: 'Nikkei USD', sector: 'Index Futures', assetType: 'future' },
}

const OPTION_FORMAT_A = /^([A-Z0-9.\-]+)\s+(\d{2}[A-Za-z]{3}\d{2})([CPcp])(\d+(?:\.\d+)?)$/
const OPTION_OCC = /^([A-Z]{1,6})\s*(\d{2})(\d{2})(\d{2})([CPcp])(\d{8})$/

/**
 * Format an option ticker into a human readable company + strike + expiry string.
 * Example: 'NVDA  22Aug26C180.00' -> 'NVIDIA Corporation · Aug 22, 2026 $180 Call'
 * Example: 'AAPL 260918C00150000' -> 'Apple Inc. · Sep 18, 2026 $150 Call'
 */
export function formatOptionRealName(raw: string): {
  isOption: boolean
  underlying: string
  companyName: string
  label: string
  fullName: string
} | null {
  const s = String(raw || '').trim().replace(/\s+/g, ' ')
  if (!s) return null

  // Check Format A: "AAPL 21Aug26C150.00" or "NVDA 22Aug26P180.00"
  const m1 = s.match(OPTION_FORMAT_A)
  if (m1 && m1[1] && m1[2] && m1[3] && m1[4]) {
    const underlying = m1[1].toUpperCase()
    const expiry = m1[2]
    const right = m1[3].toUpperCase() === 'P' ? 'Put' : 'Call'
    const strikeNum = Number(m1[4])
    const strike = Number.isFinite(strikeNum)
      ? strikeNum % 1 === 0
        ? String(strikeNum)
        : strikeNum.toFixed(2)
      : m1[4]
    const company = getSymbolRealName(underlying)
    const label = `${underlying} ${expiry} $${strike} ${right}`
    const fullName = `${company.name} · ${expiry} $${strike} ${right}`
    return {
      isOption: true,
      underlying,
      companyName: company.name,
      label,
      fullName,
    }
  }

  // Check OCC standard format: "AAPL  260918C00150000"
  const m2 = s.match(OPTION_OCC)
  if (m2 && m2[1] && m2[2] && m2[3] && m2[4] && m2[5] && m2[6]) {
    const underlying = m2[1].toUpperCase()
    const yy = m2[2]
    const mm = m2[3]
    const dd = m2[4]
    const right = m2[5].toUpperCase() === 'P' ? 'Put' : 'Call'
    const strikeNum = Number(m2[6]) / 1000
    const strike = Number.isFinite(strikeNum)
      ? strikeNum % 1 === 0
        ? String(strikeNum)
        : strikeNum.toFixed(2)
      : String(strikeNum)
    const expiry = `${yy}-${mm}-${dd}`
    const company = getSymbolRealName(underlying)
    const label = `${underlying} ${expiry} $${strike} ${right}`
    const fullName = `${company.name} · ${expiry} $${strike} ${right}`
    return {
      isOption: true,
      underlying,
      companyName: company.name,
      label,
      fullName,
    }
  }

  return null
}

/**
 * Get comprehensive metadata and real company/asset name for any stock, ETF, option, or index.
 */
export function getSymbolRealName(rawSymbol?: string | null): SymbolMetadata {
  const sym = String(rawSymbol || '')
    .trim()
    .toUpperCase()

  if (!sym) {
    return {
      symbol: '',
      name: 'Unknown Asset',
      shortName: 'Unknown',
      assetType: 'stock',
    }
  }

  // Check if option format
  const opt = formatOptionRealName(sym)
  if (opt) {
    return {
      symbol: sym,
      name: opt.fullName,
      shortName: opt.label,
      sector: 'Options Contract',
      assetType: 'option',
    }
  }

  // Normalize symbol (e.g. BRK/B -> BRK.B)
  const norm = sym.replace('/', '.')

  if (KNOWN_SYMBOLS[norm]) {
    const info = KNOWN_SYMBOLS[norm]
    return {
      symbol: norm,
      name: info.name,
      shortName: info.shortName || info.name,
      sector: info.sector,
      assetType: info.assetType || 'stock',
    }
  }

  // Fallback for symbols without dictionary entry
  return {
    symbol: norm,
    name: `${norm} Equity`,
    shortName: norm,
    assetType: 'stock',
  }
}

/**
 * Quick helper to get the real company or asset name string.
 * Example: 'AAPL' -> 'Apple Inc.'
 * Example: 'PLTR' -> 'Palantir Technologies Inc.'
 * Example: 'NVDA  22Aug26C180.00' -> 'NVIDIA Corporation · 22Aug26 $180 Call'
 */
export function getRealName(symbol?: string | null): string {
  return getSymbolRealName(symbol).name
}
