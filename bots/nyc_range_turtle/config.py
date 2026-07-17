"""Strategy and instrument configuration for range / IB Turtle backtests."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, time
from pathlib import Path
from zoneinfo import ZoneInfo

BOTS_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = BOTS_ROOT / "data"
OUTPUT_DIR = BOTS_ROOT / "output"

NY_TZ = ZoneInfo("America/New_York")

# Default Asia pair (legacy); US-session universe selected via CLI
INSTRUMENTS = ("JP225_USD", "HK33_HKD")
US_SESSION_INSTRUMENTS = (
    "US30_USD",    # Dow
    "NAS100_USD",  # Nasdaq
    "DE30_EUR",    # DAX
    "UK100_GBP",   # FTSE
    "XAU_USD",     # Gold
)

# Prior-VA mean-reversion universe (Asia winners + US cleanest names)
VA_MR_INSTRUMENTS = (
    "JP225_USD",
    "HK33_HKD",
    "US30_USD",
    "UK100_GBP",
)

# Momentum + volume trend-following universe
MOM_VOL_INSTRUMENTS = (
    "US30_USD",
    "NAS100_USD",
    "JP225_USD",
    "HK33_HKD",
    "DE30_EUR",
    "UK100_GBP",
)

# Full Auction Turtle — locked a priori
AUCTION_INSTRUMENTS = (
    "US30_USD",
    "NAS100_USD",
    "JP225_USD",
    "HK33_HKD",
    "DE30_EUR",
    "UK100_GBP",
)
AUCTION_IB_MINUTES = 45
AUCTION_TREND_STOP_ATR = 2.0
AUCTION_TREND_TARGET_ATR = 3.5
AUCTION_FADE_STOP_ATR = 1.5
AUCTION_FADE_TARGET_ATR = 2.0
AUCTION_TREND_FAIL_LIMIT = 3
AUCTION_BRACKET_FAIL_LIMIT = 3
AUCTION_RVOL_MIN = 1.5
# Curve-fit winner (M15 grid + half-period holdout) — NOT a priori
AUCTION_OPT_GRANULARITY = "M15"
AUCTION_OPT_IB_MINUTES = 30
AUCTION_OPT_TREND_STOP_ATR = 2.0
AUCTION_OPT_TREND_TARGET_ATR = 3.5
AUCTION_OPT_FADE_STOP_ATR = 1.0
AUCTION_OPT_FADE_TARGET_ATR = 1.5
AUCTION_OPT_RVOL_MIN = 2.0
AUCTION_OPT_USE_LUNCH = False
LUNCH_START = time(12, 0)
LUNCH_END = time(13, 30)  # exclusive end of lunch lock (12:00–13:30)
# Instruments that observe US lunch lock
LUNCH_LOCK_INSTRUMENTS = frozenset(
    {"US30_USD", "NAS100_USD", "DE30_EUR", "UK100_GBP", "XAU_USD"}
)

# True NYC Range: overnight Asia+London (16:00→09:30 ET) on US indices
NYC_TRUE_INSTRUMENTS = ("US30_USD", "NAS100_USD")
NYC_OVERNIGHT_START = time(16, 0)  # prior RTH close
NYC_OVERNIGHT_END = time(9, 30)  # US cash open
NYC_TRUE_STOP_ATR = 1.5
NYC_TRUE_TARGET_ATR = 2.5

# JP225 Yesterday Turtle: prior Tokyo session H/L + directional bias
JP225_YEST_INSTRUMENTS = ("JP225_USD",)
JP225_YEST_STOP_ATR = 1.5
JP225_YEST_TARGET_ATR = 2.0

# Forex VWAP mean-reversion (London–NY window)
FOREX_VWAP_INSTRUMENTS = ("EUR_USD", "GBP_USD")
FOREX_VWAP_BAND_ATR = 1.0
FOREX_VWAP_STOP_ATR = 0.75
FOREX_VWAP_TARGET_CAP_ATR = 1.5

# Locked momentum/volume filters (a priori — not optimized)
RVOL_PERIOD = 20
RVOL_MIN = 1.5
RSI_LONG_MIN = 55.0
RSI_SHORT_MAX = 45.0


# Session open/close in America/New_York
# Overnight (start > end): Asia indices
# Same-day (start < end): US cash session 09:30–16:00
SESSION_START: dict[str, time] = {
    "JP225_USD": time(21, 0),
    "HK33_HKD": time(21, 30),
    "US30_USD": time(9, 30),
    "NAS100_USD": time(9, 30),
    "DE30_EUR": time(9, 30),
    "UK100_GBP": time(9, 30),
    "XAU_USD": time(9, 30),
    "EUR_USD": time(3, 0),
    "GBP_USD": time(3, 0),
}
SESSION_END: dict[str, time] = {
    "JP225_USD": time(6, 0),
    "HK33_HKD": time(4, 0),
    "US30_USD": time(16, 0),
    "NAS100_USD": time(16, 0),
    "DE30_EUR": time(16, 0),
    "UK100_GBP": time(16, 0),
    "XAU_USD": time(16, 0),
    "EUR_USD": time(17, 0),
    "GBP_USD": time(17, 0),
}

IB_MINUTES = 60
IB_GRANULARITIES = ("M5", "M10", "M15")

NYC_RANGE_START = time(9, 30)
NYC_RANGE_END = time(16, 0)

SESSION_WINDOWS: dict[str, list[tuple[time, time]]] = {
    "JP225_USD": [
        (time(21, 0), time(23, 59, 59)),
        (time(0, 0), time(6, 0)),
    ],
    "HK33_HKD": [
        (time(21, 30), time(23, 59, 59)),
        (time(0, 0), time(4, 0)),
    ],
    "US30_USD": [(time(9, 30), time(16, 0))],
    "NAS100_USD": [(time(9, 30), time(16, 0))],
    "DE30_EUR": [(time(9, 30), time(16, 0))],
    "UK100_GBP": [(time(9, 30), time(16, 0))],
    "XAU_USD": [(time(9, 30), time(16, 0))],
    "EUR_USD": [(time(3, 0), time(17, 0))],
    "GBP_USD": [(time(3, 0), time(17, 0))],
}

ATR_PERIOD = 14
RSI_PERIOD = 14
DIV_PIVOT = 3
STOP_ATR_MULT = 0.5
TARGET_ATR_MULT = 1.0
SCRATCH_ATR_THRESH = 0.15
MAX_DAILY_LOSSES = 3
UNITS = 1.0

# --- Range Breakout Ladder (IB / Asia session / Yesterday full-day) ---
# 3-attempt decreasing-risk turtle: tight SL/TP, "from inside" directional
# filter, daily R-based kill switch. Each range type backtested independently.
RBL_INSTRUMENTS = ("US30_USD", "NAS100_USD")
RBL_IB_DURATIONS = (30, 60)  # minutes; both tested, no single winner assumed
RBL_ASIA_START = time(19, 0)  # Tokyo/HK hours, ET
RBL_ASIA_END = time(3, 0)
RBL_ENTRY_WINDOW_START = time(9, 30)
RBL_ENTRY_WINDOW_END = time(15, 30)
RBL_FLAT_TIME = time(15, 55)
RBL_FROM_INSIDE_LOOKBACK_MIN = 15
RBL_STOP_ATR_MULT = 0.5  # tight stop, turtle-style
RBL_BREAKOUT_BUFFER_ATR = 0.05  # confirmation buffer beyond boundary
RBL_TP_R_MULTIPLES = (1.0, 1.5)  # tighter-TP variants tested
RBL_DEFAULT_TP_R = 1.5
RBL_ATTEMPT_SIZE_MULT = (1.0, 0.5, 0.25)  # attempt 1 / 2 / 3 risk sizing
RBL_MAX_ATTEMPTS = 3
RBL_DAILY_KILL_R = 3.0
RBL_SPREAD_POINTS: dict[str, float] = {"US30_USD": 3.0, "NAS100_USD": 2.0}
RBL_SLIPPAGE_POINTS = 1.0

OANDA_PRACTICE_URL = "https://api-fxpractice.oanda.com"
OANDA_LIVE_URL = "https://api-fxtrade.oanda.com"
CANDLE_GRANULARITY = "M5"
MAX_CANDLES_PER_REQUEST = 5000


@dataclass(frozen=True)
class InstrumentConfig:
    name: str
    display: str


INSTRUMENT_META: dict[str, InstrumentConfig] = {
    "JP225_USD": InstrumentConfig("JP225_USD", "Nikkei 225"),
    "HK33_HKD": InstrumentConfig("HK33_HKD", "Hang Seng / HSI"),
    "US30_USD": InstrumentConfig("US30_USD", "Dow Jones"),
    "NAS100_USD": InstrumentConfig("NAS100_USD", "Nasdaq 100"),
    "DE30_EUR": InstrumentConfig("DE30_EUR", "DAX"),
    "UK100_GBP": InstrumentConfig("UK100_GBP", "FTSE 100"),
    "XAU_USD": InstrumentConfig("XAU_USD", "Gold"),
    "EUR_USD": InstrumentConfig("EUR_USD", "Euro / USD"),
    "GBP_USD": InstrumentConfig("GBP_USD", "Cable / GBPUSD"),
}


def is_overnight_session(instrument: str) -> bool:
    return SESSION_START[instrument] > SESSION_END[instrument]


def _in_windows(t: time, windows: list[tuple[time, time]]) -> bool:
    for start, end in windows:
        if start <= end:
            if start <= t < end:
                return True
        else:
            if t >= start or t < end:
                return True
    for start, end in windows:
        if end.hour == 23 and end.minute == 59 and t >= start:
            return True
    return False


def is_in_session(instrument: str, ts_ny) -> bool:
    local = ts_ny.astimezone(NY_TZ)
    return _in_windows(local.time(), SESSION_WINDOWS[instrument])


def session_open_date(instrument: str, ts) -> date | None:
    """Calendar date of the session open this bar belongs to (ET)."""
    local = ts.astimezone(NY_TZ)
    t = local.time()
    start = SESSION_START[instrument]
    end = SESSION_END[instrument]

    if is_overnight_session(instrument):
        # e.g. 21:00 → 06:00
        if t >= start:
            return local.date()
        if t < end:
            return local.date() - timedelta(days=1)
        return None

    # Same-day session e.g. 09:30 → 16:00
    if start <= t < end:
        return local.date()
    return None


def ib_end_time(instrument: str, ib_minutes: int | None = None) -> time:
    start = SESSION_START[instrument]
    minutes = IB_MINUTES if ib_minutes is None else ib_minutes
    base = datetime.combine(date(2000, 1, 1), start)
    return (base + timedelta(minutes=minutes)).time()


def is_after_ib(instrument: str, ts, ib_minutes: int | None = None) -> bool:
    local = ts.astimezone(NY_TZ)
    sod = session_open_date(instrument, ts)
    if sod is None:
        return False
    ib_done = datetime.combine(
        sod, ib_end_time(instrument, ib_minutes=ib_minutes), tzinfo=NY_TZ
    )
    return local >= ib_done


def is_lunch_lock(instrument: str, ts) -> bool:
    """US cash-session lunch lock 12:00–13:30 ET; Asia overnight sessions skip."""
    if instrument not in LUNCH_LOCK_INSTRUMENTS:
        return False
    local = ts.astimezone(NY_TZ)
    t = local.time()
    return LUNCH_START <= t < LUNCH_END


def asia_session_key(ts) -> str:
    local = ts.astimezone(NY_TZ)
    d = local.date()
    if local.time() >= NYC_RANGE_END:
        return d.isoformat()
    return (d - timedelta(days=1)).isoformat()


def chunk_days_for_granularity(granularity: str) -> int:
    minutes = {"M5": 5, "M10": 10, "M15": 15, "M30": 30, "H1": 60}.get(granularity, 5)
    return max(5, int(4500 * minutes / (60 * 24)) - 1)
