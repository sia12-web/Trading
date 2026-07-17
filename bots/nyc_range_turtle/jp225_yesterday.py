"""
JP225 Yesterday Turtle.

Locked a priori:
- Prior completed Tokyo session high/low as breakout levels
- Directional bias: prior session close >= prior mid → long only; else short only
- Trade during JP225 Tokyo overnight window (21:00–06:00 ET)
- Entry: M5 close beyond prior high/low in bias direction
- SL 1.5 ATR / TP 2.0 ATR; 3 real losses → lock session; flatten at session end
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Literal, Optional

import numpy as np
import pandas as pd

from .config import (
    JP225_YEST_STOP_ATR,
    JP225_YEST_TARGET_ATR,
    MAX_DAILY_LOSSES,
    SCRATCH_ATR_THRESH,
    UNITS,
    is_in_session,
    session_open_date,
)

Side = Literal["LONG", "SHORT"]


@dataclass
class PriorDay:
    high: float
    low: float
    mid: float
    close: float
    bias: Side


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
    signal: str = "jp225_yesterday"


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


def build_prior_day_bias(
    df: pd.DataFrame,
    instrument: str,
) -> dict[date, PriorDay]:
    """Map session date D → prior session H/L/mid/close + directional bias."""
    if df.empty:
        return {}
    work = df.copy()
    work["session_date"] = work["time"].map(lambda ts: session_open_date(instrument, ts))
    work = work.dropna(subset=["session_date"])
    if work.empty:
        return {}
    grouped = work.groupby("session_date").agg(
        high=("high", "max"),
        low=("low", "min"),
        close=("close", "last"),
    )
    dates = sorted(grouped.index)
    out: dict[date, PriorDay] = {}
    for i, d in enumerate(dates):
        if i == 0:
            continue
        prev = dates[i - 1]
        hi = float(grouped.loc[prev, "high"])
        lo = float(grouped.loc[prev, "low"])
        cl = float(grouped.loc[prev, "close"])
        if not np.isfinite(hi) or not np.isfinite(lo) or hi <= lo:
            continue
        mid = (hi + lo) / 2.0
        bias: Side = "LONG" if cl >= mid else "SHORT"
        out[d] = PriorDay(high=hi, low=lo, mid=mid, close=cl, bias=bias)
    return out


def _pnl(side: Side, entry: float, exit_price: float) -> float:
    if side == "LONG":
        return (exit_price - entry) * UNITS
    return (entry - exit_price) * UNITS


class Jp225YesterdayTurtle:
    def __init__(self, instrument: str = "JP225_USD") -> None:
        self.instrument = instrument
        self.state = StrategyState(instrument=instrument)

    def run(
        self,
        df: pd.DataFrame,
        atr: pd.Series,
        prior: dict[date, PriorDay],
    ) -> list[Trade]:
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

            if not in_sess or sod is None or sod not in prior:
                continue

            pd_ = prior[sod]
            sk = sod.isoformat()
            if self.state.session is None or self.state.session.session_key != sk:
                self.state.session = SessionState(
                    session_key=sk,
                    range_high=pd_.high,
                    range_low=pd_.low,
                    bias=pd_.bias,
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
                self._enter(
                    "LONG",
                    ts,
                    close,
                    close - JP225_YEST_STOP_ATR * atr_i,
                    close + JP225_YEST_TARGET_ATR * atr_i,
                    atr_i,
                    "yest_break_long",
                )
            elif sess.bias == "SHORT" and close < sess.range_low:
                self._enter(
                    "SHORT",
                    ts,
                    close,
                    close + JP225_YEST_STOP_ATR * atr_i,
                    close - JP225_YEST_TARGET_ATR * atr_i,
                    atr_i,
                    "yest_break_short",
                )

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
