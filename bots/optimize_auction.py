#!/usr/bin/env python3
"""
Auction Turtle grid search / curve-fit (explicit overfitting).

Train = first half of trades by exit time; holdout = second half.
Phase 1: M5 grid (sequential, Windows-safe).
Phase 2: retest top-15 on M15/M30.

Usage:
  python -u bots/optimize_auction.py --months 9
"""

from __future__ import annotations

import itertools
import json
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nyc_range_turtle.auction_turtle import AuctionParams, AuctionTurtle  # noqa: E402
from nyc_range_turtle.backtest import load_candles  # noqa: E402
from nyc_range_turtle.config import AUCTION_INSTRUMENTS, OUTPUT_DIR, RVOL_PERIOD  # noqa: E402
from nyc_range_turtle.indicators import relative_volume, wilder_atr  # noqa: E402
from nyc_range_turtle.oanda_client import OandaClient  # noqa: E402
from nyc_range_turtle.strategy import build_ib_ranges  # noqa: E402
from nyc_range_turtle.volume_profile import (  # noqa: E402
    build_session_profiles,
    prior_profile_map,
)

IB_MINUTES = (30, 45, 60)
TREND_RISK = (
    (0.5, 1.0),
    (1.0, 2.0),
    (1.5, 2.5),
    (2.0, 3.5),
)
FADE_RISK = ((1.0, 1.5), (1.5, 2.0))
RVOL_MINS = (1.2, 1.5, 2.0)
LUNCH_OPTS = (True, False)
MIN_TRAIN_TRADES = 20
TOP_N = 15
PHASE2_TF = ("M15", "M30")


def _metrics(pnls: list[float]) -> dict[str, Any]:
    if not pnls:
        return {
            "trade_count": 0,
            "win_rate": 0.0,
            "pnl": 0.0,
            "pf": 0.0,
            "max_dd": 0.0,
        }
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gw, gl = sum(wins), abs(sum(losses))
    equity = peak = max_dd = 0.0
    for p in pnls:
        equity += p
        peak = max(peak, equity)
        max_dd = min(max_dd, equity - peak)
    return {
        "trade_count": len(pnls),
        "win_rate": round(100.0 * len(wins) / len(pnls), 2),
        "pnl": round(sum(pnls), 2),
        "pf": round(gw / gl, 3) if gl > 0 else None,
        "max_dd": round(max_dd, 2),
    }


def _split_half(trades: list) -> tuple[list, list]:
    ordered = sorted(trades, key=lambda t: t.exit_time)
    if len(ordered) < 2:
        return ordered, []
    mid = len(ordered) // 2
    return ordered[:mid], ordered[mid:]


def _score_train(m: dict[str, Any]) -> float:
    if m["trade_count"] < MIN_TRAIN_TRADES:
        return -1e12
    pf = m["pf"] if m["pf"] is not None else 0.0
    return m["pnl"] + 200.0 * (pf - 1.0) - abs(m["max_dd"]) * 0.15


def prepare_instrument(df, instrument: str) -> dict[str, Any]:
    work = df.copy().reset_index(drop=True)
    work["atr"] = wilder_atr(work)
    work["rvol"] = relative_volume(work["volume"], RVOL_PERIOD)
    profiles = build_session_profiles(work, instrument)
    prior = prior_profile_map(profiles)
    return {"df": work, "prior": prior, "ib_cache": {}}


def run_params(prepared: dict[str, Any], instrument: str, params: AuctionParams) -> list:
    ib = prepared["ib_cache"].get(params.ib_minutes)
    if ib is None:
        ib = build_ib_ranges(prepared["df"], instrument, ib_minutes=params.ib_minutes)
        prepared["ib_cache"][params.ib_minutes] = ib
    return AuctionTurtle(instrument, params=params).run(
        prepared["df"],
        prepared["df"]["atr"],
        prepared["df"]["rvol"],
        ib,
        prepared["prior"],
    )


def iter_params():
    for ib, (ts, tt), (fs, ft), rvol, lunch in itertools.product(
        IB_MINUTES, TREND_RISK, FADE_RISK, RVOL_MINS, LUNCH_OPTS
    ):
        yield AuctionParams(
            ib_minutes=ib,
            trend_stop_atr=ts,
            trend_target_atr=tt,
            fade_stop_atr=fs,
            fade_target_atr=ft,
            rvol_min=rvol,
            trend_fail_limit=3,
            bracket_fail_limit=3,
            use_lunch=lunch,
        )


