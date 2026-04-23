from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from urllib.request import Request, urlopen

import pandas as pd


class MacroFetcher:
    """Fetch macro and cross-asset series for the dashboard."""

    treasury_historical_url = (
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
        "daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve&field_tdr_date_value={year}&page&_format=csv"
    )

    instruments: Dict[str, Dict[str, str]] = {
        "ust_2y": {"kind": "treasury", "label": "US Treasury 2Y", "unit": "%", "category": "Rates", "tenor": "2 Yr"},
        "ust_10y": {"kind": "treasury", "label": "US Treasury 10Y", "unit": "%", "category": "Rates", "tenor": "10 Yr"},
        "ust_30y": {"kind": "treasury", "label": "US Treasury 30Y", "unit": "%", "category": "Rates", "tenor": "30 Yr"},
        "wti": {"kind": "yahoo", "label": "WTI Crude Oil", "unit": "USD", "category": "Energy", "symbol": "CL=F"},
        "brent": {"kind": "yahoo", "label": "Brent Crude Oil", "unit": "USD", "category": "Energy", "symbol": "BZ=F"},
        "dxy": {"kind": "yahoo", "label": "US Dollar Index", "unit": "Index", "category": "Macro", "symbol": "DX-Y.NYB"},
        "gold": {"kind": "yahoo", "label": "Gold", "unit": "USD", "category": "Macro", "symbol": "GC=F"},
        "cnhusd": {"kind": "yahoo", "label": "Offshore RMB", "unit": "USD", "category": "FX", "symbol": "CNH=X"},
        "jpyusd": {"kind": "yahoo", "label": "Japanese Yen", "unit": "USD", "category": "FX", "symbol": "JPY=X"},
        "eurusd": {"kind": "yahoo", "label": "Euro", "unit": "USD", "category": "FX", "symbol": "EURUSD=X"},
        "gbpusd": {"kind": "yahoo", "label": "British Pound", "unit": "USD", "category": "FX", "symbol": "GBPUSD=X"},
        "btcusd": {"kind": "yahoo", "label": "Bitcoin", "unit": "USD", "category": "Crypto", "symbol": "BTC-USD"},
        "usdtusd": {"kind": "yahoo", "label": "USDT", "unit": "USD", "category": "Crypto", "symbol": "USDT-USD"},
    }

    period_days = {"5d": 5, "1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 732}

    def get_instrument_catalog(self) -> Dict[str, Any]:
        items = []
        for instrument_id, config in self.instruments.items():
            item = dict(config)
            item["instrument_id"] = instrument_id
            item["period_options"] = ["5d", "1mo", "3mo", "6mo", "1y"]
            item["interval_options"] = ["1d", "1h", "30m", "15m"] if config["kind"] == "yahoo" else ["1d"]
            items.append(item)
        return {"items": items}

    def fetch_instrument(self, instrument_id: str, period: str = "1mo", interval: str = "1d") -> Dict[str, Any]:
        try:
            config = self.instruments[instrument_id]
        except KeyError as exc:
            raise ValueError("Unknown instrument '%s'." % instrument_id) from exc

        if config["kind"] == "treasury":
            return self._fetch_treasury_series(instrument_id, config, period)
        return self._fetch_yahoo_series(instrument_id, config, period, interval)

    def fetch_batch(self, instrument_ids: List[str], period: str = "1mo", interval: str = "1d") -> Dict[str, Any]:
        items = [self.fetch_instrument(instrument_id=item, period=period, interval=interval) for item in instrument_ids]
        return {"updated_at": datetime.utcnow().isoformat(), "items": items}

    def _fetch_treasury_series(self, instrument_id: str, config: Dict[str, str], period: str) -> Dict[str, Any]:
        now = datetime.utcnow()
        frames = []
        for year in {now.year, now.year - 1}:
            frame = pd.read_csv(self.treasury_historical_url.format(year=year))
            frame.columns = [column.strip() for column in frame.columns]
            frame["Date"] = pd.to_datetime(frame["Date"])
            frames.append(frame)

        full = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["Date"]).sort_values("Date").reset_index(drop=True)
        cutoff = now - timedelta(days=self.period_days.get(period, 31))
        full = full[full["Date"] >= cutoff].reset_index(drop=True)
        tenor = config["tenor"]
        if full.empty or tenor not in full.columns:
            raise ValueError("Treasury data unavailable for '%s'." % instrument_id)

        history = full[["Date", tenor]].copy()
        history.columns = ["date", "value"]
        latest = history.iloc[-1]
        previous = history.iloc[-2] if len(history) > 1 else latest

        return {
            "instrument_id": instrument_id,
            "label": config["label"],
            "unit": config["unit"],
            "category": config["category"],
            "source": "U.S. Treasury",
            "latest_date": latest["date"].strftime("%Y-%m-%d"),
            "updated_at": datetime.utcnow().isoformat(),
            "metrics": {"latest": round(float(latest["value"]), 6), "change": round(float(latest["value"]) - float(previous["value"]), 6)},
            "history": self._records(history),
            "table": self._records(full.tail(12)),
        }

    def _fetch_yahoo_series(self, instrument_id: str, config: Dict[str, str], period: str, interval: str) -> Dict[str, Any]:
        url = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval={interval}&range={period}".format(
            symbol=config["symbol"], interval=interval, period=period
        )
        request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json,text/plain,*/*"})
        with urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))

        result = payload.get("chart", {}).get("result", [])
        if not result:
            raise ValueError("No market data returned for '%s'." % instrument_id)

        series = result[0]
        timestamps = series.get("timestamp", [])
        quote = series.get("indicators", {}).get("quote", [{}])[0]
        frame = pd.DataFrame(
            {
                "Date": [datetime.utcfromtimestamp(ts) for ts in timestamps],
                "Open": quote.get("open", []),
                "High": quote.get("high", []),
                "Low": quote.get("low", []),
                "Close": quote.get("close", []),
                "Volume": quote.get("volume", []),
            }
        )
        frame = frame.dropna(subset=["Close"]).reset_index(drop=True)
        if frame.empty:
            raise ValueError("Empty market data returned for '%s'." % instrument_id)

        latest = frame.iloc[-1]
        previous = frame.iloc[-2] if len(frame) > 1 else latest
        history = frame[["Date", "Close"]].copy()
        history.columns = ["date", "value"]

        return {
            "instrument_id": instrument_id,
            "label": config["label"],
            "unit": config["unit"],
            "category": config["category"],
            "source": "Yahoo Finance",
            "symbol": config["symbol"],
            "latest_date": latest["Date"].strftime("%Y-%m-%d %H:%M") if interval != "1d" else latest["Date"].strftime("%Y-%m-%d"),
            "updated_at": datetime.utcnow().isoformat(),
            "metrics": {
                "latest": round(float(latest["Close"]), 6),
                "change": round(float(latest["Close"]) - float(previous["Close"]), 6),
                "volume": int(latest["Volume"]) if pd.notna(latest["Volume"]) else 0,
            },
            "history": self._records(history),
            "table": self._records(frame.tail(12)),
        }

    def _records(self, frame: pd.DataFrame) -> List[Dict[str, Any]]:
        safe = frame.copy()
        for column in safe.columns:
            if pd.api.types.is_datetime64_any_dtype(safe[column]):
                safe[column] = safe[column].dt.strftime("%Y-%m-%d %H:%M")
        return safe.to_dict(orient="records")
