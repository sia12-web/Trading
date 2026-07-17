"""
Forex VWAP mean-reversion.

Locked a priori:
- Pairs: EUR_USD, GBP_USD
- Session VWAP reset each London–NY window (03:00–17:00 ET)
- Fade when price stretches ≥ 1.0 ATR from VWAP and rejects back toward it
- TP at VWAP (capped 1.5 ATR); SL 0.75 ATR; 3 real losses → lock day
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

import numpy as np
import pandas as pd

from .config import (
    FOREX_VWAP_BAND_ATR,
    FOREX_VWAP_STOP_ATR,
    FOREX_VWAP_TARGET_CAP_ATR,
    MAX_DAILY_LOSSES,
    SCRATCH_ATR_THRESH,
    UNITS,
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
    signal: str
    vwap_at_entry: float


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
    signal: str = "forex_vwap_fade"
    vwap: float = float("nan")


@dataclass
class SessionState:
    session_key: str
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


class ForexVwap:
    def __init__(self, instrument: str) -> None:
        self.instrument = instrument
        self.state = StrategyState(instrument=instrument)

    def run(
        self,
        df: pd.DataFrame,
        atr: pd.Series,
        vwap: pd.Series,
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

            if sod is not None:
                sk = sod.isoformat()
                if self.state.session is None or self.state.session.session_key != sk:
                    self.state.session = SessionState(session_key=sk)

            if self.state.position is not None:
                self._manage(
                    highs[i],
                    lows[i],
                    closes[i],
                    ts,
                    in_sess,
                    next_ts,
                    float(atr.iloc[i]) if pd.notna(atr.iloc[i]) else 0.0,
                    float(vwap.iloc[i]) if pd.notna(vwap.iloc[i]) else float("nan"),
                )
                continue

            if not in_sess or sod is None:
                continue
            sess = self.state.session
            if sess is None or sess.locked:
                continue

            atr_i = float(atr.iloc[i]) if pd.notna(atr.iloc[i]) else float("nan")
            vwap_i = float(vwap.iloc[i]) if pd.notna(vwap.iloc[i]) else float("nan")
            if atr_i <= 0 or np.isnan(atr_i) or np.isnan(vwap_i):
                continue

            close = closes[i]
            open_ = opens[i]
            dist = close - vwap_i
            band = FOREX_VWAP_BAND_ATR * atr_i

            if dist >= band and close < open_:
                stop = close + FOREX_VWAP_STOP_ATR * atr_i
                target = vwap_i
                min_t = close - FOREX_VWAP_TARGET_CAP_ATR * atr_i
                if target < min_t:
                    target = min_t
                if target < close:
                    self._enter(
                        "SHORT",
                        ts,
                        close,
                        stop,
                        target,
                        atr_i,
                        vwap_i,
                        "vwap_fade_short",
                    )
            elif dist <= -band and close > open_:
                stop = close - FOREX_VWAP_STOP_ATR * atr_i
                target = vwap_i
                max_t = close + FOREX_VWAP_TARGET_CAP_ATR * atr_i
                if target > max_t:
                    target = max_t
                if target > close:
                    self._enter(
                        "LONG",
                        ts,
                        close,
                        stop,
                        target,
                        atr_i,
                        vwap_i,
                        "vwap_fade_long",
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
        vwap_i: float,
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
            vwap_at_entry=vwap_i,
        )

    def _manage(
        self,
        high: float,
        low: float,
        close: float,
        ts: pd.Timestamp,
        in_sess: bool,
        next_ts: Optional[pd.Timestamp],
        atr_fallback: float,
        vwap_i: float,
    ) -> None:
        pos = self.state.position
        assert pos is not None
        reason: Optional[str] = None
        exit_price: Optional[float] = None

        if np.isfinite(vwap_i):
            if pos.side == "LONG" and vwap_i > pos.entry_price:
                cap = pos.entry_price + FOREX_VWAP_TARGET_CAP_ATR * pos.atr_at_entry
                pos.target = min(vwap_i, cap)
            elif pos.side == "SHORT" and vwap_i < pos.entry_price:
                floor = pos.entry_price - FOREX_VWAP_TARGET_CAP_ATR * pos.atr_at_entry
                pos.target = max(vwap_i, floor)

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
                range_high=pos.vwap_at_entry,
                range_low=pos.vwap_at_entry,
                range_session_date=sess.session_key if sess else "",
                signal=pos.signal,
                vwap=pos.vwap_at_entry,
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
