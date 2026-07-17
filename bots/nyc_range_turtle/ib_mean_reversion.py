"""
IB mean-reversion: wait for IB break, then fade on RSI momentum divergence
filtered by session VWAP.

A priori rules (not optimized):
1. Form 60m IB at own-market open
2. Confirm break: M close beyond IB high/low
3. Outside IB, detect RSI divergence vs price swings
4. VWAP filter: short only if close > VWAP; long only if close < VWAP
5. Enter mean-reversion; TP = IB midpoint; SL = 0.5 ATR
6. 3 real losses → lock market for that session
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Literal, Optional

import numpy as np
import pandas as pd

from .config import (
    DIV_PIVOT,
    MAX_DAILY_LOSSES,
    SCRATCH_ATR_THRESH,
    STOP_ATR_MULT,
    TARGET_ATR_MULT,
    UNITS,
    is_after_ib,
    is_in_session,
    session_open_date,
)
from .strategy import build_ib_ranges

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
    signal: str = "div_mr"


@dataclass
class SessionState:
    session_key: str
    ib_high: float
    ib_low: float
    ib_mid: float
    broke_up: bool = False
    broke_down: bool = False
    entered: bool = False
    losses: int = 0
    locked: bool = False
    # pivot history after break: list of (idx, price, rsi)
    swing_highs: list[tuple[int, float, float]] = field(default_factory=list)
    swing_lows: list[tuple[int, float, float]] = field(default_factory=list)


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


def _is_swing_high(highs: np.ndarray, i: int, pivot: int) -> bool:
    if i < pivot or i + pivot >= len(highs):
        return False
    window = highs[i - pivot : i + pivot + 1]
    return highs[i] == np.max(window) and np.sum(window == highs[i]) == 1


def _is_swing_low(lows: np.ndarray, i: int, pivot: int) -> bool:
    if i < pivot or i + pivot >= len(lows):
        return False
    window = lows[i - pivot : i + pivot + 1]
    return lows[i] == np.min(window) and np.sum(window == lows[i]) == 1


class IbMeanReversion:
    def __init__(self, instrument: str) -> None:
        self.instrument = instrument
        self.state = StrategyState(instrument=instrument)
        self._last_meta = ("", float("nan"), float("nan"))

    def run(
        self,
        df: pd.DataFrame,
        atr: pd.Series,
        rsi: pd.Series,
        vwap: pd.Series,
        ib_ranges: dict[date, tuple[float, float]],
    ) -> list[Trade]:
        highs = df["high"].to_numpy()
        lows = df["low"].to_numpy()
        closes = df["close"].to_numpy()
        times = df["time"]
        n = len(df)
        pivot = DIV_PIVOT

        for i in range(n):
            bar_time = times.iloc[i]
            next_time = times.iloc[i + 1] if i + 1 < n else None
            in_sess = is_in_session(self.instrument, bar_time)
            sod = session_open_date(self.instrument, bar_time)

            # Manage open trade first
            if self.state.position is not None:
                self._manage(i, highs[i], lows[i], closes[i], bar_time, in_sess, next_time)
                continue

            if not in_sess or sod is None or sod not in ib_ranges:
                continue
            if not is_after_ib(self.instrument, bar_time):
                continue

            ib_h, ib_l = ib_ranges[sod]
            sk = sod.isoformat()
            if self.state.session is None or self.state.session.session_key != sk:
                self.state.session = SessionState(
                    session_key=sk,
                    ib_high=ib_h,
                    ib_low=ib_l,
                    ib_mid=(ib_h + ib_l) / 2.0,
                )

            sess = self.state.session
            assert sess is not None
            if sess.locked or sess.entered:
                continue

            close = closes[i]
            # Track IB breaks
            if close > sess.ib_high:
                sess.broke_up = True
            if close < sess.ib_low:
                sess.broke_down = True

            atr_i = float(atr.iloc[i]) if pd.notna(atr.iloc[i]) else float("nan")
            rsi_i = float(rsi.iloc[i]) if pd.notna(rsi.iloc[i]) else float("nan")
            vwap_i = float(vwap.iloc[i]) if pd.notna(vwap.iloc[i]) else float("nan")
            if atr_i <= 0 or np.isnan(atr_i) or np.isnan(rsi_i) or np.isnan(vwap_i):
                continue

            # Confirm swings only after break (need pivot bars after)
            # A swing at j=i-pivot is confirmed at bar i
            j = i - pivot
            if j >= pivot:
                if sess.broke_up and _is_swing_high(highs, j, pivot):
                    sess.swing_highs.append((j, float(highs[j]), float(rsi.iloc[j])))
                    # keep last 4 swings
                    sess.swing_highs = sess.swing_highs[-4:]
                if sess.broke_down and _is_swing_low(lows, j, pivot):
                    sess.swing_lows.append((j, float(lows[j]), float(rsi.iloc[j])))
                    sess.swing_lows = sess.swing_lows[-4:]

            # Bearish divergence fade after upside break: short if > VWAP
            if (
                sess.broke_up
                and close > sess.ib_high
                and close > vwap_i
                and len(sess.swing_highs) >= 2
            ):
                (_, p1, r1), (_, p2, r2) = sess.swing_highs[-2], sess.swing_highs[-1]
                if p2 > p1 and r2 < r1:
                    target = sess.ib_mid
                    # ensure target is below entry (mean reversion)
                    if target < close:
                        stop = close + STOP_ATR_MULT * atr_i
                        # if IB mid too far, cap with TARGET_ATR_MULT
                        min_target = close - TARGET_ATR_MULT * atr_i
                        if target < min_target:
                            target = min_target
                        self._enter("SHORT", bar_time, close, stop, target, atr_i, sess)
                        continue

            # Bullish divergence fade after downside break: long if < VWAP
            if (
                sess.broke_down
                and close < sess.ib_low
                and close < vwap_i
                and len(sess.swing_lows) >= 2
            ):
                (_, p1, r1), (_, p2, r2) = sess.swing_lows[-2], sess.swing_lows[-1]
                if p2 < p1 and r2 > r1:
                    target = sess.ib_mid
                    if target > close:
                        stop = close - STOP_ATR_MULT * atr_i
                        max_target = close + TARGET_ATR_MULT * atr_i
                        if target > max_target:
                            target = max_target
                        self._enter("LONG", bar_time, close, stop, target, atr_i, sess)
                        continue

        if self.state.position is not None and n > 0:
            self._manage(
                n - 1,
                highs[-1],
                lows[-1],
                closes[-1],
                times.iloc[-1],
                False,
                None,
            )
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
        self._last_meta = (sess.session_key, sess.ib_high, sess.ib_low)

    def _manage(
        self,
        i: int,
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
        sk, ib_h, ib_l = self._last_meta
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
                signal="rsi_div_vwap_mr",
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
                    # allow another MR attempt same session until kill
                    sess.entered = False
                    sess.swing_highs.clear()
                    sess.swing_lows.clear()
