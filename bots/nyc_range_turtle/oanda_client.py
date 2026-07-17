"""OANDA practice REST client for candle history with parquet cache."""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

import pandas as pd
import requests
from dotenv import load_dotenv

from .config import (
    CANDLE_GRANULARITY,
    DATA_DIR,
    OANDA_LIVE_URL,
    OANDA_PRACTICE_URL,
    chunk_days_for_granularity,
)


def _load_env() -> None:
    root = Path(__file__).resolve().parents[2]
    for name in (".env.local", ".env"):
        path = root / name
        if path.exists():
            load_dotenv(path, override=False)


class OandaClient:
    def __init__(
        self,
        api_key: str | None = None,
        account_id: str | None = None,
        environment: str | None = None,
    ) -> None:
        _load_env()
        self.api_key = api_key or os.getenv("OANDA_API_KEY", "")
        self.account_id = account_id or os.getenv("OANDA_ACCOUNT_ID", "")
        env = (environment or os.getenv("OANDA_ENVIRONMENT", "practice")).lower()
        self.base_url = OANDA_PRACTICE_URL if env != "live" else OANDA_LIVE_URL
        if not self.api_key or not self.account_id:
            raise ValueError(
                "Missing OANDA_API_KEY or OANDA_ACCOUNT_ID. "
                "Set them in .env.local or .env before running the backtest."
            )
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }
        )

    def _get(self, path: str, params: dict | None = None) -> dict:
        url = f"{self.base_url}{path}"
        for attempt in range(5):
            resp = self.session.get(url, params=params, timeout=60)
            if resp.status_code == 429:
                time.sleep(2 ** attempt)
                continue
            if resp.status_code >= 400:
                raise RuntimeError(
                    f"OANDA {resp.status_code} on {path}: {resp.text[:500]}"
                )
            return resp.json()
        raise RuntimeError(f"OANDA rate-limited on {path}")

    def list_instruments(self) -> set[str]:
        data = self._get(f"/v3/accounts/{self.account_id}/instruments")
        return {item["name"] for item in data.get("instruments", [])}

    def verify_instruments(self, names: Iterable[str]) -> None:
        available = self.list_instruments()
        missing = [n for n in names if n not in available]
        if missing:
            raise RuntimeError(
                f"Instruments not available on this OANDA account: {missing}. "
                f"Sample available indices: "
                f"{sorted(i for i in available if any(x in i for x in ('JP', 'HK', 'US', 'NAS')))[:20]}"
            )

    def fetch_candles(
        self,
        instrument: str,
        start: datetime,
        end: datetime,
        granularity: str = CANDLE_GRANULARITY,
    ) -> pd.DataFrame:
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)

        rows: list[dict] = []
        cursor = start
        step = timedelta(days=chunk_days_for_granularity(granularity))

        while cursor < end:
            chunk_end = min(cursor + step, end)
            params = {
                "granularity": granularity,
                "price": "M",
                "from": _rfc3339(cursor),
                "to": _rfc3339(chunk_end),
            }
            data = self._get(f"/v3/instruments/{instrument}/candles", params=params)
            for c in data.get("candles", []):
                if not c.get("complete", True):
                    continue
                mid = c["mid"]
                rows.append(
                    {
                        "time": pd.Timestamp(c["time"], tz="UTC"),
                        "open": float(mid["o"]),
                        "high": float(mid["h"]),
                        "low": float(mid["l"]),
                        "close": float(mid["c"]),
                        "volume": int(c.get("volume", 0)),
                    }
                )
            cursor = chunk_end
            time.sleep(0.15)

        if not rows:
            return pd.DataFrame(
                columns=["time", "open", "high", "low", "close", "volume"]
            )

        df = pd.DataFrame(rows).drop_duplicates(subset=["time"]).sort_values("time")
        return df.reset_index(drop=True)

    def get_or_fetch_candles(
        self,
        instrument: str,
        start: datetime,
        end: datetime,
        granularity: str = CANDLE_GRANULARITY,
        force_refresh: bool = False,
    ) -> pd.DataFrame:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        cache_path = DATA_DIR / f"{instrument}_{granularity}.parquet"
        meta_path = DATA_DIR / f"{instrument}_{granularity}_meta.txt"

        need_start = (
            pd.Timestamp(start).tz_convert("UTC")
            if getattr(start, "tzinfo", None)
            else pd.Timestamp(start, tz="UTC")
        )
        need_end = (
            pd.Timestamp(end).tz_convert("UTC")
            if getattr(end, "tzinfo", None)
            else pd.Timestamp(end, tz="UTC")
        )

        if cache_path.exists() and not force_refresh:
            df = pd.read_parquet(cache_path)
            df["time"] = pd.to_datetime(df["time"], utc=True)
            if (
                len(df) > 0
                and df["time"].iloc[0] <= need_start
                and df["time"].iloc[-1] >= need_end - timedelta(days=1)
            ):
                mask = (df["time"] >= need_start) & (df["time"] <= need_end)
                return df.loc[mask].reset_index(drop=True)

        print(
            f"Fetching {instrument} {granularity} candles "
            f"{start.date()} -> {end.date()} ..."
        )
        df = self.fetch_candles(instrument, start, end, granularity=granularity)
        if len(df) == 0:
            raise RuntimeError(f"No candles returned for {instrument} {granularity}")
        df.to_parquet(cache_path, index=False)
        meta_path.write_text(
            f"instrument={instrument}\ngranularity={granularity}\n"
            f"start={start.isoformat()}\nend={end.isoformat()}\nrows={len(df)}\n",
            encoding="utf-8",
        )
        print(f"  Cached {len(df)} bars -> {cache_path}")
        return df


def _rfc3339(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000000000Z")
