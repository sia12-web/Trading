"""Initial Balance / NYC-range Turtle breakout state machine."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Literal, Optional

import pandas as pd

from .config import (
    IB_MINUTES,
    MAX_DAILY_LOSSES,
    NY_TZ,
    NYC_RANGE_END,
    SCRATCH_ATR_THRESH,
    SESSION_START,
    STOP_ATR_MULT,
    TARGET_ATR_MULT,
    UNITS,
    asia_session_key,
    is_after_ib,
    is_in_session,
    session_open_date,
)

Side = Literal["LONG", "SHORT"]


@dataclass
class Position:
    side: Side
    entry_time: pd.Timestamp
    entry_price: float
    stop: float
    target: float
    atr_at_entry: float
    units: float = UNITS


@dataclass
class Trade:
    instrument: str
    side: Side
    entry_time: pd.Timestamp
    entry_price: float
    exit_time: pd.Timestamp
    exit_price: float
    pnl_points: float
    exit_reason: str
    atr_at_entry: float
    range_high: float
    range_low: float
    range_session_date: str
    # aliases kept for older NYC report field names
    @property
    def nyc_high(self) -> float:
        return self.range_high

    @property
    def nyc_low(self) -> float:
        return self.range_low

    @property
    def nyc_session_date(self) -> str:
        return self.range_session_date


@dataclass
class DayState:
    session_key: str
    range_high: float
    range_low: float
    range_session_date: str
    losses: int = 0
    locked: bool = False
    entry_taken: bool = False


@dataclass
class StrategyState:
    instrument: str
    position: Optional[Position] = None
    day: Optional[DayState] = None
    trades: list[Trade] = field(default_factory=list)


def build_nyc_ranges(df: pd.DataFrame) -> dict[date, tuple[float, float]]:
    """NYC RTH 09:30–16:00 ET high/low per NY date (legacy mode)."""
    if df.empty:
        return {}
    work = df.copy()
    local = work["time"].dt.tz_convert(NY_TZ)
    work["ny_date"] = local.dt.date
    minutes = local.dt.hour * 60 + local.dt.minute
    mask = (minutes >= 9 * 60 + 30) & (minutes < 16 * 60)
    rth = work.loc[mask]
    if rth.empty:
        return {}
    grouped = rth.groupby("ny_date").agg(high=("high", "max"), low=("low", "min"))
    return {d: (float(row.high), float(row.low)) for d, row in grouped.iterrows()}


def resolve_nyc_range(
    ts: pd.Timestamp,
    ranges: dict[date, tuple[float, float]],
) -> Optional[tuple[date, float, float]]:
    local = ts.astimezone(NY_TZ)
    cutoff_date = local.date()
    start = cutoff_date if local.time() >= NYC_RANGE_END else cutoff_date - timedelta(days=1)
    for i in range(10):
        d = start - timedelta(days=i)
        if d in ranges:
            complete_at = datetime.combine(d, NYC_RANGE_END, tzinfo=NY_TZ)
            if complete_at <= local:
                hi, lo = ranges[d]
                return d, hi, lo
    return None


def build_ib_ranges(
    df: pd.DataFrame,
    instrument: str,
    ib_minutes: int = IB_MINUTES,
) -> dict[date, tuple[float, float]]:
    """
    Own-market Initial Balance: high/low of first `ib_minutes` after session open.
    Keyed by session open date (ET).
    """
    if df.empty:
        return {}

    start = SESSION_START[instrument]
    start_dt = datetime.combine(date(2000, 1, 1), start)
    ib_end = (start_dt + timedelta(minutes=ib_minutes)).time()

    work = df.copy()
    local = work["time"].dt.tz_convert(NY_TZ)
    sods = [session_open_date(instrument, ts) for ts in work["time"]]
    work["session_date"] = sods
    work["local_time"] = local

    # IB window is on the open evening only (before midnight)
    t = local.dt.time
    if ib_end > start:
        ib_mask = (t >= start) & (t < ib_end)
    else:
        ib_mask = (t >= start) | (t < ib_end)

    ib_bars = work.loc[ib_mask & work["session_date"].notna()]
    if ib_bars.empty:
        return {}

    grouped = ib_bars.groupby("session_date").agg(high=("high", "max"), low=("low", "min"))
    return {d: (float(row.high), float(row.low)) for d, row in grouped.iterrows()}


def build_prior_session_ranges(
    df: pd.DataFrame,
    instrument: str,
) -> dict[date, tuple[float, float]]:
    """
    Prior completed session high/low ('yesterday range' for that market's session).
    Map: trading session date D -> (high, low) of previous session.
    """
    if df.empty:
        return {}
    work = df.copy()
    work["session_date"] = work["time"].map(lambda ts: session_open_date(instrument, ts))
    work = work.dropna(subset=["session_date"])
    if work.empty:
        return {}
    grouped = work.groupby("session_date").agg(high=("high", "max"), low=("low", "min"))
    dates = sorted(grouped.index)
    prior: dict[date, tuple[float, float]] = {}
    for i, d in enumerate(dates):
        if i == 0:
            continue
        prev = dates[i - 1]
        prior[d] = (float(grouped.loc[prev, "high"]), float(grouped.loc[prev, "low"]))
    return prior


def resolve_ib_range(
    instrument: str,
    ts: pd.Timestamp,
    ranges: dict[date, tuple[float, float]],
) -> Optional[tuple[date, float, float]]:
    """Return this session's IB only after IB has completed."""
    if not is_in_session(instrument, ts):
        return None
    if not is_after_ib(instrument, ts):
        return None
    sod = session_open_date(instrument, ts)
    if sod is None or sod not in ranges:
        return None
    hi, lo = ranges[sod]
    return sod, hi, lo


def _pnl(side: Side, entry: float, exit_price: float, units: float = UNITS) -> float:
    if side == "LONG":
        return (exit_price - entry) * units
    return (entry - exit_price) * units


class RangeTurtle:
    """Breakout turtle on a precomputed range (NYC RTH or own-market IB)."""

    def __init__(self, instrument: str, mode: str = "ib") -> None:
        self.state = StrategyState(instrument=instrument)
        self.instrument = instrument
        self.mode = mode
        self._last_range: tuple[float, float] = (float("nan"), float("nan"))
        self._last_range_date: str = ""

    def on_bar(
        self,
        bar: pd.Series,
        atr: float,
        range_high: Optional[float],
        range_low: Optional[float],
        range_session_date: Optional[str],
        next_bar_time: Optional[pd.Timestamp] = None,
        allow_entry: bool = True,
    ) -> None:
        ts = bar["time"]
        in_session = is_in_session(self.instrument, ts)
        if self.mode == "ib":
            sod = session_open_date(self.instrument, ts)
            sk = sod.isoformat() if sod else asia_session_key(ts)
        else:
            sk = asia_session_key(ts)

        if range_high is not None and range_low is not None and range_session_date:
            if self.state.day is None or self.state.day.session_key != sk:
                self.state.day = DayState(
                    session_key=sk,
                    range_high=range_high,
                    range_low=range_low,
                    range_session_date=range_session_date,
                )

        if self.state.position is not None:
            self._manage_position(bar, in_session, next_bar_time)
            return

        if not allow_entry or not in_session:
            return
        if self.state.day is None or self.state.day.locked or self.state.day.entry_taken:
            return
        if atr is None or atr <= 0 or pd.isna(atr):
            return

        close = float(bar["close"])
        hi, lo = self.state.day.range_high, self.state.day.range_low

        if close > hi:
            self._enter("LONG", bar, atr, hi, lo)
        elif close < lo:
            self._enter("SHORT", bar, atr, hi, lo)

    def _enter(
        self,
        side: Side,
        bar: pd.Series,
        atr: float,
        range_high: float,
        range_low: float,
    ) -> None:
        entry = float(bar["close"])
        if side == "LONG":
            stop = entry - STOP_ATR_MULT * atr
            target = entry + TARGET_ATR_MULT * atr
        else:
            stop = entry + STOP_ATR_MULT * atr
            target = entry - TARGET_ATR_MULT * atr

        self.state.position = Position(
            side=side,
            entry_time=bar["time"],
            entry_price=entry,
            stop=stop,
            target=target,
            atr_at_entry=atr,
        )
        assert self.state.day is not None
        self.state.day.entry_taken = True
        self._last_range = (range_high, range_low)
        self._last_range_date = self.state.day.range_session_date

    def _manage_position(
        self,
        bar: pd.Series,
        in_session: bool,
        next_bar_time: Optional[pd.Timestamp],
    ) -> None:
        pos = self.state.position
        assert pos is not None
        high = float(bar["high"])
        low = float(bar["low"])
        close = float(bar["close"])
        reason: Optional[str] = None
        exit_price: Optional[float] = None

        if pos.side == "LONG":
            if low <= pos.stop:
                reason, exit_price = "stop", pos.stop
            elif high >= pos.target:
                reason, exit_price = "target", pos.target
        else:
            if high >= pos.stop:
                reason, exit_price = "stop", pos.stop
            elif low <= pos.target:
                reason, exit_price = "target", pos.target

        session_end = (not in_session) or (
            next_bar_time is not None
            and in_session
            and not is_in_session(self.instrument, next_bar_time)
        )
        if reason is None and session_end:
            reason, exit_price = "session_end", close

        if reason is None:
            return

        pnl = _pnl(pos.side, pos.entry_price, float(exit_price))
        hi, lo = self._last_range
        trade = Trade(
            instrument=self.instrument,
            side=pos.side,
            entry_time=pos.entry_time,
            entry_price=pos.entry_price,
            exit_time=bar["time"],
            exit_price=float(exit_price),
            pnl_points=pnl,
            exit_reason=reason,
            atr_at_entry=pos.atr_at_entry,
            range_high=hi,
            range_low=lo,
            range_session_date=self._last_range_date,
        )
        self.state.trades.append(trade)
        self.state.position = None

        if self.state.day is not None and pnl < 0:
            loss_atr = abs(pnl) / pos.atr_at_entry if pos.atr_at_entry > 0 else 0
            if loss_atr > SCRATCH_ATR_THRESH:
                self.state.day.losses += 1
                if self.state.day.losses >= MAX_DAILY_LOSSES:
                    self.state.day.locked = True

        if self.state.day is not None and not self.state.day.locked:
            self.state.day.entry_taken = False

    def force_flat(self, bar: pd.Series) -> None:
        if self.state.position is None:
            return
        self._manage_position(bar, in_session=False, next_bar_time=None)


# Back-compat alias
NycRangeTurtle = RangeTurtle
