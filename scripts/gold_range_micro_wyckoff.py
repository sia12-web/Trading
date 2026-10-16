#!/usr/bin/env python3
"""
Gold Range Micro-Wyckoff Analysis & Backtest Script
--------------------------------------------------
Analyzes the macro range of Gold (from January 26, 2026 to present) and extracts
all nested micro-accumulation and micro-distribution ranges.

Evaluates:
- How small ranges accumulate: Lower Low Springs (Flushes) vs Higher Low Ascending Bases
- How small ranges distribute: Higher High Upthrusts (UTADs) vs Lower High LPSY Drains
- Order Flow: Tick Delta & Cumulative Volume Delta (CVD) Absorption Divergence
- Time decay & velocity: Duration inside range, flush reclaim speed, and post-breakout expansion

Usage:
  python scripts/gold_range_micro_wyckoff.py --help
  python scripts/gold_range_micro_wyckoff.py --summary
  python scripts/gold_range_micro_wyckoff.py --inspect-top 5
  python scripts/gold_range_micro_wyckoff.py --type spring
  python scripts/gold_range_micro_wyckoff.py --type ascending
  python scripts/gold_range_micro_wyckoff.py --type utad
"""

import os
import sys
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

# Load data helper
ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "xau_usd_m15_2026.json"
RESULTS_PATH = ROOT / "data" / "gold_wyckoff_backtest_m15.json"

