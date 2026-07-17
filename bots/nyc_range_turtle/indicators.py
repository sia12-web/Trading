"""Technical indicators for Turtle / IB mean-reversion bots."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import ATR_PERIOD, RSI_PERIOD


def wilder_atr(df: pd.DataFrame, period: int = ATR_PERIOD) -> pd.Series:
    """Wilder ATR using high/low/close columns."""
    high = df["high"]
    low = df["low"]
    close = df["close"]
    prev_close = close.shift(1)
    tr = pd.concat(
        [
            (high - low).abs(),
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def wilder_rsi(close: pd.Series, period: int = RSI_PERIOD) -> pd.Series:
    """Wilder RSI on close."""
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100.0 - (100.0 / (1.0 + rs))


def session_vwap(
    df: pd.DataFrame,
    session_ids: pd.Series,
) -> pd.Series:
    """
    Volume-weighted average price reset each session.
    typical = (H+L+C)/3; VWAP = cumsum(typical*vol) / cumsum(vol)
    """
    typical = (df["high"] + df["low"] + df["close"]) / 3.0
    vol = df["volume"].astype(float).replace(0, 1.0)
    tp_vol = typical * vol

    out = pd.Series(np.nan, index=df.index, dtype=float)
    sid = session_ids.astype(str)
    for key in sid.unique():
        if key in ("None", "nan"):
            continue
        mask = sid == key
        cv = tp_vol.loc[mask].cumsum()
        vv = vol.loc[mask].cumsum()
        out.loc[mask] = cv / vv.replace(0, np.nan)
    return out


def relative_volume(volume: pd.Series, period: int = 20) -> pd.Series:
    """RVOL = current volume / SMA(volume, period)."""
    sma = volume.astype(float).rolling(period, min_periods=period).mean()
    return volume.astype(float) / sma.replace(0, np.nan)
