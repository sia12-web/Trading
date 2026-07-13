# Paper Trading Mode Implementation

## Overview

Slice 15 implements a paper trading toggle feature that allows users to switch between simulated (paper) and real (live) trading modes. This ensures safety by defaulting all new users to paper mode.

## Architecture

### Database Changes

#### Profiles Table
- **trading_mode** (TEXT, DEFAULT 'paper'): User's default mode preference
  - Values: 'paper' | 'live'
  - Persists across sessions
  - Applied to all new positions created by user

#### Positions Table
- **is_paper_trading** (BOOLEAN, DEFAULT TRUE): Per-position trading mode
  - Overrides user's default preference if needed
  - Determines execution behavior when position reaches entry price
  - Defaults to TRUE for safety (paper mode is default)
  - Indexed with (user_id, is_paper_trading) for quick filtering

## API Endpoints

### GET /api/settings/trading-mode
Retrieve user's current trading mode preference.

**Response:**
```typescript
{
  trading_mode: 'paper' | 'live',
  is_live_trading_enabled: boolean,
  updated_at?: string
}
```

**Status Codes:**
- 200: Success
- 401: Unauthorized
- 404: Profile not found
- 500: Server error

### PATCH /api/settings/trading-mode
Update user's default trading mode preference.

**Request:**
```typescript
{
  mode: 'paper' | 'live'
}
```

**Response:**
```typescript
{
  trading_mode: 'paper' | 'live',
  is_live_trading_enabled: boolean,
  updated_at: string
}
```

**Status Codes:**
- 200: Success
- 400: Invalid mode
- 401: Unauthorized
- 500: Server error

## Execution Flow

### Position Creation (POST /api/positions/create)

1. User submits position entry form
2. API validates all required fields and trade structure
3. Fetches user's current trading_mode from profiles table
4. Creates new position with is_paper_trading inherited from trading_mode
5. Returns created position with trading mode info

```typescript
// Example: User in paper mode creates BUY position
{
  session_id: "sess-123",
  symbol: "NQ",
  side: "BUY",
  entry_level: 19500,
  stop_loss: 19450,
  take_profit: 19600,
  quantity: 1
}

// Position created with:
{
  is_paper_trading: true  // Inherited from user's trading_mode: 'paper'
}
```

### Position Entry Execution (Monitoring Service)

When price reaches entry level:

1. Monitoring service fetches position with is_paper_trading flag
2. Checks flag to determine execution type:
   - **PAPER (is_paper_trading = true):**
     - Records entry price to position
     - Logs "simulated_execution" event to monitoring_events
     - No OANDA API call
   - **LIVE (is_paper_trading = false):**
     - Calls OANDA API to place real order
     - Records order ID
     - Logs "execution" event to monitoring_events with order details

### Position Exit (SL/TP reached)

Both paper and live modes:
- Exit price recorded when position reaches SL or TP
- Position marked as "closed"
- Exit event logged to monitoring_events
- No mode-based routing (both exit identically)

## Audit Trail

All execution events logged to monitoring_events table:

```typescript
// Simulated execution
{
  event_type: 'simulated_execution',
  description: 'PAPER MODE: Simulated entry at $19500'
}

// Live execution
{
  event_type: 'execution',
  description: 'LIVE MODE: Real order placed at $19500 | Order ID: OANDA_xxx'
}

// Position close
{
  event_type: 'closed',
  description: 'Position closed at $19600 | Mode: live_close'
}
```

Console logs also track mode:
```
[Position Created] NQ BUY at $19500 | Mode: PAPER
[Position Executor] PAPER MODE: Position pos-123 simulated at $19500
[Position Executor] LIVE MODE: Position pos-456 executed at $19500 | Order: OANDA_xxx
```

## Safety Features

1. **Default to Paper Mode**
   - New users default to trading_mode = 'paper'
   - All new positions default to is_paper_trading = true
   - Prevents accidental real-money execution

2. **Per-Position Override**
   - Each position inherits user's current mode at creation time
   - Switching user mode doesn't affect existing open positions
   - If user switches to 'live', new positions execute live; old positions retain original mode

3. **Audit Trail**
   - All executions logged with mode indicator
   - monitoring_events table tracks paper vs live
   - Console logs include mode for debugging

4. **No Retroactive Changes**
   - Changing user's trading_mode does NOT change existing positions
   - Ensures consistency and prevents surprise mode switches

