"""
True NYC Range: overnight Asia+London range on US indices.

Locked a priori:
- Overnight window: 16:00 ET prior day → 09:30 ET trade day
- Instruments: US30, NAS100; trade US cash 09:30–16:00
- Open location bias: open >= overnight mid → long breakouts only; else shorts only
- Entry: M5 close beyond overnight high/low in bias direction
- SL 1.5 ATR / TP 2.5 ATR; 3 real losses → lock session; flatten EOD
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Literal, Optional

import numpy as np
import pandas as pd

from .config import (
    MAX_DAILY_LOSSES,
    NYC_OVERNIGHT_END,
    NYC_OVERNIGHT_START,
    NYC_TRUE_STOP_ATR,
    NYC_TRUE_TARGET_ATR,
    NY_TZ,
    SCRATCH_ATR_THRESH,
    UNITS,
    is_in_session,
    session_open_date,
)

Side = Literal["LONG", "SHORT"]


@dataclass
class OvernightRange:
    trade_date: date
    high: float
    low: float
    mid: float


@dataclass
class Position:
    side: Side
    entry_time: pd.Timestamp
    entry_price: float
    stop: float
    target: float
    atr_at_entry: float
    signal: str


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
    signal: str = "nyc_overnight_break"


@dataclass
class SessionState:
    session_key: str
    range_high: float
    range_low: float
    bias: Side
    losses: int = 0
    locked: bool = False
    entry_taken: bool = False


@dataclass
class StrategyState:
    instrument: str
    position: Optional[Position] = None
    session: Optional[SessionState] = None
    trades: list[Trade] = field(default_factory=list)


def build_overnight_ranges(df: pd.DataFrame) -> dict[date, OvernightRange]:
    """
    For each US cash trade date D: high/low of bars in [D-1 16:00, D 09:30) ET.
    """
    if df.empty:
        return {}
    work = df.copy()
    local = work["time"].dt.tz_convert(NY_TZ)
    work["local"] = local
    work["ny_date"] = local.dt.date
    work["minutes"] = local.dt.hour * 60 + local.dt.minute
    start_m = NYC_OVERNIGHT_START.hour * 60 + NYC_OVERNIGHT_START.minute
    end_m = NYC_OVERNIGHT_END.hour * 60 + NYC_OVERNIGHT_END.minute

    # overnight bars: after 16:00 or before 09:30
    overnight = work.loc[(work["minutes"] >= start_m) | (work["minutes"] < end_m)]
    if overnight.empty:
        return {}

    # Assign each overnight bar to the trade date it feeds (next cash open)
    def trade_date_for(row) -> date:
        d = row["ny_date"]
        if row["minutes"] >= start_m:
            return d + timedelta(days=1)
        return d

    overnight = overnight.copy()
    overnight["trade_date"] = overnight.apply(trade_date_for, axis=1)
    grouped = overnight.groupby("trade_date").agg(
        high=("high", "max"),
        low=("low", "min"),
    )
    out: dict[date, OvernightRange] = {}
    for d, row in grouped.iterrows():
        hi, lo = float(row.high), float(row.low)
        if not np.isfinite(hi) or not np.isfinite(lo) or hi <= lo:
            continue
        out[d] = OvernightRange(trade_date=d, high=hi, low=lo, mid=(hi + lo) / 2.0)
    return out


def _pnl(side: Side, entry: float, exit_price: float) -> float:
    if side == "LONG":
        return (exit_price - entry) * UNITS
    return (entry - exit_price) * UNITS


class NycTrueRange:
    def __init__(self, instrument: str) -> None:
        self.instrument = instrument
        self.state = StrategyState(instrument=instrument)

    def run(
        self,
        df: pd.DataFrame,
        atr: pd.Series,
        overnight: dict[date, OvernightRange],
    ) -> list[Trade]:
        opens = df["open"].to_numpy(dtype=float)
        highs = df["high"].to_numpy(dtype=float)
        lows = df["low"].to_numpy(dtype=float)
        closes = df["close"].to_numpy(dtype=float)
        times = df["time"]
        n = len(df)

        for i in range(n):
            ts = times.iloc[i]
            in_sess = is_in_session(self.instrument, ts)
            sod = session_open_date(self.instrument, ts)
            next_ts = times.iloc[i + 1] if i + 1 < n else None

            if self.state.position is not None:
                self._manage(
                    highs[i],
                    lows[i],
                    closes[i],
                    ts,
                    in_sess,
                    next_ts,
                    float(atr.iloc[i]) if pd.notna(atr.iloc[i]) else 0.0,
                )
                continue

            if not in_sess or sod is None or sod not in overnight:
                continue

            on = overnight[sod]
            sk = sod.isoformat()
            if self.state.session is None or self.state.session.session_key != sk:
                open_px = float(opens[i])
                bias: Side = "LONG" if open_px >= on.mid else "SHORT"
                self.state.session = SessionState(
                    session_key=sk,
                    range_high=on.high,
                    range_low=on.low,
                    bias=bias,
                )

            sess = self.state.session
            assert sess is not None
            if sess.locked or sess.entry_taken:
                continue

            atr_i = float(atr.iloc[i]) if pd.notna(atr.iloc[i]) else float("nan")
            if atr_i <= 0 or np.isnan(atr_i):
                continue

            close = closes[i]
            if sess.bias == "LONG" and close > sess.range_high:
                stop = close - NYC_TRUE_STOP_ATR * atr_i
                target = close + NYC_TRUE_TARGET_ATR * atr_i
                self._enter("LONG", ts, close, stop, target, atr_i, "on_break_long")
            elif sess.bias == "SHORT" and close < sess.range_low:
                stop = close + NYC_TRUE_STOP_ATR * atr_i
                target = close - NYC_TRUE_TARGET_ATR * atr_i
                self._enter("SHORT", ts, close, stop, target, atr_i, "on_break_short")

        if self.state.position is not None:
            last = df.iloc[-1]
            self._close(
                last["time"],
                float(last["close"]),
                "force_flat",
                atr_fallback=float(atr.iloc[-1]) if pd.notna(atr.iloc[-1]) else 0.0,
            )
        return self.state.trades

    def _enter(
        self,
        side: Side,
        ts: pd.Timestamp,
        price: float,
        stop: float,
        target: float,
        atr_i: float,
        signal: str,
    ) -> None:
        self.state.position = Position(
            side=side,
            entry_time=ts,
            entry_price=price,
            stop=stop,
            target=target,
            atr_at_entry=atr_i,
            signal=signal,
        )
        if self.state.session is not None:
            self.state.session.entry_taken = True

    def _manage(
        self,
        high: float,
        low: float,
        close: float,
        ts: pd.Timestamp,
        in_sess: bool,
        next_ts: Optional[pd.Timestamp],
        atr_fallback: float,
    ) -> None:
        pos = self.state.position
        assert pos is not None
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

        session_end = (not in_sess) or (
            next_ts is not None
            and in_sess
            and not is_in_session(self.instrument, next_ts)
        )
        if reason is None and session_end:
            reason, exit_price = "session_end", close
        if reason is None:
            return
        self._close(ts, float(exit_price), reason, atr_fallback)

    def _close(
        self,
        ts: pd.Timestamp,
        exit_price: float,
        reason: str,
        atr_fallback: float,
    ) -> None:
        pos = self.state.position
        assert pos is not None
        sess = self.state.session
        pnl = _pnl(pos.side, pos.entry_price, exit_price)
        self.state.trades.append(
            Trade(
                instrument=self.instrument,
                side=pos.side,
                entry_time=pos.entry_time,
                entry_price=pos.entry_price,
                exit_time=ts,
                exit_price=exit_price,
                pnl_points=pnl,
                exit_reason=reason,
                atr_at_entry=pos.atr_at_entry,
                range_high=sess.range_high if sess else float("nan"),
                range_low=sess.range_low if sess else float("nan"),
                range_session_date=sess.session_key if sess else "",
                signal=pos.signal,
            )
        )
        self.state.position = None

        if sess is None:
            return
        atr = pos.atr_at_entry if pos.atr_at_entry > 0 else atr_fallback
        real_loss = pnl < 0 and atr > 0 and (abs(pnl) / atr) > SCRATCH_ATR_THRESH
        if real_loss:
            sess.losses += 1
            if sess.losses >= MAX_DAILY_LOSSES:
                sess.locked = True
        if not sess.locked:
            sess.entry_taken = False
