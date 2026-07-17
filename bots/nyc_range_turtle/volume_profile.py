"""Volume profile: POC / Value Area from session bars."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional

import numpy as np
import pandas as pd

from .config import session_open_date

# Locked a priori profile params (not optimized)
VP_BINS = 40
VA_PCT = 0.70


@dataclass(frozen=True)
class VolumeProfileLevels:
    session_date: date
    poc: float
    val: float
    vah: float
    session_high: float
    session_low: float
    total_volume: float


def _profile_from_bars(highs: np.ndarray, lows: np.ndarray, vols: np.ndarray) -> Optional[tuple[float, float, float, float, float]]:
    """Return (poc, val, vah, sess_high, sess_low) or None."""
    if len(highs) == 0:
        return None
    sess_high = float(np.max(highs))
    sess_low = float(np.min(lows))
    if sess_high <= sess_low:
        return None

    bin_size = (sess_high - sess_low) / VP_BINS
    if bin_size <= 0:
        return None

    # Distribute each bar's volume across bins it overlaps (uniform by range)
    vol_bins = np.zeros(VP_BINS, dtype=float)
    for h, l, v in zip(highs, lows, vols):
        if v <= 0:
            v = 1.0
        lo = float(l)
        hi = float(h)
        if hi < lo:
            lo, hi = hi, lo
        if hi == lo:
            idx = min(VP_BINS - 1, max(0, int((lo - sess_low) / bin_size)))
            vol_bins[idx] += v
            continue
        # overlap each bin
        for b in range(VP_BINS):
            b_lo = sess_low + b * bin_size
            b_hi = b_lo + bin_size
            overlap = max(0.0, min(hi, b_hi) - max(lo, b_lo))
            if overlap > 0:
                vol_bins[b] += v * (overlap / (hi - lo))

    total = float(vol_bins.sum())
    if total <= 0:
        return None

    poc_idx = int(np.argmax(vol_bins))
    poc = sess_low + (poc_idx + 0.5) * bin_size

    # Expand value area from POC until VA_PCT of volume
    target = total * VA_PCT
    left = right = poc_idx
    covered = vol_bins[poc_idx]
    while covered < target and (left > 0 or right < VP_BINS - 1):
        left_vol = vol_bins[left - 1] if left > 0 else -1.0
        right_vol = vol_bins[right + 1] if right < VP_BINS - 1 else -1.0
        if right_vol >= left_vol and right < VP_BINS - 1:
            right += 1
            covered += vol_bins[right]
        elif left > 0:
            left -= 1
            covered += vol_bins[left]
        elif right < VP_BINS - 1:
            right += 1
            covered += vol_bins[right]
        else:
            break

    val = sess_low + left * bin_size
    vah = sess_low + (right + 1) * bin_size
    return poc, val, vah, sess_high, sess_low


def build_session_profiles(
    df: pd.DataFrame,
    instrument: str,
) -> dict[date, VolumeProfileLevels]:
    """Build a volume profile for each completed session on this instrument."""
    if df.empty:
        return {}

    work = df.copy()
    work["session_date"] = work["time"].map(lambda ts: session_open_date(instrument, ts))
    work = work.dropna(subset=["session_date"])
    if work.empty:
        return {}

    out: dict[date, VolumeProfileLevels] = {}
    for sod, g in work.groupby("session_date"):
        highs = g["high"].to_numpy(dtype=float)
        lows = g["low"].to_numpy(dtype=float)
        vols = g["volume"].astype(float).to_numpy()
        result = _profile_from_bars(highs, lows, vols)
        if result is None:
            continue
        poc, val, vah, sh, sl = result
        out[sod] = VolumeProfileLevels(
            session_date=sod,
            poc=poc,
            val=val,
            vah=vah,
            session_high=sh,
            session_low=sl,
            total_volume=float(vols.sum()),
        )
    return out


def prior_profile_map(
    profiles: dict[date, VolumeProfileLevels],
) -> dict[date, VolumeProfileLevels]:
    """
    Map each session date -> prior completed session's profile.
    Trading day D uses profile from the previous key in sorted session dates.
    """
    dates = sorted(profiles.keys())
    prior: dict[date, VolumeProfileLevels] = {}
    for i, d in enumerate(dates):
        if i == 0:
            continue
        prior[d] = profiles[dates[i - 1]]
    return prior
