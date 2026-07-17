"""Bar-by-bar backtest runner for Range / IB Turtle / IB mean-reversion."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Union

import pandas as pd

from .auction_turtle import AuctionParams, AuctionTurtle
from .auction_turtle import Trade as AuctionTrade
from .config import AUCTION_IB_MINUTES, RVOL_PERIOD, session_open_date
from .forex_vwap import ForexVwap
from .forex_vwap import Trade as FxTrade
from .ib_mean_reversion import IbMeanReversion
from .ib_mean_reversion import Trade as MrTrade
from .indicators import relative_volume, session_vwap, wilder_atr, wilder_rsi
from .jp225_yesterday import Jp225YesterdayTurtle
from .jp225_yesterday import Trade as JpTrade
from .mom_vol_trend import MomVolTrend
from .mom_vol_trend import Trade as MvTrade
from .nyc_true_range import NycTrueRange
from .nyc_true_range import Trade as NycTrade
from .nyc_true_range import build_overnight_ranges
from .oanda_client import OandaClient
from .jp225_yesterday import build_prior_day_bias
from .range_breakout_ladder import (
    RangeBreakoutLadder,
    Trade as RblTrade,
    build_asia_session_ranges,
    build_yesterday_full_day_ranges,
)
from .strategy import (
    RangeTurtle,
    Trade,
    build_ib_ranges,
    build_nyc_ranges,
    build_prior_session_ranges,
    resolve_ib_range,
    resolve_nyc_range,
)
from .va_mean_reversion import VaMeanReversion
from .va_mean_reversion import Trade as VaTrade
from .volume_profile import build_session_profiles, prior_profile_map

AnyTrade = Union[
    Trade, MrTrade, VaTrade, MvTrade, AuctionTrade, NycTrade, JpTrade, FxTrade, RblTrade
]


def load_candles(
    client: OandaClient,
    instrument: str,
    months: int,
    granularity: str = "M5",
    end: datetime | None = None,
    force_refresh: bool = False,
) -> pd.DataFrame:
    end = end or datetime.now(timezone.utc)
    start = end - timedelta(days=int(months * 30.5) + 10)
    return client.get_or_fetch_candles(
        instrument,
        start,
        end,
        granularity=granularity,
        force_refresh=force_refresh,
    )


def run_instrument_backtest(
    df: pd.DataFrame,
    instrument: str,
    mode: str = "ib",
    *,
    ib_minutes: int = 60,
    range_source: str = "ib",
    auction_params: AuctionParams | None = None,
    rbl_range_type: str = "ib",
    rbl_tp_r: float = 1.5,
    rbl_stop_atr_mult: float | None = None,
    rbl_max_attempts: int | None = None,
) -> list[Any]:
    if df.empty:
        return []

    work = df.copy().reset_index(drop=True)

    if mode == "range_breakout":
        work["atr"] = wilder_atr(work)
        if rbl_range_type == "asia":
            ranges = build_asia_session_ranges(work)
        elif rbl_range_type == "yest":
            ranges = build_yesterday_full_day_ranges(work)
        else:
            ranges = build_ib_ranges(work, instrument, ib_minutes=ib_minutes)
        kwargs: dict[str, Any] = {}
        if rbl_stop_atr_mult is not None:
            kwargs["stop_atr_mult"] = rbl_stop_atr_mult
        if rbl_max_attempts is not None:
            kwargs["max_attempts"] = rbl_max_attempts
        strat = RangeBreakoutLadder(
            instrument,
            rbl_range_type,  # type: ignore[arg-type]
            ib_minutes=ib_minutes,
            tp_r=rbl_tp_r,
            **kwargs,
        )
        return strat.run(work, work["atr"], ranges)

    if mode == "ib_mr":
        work["atr"] = wilder_atr(work)
        work["rsi"] = wilder_rsi(work["close"])
        session_ids = work["time"].map(
            lambda ts: session_open_date(instrument, ts)
        )
        work["vwap"] = session_vwap(work, session_ids)
        ranges = build_ib_ranges(work, instrument, ib_minutes=ib_minutes)
        strat = IbMeanReversion(instrument)
        return strat.run(
            work,
            work["atr"],
            work["rsi"],
            work["vwap"],
            ranges,
        )

    if mode == "va_mr":
        work["atr"] = wilder_atr(work)
        work["rsi"] = wilder_rsi(work["close"])
        session_ids = work["time"].map(
            lambda ts: session_open_date(instrument, ts)
        )
        work["vwap"] = session_vwap(work, session_ids)
        profiles = build_session_profiles(work, instrument)
        prior = prior_profile_map(profiles)
        strat = VaMeanReversion(instrument)
        return strat.run(
            work,
            work["atr"],
            work["rsi"],
            work["vwap"],
            prior,
        )

    if mode == "mom_vol":
        work["atr"] = wilder_atr(work)
        work["rsi"] = wilder_rsi(work["close"])
        work["rvol"] = relative_volume(work["volume"], RVOL_PERIOD)
        if range_source == "prior_session":
            ranges = build_prior_session_ranges(work, instrument)
            strat = MomVolTrend(
                instrument,
                require_after_ib=False,
                ib_minutes=ib_minutes,
            )
        else:
            ranges = build_ib_ranges(work, instrument, ib_minutes=ib_minutes)
            strat = MomVolTrend(
                instrument,
                require_after_ib=True,
                ib_minutes=ib_minutes,
            )
        return strat.run(
            work,
            work["atr"],
            work["rsi"],
            work["rvol"],
            ranges,
        )

    if mode == "auction":
        work["atr"] = wilder_atr(work)
        work["rvol"] = relative_volume(work["volume"], RVOL_PERIOD)
        params = auction_params or AuctionParams()
        ib_mins = params.ib_minutes
        ranges = build_ib_ranges(work, instrument, ib_minutes=ib_mins)
        profiles = build_session_profiles(work, instrument)
        prior = prior_profile_map(profiles)
        strat = AuctionTurtle(instrument, params=params)
        return strat.run(
            work,
            work["atr"],
            work["rvol"],
            ranges,
            prior,
        )

    if mode == "nyc_true":
        work["atr"] = wilder_atr(work)
        overnight = build_overnight_ranges(work)
        strat = NycTrueRange(instrument)
        return strat.run(work, work["atr"], overnight)

    if mode == "jp225_yest":
        work["atr"] = wilder_atr(work)
        prior = build_prior_day_bias(work, instrument)
        strat = Jp225YesterdayTurtle(instrument)
        return strat.run(work, work["atr"], prior)

    if mode == "forex_vwap":
        work["atr"] = wilder_atr(work)
        session_ids = work["time"].map(lambda ts: session_open_date(instrument, ts))
        work["vwap"] = session_vwap(work, session_ids)
        strat = ForexVwap(instrument)
        return strat.run(work, work["atr"], work["vwap"])

    work["atr"] = wilder_atr(work)
    if mode == "ib":
        ranges = build_ib_ranges(work, instrument, ib_minutes=ib_minutes)
    else:
        ranges = build_nyc_ranges(work)

    strat = RangeTurtle(instrument, mode=mode)
    n = len(work)
    for i in range(n):
        bar = work.iloc[i]
        if mode == "ib":
            resolved = resolve_ib_range(instrument, bar["time"], ranges)
            allow_entry = resolved is not None
        else:
            resolved = resolve_nyc_range(bar["time"], ranges)
            allow_entry = True

        if resolved is None:
            range_date_str, ph, pl = None, None, None
        else:
            range_date, ph, pl = resolved
            range_date_str = range_date.isoformat()

        atr = float(bar["atr"]) if pd.notna(bar["atr"]) else float("nan")
        next_ts = work.iloc[i + 1]["time"] if i + 1 < n else None
        strat.on_bar(
            bar,
            atr,
            ph,
            pl,
            range_date_str,
            next_bar_time=next_ts,
            allow_entry=allow_entry,
        )

    if strat.state.position is not None:
        strat.force_flat(work.iloc[-1])

    return strat.state.trades


def run_backtest(
    instruments: Iterable[str],
    months: int = 9,
    mode: str = "ib",
    granularity: str = "M5",
    force_refresh: bool = False,
    client: OandaClient | None = None,
    *,
    ib_minutes: int = 60,
    range_source: str = "ib",
    auction_params: AuctionParams | None = None,
    rbl_range_type: str = "ib",
    rbl_tp_r: float = 1.5,
    rbl_stop_atr_mult: float | None = None,
    rbl_max_attempts: int | None = None,
    end: datetime | None = None,
) -> dict[str, list[Any]]:
    client = client or OandaClient()
    names = list(instruments)
    client.verify_instruments(names)

    results: dict[str, list[Any]] = {}
    for inst in names:
        df = load_candles(
            client,
            inst,
            months,
            granularity=granularity,
            end=end,
            force_refresh=force_refresh,
        )
        label = f"{granularity}/{mode}"
        if mode == "mom_vol":
            label = f"{granularity}/{mode}/{range_source}/ib{ib_minutes}m"
        if mode == "auction" and auction_params is not None:
            label = f"{granularity}/{mode}/{auction_params.label()}"
        if mode == "range_breakout":
            ib_tag = f"/ib{ib_minutes}m" if rbl_range_type == "ib" else ""
            sl_tag = f"/sl{rbl_stop_atr_mult}" if rbl_stop_atr_mult is not None else ""
            att_tag = f"/att{rbl_max_attempts}" if rbl_max_attempts is not None else ""
            label = f"{granularity}/{mode}/{rbl_range_type}{ib_tag}/tp{rbl_tp_r}R{sl_tag}{att_tag}"
        print(
            f"{inst} [{label}]: {len(df)} bars "
            f"from {df['time'].iloc[0]} to {df['time'].iloc[-1]}"
        )
        trades = run_instrument_backtest(
            df,
            inst,
            mode=mode,
            ib_minutes=ib_minutes,
            range_source=range_source,
            auction_params=auction_params,
            rbl_range_type=rbl_range_type,
            rbl_tp_r=rbl_tp_r,
            rbl_stop_atr_mult=rbl_stop_atr_mult,
            rbl_max_attempts=rbl_max_attempts,
        )
        results[inst] = trades
        print(f"{inst} [{label}]: {len(trades)} trades")
    return results


def trades_to_frame(trades_by_instrument: dict[str, list[Any]]) -> pd.DataFrame:
    rows = []
    for trades in trades_by_instrument.values():
        for t in trades:
            row = {
                "instrument": t.instrument,
                "side": t.side,
                "entry_time": t.entry_time.isoformat(),
                "entry_price": t.entry_price,
                "exit_time": t.exit_time.isoformat(),
                "exit_price": t.exit_price,
                "pnl_points": t.pnl_points,
                "exit_reason": t.exit_reason,
                "atr_at_entry": getattr(t, "atr_at_entry", None),
                "range_high": t.range_high,
                "range_low": t.range_low,
                "range_session_date": t.range_session_date,
            }
            if hasattr(t, "signal"):
                row["signal"] = t.signal
            if hasattr(t, "poc"):
                row["poc"] = t.poc
            if hasattr(t, "vah"):
                row["vah"] = t.vah
            if hasattr(t, "val"):
                row["val"] = t.val
            if hasattr(t, "regime"):
                row["regime"] = t.regime
            if hasattr(t, "rvol"):
                row["rvol"] = t.rvol
            if hasattr(t, "rsi") and "rsi" not in row:
                row["rsi"] = t.rsi
            if hasattr(t, "vwap"):
                row["vwap"] = t.vwap
            if hasattr(t, "range_type"):
                row["range_type"] = t.range_type
            if hasattr(t, "attempt"):
                row["attempt"] = t.attempt
            if hasattr(t, "size_mult"):
                row["size_mult"] = t.size_mult
            if hasattr(t, "pnl_r"):
                row["pnl_r"] = t.pnl_r
            if hasattr(t, "stop_distance"):
                row["stop_distance"] = t.stop_distance
            rows.append(row)
    return pd.DataFrame(rows) if rows else pd.DataFrame()
