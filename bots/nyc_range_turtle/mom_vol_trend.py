"""
Momentum + relative-volume trend following after Initial Balance.

A priori rules (not optimized):
1. Form 60m IB at each market's session open
2. After IB: trend entry on close beyond IB high/low
3. Volume filter: RVOL >= 1.5 on signal bar
4. Momentum filter: RSI >= 55 for long, RSI <= 45 for short
5. SL = 0.5 ATR, TP = 1.0 ATR (same locked risk as other modes)
6. 3 real losses → lock that session
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Literal, Optional

import numpy as np
import pandas as pd

from .config import (
    MAX_DAILY_LOSSES,
    RSI_LONG_MIN,
    RSI_SHORT_MAX,
    RVOL_MIN,
    SCRATCH_ATR_THRESH,
    STOP_ATR_MULT,
    TARGET_ATR_MULT,
    UNITS,
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
    signal: str = "mom_vol_tf"
    rvol: float = float("nan")
    rsi: float = float("nan")


@dataclass
class SessionState:
    session_key: str
    ib_high: float
    ib_low: float
    entered: bool = False
    losses: int = 0
    locked: bool = False


@dataclass
class StrategyState:
    instrument: str
    position: Optional[Position] = None
    session: Optional[SessionState] = None
    trades: list[Trade] = field(default_factory=list)


def _pnl(side: Side, entry: float, exit_price: float) -> float:
    if side == "LONG":
        return (exit_price - entry) * UNITS
    return (entry - exit_price) * UNITS


class MomVolTrend:
    def __init__(
        self,
        instrument: str,
        *,
        require_after_ib: bool = True,
        ib_minutes: int = 60,
    ) -> None:
        self.instrument = instrument
        self.require_after_ib = require_after_ib
        self.ib_minutes = ib_minutes
        self.state = StrategyState(instrument=instrument)
        self._last_meta = ("", float("nan"), float("nan"), float("nan"), float("nan"))

    def run(
        self,
        df: pd.DataFrame,
        atr: pd.Series,
        rsi: pd.Series,
        rvol: pd.Series,
        ib_ranges: dict[date, tuple[float, float]],
    ) -> list[Trade]:
        closes = df["close"].to_numpy()
        highs = df["high"].to_numpy()
        lows = df["low"].to_numpy()
        times = df["time"]
        n = len(df)

        for i in range(n):
            bar_time = times.iloc[i]
            next_time = times.iloc[i + 1] if i + 1 < n else None
            in_sess = is_in_session(self.instrument, bar_time)
            sod = session_open_date(self.instrument, bar_time)

            if self.state.position is not None:
                self._manage(highs[i], lows[i], closes[i], bar_time, in_sess, next_time)
                continue

            if not in_sess or sod is None or sod not in ib_ranges:
                continue
            if self.require_after_ib and not is_after_ib(
                self.instrument, bar_time, ib_minutes=self.ib_minutes
            ):
                continue

            ib_h, ib_l = ib_ranges[sod]
            sk = sod.isoformat()
            if self.state.session is None or self.state.session.session_key != sk:
                self.state.session = SessionState(
                    session_key=sk,
                    ib_high=ib_h,
                    ib_low=ib_l,
                )

            sess = self.state.session
            assert sess is not None
            if sess.locked or sess.entered:
                continue

            atr_i = float(atr.iloc[i]) if pd.notna(atr.iloc[i]) else float("nan")
            rsi_i = float(rsi.iloc[i]) if pd.notna(rsi.iloc[i]) else float("nan")
            rvol_i = float(rvol.iloc[i]) if pd.notna(rvol.iloc[i]) else float("nan")
            if atr_i <= 0 or np.isnan(atr_i) or np.isnan(rsi_i) or np.isnan(rvol_i):
                continue
            if rvol_i < RVOL_MIN:
                continue

            close = closes[i]

            if close > sess.ib_high and rsi_i >= RSI_LONG_MIN:
                stop = close - STOP_ATR_MULT * atr_i
                target = close + TARGET_ATR_MULT * atr_i
                self._enter("LONG", bar_time, close, stop, target, atr_i, sess, rvol_i, rsi_i)
                continue

            if close < sess.ib_low and rsi_i <= RSI_SHORT_MAX:
                stop = close + STOP_ATR_MULT * atr_i
                target = close - TARGET_ATR_MULT * atr_i
                self._enter("SHORT", bar_time, close, stop, target, atr_i, sess, rvol_i, rsi_i)
                continue

        if self.state.position is not None and n > 0:
            self._manage(highs[-1], lows[-1], closes[-1], times.iloc[-1], False, None)
        return self.state.trades

    def _enter(
        self,
        side: Side,
        ts: pd.Timestamp,
        price: float,
        stop: float,
        target: float,
        atr: float,
        sess: SessionState,
        rvol: float,
        rsi: float,
    ) -> None:
        self.state.position = Position(
            side=side,
            entry_time=ts,
            entry_price=price,
            stop=stop,
            target=target,
            atr_at_entry=atr,
        )
        sess.entered = True
        self._last_meta = (sess.session_key, sess.ib_high, sess.ib_low, rvol, rsi)

    def _manage(
        self,
        high: float,
        low: float,
        close: float,
        ts: pd.Timestamp,
        in_session: bool,
        next_time: Optional[pd.Timestamp],
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

        session_end = (not in_session) or (
            next_time is not None
            and in_session
            and not is_in_session(self.instrument, next_time)
        )
        if reason is None and session_end:
            reason, exit_price = "session_end", close
        if reason is None:
            return

        pnl = _pnl(pos.side, pos.entry_price, float(exit_price))
        sk, ib_h, ib_l, rvol, rsi = self._last_meta
        self.state.trades.append(
            Trade(
                instrument=self.instrument,
                side=pos.side,
                entry_time=pos.entry_time,
                entry_price=pos.entry_price,
                exit_time=ts,
                exit_price=float(exit_price),
                pnl_points=pnl,
                exit_reason=reason,
                atr_at_entry=pos.atr_at_entry,
                range_high=ib_h,
                range_low=ib_l,
                range_session_date=sk,
                signal="ib_break_rvol_rsi",
                rvol=rvol,
                rsi=rsi,
            )
        )
        self.state.position = None

        sess = self.state.session
        if sess is not None and pnl < 0:
            loss_atr = abs(pnl) / pos.atr_at_entry if pos.atr_at_entry > 0 else 0
            if loss_atr > SCRATCH_ATR_THRESH:
                sess.losses += 1
                if sess.losses >= MAX_DAILY_LOSSES:
                    sess.locked = True
                else:
                    sess.entered = False
