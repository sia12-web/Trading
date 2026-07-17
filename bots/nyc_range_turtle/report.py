"""Metrics and report writers for Range / IB Turtle backtests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from .config import (
    AUCTION_FADE_STOP_ATR,
    AUCTION_FADE_TARGET_ATR,
    AUCTION_IB_MINUTES,
    AUCTION_TREND_STOP_ATR,
    AUCTION_TREND_TARGET_ATR,
    FOREX_VWAP_BAND_ATR,
    FOREX_VWAP_STOP_ATR,
    FOREX_VWAP_TARGET_CAP_ATR,
    IB_MINUTES,
    JP225_YEST_STOP_ATR,
    JP225_YEST_TARGET_ATR,
    MAX_DAILY_LOSSES,
    NYC_TRUE_STOP_ATR,
    NYC_TRUE_TARGET_ATR,
    OUTPUT_DIR,
    RBL_DEFAULT_TP_R,
    RBL_STOP_ATR_MULT,
    STOP_ATR_MULT,
    TARGET_ATR_MULT,
)
from .strategy import Trade


def _regime_mix(trades: list) -> dict[str, int]:
    out: dict[str, int] = {}
    for t in trades:
        key = getattr(t, "regime", None) or "unknown"
        out[key] = out.get(key, 0) + 1
    return out


def _metrics_from_pnls(pnls: list[float]) -> dict[str, Any]:
    if not pnls:
        return {
            "trade_count": 0,
            "win_count": 0,
            "loss_count": 0,
            "win_rate": 0.0,
            "total_pnl_points": 0.0,
            "gross_wins": 0.0,
            "gross_losses": 0.0,
            "profit_factor": 0.0,
            "avg_win": 0.0,
            "avg_loss": 0.0,
            "max_drawdown_points": 0.0,
        }

    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gross_wins = sum(wins)
    gross_losses = abs(sum(losses))
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    for p in pnls:
        equity += p
        peak = max(peak, equity)
        max_dd = min(max_dd, equity - peak)

    return {
        "trade_count": len(pnls),
        "win_count": len(wins),
        "loss_count": len(losses),
        "win_rate": round(100.0 * len(wins) / len(pnls), 2),
        "total_pnl_points": round(sum(pnls), 2),
        "gross_wins": round(gross_wins, 2),
        "gross_losses": round(gross_losses, 2),
        "profit_factor": round(gross_wins / gross_losses, 3) if gross_losses > 0 else None,
        "avg_win": round(sum(wins) / len(wins), 2) if wins else 0.0,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0.0,
        "max_drawdown_points": round(max_dd, 2),
    }


def _pnl_value(t: Trade, use_r: bool = False) -> float:
    if use_r and hasattr(t, "pnl_r"):
        return t.pnl_r
    return t.pnl_points


def monthly_breakdown(trades: list[Trade], use_r: bool = False) -> list[dict[str, Any]]:
    if not trades:
        return []
    df = pd.DataFrame(
        {
            "month": [t.exit_time.strftime("%Y-%m") for t in trades],
            "pnl": [_pnl_value(t, use_r) for t in trades],
        }
    )
    rows = []
    for month, g in df.groupby("month"):
        rows.append({"month": month, **_metrics_from_pnls(g["pnl"].tolist())})
    return rows


def half_period_split(trades: list[Trade], use_r: bool = False) -> dict[str, Any]:
    if len(trades) < 2:
        return {"first_half": _metrics_from_pnls([]), "second_half": _metrics_from_pnls([])}
    ordered = sorted(trades, key=lambda t: t.exit_time)
    mid = len(ordered) // 2
    return {
        "split_at": ordered[mid].exit_time.isoformat(),
        "note": "Fixed params; halves are diagnostic only (not used for optimization)",
        "first_half": _metrics_from_pnls([_pnl_value(t, use_r) for t in ordered[:mid]]),
        "second_half": _metrics_from_pnls([_pnl_value(t, use_r) for t in ordered[mid:]]),
    }


def summarize(
    trades_by_instrument: dict[str, list[Trade]],
    window: dict[str, Any] | None = None,
    mode: str = "ib",
    granularity: str = "M5",
) -> dict[str, Any]:
    use_r = mode == "range_breakout"
    per_instrument: dict[str, Any] = {}
    all_trades: list[Trade] = []
    for inst, trades in trades_by_instrument.items():
        all_trades.extend(trades)
        block = {
            **_metrics_from_pnls([_pnl_value(t, use_r) for t in trades]),
            "monthly": monthly_breakdown(trades, use_r),
            "exit_reasons": _count_reasons(trades),
            "half_period": half_period_split(trades, use_r),
        }
        if mode == "auction":
            block["regime_mix"] = _regime_mix(trades)
        if mode == "range_breakout":
            block["attempt_mix"] = _count_field(trades, "attempt")
            block["range_type_mix"] = _count_field(trades, "range_type")
        per_instrument[inst] = block

    all_trades_sorted = sorted(all_trades, key=lambda t: t.exit_time)
    range_desc = {
        "ib": f"Own-market Initial Balance first {IB_MINUTES}m after session open (breakout)",
        "ib_mr": (
            f"Own-market IB {IB_MINUTES}m → wait for break → RSI divergence mean-reversion "
            "with session VWAP filter"
        ),
        "va_mr": (
            "Prior-session volume profile (40 bins, 70% VA) → break VAH/VAL → "
            "RSI divergence mean-reversion to POC with session VWAP filter"
        ),
        "mom_vol": (
            f"IB {IB_MINUTES}m breakout trend-follow filtered by RVOL>=1.5 and "
            "RSI momentum (long>=55 / short<=45)"
        ),
        "auction": (
            f"Full Auction Turtle: IB {AUCTION_IB_MINUTES}m + prior VA; "
            "TREND→BRACKET→ERRATIC; RVOL>=1.5; lunch lock US session"
        ),
        "nyc": "NYC RTH 09:30-16:00 ET high/low on same instrument",
        "nyc_true": (
            "True NYC Range: overnight Asia+London (16:00→09:30 ET) high/low; "
            "open-location bias; US cash session breakout"
        ),
        "jp225_yest": (
            "JP225 Yesterday Turtle: prior Tokyo session H/L with close-vs-mid bias"
        ),
        "forex_vwap": (
            f"Forex VWAP fade: stretch ≥{FOREX_VWAP_BAND_ATR} ATR from session VWAP "
            "then reject toward VWAP (EUR/GBP)"
        ),
        "range_breakout": (
            "Range Breakout Ladder: IB (30m/60m) / latest Asia session (19:00-03:00 ET) / "
            "prior full-day range on US30/NAS100; 'from inside' filter requires a close "
            "inside the range within the last 15 minutes before the breakout bar"
        ),
    }.get(mode, mode)
    strategy_name = {
        "ib": "ib_turtle",
        "ib_mr": "ib_mean_reversion",
        "va_mr": "va_mean_reversion",
        "mom_vol": "mom_vol_trend",
        "auction": "auction_turtle",
        "nyc": "nyc_range_turtle",
        "nyc_true": "nyc_true_overnight",
        "jp225_yest": "jp225_yesterday_turtle",
        "forex_vwap": "forex_vwap",
        "range_breakout": "range_breakout_ladder",
    }.get(mode, "turtle")
    entry_desc = {
        "ib": "Close beyond IB high/low after IB completes (breakout)",
        "ib_mr": (
            "After IB break, fade on RSI swing divergence; "
            "short only if close>VWAP, long only if close<VWAP; TP=IB mid"
        ),
        "va_mr": (
            "After prior VA break, fade on RSI swing divergence; "
            "short if close>VWAP, long if close<VWAP; TP=prior POC"
        ),
        "mom_vol": (
            "After IB completes, join IB break only if RVOL>=1.5 and RSI confirms "
            "direction; TP=1.0 ATR trend continuation"
        ),
        "auction": (
            "TREND: IB break + RVOL; BRACKET: VAH/VAL rejection fade to POC + RVOL; "
            f"trend SL/TP {AUCTION_TREND_STOP_ATR}/{AUCTION_TREND_TARGET_ATR} ATR; "
            f"fade SL/TP {AUCTION_FADE_STOP_ATR}/{AUCTION_FADE_TARGET_ATR} ATR"
        ),
        "nyc": "Asia session close beyond NYC high/low",
        "nyc_true": (
            f"Bias-aligned overnight H/L break; SL/TP "
            f"{NYC_TRUE_STOP_ATR}/{NYC_TRUE_TARGET_ATR} ATR"
        ),
        "jp225_yest": (
            f"Bias-aligned prior-day H/L break; SL/TP "
            f"{JP225_YEST_STOP_ATR}/{JP225_YEST_TARGET_ATR} ATR"
        ),
        "forex_vwap": (
            f"Fade VWAP stretch on rejection; SL {FOREX_VWAP_STOP_ATR} ATR; "
            f"TP VWAP (cap {FOREX_VWAP_TARGET_CAP_ATR} ATR)"
        ),
        "range_breakout": (
            "Close beyond range boundary + buffer, only if seen inside the range within "
            "15 min; tight SL 0.5 ATR, TP in R-multiples; 3-attempt ladder "
            "(1.0/0.5/0.25 size) per boundary per day; 3R daily kill switch; flat 15:55 ET"
        ),
    }.get(mode, "")

    def _locked_stop() -> float:
        return {
            "auction": AUCTION_TREND_STOP_ATR,
            "nyc_true": NYC_TRUE_STOP_ATR,
            "jp225_yest": JP225_YEST_STOP_ATR,
            "forex_vwap": FOREX_VWAP_STOP_ATR,
            "range_breakout": RBL_STOP_ATR_MULT,
        }.get(mode, STOP_ATR_MULT)

    def _locked_target() -> float:
        return {
            "auction": AUCTION_TREND_TARGET_ATR,
            "nyc_true": NYC_TRUE_TARGET_ATR,
            "jp225_yest": JP225_YEST_TARGET_ATR,
            "forex_vwap": FOREX_VWAP_TARGET_CAP_ATR,
            "range_breakout": RBL_DEFAULT_TP_R,
        }.get(mode, TARGET_ATR_MULT)

    combined = {
        **_metrics_from_pnls([_pnl_value(t, use_r) for t in all_trades_sorted]),
        "monthly": monthly_breakdown(all_trades_sorted, use_r),
        "half_period": half_period_split(all_trades_sorted, use_r),
    }
    if mode == "auction":
        combined["regime_mix"] = _regime_mix(all_trades_sorted)
    if mode == "range_breakout":
        combined["attempt_mix"] = _count_field(all_trades_sorted, "attempt")
        combined["range_type_mix"] = _count_field(all_trades_sorted, "range_type")
        combined["units_note"] = (
            "range_breakout metrics are in R-multiples (pnl_r), not raw points, "
            "since attempt sizing decreases 1.0/0.5/0.25 across the ladder"
        )

    return {
        "strategy": strategy_name,
        "mode": mode,
        "granularity": granularity,
        "curve_fit_controls": {
            "parameter_selection": "a_priori",
            "grid_search": False,
            "optimized_on_results": False,
            "locked_stop_atr": _locked_stop(),
            "locked_target_atr": _locked_target(),
            "max_daily_losses": MAX_DAILY_LOSSES,
            "ib_minutes": (
                AUCTION_IB_MINUTES
                if mode == "auction"
                else (
                    IB_MINUTES
                    if mode in ("ib", "ib_mr", "mom_vol", "range_breakout")
                    else None
                )
            ),
            "vp_bins": 40 if mode in ("va_mr", "auction") else None,
            "va_pct": 0.70 if mode in ("va_mr", "auction") else None,
            "rvol_min": 1.5 if mode in ("mom_vol", "auction") else None,
            "fade_stop_atr": AUCTION_FADE_STOP_ATR if mode == "auction" else None,
            "fade_target_atr": AUCTION_FADE_TARGET_ATR if mode == "auction" else None,
            "vwap_band_atr": FOREX_VWAP_BAND_ATR if mode == "forex_vwap" else None,
        },
        "rules": {
            "range": range_desc,
            "entry": entry_desc,
            "stop_atr": _locked_stop(),
            "target_atr": _locked_target(),
            "max_daily_losses": MAX_DAILY_LOSSES,
            "sessions": {
                "JP225_USD": "21:00-06:00 ET",
                "HK33_HKD": "21:30-04:00 ET",
                "US30_USD": "09:30-16:00 ET (overnight range 16:00→09:30)",
                "NAS100_USD": "09:30-16:00 ET (overnight range 16:00→09:30)",
                "DE30_EUR": "09:30-16:00 ET",
                "UK100_GBP": "09:30-16:00 ET",
                "EUR_USD": "03:00-17:00 ET (London–NY)",
                "GBP_USD": "03:00-17:00 ET (London–NY)",
            },
        },
        "window": window or {},
        "instruments": per_instrument,
        "combined": combined,
    }


def _count_reasons(trades: list[Trade]) -> dict[str, int]:
    out: dict[str, int] = {}
    for t in trades:
        out[t.exit_reason] = out.get(t.exit_reason, 0) + 1
    return out


def _count_field(trades: list[Trade], field_name: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for t in trades:
        key = str(getattr(t, field_name, "unknown"))
        out[key] = out.get(key, 0) + 1
    return out


def write_reports(
    trades_df: pd.DataFrame,
    summary: dict[str, Any],
    tag: str = "9m",
) -> tuple[Path, Path]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    prefix = summary.get("strategy", "nyc_range_turtle")
    trades_path = OUTPUT_DIR / f"{prefix}_{tag}_trades.csv"
    summary_path = OUTPUT_DIR / f"{prefix}_{tag}_summary.json"
    trades_df.to_csv(trades_path, index=False)
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return trades_path, summary_path


def write_comparison(comparison: dict[str, Any], tag: str = "9m_ib_tf_compare") -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    mode = comparison.get("mode", "ib")
    prefix = {
        "ib": "ib_turtle",
        "ib_mr": "ib_mean_reversion",
        "va_mr": "va_mean_reversion",
        "mom_vol": "mom_vol_trend",
        "auction": "auction_turtle",
        "nyc": "nyc_range_turtle",
        "nyc_true": "nyc_true_overnight",
        "jp225_yest": "jp225_yesterday_turtle",
        "forex_vwap": "forex_vwap",
        "range_breakout": "range_breakout_ladder",
    }.get(mode, "turtle")
    path = OUTPUT_DIR / f"{prefix}_{tag}.json"
    path.write_text(json.dumps(comparison, indent=2), encoding="utf-8")
    return path


def print_summary(summary: dict[str, Any]) -> None:
    mode = summary.get("mode", "?")
    gran = summary.get("granularity", "?")
    print(f"\n=== Turtle Backtest Summary [{mode} / {gran}] ===")
    ctrl = summary.get("curve_fit_controls", {})
    if ctrl:
        extra = ""
        if mode == "auction":
            extra = (
                f"  fadeSL={ctrl.get('fade_stop_atr')}  fadeTP={ctrl.get('fade_target_atr')}"
            )
        print(
            f"Params locked a priori: SL={ctrl.get('locked_stop_atr')} ATR  "
            f"TP={ctrl.get('locked_target_atr')} ATR  "
            f"kill={ctrl.get('max_daily_losses')} stops/day  "
            f"IB={ctrl.get('ib_minutes')}m  grid_search={ctrl.get('grid_search')}"
            f"{extra}"
        )
    for inst, m in summary["instruments"].items():
        print(f"\n-- {inst} --")
        _print_metrics(m)
    print("\n-- COMBINED --")
    _print_metrics(summary["combined"])


def _print_metrics(m: dict[str, Any]) -> None:
    print(
        f"  trades={m['trade_count']}  win_rate={m['win_rate']}%  "
        f"pnl_pts={m['total_pnl_points']}  PF={m['profit_factor']}  "
        f"maxDD={m['max_drawdown_points']}"
    )
    if m.get("exit_reasons"):
        print(f"  exits={m['exit_reasons']}")
    if m.get("regime_mix"):
        print(f"  regimes={m['regime_mix']}")
    if m.get("attempt_mix"):
        print(f"  attempts={m['attempt_mix']}  range_types={m.get('range_type_mix')}")
    hp = m.get("half_period")
    if hp and hp.get("first_half") and hp.get("second_half"):
        f1, f2 = hp["first_half"], hp["second_half"]
        print(
            f"  half1: trades={f1['trade_count']} pnl={f1['total_pnl_points']} PF={f1['profit_factor']} | "
            f"half2: trades={f2['trade_count']} pnl={f2['total_pnl_points']} PF={f2['profit_factor']}"
        )
