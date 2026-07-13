-- Slice 15: Add paper trading mode toggle support
-- Allows users to switch between paper (simulation) and live (real) trading modes

-- Add trading_mode to profiles table (user's default preference)
ALTER TABLE profiles
ADD COLUMN trading_mode TEXT NOT NULL DEFAULT 'paper' CHECK (trading_mode IN ('paper', 'live'));

CREATE INDEX idx_profiles_trading_mode ON profiles(trading_mode);

-- Add is_paper_trading to positions table (per-position override)
ALTER TABLE positions
ADD COLUMN is_paper_trading BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX idx_positions_is_paper_trading ON positions(user_id, is_paper_trading);

-- No RLS policy changes needed - existing policies remain in effect
-- Paper trading flag is used only in application logic, not in data access control