def eval_params(prepared: dict[str, dict], params: AuctionParams) -> dict[str, Any]:
    all_trades = []
    per_inst: dict[str, Any] = {}
    for inst, prep in prepared.items():
        trades = run_params(prep, inst, params)
        all_trades.extend(trades)
        tr, ho = _split_half(trades)
        per_inst[inst] = {
            "full": _metrics([t.pnl_points for t in trades]),
            "train": _metrics([t.pnl_points for t in tr]),
            "holdout": _metrics([t.pnl_points for t in ho]),
        }
    train, hold = _split_half(all_trades)
    train_m = _metrics([t.pnl_points for t in train])
    hold_m = _metrics([t.pnl_points for t in hold])
    full_m = _metrics([t.pnl_points for t in all_trades])
    return {
        "params": asdict(params),
        "label": params.label(),
        "train": train_m,
        "holdout": hold_m,
        "full": full_m,
        "train_score": _score_train(train_m),
        "both_halves_positive": train_m["pnl"] > 0 and hold_m["pnl"] > 0,
        "instruments": per_inst,
    }


def eval_on_tf(
    client: OandaClient,
    instruments: list[str],
    months: int,
    gran: str,
    param_dicts: list[dict],
) -> list[dict[str, Any]]:
    prepared: dict[str, dict] = {}
    for inst in instruments:
        df = load_candles(client, inst, months, granularity=gran)
        print(f"  {gran} {inst}: {len(df)} bars", flush=True)
        if not df.empty:
            prepared[inst] = prepare_instrument(df, inst)
    out = []
    for i, pd_ in enumerate(param_dicts, 1):
        params = AuctionParams(**pd_)
        row = eval_params(prepared, params)
        row["granularity"] = gran
        row["label"] = f"{gran}/{params.label()}"
        row["per_inst_full_pnl"] = {
            k: v["full"]["pnl"] for k, v in row["instruments"].items()
        }
        del row["instruments"]
        out.append(row)
        print(
            f"  {gran} {i}/{len(param_dicts)} full={row['full']['pnl']} "
            f"hold={row['holdout']['pnl']} both={row['both_halves_positive']}",
            flush=True,
        )
    return out


