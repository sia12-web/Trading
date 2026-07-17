"""
Prior-session Value Area mean-reversion.

A priori rules (not optimized):
1. Build volume profile on each completed own-market session → POC / VAL / VAH (70%)
2. Today: wait for close beyond prior VAH (up) or VAL (down)
3. Outside VA, detect RSI swing divergence
4. VWAP filter: short only if close > VWAP; long only if close < VWAP
5. Fade toward prior POC; SL = 0.5 ATR (TP capped at 1.0 ATR toward POC)
6. 3 real losses → lock that session
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
    is_in_session,
    session_open_date,
)
from .volume_profile import VolumeProfileLevels

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
    range_high: float  # prior VAH
    range_low: float   # prior VAL
    range_session_date: str
    signal: str = "va_div_mr"
    poc: float = float("nan")


@dataclass
class SessionState:
    session_key: str
    vah: float
    val: float
    poc: float
    broke_up: bool = False
    broke_down: bool = False
    entered: bool = False
    losses: int = 0
    locked: bool = False
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


class VaMeanReversion:
    def __init__(self, instrument: str) -> None:
        self.instrument = instrument
        self.state = StrategyState(instrument=instrument)
        self._last_meta = ("", float("nan"), float("nan"), float("nan"))

    def run(
        self,
        df: pd.DataFrame,
        atr: pd.Series,
        rsi: pd.Series,
        vwap: pd.Series,
        prior_by_session: dict[date, VolumeProfileLevels],
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

            if self.state.position is not None:
                self._manage(i, highs[i], lows[i], closes[i], bar_time, in_sess, next_time)
                continue

            if not in_sess or sod is None or sod not in prior_by_session:
                continue

            vp = prior_by_session[sod]
            sk = sod.isoformat()
            if self.state.session is None or self.state.session.session_key != sk:
                self.state.session = SessionState(
                    session_key=sk,
                    vah=vp.vah,
                    val=vp.val,
                    poc=vp.poc,
                )

            sess = self.state.session
            assert sess is not None
            if sess.locked or sess.entered:
                continue

            close = closes[i]
            if close > sess.vah:
                sess.broke_up = True
            if close < sess.val:
                sess.broke_down = True

            atr_i = float(atr.iloc[i]) if pd.notna(atr.iloc[i]) else float("nan")
            rsi_i = float(rsi.iloc[i]) if pd.notna(rsi.iloc[i]) else float("nan")
            vwap_i = float(vwap.iloc[i]) if pd.notna(vwap.iloc[i]) else float("nan")
            if atr_i <= 0 or np.isnan(atr_i) or np.isnan(rsi_i) or np.isnan(vwap_i):
                continue

            j = i - pivot
            if j >= pivot:
                if sess.broke_up and _is_swing_high(highs, j, pivot):
                    sess.swing_highs.append((j, float(highs[j]), float(rsi.iloc[j])))
                    sess.swing_highs = sess.swing_highs[-4:]
                if sess.broke_down and _is_swing_low(lows, j, pivot):
                    sess.swing_lows.append((j, float(lows[j]), float(rsi.iloc[j])))
                    sess.swing_lows = sess.swing_lows[-4:]

            # Fade upside VA break on bearish divergence above VWAP → short to POC
            if (
                sess.broke_up
                and close > sess.vah
                and close > vwap_i
                and len(sess.swing_highs) >= 2
            ):
                (_, p1, r1), (_, p2, r2) = sess.swing_highs[-2], sess.swing_highs[-1]
                if p2 > p1 and r2 < r1:
                    target = sess.poc
                    if target < close:
                        stop = close + STOP_ATR_MULT * atr_i
                        min_target = close - TARGET_ATR_MULT * atr_i
                        if target < min_target:
                            target = min_target
                        self._enter("SHORT", bar_time, close, stop, target, atr_i, sess)
                        continue

            # Fade downside VA break on bullish divergence below VWAP → long to POC
            if (
                sess.broke_down
                and close < sess.val
                and close < vwap_i
                and len(sess.swing_lows) >= 2
            ):
                (_, p1, r1), (_, p2, r2) = sess.swing_lows[-2], sess.swing_lows[-1]
                if p2 < p1 and r2 > r1:
                    target = sess.poc
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
        self._last_meta = (sess.session_key, sess.vah, sess.val, sess.poc)

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
        sk, vah, val, poc = self._last_meta
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
                range_high=vah,
                range_low=val,
                range_session_date=sk,
                signal="va_rsi_div_vwap_mr",
                poc=poc,
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
                    sess.swing_highs.clear()
                    sess.swing_lows.clear()
