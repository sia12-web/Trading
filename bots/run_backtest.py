#!/usr/bin/env python3
"""CLI: python bots/run_backtest.py --mode nyc_true --months 9 --granularities M5"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nyc_range_turtle.backtest import run_backtest, trades_to_frame  # noqa: E402
from nyc_range_turtle.auction_turtle import AuctionParams  # noqa: E402
from nyc_range_turtle.config import (  # noqa: E402
    AUCTION_IB_MINUTES,
    AUCTION_INSTRUMENTS,
    AUCTION_OPT_FADE_STOP_ATR,
    AUCTION_OPT_FADE_TARGET_ATR,
    AUCTION_OPT_GRANULARITY,
    AUCTION_OPT_IB_MINUTES,
    AUCTION_OPT_RVOL_MIN,
    AUCTION_OPT_TREND_STOP_ATR,
    AUCTION_OPT_TREND_TARGET_ATR,
    AUCTION_OPT_USE_LUNCH,
    AUCTION_TREND_STOP_ATR,
    AUCTION_TREND_TARGET_ATR,
    FOREX_VWAP_INSTRUMENTS,
    FOREX_VWAP_STOP_ATR,
    FOREX_VWAP_TARGET_CAP_ATR,
    IB_MINUTES,
    INSTRUMENTS,
    JP225_YEST_INSTRUMENTS,
    JP225_YEST_STOP_ATR,
    JP225_YEST_TARGET_ATR,
    MOM_VOL_INSTRUMENTS,
    NYC_TRUE_INSTRUMENTS,
    NYC_TRUE_STOP_ATR,
    NYC_TRUE_TARGET_ATR,
    RBL_DEFAULT_TP_R,
    RBL_IB_DURATIONS,
    RBL_INSTRUMENTS,
    RBL_STOP_ATR_MULT,
    RBL_TP_R_MULTIPLES,
    STOP_ATR_MULT,
    TARGET_ATR_MULT,
    VA_MR_INSTRUMENTS,
)
from nyc_range_turtle.report import (  # noqa: E402
    print_summary,
    summarize,
    write_comparison,
    write_reports,
)


def _sl_tp_for_mode(mode: str) -> tuple[float, float]:
    return {
        "auction": (AUCTION_TREND_STOP_ATR, AUCTION_TREND_TARGET_ATR),
        "nyc_true": (NYC_TRUE_STOP_ATR, NYC_TRUE_TARGET_ATR),
        "jp225_yest": (JP225_YEST_STOP_ATR, JP225_YEST_TARGET_ATR),
        "forex_vwap": (FOREX_VWAP_STOP_ATR, FOREX_VWAP_TARGET_CAP_ATR),
        "range_breakout": (RBL_STOP_ATR_MULT, RBL_DEFAULT_TP_R),
    }.get(mode, (STOP_ATR_MULT, TARGET_ATR_MULT))


def _default_instruments(mode: str) -> list[str]:
    return {
        "va_mr": list(VA_MR_INSTRUMENTS),
        "mom_vol": list(MOM_VOL_INSTRUMENTS),
        "auction": list(AUCTION_INSTRUMENTS),
        "nyc_true": list(NYC_TRUE_INSTRUMENTS),
        "jp225_yest": list(JP225_YEST_INSTRUMENTS),
        "forex_vwap": list(FOREX_VWAP_INSTRUMENTS),
        "range_breakout": list(RBL_INSTRUMENTS),
    }.get(mode, list(INSTRUMENTS))


def _run_one(
    *,
    instruments: list[str],
    months: int,
    mode: str,
    gran: str,
    force_refresh: bool,
    ib_minutes: int,
    range_source: str,
    sl: str,
    tp: str,
    auction_params: AuctionParams | None = None,
    rbl_range_type: str = "ib",
    rbl_tp_r: float = RBL_DEFAULT_TP_R,
    rbl_stop_atr_mult: float | None = None,
    rbl_max_attempts: int | None = None,
    end: datetime | None = None,
) -> dict:
    label = f"{mode}/{range_source}/ib{ib_minutes}m" if mode == "mom_vol" else mode
    if mode == "auction" and auction_params is not None:
        label = f"auction/{auction_params.label()}"
    if mode == "range_breakout":
        ib_tag = f"ib{ib_minutes}m" if rbl_range_type == "ib" else rbl_range_type
        sl_tag = f"/sl{rbl_stop_atr_mult}" if rbl_stop_atr_mult is not None else ""
        att_tag = f"/att{rbl_max_attempts}" if rbl_max_attempts is not None else ""
        label = f"range_breakout/{ib_tag}/tp{rbl_tp_r}R{sl_tag}{att_tag}"
    print(f"\n######## Running {label.upper()} @ {gran} ########")
    results = run_backtest(
        instruments,
        months=months,
        mode=mode,
        granularity=gran,
        force_refresh=force_refresh,
        ib_minutes=ib_minutes,
        range_source=range_source,
        auction_params=auction_params,
        rbl_range_type=rbl_range_type,
        rbl_tp_r=rbl_tp_r,
        rbl_stop_atr_mult=rbl_stop_atr_mult,
        rbl_max_attempts=rbl_max_attempts,
        end=end,
    )
    window = {}
    for inst, trades in results.items():
        if trades:
            window[inst] = {
                "first_entry": min(t.entry_time for t in trades).isoformat(),
                "last_exit": max(t.exit_time for t in trades).isoformat(),
            }
    trades_df = trades_to_frame(results)
    summary = summarize(results, window=window, mode=mode, granularity=gran)
    summary["range_source"] = range_source
    summary["ib_minutes_used"] = ib_minutes if range_source == "ib" else None
    if mode == "mom_vol":
        if range_source == "prior_session":
            tag = f"{months}m_mom_vol_prior_session_{gran.lower()}_6mkt_sl{sl}_tp{tp}"
        else:
            tag = f"{months}m_mom_vol_ib{ib_minutes}m_{gran.lower()}_6mkt_sl{sl}_tp{tp}"
    elif mode == "va_mr":
        tag = f"{months}m_va_mr_{gran.lower()}_jp_hk_dow_uk_sl{sl}_tp{tp}"
    elif mode == "auction":
        if auction_params is not None:
            tag = f"{months}m_auction_opt_{gran.lower()}_{auction_params.label()}"
        else:
            tag = f"{months}m_m5_6mkt"
    elif mode == "nyc_true":
        tag = f"{months}m_nyc_true_{gran.lower()}_us30_nas_sl{sl}_tp{tp}"
    elif mode == "jp225_yest":
        tag = f"{months}m_jp225_yest_{gran.lower()}_sl{sl}_tp{tp}"
    elif mode == "forex_vwap":
        tag = f"{months}m_forex_vwap_{gran.lower()}_eur_gbp_sl{sl}_tp{tp}"
    elif mode == "range_breakout":
        rt_tag = f"ib{ib_minutes}m" if rbl_range_type == "ib" else rbl_range_type
        tp_tag = str(rbl_tp_r).replace(".", "")
        sl_tag = f"_sl{str(rbl_stop_atr_mult).replace('.', '')}" if rbl_stop_atr_mult is not None else ""
        att_tag = f"_att{rbl_max_attempts}" if rbl_max_attempts is not None else ""
        end_tag = f"_end{end.strftime('%Y%m%d')}" if end is not None else ""
        tag = f"{months}m_range_breakout_{gran.lower()}_{rt_tag}_tpR{tp_tag}{sl_tag}{att_tag}{end_tag}"
    else:
        tag = f"{months}m_{mode}_{gran.lower()}_sl{sl}_tp{tp}"
    trades_path, summary_path = write_reports(trades_df, summary, tag=tag)
    print_summary(summary)
    print(f"Wrote {trades_path}")
    print(f"Wrote {summary_path}")
    return {
        "label": label,
        "combined": summary["combined"],
        "instruments": {
            k: {
                "trade_count": v["trade_count"],
                "win_rate": v["win_rate"],
                "total_pnl_points": v["total_pnl_points"],
                "profit_factor": v["profit_factor"],
                "max_drawdown_points": v["max_drawdown_points"],
                "half_period": v["half_period"],
            }
            for k, v in summary["instruments"].items()
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Range / IB / VWAP Turtle backtest")
    parser.add_argument("--months", type=int, default=9)
    parser.add_argument(
        "--mode",
        choices=(
            "ib",
            "nyc",
            "ib_mr",
            "va_mr",
            "mom_vol",
            "auction",
            "nyc_true",
            "jp225_yest",
            "forex_vwap",
            "range_breakout",
        ),
        default="auction",
    )
    parser.add_argument("--instruments", type=str, default="")
    parser.add_argument(
        "--granularities",
        type=str,
        default="M5",
        help="Comma-separated OANDA granularities",
    )
    parser.add_argument(
        "--ib-minutes",
        type=int,
        default=IB_MINUTES,
        help="IB length in minutes (mom_vol / ib modes)",
    )
    parser.add_argument(
        "--range-source",
        choices=("ib", "prior_session", "both"),
        default="both",
        help="mom_vol only: ib, prior_session (yesterday range), or both",
    )
    parser.add_argument(
        "--auction-profile",
        choices=("doc", "optimized"),
        default="doc",
        help="auction only: doc=a priori defaults; optimized=curve-fit M15 winner",
    )
    parser.add_argument(
        "--rbl-range-types",
        type=str,
        default="",
        help="range_breakout only: comma list of ib30,ib60,asia,yest (default: all four)",
    )
    parser.add_argument(
        "--rbl-tp-r",
        type=str,
        default="",
        help="range_breakout only: comma list of TP R-multiples, e.g. 1.0,1.5 (default: both)",
    )
    parser.add_argument(
        "--rbl-stop-atr-mult",
        type=str,
        default="",
        help="range_breakout only: comma list of stop ATR multipliers, e.g. 0.5,0.75,1.0 "
        "(default: locked 0.5)",
    )
    parser.add_argument(
        "--rbl-max-attempts",
        type=str,
        default="",
        help="range_breakout only: comma list of max ladder attempts, e.g. 1,3 (default: 3)",
    )
    parser.add_argument(
        "--end-date",
        type=str,
        default="",
        help="ISO date (YYYY-MM-DD) to anchor the --months lookback window for "
        "out-of-sample testing, e.g. 2025-10-16 (default: now)",
    )
    parser.add_argument("--force-refresh", action="store_true")
    args = parser.parse_args()

    end_dt = None
    if args.end_date.strip():
        end_dt = datetime.strptime(args.end_date.strip(), "%Y-%m-%d").replace(
            tzinfo=timezone.utc
        )

    if args.instruments.strip():
        instruments = [x.strip() for x in args.instruments.split(",") if x.strip()]
    else:
        instruments = _default_instruments(args.mode)

    auction_params: AuctionParams | None = None
    if args.mode == "auction" and args.auction_profile == "optimized":
        auction_params = AuctionParams(
            ib_minutes=AUCTION_OPT_IB_MINUTES,
            trend_stop_atr=AUCTION_OPT_TREND_STOP_ATR,
            trend_target_atr=AUCTION_OPT_TREND_TARGET_ATR,
            fade_stop_atr=AUCTION_OPT_FADE_STOP_ATR,
            fade_target_atr=AUCTION_OPT_FADE_TARGET_ATR,
            rvol_min=AUCTION_OPT_RVOL_MIN,
            use_lunch=AUCTION_OPT_USE_LUNCH,
        )
        if args.granularities.strip().upper() == "M5":
            # Default M5 is wrong for optimized profile — use the fit TF
            granularities = [AUCTION_OPT_GRANULARITY]
            print(
                f"Using optimized auction profile @ {AUCTION_OPT_GRANULARITY} "
                f"({auction_params.label()})",
                flush=True,
            )
        else:
            granularities = [
                x.strip().upper() for x in args.granularities.split(",") if x.strip()
            ]
        stop, target = AUCTION_OPT_TREND_STOP_ATR, AUCTION_OPT_TREND_TARGET_ATR
    else:
        granularities = [
            x.strip().upper() for x in args.granularities.split(",") if x.strip()
        ]
        stop, target = _sl_tp_for_mode(args.mode)

    sl = str(stop).replace(".", "")
    tp = str(target).replace(".", "")
    ib_default = AUCTION_IB_MINUTES if args.mode == "auction" else args.ib_minutes

    if args.mode == "mom_vol" and args.range_source == "both":
        if args.ib_minutes != IB_MINUTES:
            variants = [("ib", args.ib_minutes), ("prior_session", args.ib_minutes)]
        else:
            variants = [("ib", 30), ("prior_session", 60)]
    elif args.mode == "mom_vol":
        variants = [(args.range_source, args.ib_minutes)]
    elif args.mode == "auction":
        ib_use = (
            AUCTION_OPT_IB_MINUTES
            if auction_params is not None
            else AUCTION_IB_MINUTES
        )
        variants = [("ib", ib_use)]
    elif args.mode == "range_breakout":
        variants = [("ib", ib_default)]  # unused for range_breakout; see rbl_variants
    else:
        variants = [("ib", ib_default)]

    rbl_range_types: list[str] = (
        [x.strip() for x in args.rbl_range_types.split(",") if x.strip()]
        if args.rbl_range_types.strip()
        else ["ib30", "ib60", "asia", "yest"]
    )
    rbl_tp_rs: list[float] = (
        [float(x.strip()) for x in args.rbl_tp_r.split(",") if x.strip()]
        if args.rbl_tp_r.strip()
        else list(RBL_TP_R_MULTIPLES)
    )
    rbl_stop_mults: list[float | None] = (
        [float(x.strip()) for x in args.rbl_stop_atr_mult.split(",") if x.strip()]
        if args.rbl_stop_atr_mult.strip()
        else [None]
    )
    rbl_max_attempts_list: list[int | None] = (
        [int(x.strip()) for x in args.rbl_max_attempts.split(",") if x.strip()]
        if args.rbl_max_attempts.strip()
        else [None]
    )
    rbl_variants: list[tuple[str, int, float, float | None, int | None]] = []
    if args.mode == "range_breakout":
        for rt in rbl_range_types:
            if rt.startswith("ib"):
                ib_mins = int(rt[2:]) if len(rt) > 2 else RBL_IB_DURATIONS[0]
                for tp_r in rbl_tp_rs:
                    for sl_mult in rbl_stop_mults:
                        for max_att in rbl_max_attempts_list:
                            rbl_variants.append(("ib", ib_mins, tp_r, sl_mult, max_att))
            else:
                for tp_r in rbl_tp_rs:
                    for sl_mult in rbl_stop_mults:
                        for max_att in rbl_max_attempts_list:
                            rbl_variants.append((rt, 0, tp_r, sl_mult, max_att))

    comparison: dict = {
        "mode": args.mode,
        "curve_fit_controls": {
            "parameter_selection": (
                "optimized_grid" if auction_params is not None else "a_priori"
            ),
            "grid_search": auction_params is not None,
            "optimized_on_results": auction_params is not None,
            "locked_stop_atr": stop,
            "locked_target_atr": target,
            "note": (
                "CURVE-FIT M15 winner from optimize_auction.py"
                if auction_params is not None
                else "Params locked a priori from turtle conventions"
            ),
        },
        "variants": {},
    }

    if args.mode == "range_breakout":
        for gran in granularities:
            for rbl_range_type, rbl_ib_minutes, rbl_tp_r, rbl_sl, rbl_att in rbl_variants:
                try:
                    block = _run_one(
                        instruments=instruments,
                        months=args.months,
                        mode=args.mode,
                        gran=gran,
                        force_refresh=args.force_refresh,
                        ib_minutes=rbl_ib_minutes,
                        range_source="ib",
                        sl=sl,
                        tp=tp,
                        rbl_range_type=rbl_range_type,
                        rbl_tp_r=rbl_tp_r,
                        rbl_stop_atr_mult=rbl_sl,
                        rbl_max_attempts=rbl_att,
                        end=end_dt,
                    )
                except RuntimeError as exc:
                    key = f"{gran}/{rbl_range_type}/ib{rbl_ib_minutes}/tp{rbl_tp_r}R/sl{rbl_sl}/att{rbl_att}"
                    print(f"SKIP {key}: {exc}")
                    comparison["variants"][key] = {"error": str(exc)}
                    continue
                key = block["label"]
                comparison["variants"][key] = block
    else:
        for gran in granularities:
            for range_source, ib_minutes in variants:
                try:
                    block = _run_one(
                        instruments=instruments,
                        months=args.months,
                        mode=args.mode,
                        gran=gran,
                        force_refresh=args.force_refresh,
                        ib_minutes=ib_minutes,
                        range_source=range_source if args.mode == "mom_vol" else "ib",
                        sl=sl,
                        tp=tp,
                        auction_params=auction_params,
                    )
                except RuntimeError as exc:
                    key = f"{gran}/{range_source}/ib{ib_minutes}"
                    print(f"SKIP {key}: {exc}")
                    comparison["variants"][key] = {"error": str(exc)}
                    continue
                key = block["label"]
                comparison["variants"][key] = block

    cmp_path = write_comparison(
        comparison,
        tag=f"{args.months}m_{args.mode}_range_variants_sl{sl}_tp{tp}",
    )
    print("\n======== VARIANT COMPARISON (no cherry-pick) ========")
    for key, block in comparison["variants"].items():
        if "error" in block:
            print(f"{key}: ERROR {block['error']}")
            continue
        c = block["combined"]
        print(
            f"{key}: trades={c['trade_count']} win={c['win_rate']}% "
            f"pnl={c['total_pnl_points']} PF={c['profit_factor']} "
            f"maxDD={c['max_drawdown_points']}"
        )
    print(f"Wrote {cmp_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
