#!/usr/bin/env python3
"""
Walk-forward validation for the LOCKED Range Breakout Ladder config.

No parameter search. One a-priori hypothesis only:
  range=yest, attempts=1, stop=1.0 ATR, tp=1.5R
  from-inside filter, spread+slippage, flat 15:55 ET, daily 3R kill

Kill criteria (pre-committed):
  - PF >= ~1.15 in MOST test folds, AND
  - same-sign expectancy across folds
If either fails → strategy is done (no further curving).
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nyc_range_turtle.backtest import load_candles, run_instrument_backtest  # noqa: E402
from nyc_range_turtle.config import OUTPUT_DIR, RBL_INSTRUMENTS  # noqa: E402
from nyc_range_turtle.oanda_client import OandaClient  # noqa: E402
from nyc_range_turtle.report import _metrics_from_pnls  # noqa: E402

# Locked a priori — do not change for this run
LOCKED = {
    "rbl_range_type": "yest",
    "rbl_tp_r": 1.5,
    "rbl_stop_atr_mult": 1.0,
    "rbl_max_attempts": 1,
}
WARMUP_DAYS = 14  # ATR + prior-day range need history before fold start
KILL_PF = 1.15


def _fold_windows(end: datetime) -> list[tuple[str, datetime, datetime]]:
    """Four contiguous 6-month OOS folds covering ~24 months ending at `end`."""
    folds: list[tuple[str, datetime, datetime]] = []
    cursor = end
    for i in range(4, 0, -1):
        start = cursor - timedelta(days=int(6 * 30.5))
        folds.append((f"fold{i}", start, cursor))
        cursor = start
    folds.reverse()
    return folds


def _slice_with_warmup(df: pd.DataFrame, start: datetime, end: datetime) -> pd.DataFrame:
    warm = start - timedelta(days=WARMUP_DAYS)
    mask = (df["time"] >= pd.Timestamp(warm)) & (df["time"] < pd.Timestamp(end))
    return df.loc[mask].reset_index(drop=True)


def _trades_in_window(trades: list, start: datetime, end: datetime) -> list:
    s = pd.Timestamp(start)
    e = pd.Timestamp(end)
    return [t for t in trades if s <= t.entry_time < e]


def _expectancy(pnls: list[float]) -> float:
    return sum(pnls) / len(pnls) if pnls else 0.0


def main() -> int:
    end = datetime.now(timezone.utc)
    client = OandaClient()
    client.verify_instruments(list(RBL_INSTRUMENTS))

    print("=" * 72)
    print("LOCKED WALK-FORWARD - Range Breakout Ladder")
    print(f"Config: {LOCKED}")
    print(f"Kill: PF>={KILL_PF} in most folds AND same-sign expectancy")
    print("=" * 72)

    candles: dict[str, pd.DataFrame] = {}
    for inst in RBL_INSTRUMENTS:
        df = load_candles(client, inst, months=24, granularity="M5", end=end)
        candles[inst] = df
        print(f"{inst}: {len(df)} bars  {df['time'].iloc[0]} -> {df['time'].iloc[-1]}")

    folds = _fold_windows(end)
    fold_rows: list[dict] = []
    all_oos_pnls: list[float] = []

    for name, start, fold_end in folds:
        print(f"\n######## {name}: {start.date()} -> {fold_end.date()} ########")
        fold_trades: list = []
        for inst in RBL_INSTRUMENTS:
            slice_df = _slice_with_warmup(candles[inst], start, fold_end)
            trades = run_instrument_backtest(
                slice_df,
                inst,
                mode="range_breakout",
                rbl_range_type=LOCKED["rbl_range_type"],
                rbl_tp_r=LOCKED["rbl_tp_r"],
                rbl_stop_atr_mult=LOCKED["rbl_stop_atr_mult"],
                rbl_max_attempts=LOCKED["rbl_max_attempts"],
            )
            in_fold = _trades_in_window(trades, start, fold_end)
            fold_trades.extend(in_fold)
            print(f"  {inst}: {len(in_fold)} trades in fold")

        pnls = [t.pnl_r for t in fold_trades]
        metrics = _metrics_from_pnls(pnls)
        exp = round(_expectancy(pnls), 4)
        metrics["expectancy_r"] = exp
        metrics["fold"] = name
        metrics["start"] = start.isoformat()
        metrics["end"] = fold_end.isoformat()
        fold_rows.append(metrics)
        all_oos_pnls.extend(pnls)

        print(
            f"  COMBINED: trades={metrics['trade_count']}  "
            f"win={metrics['win_rate']}%  PF={metrics['profit_factor']}  "
            f"pnl_R={metrics['total_pnl_points']}  "
            f"E[R]={exp}  maxDD={metrics['max_drawdown_points']}"
        )

    combined = _metrics_from_pnls(all_oos_pnls)
    combined["expectancy_r"] = round(_expectancy(all_oos_pnls), 4)

    # Kill criteria
    pfs = [r["profit_factor"] for r in fold_rows if r["profit_factor"] is not None]
    exps = [r["expectancy_r"] for r in fold_rows]
    folds_above = sum(1 for pf in pfs if pf >= KILL_PF)
    most_above = folds_above >= (len(pfs) + 1) // 2 + (0 if len(pfs) % 2 else 0)
    # "most" = strictly more than half
    most_above = folds_above > len(pfs) / 2
    signs = [1 if e > 0 else (-1 if e < 0 else 0) for e in exps]
    nonzero = [s for s in signs if s != 0]
    same_sign = len(set(nonzero)) == 1 and len(nonzero) == len(exps)

    verdict_pass = most_above and same_sign

    print("\n======== WALK-FORWARD SUMMARY ========")
    for r in fold_rows:
        print(
            f"{r['fold']}: trades={r['trade_count']} win={r['win_rate']}% "
            f"PF={r['profit_factor']} pnl_R={r['total_pnl_points']} "
            f"E[R]={r['expectancy_r']} maxDD={r['max_drawdown_points']}"
        )
    print(
        f"ALL FOLDS: trades={combined['trade_count']} win={combined['win_rate']}% "
        f"PF={combined['profit_factor']} pnl_R={combined['total_pnl_points']} "
        f"E[R]={combined['expectancy_r']} maxDD={combined['max_drawdown_points']}"
    )
    print("\n======== KILL CRITERIA ========")
    print(f"Folds with PF>={KILL_PF}: {folds_above}/{len(pfs)}  (need most) -> {'PASS' if most_above else 'FAIL'}")
    print(f"Same-sign expectancy: {exps} -> {'PASS' if same_sign else 'FAIL'}")
    print(
        "VERDICT: KEEP RESEARCHING (filters next)"
        if verdict_pass
        else "VERDICT: SHELVE - do not curve further"
    )

    out = {
        "locked_config": LOCKED,
        "kill_pf": KILL_PF,
        "folds": fold_rows,
        "combined": combined,
        "criteria": {
            "folds_above_kill_pf": folds_above,
            "n_folds": len(pfs),
            "most_above": most_above,
            "expectancies": exps,
            "same_sign": same_sign,
            "verdict_pass": verdict_pass,
        },
    }
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / "range_breakout_ladder_walkforward_yest_locked.json"
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nWrote {path}")
    return 0 if verdict_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
