-- Broker execution ids for OANDA practice/live fills
ALTER TABLE trades_journal
  ADD COLUMN IF NOT EXISTS oanda_trade_id TEXT,
  ADD COLUMN IF NOT EXISTS oanda_order_id TEXT,
  ADD COLUMN IF NOT EXISTS broker_fill_price NUMERIC;

CREATE INDEX IF NOT EXISTS idx_trades_journal_oanda_trade
  ON trades_journal(oanda_trade_id)
  WHERE oanda_trade_id IS NOT NULL;