## Usage Examples

### Example 1: User Starts in Paper Mode (Default)

```typescript
// Day 1: User creates position while in default paper mode
POST /api/positions/create
{
  // ... position data ...
}
// Result: Position created with is_paper_trading = true

// Position reaches entry price
// Result: Simulated execution, no OANDA call

// Price reaches take profit
// Result: Position closed, recorded in database
```

### Example 2: User Switches to Live Mode

```typescript
// User calls settings endpoint
PATCH /api/settings/trading-mode
{ mode: 'live' }

// User creates new position
POST /api/positions/create
{
  // ... position data ...
}
// Result: Position created with is_paper_trading = false

// Position reaches entry price
// Result: Real OANDA order placed with real money!

// User later switches back to paper
PATCH /api/settings/trading-mode
{ mode: 'paper' }

// Old live position is still live (won't be affected)
// New positions created after this will be paper
```

### Example 3: Mixed Paper and Live Positions

```typescript
// User has existing paper position (still open)
// User switches to live mode
// User creates new live position

// Dashboard shows both positions with appropriate badges:
// - Position 1: PAPER MODE (simulated, no real money)
// - Position 2: LIVE MODE (real money at risk)
```

## Integration with Position Executor Service

`lib/services/positionExecutor.ts` exports two key functions:

```typescript
// Execute entry when price reached
executePositionEntry(positionId, entryPrice, oandaOrderData?)
// Returns: ExecutionResult with execution_type and success status

// Close position at exit price
closePositionExit(positionId, exitPrice)
// Returns: ExecutionResult
```

These functions are called by the monitoring service when price conditions are met.

## Testing Paper Mode

### Manual Testing Steps

1. **Create session**
   ```bash
   curl -X POST http://localhost:3000/api/sessions/create \
     -H "Content-Type: application/json" \
     -d '{"date":"2024-07-13","index_recommendation":"NASDAQ"}'
   ```

2. **Check trading mode (should be paper by default)**
   ```bash
   curl http://localhost:3000/api/settings/trading-mode
   ```

3. **Create position (should inherit paper mode)**
   ```bash
   curl -X POST http://localhost:3000/api/positions/create \
     -H "Content-Type: application/json" \
     -d '{
       "session_id":"sess-123",
       "symbol":"NQ",
       "side":"BUY",
       "entry_level":19500,
       "stop_loss":19450,
       "take_profit":19600,
       "quantity":1
     }'
   ```

4. **Verify position has is_paper_trading = true**

5. **Switch to live mode**
   ```bash
   curl -X PATCH http://localhost:3000/api/settings/trading-mode \
     -H "Content-Type: application/json" \
     -d '{"mode":"live"}'
   ```

6. **Create new position (should have is_paper_trading = false)**

7. **Verify first position still has is_paper_trading = true** (retroactive change not applied)

## Performance Considerations

- Index on `profiles(trading_mode)` for filtering users by mode
- Index on `positions(user_id, is_paper_trading)` for dashboard queries like "show all live positions"
- Boolean flag check is O(1), negligible performance impact
- No query overhead on execution path - flag fetched during position creation

## Future Enhancements

1. **Paper Mode with Realistic Fills**
   - Simulate slippage and partial fills
   - Use real market data for simulation
   - Track simulated commissions

2. **Mode History**
   - Track when user switched between modes
   - Audit trail of mode changes

3. **Paperless Trading Limits**
   - Require minimum paper trading history before live
   - Restrict position size growth during first live positions

4. **Risk Management**
   - Daily loss limits that differ by mode
   - Forced transition to paper if live losses exceed threshold

5. **Dashboard Badges**
   - Visual indicators for paper vs live positions
   - Summary of total exposure by mode
   - Risk metrics separated by mode

## Security Considerations

- RLS policies unchanged - paper flag is application logic, not access control
- All mode changes logged for audit trail
- User cannot modify another user's trading mode
- No privilege escalation via mode manipulation
- OANDA API keys never exposed in response
- Paper mode executions don't call OANDA, reducing API exposure

## Migration Notes

For existing installations:
1. Run migration to add columns (non-breaking)
2. Existing users get trading_mode = 'paper' (safe default)
3. Existing positions get is_paper_trading = true (safe default)
4. No data loss or downtime required
5. Can deploy without interrupting live trading
