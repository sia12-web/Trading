-- Slice 3: Real-Time Level Status Monitoring
-- Creates tables for trading levels and monitoring status

-- Create trading_levels table
CREATE TABLE trading_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL,
  level_name TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  level_type TEXT NOT NULL CHECK (level_type IN ('support', 'resistance', 'pivot')),
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_level UNIQUE(user_id, instrument, price)
);

-- Create indexes for fast queries
CREATE INDEX idx_levels_user_id ON trading_levels(user_id);
CREATE INDEX idx_levels_user_instrument ON trading_levels(user_id, instrument);
CREATE INDEX idx_levels_user_instrument_active ON trading_levels(user_id, instrument, is_active);

-- Enable RLS on trading_levels
ALTER TABLE trading_levels ENABLE ROW LEVEL SECURITY;

-- RLS Policies for trading_levels
CREATE POLICY "Users can read own levels"
  ON trading_levels FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own levels"
  ON trading_levels FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own levels"
  ON trading_levels FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own levels"
  ON trading_levels FOR DELETE
  USING (user_id = auth.uid());

-- Create level_monitor_status table
CREATE TABLE level_monitor_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'disconnected' CHECK (connection_status IN ('connected', 'reconnecting', 'disconnected')),
  last_price DECIMAL(10, 2),
  last_price_update TIMESTAMPTZ,
  reconnect_attempts INT DEFAULT 0,
  last_reconnect_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_instrument ON (user_id, instrument)
);

-- Create indexes for monitoring status
CREATE INDEX idx_monitor_status_user_id ON level_monitor_status(user_id);
CREATE INDEX idx_monitor_status_user_instrument ON level_monitor_status(user_id, instrument);

-- Enable RLS on level_monitor_status
ALTER TABLE level_monitor_status ENABLE ROW LEVEL SECURITY;

-- RLS Policies for level_monitor_status
CREATE POLICY "Users can read own monitoring status"
  ON level_monitor_status FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "System can update monitoring status"
  ON level_monitor_status FOR UPDATE
  USING (true);

CREATE POLICY "System can insert monitoring status"
  ON level_monitor_status FOR INSERT
  WITH CHECK (true);

-- Seed default levels for each user/instrument combination
-- Note: These will be inserted via application logic, not this migration
-- This ensures each user gets their own copy of default levels
