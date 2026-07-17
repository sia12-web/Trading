"""
Range Breakout Ladder: IB / Asia-session / Yesterday-full-day breakout turtle.

Locked a priori (per Scout grill session):
- Three independent range types, each backtested separately:
    * ib   -> own-market Initial Balance (30m and 60m, both tested)
    * asia -> latest completed Asia/HK session range (19:00-03:00 ET)
    * yest -> previous full calendar day's high/low (24/5 CFD range)
- Directional filter: price must have closed inside the range within the
  last RBL_FROM_INSIDE_LOOKBACK_MIN minutes before the breakout bar (no
  gap-and-go trades; also gates re-entries, since a stopped-out side must
  come back inside before it can signal again).
- Entry: M5 close beyond boundary + buffer (RBL_BREAKOUT_BUFFER_ATR * ATR).
- Exit: tight stop = RBL_STOP_ATR_MULT * ATR from entry; TP = tp_r * stop
  distance (tight, tested at 1.0R and 1.5R).
- 3-attempt decreasing-risk ladder per boundary per day: attempt sizes
  1.0 / 0.5 / 0.25 (of a fixed risk unit). A target hit locks that boundary
  for the day (profit taken); 3 stop-outs locks it (switched off).
- Daily kill switch: RBL_DAILY_KILL_R cumulative R loss halts new entries
  for the rest of the day (both boundaries).
- Entries only in RBL_ENTRY_WINDOW; hard flat at RBL_FLAT_TIME, no
  overnight holds. Realistic spread + slippage deducted on every trade.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Literal, Optional

import numpy as np
import pandas as pd

from .config import (
    NY_TZ,
    RBL_ASIA_END,
    RBL_ASIA_START,
    RBL_ATTEMPT_SIZE_MULT,
    RBL_BREAKOUT_BUFFER_ATR,
    RBL_DAILY_KILL_R,
    RBL_DEFAULT_TP_R,
    RBL_ENTRY_WINDOW_END,
    RBL_ENTRY_WINDOW_START,
    RBL_FLAT_TIME,
    RBL_FROM_INSIDE_LOOKBACK_MIN,
    RBL_MAX_ATTEMPTS,
    RBL_SLIPPAGE_POINTS,
    RBL_SPREAD_POINTS,
    RBL_STOP_ATR_MULT,
    is_after_ib,
    is_in_session,
    session_open_date,
)
from .strategy import build_ib_ranges, resolve_ib_range

Side = Literal["LONG", "SHORT"]
RangeType = Literal["ib", "asia", "yest"]


# --------------------------------------------------------------------------
# Range builders
# --------------------------------------------------------------------------


def build_asia_session_ranges(df: pd.DataFrame) -> dict[date, tuple[float, float]]:
    """
    Latest completed Asia/HK session range (19:00 ET prior day -> 03:00 ET)
    keyed by the US trading day (ET calendar date) that session feeds into.
    """
    if df.empty:
        return {}
    work = df.copy()
    local = work["time"].dt.tz_convert(NY_TZ)
    work["ny_date"] = local.dt.date
    minutes = local.dt.hour * 60 + local.dt.minute
    start_m = RBL_ASIA_START.hour * 60 + RBL_ASIA_START.minute
    end_m = RBL_ASIA_END.hour * 60 + RBL_ASIA_END.minute

    mask = (minutes >= start_m) | (minutes < end_m)
    asia = work.loc[mask].copy()
    if asia.empty:
        return {}

    asia_minutes = local.loc[asia.index].dt.hour * 60 + local.loc[asia.index].dt.minute

    def trade_date_for(idx) -> date:
        d = asia.loc[idx, "ny_date"]
        if asia_minutes.loc[idx] >= start_m:
            return d + timedelta(days=1)
        return d

    asia["trade_date"] = [trade_date_for(i) for i in asia.index]
    grouped = asia.groupby("trade_date").agg(high=("high", "max"), low=("low", "min"))
    out: dict[date, tuple[float, float]] = {}
    for d, row in grouped.iterrows():
        hi, lo = float(row.high), float(row.low)
        if np.isfinite(hi) and np.isfinite(lo) and hi > lo:
            out[d] = (hi, lo)
    return out


def build_yesterday_full_day_ranges(df: pd.DataFrame) -> dict[date, tuple[float, float]]:
    """
    Previous full ET calendar day's high/low (near-24h CFD range), keyed by
    the trading day that uses it.
    """
    if df.empty:
        return {}
    work = df.copy()
    local = work["time"].dt.tz_convert(NY_TZ)
    work["ny_date"] = local.dt.date
    grouped = work.groupby("ny_date").agg(high=("high", "max"), low=("low", "min"))
    dates = sorted(grouped.index)
    out: dict[date, tuple[float, float]] = {}
    for i, d in enumerate(dates):
        if i == 0:
            continue
        prev = dates[i - 1]
        hi = float(grouped.loc[prev, "high"])
        lo = float(grouped.loc[prev, "low"])
        if np.isfinite(hi) and np.isfinite(lo) and hi > lo:
            out[d] = (hi, lo)
    return out


# --------------------------------------------------------------------------
# State
# --------------------------------------------------------------------------


@dataclass
class Position:
    side: Side
    entry_time: pd.Timestamp
    entry_price: float
    stop: float
    target: float
    stop_distance: float
    size_mult: float
    attempt: int


@dataclass
class Trade:
    instrument: str
    range_type: str
    side: Side
    attempt: int
    size_mult: float
    entry_time: pd.Timestamp
    entry_price: float
    exit_time: pd.Timestamp
    exit_price: float
    pnl_points: float
    pnl_r: float
    exit_reason: str
    stop_distance: float
    range_high: float
    range_low: float
    range_session_date: str
    signal: str = "range_breakout_ladder"


@dataclass
class SideState:
    attempts_used: int = 0
    locked: bool = False


@dataclass
class DayState:
    session_key: str
    range_high: float
    range_low: float
    long: SideState = field(default_factory=SideState)
    short: SideState = field(default_factory=SideState)
    daily_r: float = 0.0
    kill_switched: bool = False
    last_inside_ts: Optional[pd.Timestamp] = None


@dataclass
class StrategyState:
    instrument: str
    position: Optional[Position] = None
    day: Optional[DayState] = None
    trades: list[Trade] = field(default_factory=list)


def _round_trip_cost(instrument: str) -> float:
    spread = RBL_SPREAD_POINTS.get(instrument, 2.5)
    return spread + RBL_SLIPPAGE_POINTS


def _pnl_points(side: Side, entry: float, exit_price: float) -> float:
    if side == "LONG":
        return exit_price - entry
    return entry - exit_price


class RangeBreakoutLadder:
    """3-attempt decreasing-risk breakout turtle on a precomputed range."""

    def __init__(
        self,
        instrument: str,
        range_type: RangeType,
        *,
        ib_minutes: int = 60,
        tp_r: float = RBL_DEFAULT_TP_R,
        stop_atr_mult: float = RBL_STOP_ATR_MULT,
        max_attempts: int = RBL_MAX_ATTEMPTS,
        attempt_size_mult: tuple[float, ...] = RBL_ATTEMPT_SIZE_MULT,
        daily_kill_r: float = RBL_DAILY_KILL_R,
    ) -> None:
        self.instrument = instrument
        self.range_type = range_type
        self.ib_minutes = ib_minutes
        self.tp_r = tp_r
        self.stop_atr_mult = stop_atr_mult
        self.max_attempts = max_attempts
        self.attempt_size_mult = attempt_size_mult
        self.daily_kill_r = daily_kill_r
        self.state = StrategyState(instrument=instrument)

    def run(
        self,
        df: pd.DataFrame,
        atr: pd.Series,
        ranges: dict[date, tuple[float, float]],
    ) -> list[Trade]:
        highs = df["high"].to_numpy(dtype=float)
        lows = df["low"].to_numpy(dtype=float)
        closes = df["close"].to_numpy(dtype=float)
        times = df["time"]
        n = len(df)

        for i in range(n):
            ts = times.iloc[i]
            atr_i = float(atr.iloc[i]) if pd.notna(atr.iloc[i]) else float("nan")
            next_ts = times.iloc[i + 1] if i + 1 < n else None

            if self.state.position is not None:
                self._manage(highs[i], lows[i], closes[i], ts, next_ts)
                continue

            in_sess = is_in_session(self.instrument, ts)
            if not in_sess:
                continue

            sod = session_open_date(self.instrument, ts)
            if sod is None or sod not in ranges:
                continue

            hi, lo = ranges[sod]
            sk = sod.isoformat()
            if self.state.day is None or self.state.day.session_key != sk:
                self.state.day = DayState(session_key=sk, range_high=hi, range_low=lo)

            day = self.state.day
            assert day is not None

            if not self._entries_allowed(ts):
                continue
            if day.kill_switched:
                continue
            if np.isnan(atr_i) or atr_i <= 0:
                continue

            close = closes[i]
            if lo <= close <= hi:
                day.last_inside_ts = ts

            recently_inside = day.last_inside_ts is not None and (
                ts - day.last_inside_ts <= timedelta(minutes=RBL_FROM_INSIDE_LOOKBACK_MIN)
            )
            if not recently_inside:
                continue

            buffer = RBL_BREAKOUT_BUFFER_ATR * atr_i
            if close > hi + buffer and not day.long.locked:
                self._enter("LONG", ts, close, atr_i, hi, lo, day)
            elif close < lo - buffer and not day.short.locked:
                self._enter("SHORT", ts, close, atr_i, hi, lo, day)

        if self.state.position is not None:
            last = df.iloc[-1]
            self._close(last["time"], float(last["close"]), "force_flat")

        return self.state.trades

    def _entries_allowed(self, ts: pd.Timestamp) -> bool:
        local = ts.astimezone(NY_TZ)
        t = local.time()
        if not (RBL_ENTRY_WINDOW_START <= t < RBL_ENTRY_WINDOW_END):
            return False
        if self.range_type == "ib":
            return is_after_ib(self.instrument, ts, ib_minutes=self.ib_minutes)
        return True

    def _enter(
        self,
        side: Side,
        ts: pd.Timestamp,
        close: float,
        atr_i: float,
        hi: float,
        lo: float,
        day: DayState,
    ) -> None:
        side_state = day.long if side == "LONG" else day.short
        attempt = side_state.attempts_used + 1
        size_mult = self.attempt_size_mult[
            min(attempt - 1, len(self.attempt_size_mult) - 1)
        ]
        stop_distance = self.stop_atr_mult * atr_i
        entry_price = close

        if side == "LONG":
            stop = entry_price - stop_distance
            target = entry_price + self.tp_r * stop_distance
        else:
            stop = entry_price + stop_distance
            target = entry_price - self.tp_r * stop_distance

        self.state.position = Position(
            side=side,
            entry_time=ts,
            entry_price=entry_price,
            stop=stop,
            target=target,
            stop_distance=stop_distance,
            size_mult=size_mult,
            attempt=attempt,
        )
        self._entry_range = (hi, lo)
        self._entry_session_key = day.session_key

    def _manage(
        self,
        high: float,
        low: float,
        close: float,
        ts: pd.Timestamp,
        next_ts: Optional[pd.Timestamp],
    ) -> None:
        pos = self.state.position
        assert pos is not None
        local = ts.astimezone(NY_TZ)
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

        past_flat = local.time() >= RBL_FLAT_TIME
        session_ending = next_ts is not None and not is_in_session(
            self.instrument, next_ts
        )
        if reason is None and (past_flat or session_ending or next_ts is None):
            reason, exit_price = "session_end", close

        if reason is None:
            return
        self._close(ts, float(exit_price), reason)

    def _close(self, ts: pd.Timestamp, exit_price: float, reason: str) -> None:
        pos = self.state.position
        assert pos is not None
        day = self.state.day
        assert day is not None

        raw_pnl = _pnl_points(pos.side, pos.entry_price, exit_price)
        cost = _round_trip_cost(self.instrument)
        pnl_points = (raw_pnl - cost) * pos.size_mult
        pnl_r = ((raw_pnl - cost) / pos.stop_distance) * pos.size_mult if pos.stop_distance > 0 else 0.0

        hi, lo = self._entry_range
        trade = Trade(
            instrument=self.instrument,
            range_type=self.range_type,
            side=pos.side,
            attempt=pos.attempt,
            size_mult=pos.size_mult,
            entry_time=pos.entry_time,
            entry_price=pos.entry_price,
            exit_time=ts,
            exit_price=exit_price,
            pnl_points=pnl_points,
            pnl_r=pnl_r,
            exit_reason=reason,
            stop_distance=pos.stop_distance,
            range_high=hi,
            range_low=lo,
            range_session_date=self._entry_session_key,
        )
        self.state.trades.append(trade)
        self.state.position = None

        day.daily_r += pnl_r
        side_state = day.long if pos.side == "LONG" else day.short

        if reason == "target":
            side_state.locked = True
        elif reason == "stop":
            side_state.attempts_used += 1
            if side_state.attempts_used >= self.max_attempts:
                side_state.locked = True
            else:
                # must be seen back inside the range before re-entry
                day.last_inside_ts = None
        else:  # session_end / force_flat
            side_state.locked = True

        if day.daily_r <= -self.daily_kill_r:
            day.kill_switched = True
