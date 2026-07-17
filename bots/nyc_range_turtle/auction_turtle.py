"""
Full Auction Turtle.

Locked a priori:
- IB = 45m after session open
- Prior session VA (POC/VAL/VAH)
- TREND_MODE → BRACKET_MODE (3 trend fails) → ERRATIC_MODE (3 bracket fails)
- Trend: IB break + RVOL>=1.5; SL 2.0 ATR / TP 3.5 ATR
- Bracket: fade VAH/VAL rejection + RVOL>=1.5; SL 1.5 ATR / TP toward POC (cap 2.0 ATR)
- Lunch lock 12:00–13:30 ET for US cash-session instruments
- Daily 3-attempt kill with scratch threshold
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Literal, Optional

import numpy as np
import pandas as pd

from .config import (
    AUCTION_BRACKET_FAIL_LIMIT,
    AUCTION_FADE_STOP_ATR,
    AUCTION_FADE_TARGET_ATR,
    AUCTION_IB_MINUTES,
    AUCTION_RVOL_MIN,
    AUCTION_TREND_FAIL_LIMIT,
    AUCTION_TREND_STOP_ATR,
    AUCTION_TREND_TARGET_ATR,
    SCRATCH_ATR_THRESH,
    UNITS,
    is_after_ib,
    is_in_session,
    is_lunch_lock,
    session_open_date,
)
from .volume_profile import VolumeProfileLevels

Side = Literal["LONG", "SHORT"]


@dataclass(frozen=True)
class AuctionParams:
    ib_minutes: int = AUCTION_IB_MINUTES
    trend_stop_atr: float = AUCTION_TREND_STOP_ATR
    trend_target_atr: float = AUCTION_TREND_TARGET_ATR
    fade_stop_atr: float = AUCTION_FADE_STOP_ATR
    fade_target_atr: float = AUCTION_FADE_TARGET_ATR
    rvol_min: float = AUCTION_RVOL_MIN
    trend_fail_limit: int = AUCTION_TREND_FAIL_LIMIT
    bracket_fail_limit: int = AUCTION_BRACKET_FAIL_LIMIT
    use_lunch: bool = True

    def label(self) -> str:
        return (
            f"ib{self.ib_minutes}_t{self.trend_stop_atr}/{self.trend_target_atr}"
            f"_f{self.fade_stop_atr}/{self.fade_target_atr}"
            f"_rvol{self.rvol_min}_fail{self.trend_fail_limit}"
            f"_lunch{int(self.use_lunch)}"
        )


class Regime(str, Enum):
    TREND = "TREND_MODE"
    BRACKET = "BRACKET_MODE"
    ERRATIC = "ERRATIC_MODE"


@dataclass
class Position:
    side: Side
    entry_time: pd.Timestamp
    entry_price: float
    stop: float
    target: float
    atr_at_entry: float
    regime: str
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
    signal: str = "auction"
    regime: str = "TREND_MODE"
    poc: float = float("nan")
    vah: float = float("nan")
    val: float = float("nan")
    rvol: float = float("nan")


@dataclass
class SessionState:
    session_key: str
    ib_high: float
    ib_low: float
    vah: float
    val: float
    poc: float
    regime: Regime = Regime.TREND
    trend_fails: int = 0
    bracket_fails: int = 0
    daily_losses: int = 0
    locked: bool = False
    has_position_slot: bool = True  # one at a time; cleared while in trade


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


class AuctionTurtle:
    def __init__(
        self,
        instrument: str,
        params: AuctionParams | None = None,
    ) -> None:
        self.instrument = instrument
        self.params = params or AuctionParams()
        self.state = StrategyState(instrument=instrument)
        self._meta = {
            "session_key": "",
            "ib_high": float("nan"),
            "ib_low": float("nan"),
            "poc": float("nan"),
            "vah": float("nan"),
            "val": float("nan"),
            "rvol": float("nan"),
        }

    def run(
        self,
        df: pd.DataFrame,
        atr: pd.Series,
        rvol: pd.Series,
        ib_ranges: dict[date, tuple[float, float]],
        prior_va: dict[date, VolumeProfileLevels],
    ) -> list[Trade]:
        p = self.params
        highs = df["high"].to_numpy()
        lows = df["low"].to_numpy()
        closes = df["close"].to_numpy()
        opens = df["open"].to_numpy()
        times = df["time"]
        n = len(df)

        for i in range(n):
            ts = times.iloc[i]
            next_ts = times.iloc[i + 1] if i + 1 < n else None
            in_sess = is_in_session(self.instrument, ts)
            lunch = p.use_lunch and is_lunch_lock(self.instrument, ts)
            sod = session_open_date(self.instrument, ts)

            # Lunch: flatten open trades
            if self.state.position is not None and lunch:
                self._close(
                    ts,
                    float(closes[i]),
                    "lunch_lock",
                    atr_fallback=float(atr.iloc[i]) if pd.notna(atr.iloc[i]) else 0.0,
                )
                continue

            if self.state.position is not None:
                self._manage(
                    highs[i],
                    lows[i],
                    closes[i],
                    ts,
                    in_sess,
                    next_ts,
                    lunch,
                )
                continue

            if not in_sess or sod is None:
                continue
            if sod not in ib_ranges or sod not in prior_va:
                continue
            if not is_after_ib(self.instrument, ts, ib_minutes=p.ib_minutes):
                continue

            ib_h, ib_l = ib_ranges[sod]
            vp = prior_va[sod]
            sk = sod.isoformat()
            if self.state.session is None or self.state.session.session_key != sk:
                self.state.session = SessionState(
                    session_key=sk,
                    ib_high=ib_h,
                    ib_low=ib_l,
                    vah=vp.vah,
                    val=vp.val,
                    poc=vp.poc,
                    regime=Regime.TREND,
                )

            sess = self.state.session
            assert sess is not None
            if lunch or sess.locked or sess.regime == Regime.ERRATIC:
                continue

            atr_i = float(atr.iloc[i]) if pd.notna(atr.iloc[i]) else float("nan")
            rvol_i = float(rvol.iloc[i]) if pd.notna(rvol.iloc[i]) else float("nan")
            if atr_i <= 0 or np.isnan(atr_i) or np.isnan(rvol_i):
                continue
            if rvol_i < p.rvol_min:
                continue

            close = float(closes[i])
            open_ = float(opens[i])
            high = float(highs[i])
            low = float(lows[i])

            if sess.regime == Regime.TREND:
                if close > sess.ib_high:
                    stop = close - p.trend_stop_atr * atr_i
                    target = close + p.trend_target_atr * atr_i
                    self._enter(
                        "LONG",
                        ts,
                        close,
                        stop,
                        target,
                        atr_i,
                        sess,
                        "ib_break_long",
                        rvol_i,
                    )
                elif close < sess.ib_low:
                    stop = close + p.trend_stop_atr * atr_i
                    target = close - p.trend_target_atr * atr_i
                    self._enter(
                        "SHORT",
                        ts,
                        close,
                        stop,
                        target,
                        atr_i,
                        sess,
                        "ib_break_short",
                        rvol_i,
                    )

            elif sess.regime == Regime.BRACKET:
                # Fade VAH: rejection — wick above/near VAH, close back below
                near_vah = high >= sess.vah and close < sess.vah and close < open_
                if near_vah:
                    stop = close + p.fade_stop_atr * atr_i
                    target = sess.poc
                    if target < close:
                        min_t = close - p.fade_target_atr * atr_i
                        if target < min_t:
                            target = min_t
                        self._enter(
                            "SHORT",
                            ts,
                            close,
                            stop,
                            target,
                            atr_i,
                            sess,
                            "va_fade_short",
                            rvol_i,
                        )
                        continue

                near_val = low <= sess.val and close > sess.val and close > open_
                if near_val:
                    stop = close - p.fade_stop_atr * atr_i
                    target = sess.poc
                    if target > close:
                        max_t = close + p.fade_target_atr * atr_i
                        if target > max_t:
                            target = max_t
                        self._enter(
                            "LONG",
                            ts,
                            close,
                            stop,
                            target,
                            atr_i,
                            sess,
                            "va_fade_long",
                            rvol_i,
                        )

        if self.state.position is not None and n > 0:
            self._close(
                times.iloc[-1],
                float(closes[-1]),
                "session_end",
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
        atr: float,
        sess: SessionState,
        signal: str,
        rvol: float,
    ) -> None:
        self.state.position = Position(
            side=side,
            entry_time=ts,
            entry_price=price,
            stop=stop,
            target=target,
            atr_at_entry=atr,
            regime=sess.regime.value,
            signal=signal,
        )
        self._meta = {
            "session_key": sess.session_key,
            "ib_high": sess.ib_high,
            "ib_low": sess.ib_low,
            "poc": sess.poc,
            "vah": sess.vah,
            "val": sess.val,
            "rvol": rvol,
        }

    def _manage(
        self,
        high: float,
        low: float,
        close: float,
        ts: pd.Timestamp,
        in_session: bool,
        next_ts: Optional[pd.Timestamp],
        lunch: bool,
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
            next_ts is not None
            and in_session
            and not is_in_session(self.instrument, next_ts)
        )
        if reason is None and (session_end or lunch):
            reason = "lunch_lock" if lunch else "session_end"
            exit_price = close
        if reason is None:
            return
        self._close(ts, float(exit_price), reason, atr_fallback=pos.atr_at_entry)

    def _close(
        self,
        ts: pd.Timestamp,
        exit_price: float,
        reason: str,
        atr_fallback: float,
    ) -> None:
        pos = self.state.position
        if pos is None:
            return
        pnl = _pnl(pos.side, pos.entry_price, exit_price)
        m = self._meta
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
                range_high=m["ib_high"],
                range_low=m["ib_low"],
                range_session_date=m["session_key"],
                signal=pos.signal,
                regime=pos.regime,
                poc=m["poc"],
                vah=m["vah"],
                val=m["val"],
                rvol=m["rvol"],
            )
        )
        self.state.position = None

        sess = self.state.session
        if sess is None:
            return

        atr = pos.atr_at_entry if pos.atr_at_entry > 0 else atr_fallback
        real_loss = pnl < 0 and atr > 0 and (abs(pnl) / atr) > SCRATCH_ATR_THRESH
        if not real_loss:
            return

        # Regime machine first: 3 trend fails → BRACKET (not day-lock).
        # Daily kill / ERRATIC only after 3 bracket fails (same scratch rule).
        p = self.params
        if pos.regime == Regime.TREND.value:
            sess.trend_fails += 1
            sess.daily_losses += 1
            if sess.trend_fails >= p.trend_fail_limit:
                sess.regime = Regime.BRACKET
                sess.bracket_fails = 0
        elif pos.regime == Regime.BRACKET.value:
            sess.bracket_fails += 1
            sess.daily_losses += 1
            if sess.bracket_fails >= p.bracket_fail_limit:
                sess.regime = Regime.ERRATIC
                sess.locked = True