def slim(r: dict, with_inst: bool = False) -> dict:
    out = {
        "label": r.get("label"),
        "params": r["params"],
        "train": r["train"],
        "holdout": r["holdout"],
        "full": r["full"],
        "both_halves_positive": r.get("both_halves_positive"),
    }
    if with_inst and "instruments" in r:
        out["per_inst_full_pnl"] = {
            k: v["full"]["pnl"] for k, v in r["instruments"].items()
        }
    if "per_inst_full_pnl" in r:
        out["per_inst_full_pnl"] = r["per_inst_full_pnl"]
    if "granularity" in r:
        out["granularity"] = r["granularity"]
    return out


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--months", type=int, default=9)
    parser.add_argument(
        "--instruments",
        type=str,
        default=",".join(AUCTION_INSTRUMENTS),
    )
    args = parser.parse_args()
    instruments = [x.strip() for x in args.instruments.split(",") if x.strip()]

    client = OandaClient()
    client.verify_instruments(instruments)

    print("===== Phase 1: prepare M5 =====", flush=True)
    prepared: dict[str, dict] = {}
    for inst in instruments:
        df = load_candles(client, inst, args.months, granularity="M5")
        print(f"  M5 {inst}: {len(df)} bars", flush=True)
        if not df.empty:
            prepared[inst] = prepare_instrument(df, inst)

    params_list = list(iter_params())
    print(f"===== Phase 1: M5 grid ({len(params_list)} configs) =====", flush=True)
    t0 = time.time()
    m5_rows: list[dict[str, Any]] = []
    for i, params in enumerate(params_list, 1):
        row = eval_params(prepared, params)
        m5_rows.append(row)
        elapsed = time.time() - t0
        eta = elapsed / i * (len(params_list) - i)
        print(
            f"  [{i}/{len(params_list)}] {params.label()} "
            f"full={row['full']['pnl']} train={row['train']['pnl']} "
            f"hold={row['holdout']['pnl']} both={row['both_halves_positive']} "
            f"ETA={eta/60:.1f}m",
            flush=True,
        )

    m5_rows.sort(
        key=lambda r: (
            1 if r["both_halves_positive"] else 0,
            r["holdout"]["pnl"],
            r["train_score"],
        ),
        reverse=True,
    )
    both = [r for r in m5_rows if r["both_halves_positive"]]
    top = m5_rows[:TOP_N]
    best_robust = both[0] if both else None
    best_train = max(m5_rows, key=lambda r: r["train_score"])
    best_holdout = max(m5_rows, key=lambda r: r["holdout"]["pnl"])

    per_market: dict[str, Any] = {}
    for inst in instruments:
        cand = []
        for r in m5_rows:
            im = r["instruments"][inst]
            robust = (
                im["train"]["pnl"] > 0
                and im["holdout"]["pnl"] > 0
                and im["train"]["trade_count"] >= 10
            )
            cand.append(
                {
                    "label": f"M5/{r['label']}",
                    "params": r["params"],
                    "train": im["train"],
                    "holdout": im["holdout"],
                    "full": im["full"],
                    "robust": robust,
                    "score": (
                        1 if robust else 0,
                        im["holdout"]["pnl"],
                        im["train"]["pnl"],
                    ),
                }
            )
        cand.sort(key=lambda x: x["score"], reverse=True)
        per_market[inst] = cand[0]

    print("===== Phase 2: top on M15/M30 =====", flush=True)
    top_params = [r["params"] for r in top]
    phase2_flat: list[dict] = []
    for gran in PHASE2_TF:
        print(f"--- {gran} ---", flush=True)
        phase2_flat.extend(
            eval_on_tf(client, instruments, args.months, gran, top_params)
        )

    phase2_robust = [r for r in phase2_flat if r["both_halves_positive"]]
    phase2_robust.sort(key=lambda r: r["holdout"]["pnl"], reverse=True)

    result = {
        "note": (
            "CURVE-FIT. Train = first half of trades by time; holdout = second half. "
            "Not a future guarantee."
        ),
        "grid_m5": {
            "ib_minutes": list(IB_MINUTES),
            "trend_risk": [list(x) for x in TREND_RISK],
            "fade_risk": [list(x) for x in FADE_RISK],
            "rvol_mins": list(RVOL_MINS),
            "lunch": list(LUNCH_OPTS),
            "configs": len(m5_rows),
        },
        "m5_robust_count": len(both),
        "m5_best_robust": slim(best_robust, True) if best_robust else None,
        "m5_best_train": slim(best_train, True),
        "m5_best_holdout": slim(best_holdout, True),
        "m5_top15": [slim(r, True) for r in top],
        "phase2_best_robust": slim(phase2_robust[0]) if phase2_robust else None,
        "phase2_top": [
            slim(r)
            for r in sorted(phase2_flat, key=lambda x: x["holdout"]["pnl"], reverse=True)[
                :15
            ]
        ],
        "per_market_best_m5": per_market,
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / "auction_turtle_opt_grid_9m.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")

    print("\n======== AUCTION CURVE-FIT SUMMARY ========", flush=True)
    print(f"M5 configs: {len(m5_rows)} | both-halves+: {len(both)}", flush=True)
    if best_robust:
        br = best_robust
        print(
            f"M5 BEST ROBUST: {br['label']}\n"
            f"  train={br['train']['pnl']} PF={br['train']['pf']} | "
            f"holdout={br['holdout']['pnl']} PF={br['holdout']['pf']} | "
            f"full={br['full']['pnl']}",
            flush=True,
        )
    else:
        print("M5: no combined config profitable on BOTH halves.", flush=True)
    print(
        f"M5 best train: {best_train['label']} "
        f"train={best_train['train']['pnl']} holdout={best_train['holdout']['pnl']}",
        flush=True,
    )
    if phase2_robust:
        p2 = phase2_robust[0]
        print(
            f"PHASE2 BEST ROBUST: {p2['label']} "
            f"train={p2['train']['pnl']} holdout={p2['holdout']['pnl']} "
            f"full={p2['full']['pnl']}",
            flush=True,
        )
    print("\nPer-market M5 best:", flush=True)
    for inst, b in per_market.items():
        print(
            f"  {inst}: robust={b['robust']} full={b['full']['pnl']} "
            f"train={b['train']['pnl']} hold={b['holdout']['pnl']} | {b['label']}",
            flush=True,
        )
    print(f"\nWrote {path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