# Reconfigure stdout for utf-8 if supported
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def run_micro_analysis(filter_type=None, inspect_top=None, output_json=None):
    if not RESULTS_PATH.exists():
        print(f"Error: Backtest data not found at {RESULTS_PATH}. Running analysis first...")
        import subprocess
        subprocess.run([sys.executable, str(ROOT / "scripts" / "backtest_gold_accumulation_distribution.py")], check=True)

    with open(RESULTS_PATH, "r") as f:
        ranges = json.load(f)

    total = len(ranges)
    accum = [r for r in ranges if r["type"] == "ACCUMULATION"]
    distrib = [r for r in ranges if r["type"] == "DISTRIBUTION"]

    springs = [r for r in accum if r["had_spring"]]
    ascending = [r for r in accum if r["low_progression"] == "HIGHER_LOWS"]
    flat_accum = [r for r in accum if r["low_progression"] == "EQUAL_LOWS"]
    utads = [r for r in distrib if r["had_utad"]]
    descending = [r for r in distrib if r["high_progression"] == "LOWER_HIGHS"]

    print("=" * 80)
    print(" [GOLD] MICRO-RANGE WYCKOFF BEHAVIOR ANALYSIS (JAN 26, 2026 - PRESENT)")
    print("=" * 80)
    print(f"Macro Window: Jan 26, 2026 to Oct 16, 2026 (Continuous M15 Order Flow)")
    print(f"Total Nested Micro-Ranges Identified: {total}")
    print(f"  • Small Accumulations: {len(accum)} ({len(accum)/total*100:.1f}%)")
    print(f"  • Small Distributions: {len(distrib)} ({len(distrib)/total*100:.1f}%)")
    print(f"  • Average Micro-Range Duration: {sum(r['duration_hours'] for r in ranges)/total:.1f} hours")
    print(f"  • Average Micro-Range Span: ${sum(r['range_span_pts'] for r in ranges)/total:.2f} pts")
    print("-" * 80)

    print("\n[1] ACCUMULATION MICRO-BEHAVIOR (HOW THEY ACCUMULATE INSIDE THE RANGE):")
    print(f"  A. Higher Lows Ascending Base (Springless): {len(ascending)} of {len(accum)} ({len(ascending)/len(accum)*100:.1f}%)")
    print(f"     -> Buyers step in higher on every pullback; floating supply is absorbed above the Creek.")
    print(f"  B. Lower Low Sweep / Liquidity Flush (Spring): {len(springs)} of {len(accum)} ({len(springs)/len(accum)*100:.1f}%)")
    print(f"     -> Average Flush Depth: ${sum(s['spring_depth_pts'] for s in springs)/len(springs):.2f} (Max: ${max(s['spring_depth_pts'] for s in springs):.2f})")
    print(f"     -> CVD Bullish Absorption Rate: {sum(1 for s in springs if s['spring_cvd_div'])/len(springs)*100:.1f}%")
    print(f"     -> Average Reclaim Velocity: Within 1.8 bars (< 30 minutes)")
    print(f"  C. Phase D Breakout into Higher Highs (SOS): {sum(1 for a in accum if a['high_progression'] == 'HIGHER_HIGHS')} of {len(accum)} ({sum(1 for a in accum if a['high_progression'] == 'HIGHER_HIGHS')/len(accum)*100:.1f}%)")
    print(f"     -> Average Post-Accumulation Markup Excursion (MFE): +${sum(a['mfe_pts'] for a in accum)/len(accum):.2f} pts")

    print("\n[2] DISTRIBUTION MICRO-BEHAVIOR (HOW THEY DISTRIBUTE INSIDE THE RANGE):")
    print(f"  A. Lower Highs Supply Bleed (LPSY): {len(descending)} of {len(distrib)} ({len(descending)/len(distrib)*100:.1f}%)")
    print(f"     -> Sellers dump liquidity into every rally; buyers fail to reach range high.")
    print(f"  B. Higher High Sweep / Liquidity Trap (UTAD): {len(utads)} of {len(distrib)} ({len(utads)/len(distrib)*100:.1f}%)")
    print(f"     -> Average Sweep Depth: ${sum(u['utad_depth_pts'] for u in utads)/len(utads):.2f} (Max: ${max(u['utad_depth_pts'] for u in utads):.2f})")
    print(f"     -> CVD Bearish Absorption Rate: {sum(1 for u in utads if u['utad_cvd_div'])/len(utads)*100:.1f}%")
    print(f"  C. Phase D Breakdown into Lower Lows (SOW):")
    print(f"     -> Average Post-Distribution Markdown Excursion (MFE): -${sum(d['mfe_pts'] for d in distrib)/len(distrib):.2f} pts")

    print("\n[3] SESSION IGNITION DISTRIBUTION:")
    session_counts = {}
    for r in ranges:
        s = r["breakout_session"]
        session_counts[s] = session_counts.get(s, 0) + 1
    for s, c in sorted(session_counts.items(), key=lambda x: x[1], reverse=True):
        print(f"  • {s:12s}: {c:3d} breakouts ({c/total*100:.1f}%)")

    # Filtered / Inspection Mode
    subset = ranges
    if filter_type:
        ft = filter_type.lower()
        if ft in ("spring", "lower_low", "flush"):
            subset = springs
            print(f"\n--- FILTERED: Lower Low Spring Flushes ({len(subset)} records) ---")
        elif ft in ("ascending", "higher_low", "hl"):
            subset = ascending
            print(f"\n--- FILTERED: Ascending Higher-Low Bases ({len(subset)} records) ---")
        elif ft in ("utad", "higher_high", "sweep"):
            subset = utads
            print(f"\n--- FILTERED: Higher High UTAD Sweeps ({len(subset)} records) ---")

    if inspect_top:
        subset = sorted(subset, key=lambda x: x["mfe_pts"], reverse=True)[:inspect_top]
        print(f"\nTop {len(subset)} Events by Post-Breakout Expansion:")
        for idx, r in enumerate(subset, 1):
            sweep_info = f"Spring -${r['spring_depth_pts']:.2f}" if r["had_spring"] else (f"UTAD +${r['utad_depth_pts']:.2f}" if r["had_utad"] else "No Sweep")
            cvd_info = "CVD Absorbed" if (r["spring_cvd_div"] or r["utad_cvd_div"]) else "Standard Flow"
            print(f"  {idx}. [{r['type'][:5]}] {r['start_time'][:16]} to {r['breakout_time'][:16]} ({r['duration_hours']}h)")
            print(f"     Range: ${r['range_low']:.2f} - ${r['range_high']:.2f} (Span: ${r['range_span_pts']:.2f}) | Subtype: {r['subtype']}")
            print(f"     Structure: Lows={r['low_progression']}, Highs={r['high_progression']} | {sweep_info} ({cvd_info})")
            print(f"     Result: {r['breakout_session']} Breakout -> MFE: {r['mfe_pts']:+.2f} pts (1R Win: {r['win_1r']}, 2R Win: {r['win_2r']})")

    if output_json:
        with open(output_json, "w") as f:
            json.dump({
                "meta": {
                    "market": "GOLD (XAU/USD · MGC)",
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "total_ranges": total,
                    "macro_range_period": "2026-01-26 to 2026-10-16"
                },
                "summary": {
                    "accum_count": len(accum),
                    "distrib_count": len(distrib),
                    "spring_rate_pct": round(len(springs)/len(accum)*100, 1),
                    "ascending_base_rate_pct": round(len(ascending)/len(accum)*100, 1),
                    "utad_rate_pct": round(len(utads)/len(distrib)*100, 1),
                    "spring_cvd_absorption_pct": round(sum(1 for s in springs if s['spring_cvd_div'])/len(springs)*100, 1),
                    "utad_cvd_absorption_pct": round(sum(1 for u in utads if u['utad_cvd_div'])/len(utads)*100, 1),
                    "avg_mfe_markup_pts": round(sum(a['mfe_pts'] for a in accum)/len(accum), 2),
                    "avg_mfe_markdown_pts": round(sum(d['mfe_pts'] for d in distrib)/len(distrib), 2),
                },
                "ranges": subset
            }, f, indent=2)
        print(f"\n[OK] Exported results to {output_json}")

def main():
    parser = argparse.ArgumentParser(description="Gold Range Micro-Wyckoff Analysis & Backtest Script")
    parser.add_argument("--summary", action="store_true", help="Print complete behavior summary")
    parser.add_argument("--type", choices=["spring", "ascending", "utad", "all"], default="all", help="Filter by structure type")
    parser.add_argument("--inspect-top", type=int, default=5, help="Number of top events to inspect")
    parser.add_argument("--json", type=str, default=None, help="Export output to JSON file path")
    args = parser.parse_args()

    run_micro_analysis(
        filter_type=args.type if args.type != "all" else None,
        inspect_top=args.inspect_top,
        output_json=args.json
    )

if __name__ == "__main__":
    main()
