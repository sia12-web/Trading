-- Create regime_cache table for market recommendation data
CREATE TABLE IF NOT EXISTS regime_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument TEXT NOT NULL CHECK (instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  date DATE NOT NULL,

  -- Gap and overnight OHLC
  gap_percent DECIMAL(5, 2) NOT NULL,
  overnight_open DECIMAL(10, 2) NOT NULL,
  overnight_high DECIMAL(10, 2) NOT NULL,
  overnight_low DECIMAL(10, 2) NOT NULL,
  overnight_close DECIMAL(10, 2) NOT NULL,

  -- Regime classification
  regime TEXT NOT NULL CHECK (regime IN ('bullish', 'bearish', 'choppy')),
  regime_confidence SMALLINT NOT NULL CHECK (regime_confidence >= 0 AND regime_confidence <= 100),

  -- News and sentiment
  news_headlines JSONB DEFAULT '[]'::jsonb,
  news_sentiment_score SMALLINT DEFAULT 0,

  -- Level break data from detector
  best_level_break_confidence SMALLINT CHECK (best_level_break_confidence IS NULL OR (best_level_break_confidence >= 0 AND best_level_break_confidence <= 100)),
  best_break_level DECIMAL(10, 2),

  -- Recommendation confidence (final score)
  recommendation_confidence SMALLINT NOT NULL CHECK (recommendation_confidence >= 0 AND recommendation_confidence <= 100),

  -- Scoring breakdown for transparency
  gap_score SMALLINT DEFAULT 0,
  ohlc_score SMALLINT DEFAULT 0,
  news_score SMALLINT DEFAULT 0,
  level_score SMALLINT DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Composite index: instrument + date (typically queried together)
CREATE INDEX IF NOT EXISTS idx_regime_cache_instrument_date ON regime_cache(instrument, date DESC);

-- Index for finding today's recommendations quickly
CREATE INDEX IF NOT EXISTS idx_regime_cache_date ON regime_cache(date DESC);

-- Index for finding best recommendation per day
CREATE INDEX IF NOT EXISTS idx_regime_cache_confidence ON regime_cache(recommendation_confidence DESC);

-- Unique constraint: one row per instrument per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_regime_cache_unique ON regime_cache(instrument, date);

ALTER TABLE regime_cache ENABLE ROW LEVEL SECURITY;

-- RLS: All readable (single-user app)
DROP POLICY IF EXISTS "regime_cache_all_readable" ON regime_cache;
CREATE POLICY "regime_cache_all_readable"
  ON regime_cache FOR SELECT
  USING (true);

-- Only system can insert regime cache
DROP POLICY IF EXISTS "regime_cache_system_insert" ON regime_cache;
CREATE POLICY "regime_cache_system_insert"
  ON regime_cache FOR INSERT
  WITH CHECK (true);

-- System can update regime cache
DROP POLICY IF EXISTS "regime_cache_system_update" ON regime_cache;
CREATE POLICY "regime_cache_system_update"
  ON regime_cache FOR UPDATE
  USING (true);

-- Create market_recommendations table for tracking trader choices
CREATE TABLE IF NOT EXISTS market_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,

  -- Winning recommendation for the day
  recommended_instrument TEXT NOT NULL CHECK (recommended_instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  recommendation_confidence SMALLINT NOT NULL,

  -- All candidates (for comparison)
  all_recommendations JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Trader's choice
  trader_selected_instrument TEXT CHECK (trader_selected_instrument IS NULL OR trader_selected_instrument IN ('DOW', 'NASDAQ', 'NIKKEI')),
  selected_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_date ON market_recommendations(date DESC);

ALTER TABLE market_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recommendations_all_readable" ON market_recommendations;
CREATE POLICY "recommendations_all_readable"
  ON market_recommendations FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "recommendations_system_write" ON market_recommendations;
CREATE POLICY "recommendations_system_write"
  ON market_recommendations FOR INSERT
  WITH CHECK (true);
