from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import pandas as pd

from backend.database.market_repository import MarketDataRepository


class MacroFetcher:
    """Local-first market service backed by sqlite3."""

    write_chunk_size = 250

    treasury_historical_url = (
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
        "daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve&field_tdr_date_value={year}&page&_format=csv"
    )

    instruments: Dict[str, Dict[str, str]] = {
        "ust_2y": {"kind": "treasury", "label": "US Treasury 2Y", "unit": "%", "category": "Rates", "tenor": "2 Yr", "symbol": "UST"},
        "ust_10y": {"kind": "treasury", "label": "US Treasury 10Y", "unit": "%", "category": "Rates", "tenor": "10 Yr", "symbol": "UST"},
        "ust_30y": {"kind": "treasury", "label": "US Treasury 30Y", "unit": "%", "category": "Rates", "tenor": "30 Yr", "symbol": "UST"},
        "wti": {"kind": "yahoo", "label": "WTI Crude Oil", "unit": "USD", "category": "Energy", "symbol": "CL=F"},
        "brent": {"kind": "yahoo", "label": "Brent Crude Oil", "unit": "USD", "category": "Energy", "symbol": "BZ=F"},
        "dxy": {"kind": "yahoo", "label": "US Dollar Index", "unit": "Index", "category": "Macro", "symbol": "DX-Y.NYB"},
        "gold": {"kind": "yahoo", "label": "Gold", "unit": "USD", "category": "Macro", "symbol": "GC=F"},
        "cnhusd": {"kind": "yahoo", "label": "Chinese Yuan", "unit": "USD", "category": "FX", "symbol": "CNY=X"},
        "jpyusd": {"kind": "yahoo", "label": "Japanese Yen", "unit": "USD", "category": "FX", "symbol": "JPY=X"},
        "eurusd": {"kind": "yahoo", "label": "Euro", "unit": "USD", "category": "FX", "symbol": "EURUSD=X"},
        "gbpusd": {"kind": "yahoo", "label": "British Pound", "unit": "USD", "category": "FX", "symbol": "GBPUSD=X"},
        "btcusd": {"kind": "yahoo", "label": "Bitcoin", "unit": "USD", "category": "Crypto", "symbol": "BTC-USD"},
        "usdtusd": {"kind": "yahoo", "label": "USDT", "unit": "USD", "category": "Crypto", "symbol": "USDT-USD"},
    }

    range_days = {"5d": 5, "1m": 31, "1y": 366, "3y": 366 * 3, "5y": 366 * 5, "10y": 366 * 10, "20y": 366 * 20}
    period_order = {"5d": 0, "1m": 1, "1y": 2, "3y": 3, "5y": 4, "10y": 5, "20y": 6}

    def __init__(self) -> None:
        self.repository = MarketDataRepository()

    def get_instrument_catalog(self) -> Dict[str, Any]:
        items = []
        for instrument_id, config in self.instruments.items():
            item = dict(config)
            time_range = self.repository.get_timestamp_range(instrument_id)
            item["instrument_id"] = instrument_id
            item["period_options"] = ["5d", "1m", "1y", "3y", "5y", "10y", "20y"]
            item["interval_options"] = ["1d", "1w", "1m", "1q"]
            item["earliest_local_timestamp"] = time_range["earliest_timestamp"]
            item["latest_local_timestamp"] = time_range["latest_timestamp"]
            items.append(item)
        return {"items": items}

    def sync_instrument(self, instrument_id: str, period: str = "20y", interval: str = "1d") -> Dict[str, Any]:
        config = self._get_instrument(instrument_id)
        time_range_before = self.repository.get_timestamp_range(instrument_id)
        earliest_local = time_range_before["earliest_timestamp"]
        latest_local = time_range_before["latest_timestamp"]

        if config["kind"] == "treasury":
            inserted = self._sync_treasury(instrument_id, config, period)
        else:
            inserted = self._sync_yahoo(instrument_id, config, period, interval, earliest_local, latest_local)

        latest_after = self.repository.get_latest_timestamp(instrument_id)
        time_range = self.repository.get_timestamp_range(instrument_id)
        return {
            "instrument_id": instrument_id,
            "inserted_rows": inserted,
            "updated": inserted > 0,
            "earliest_local_timestamp": time_range["earliest_timestamp"],
            "latest_local_timestamp": latest_after,
            "message": "New data saved." if inserted > 0 else "Already up to date.",
        }

    def sync_batch(self, instrument_ids: List[str], period: str = "20y", interval: str = "1d") -> Dict[str, Any]:
        results = []
        for instrument_id in instrument_ids:
            try:
                results.append(self.sync_instrument(instrument_id, period=period, interval=interval))
            except Exception as exc:
                results.append({"instrument_id": instrument_id, "updated": False, "error": str(exc)})
        return {"updated_at": datetime.utcnow().isoformat(), "items": results}

    def read_instrument(self, instrument_id: str, period: str = "1y", interval: str = "1d") -> Dict[str, Any]:
        config = self._get_instrument(instrument_id)
        rows = self.repository.get_series(instrument_id, self.range_days.get(period, 366))
        time_range = self.repository.get_timestamp_range(instrument_id)
        if not rows:
            return {
                "instrument_id": instrument_id,
                "label": config["label"],
                "unit": config["unit"],
                "category": config["category"],
                "source": config["symbol"] if config["kind"] == "yahoo" else "U.S. Treasury",
                "latest_date": None,
                "updated_at": datetime.utcnow().isoformat(),
                "metrics": {"latest": 0.0, "reference": 1.0, "derived_latest": 0.0, "volume": 0},
                "history": [],
                "table": [],
                "data_range": {"earliest": time_range["earliest_timestamp"], "latest": time_range["latest_timestamp"]},
                "local_status": {"has_data": False, "message": "No local data yet."},
            }

        history = self._build_continuous_history(rows, interval)
        if not history:
            return {
                "instrument_id": instrument_id,
                "label": config["label"],
                "unit": config["unit"],
                "category": config["category"],
                "source": "Local sqlite3 cache",
                "symbol": config["symbol"],
                "latest_date": None,
                "updated_at": datetime.utcnow().isoformat(),
                "metrics": {"latest": 0.0, "reference": 1.0, "derived_latest": 0.0, "volume": 0},
                "history": [],
                "table": [],
                "data_range": {"earliest": time_range["earliest_timestamp"], "latest": time_range["latest_timestamp"]},
                "local_status": {"has_data": False, "message": "No local data yet."},
            }

        latest = history[-1]
        latest_payload = json.loads(rows[-1]["payload_json"] or "{}")
        table = self._build_table(self.repository.get_recent_rows(instrument_id, 12))

        return {
            "instrument_id": instrument_id,
            "label": config["label"],
            "unit": config["unit"],
            "category": config["category"],
            "source": "Local sqlite3 cache",
            "symbol": config["symbol"],
            "latest_date": latest["date"],
            "updated_at": datetime.utcnow().isoformat(),
            "metrics": {
                "latest": round(float(latest["value"]), 6),
                "reference": 1.0,
                "derived_latest": round(float(latest["value"]), 6),
                "volume": int(latest_payload.get("Volume", 0) or 0),
            },
            "history": history,
            "table": table,
            "data_range": {"earliest": time_range["earliest_timestamp"], "latest": time_range["latest_timestamp"]},
            "local_status": {"has_data": True, "message": "Read from local sqlite3 cache."},
        }

    def read_batch(self, instrument_ids: List[str], period: str = "1y", interval: str = "1d") -> Dict[str, Any]:
        items = []
        for instrument_id in instrument_ids:
            try:
                items.append(self.read_instrument(instrument_id, period=period, interval=interval))
            except Exception as exc:
                items.append({"instrument_id": instrument_id, "label": instrument_id, "error": str(exc)})
        return {"updated_at": datetime.utcnow().isoformat(), "items": items}

    def _sync_treasury(self, instrument_id: str, config: Dict[str, str], period: str) -> int:
        now = datetime.utcnow()
        years_back = self._years_back_for_period(period)
        years = {now.year - offset for offset in range(years_back + 1)}
        inserted = 0
        rows: List[Dict[str, Any]] = []
        tenor = config["tenor"]
        for year in sorted(years):
            try:
                frame = pd.read_csv(self.treasury_historical_url.format(year=year))
            except Exception:
                continue

            frame.columns = [column.strip() for column in frame.columns]
            if "Date" not in frame.columns or tenor not in frame.columns:
                continue

            frame["Date"] = pd.to_datetime(frame["Date"])
            frame = frame.sort_values("Date")
            for _, item in frame.iterrows():
                try:
                    tenor_value = item[tenor]
                    if pd.isna(tenor_value):
                        continue
                    rows.append(
                        {
                            "source": "U.S. Treasury",
                            "symbol": config["symbol"],
                            "data_type": instrument_id,
                            "observation_time": item["Date"].strftime("%Y-%m-%dT00:00:00"),
                            "value": float(tenor_value),
                            "payload": {"Date": item["Date"].strftime("%Y-%m-%d"), tenor: float(tenor_value)},
                        }
                    )
                except Exception:
                    continue

                if len(rows) >= self.write_chunk_size:
                    inserted += self.repository.upsert_points(rows)
                    rows = []

        if rows:
            inserted += self.repository.upsert_points(rows)
        return inserted

    def _sync_yahoo(
        self,
        instrument_id: str,
        config: Dict[str, str],
        period: str,
        interval: str,
        earliest_local: Optional[str],
        latest_local: Optional[str],
    ) -> int:
        effective_period = self._period_for_incremental_sync(period, earliest_local, latest_local)
        payload = self._fetch_yahoo_payload(symbol=config["symbol"], period=effective_period, interval=interval)
        result = payload.get("chart", {}).get("result", [])
        if not result:
            raise ValueError("No market data returned for '%s'." % instrument_id)

        series = result[0]
        timestamps = series.get("timestamp", [])
        quote = series.get("indicators", {}).get("quote", [{}])[0]
        rows: List[Dict[str, Any]] = []
        inserted = 0
        for index, timestamp in enumerate(timestamps):
            try:
                observed_at = datetime.utcfromtimestamp(timestamp)
                iso_time = observed_at.strftime("%Y-%m-%dT%H:%M:%S")
                if earliest_local and latest_local and earliest_local <= iso_time <= latest_local:
                    continue
                close_value = quote.get("close", [None])[index]
                if close_value is None:
                    continue
                payload_row = {
                    "Date": observed_at.strftime("%Y-%m-%d %H:%M"),
                    "Open": self._safe_list_value(quote.get("open", []), index),
                    "High": self._safe_list_value(quote.get("high", []), index),
                    "Low": self._safe_list_value(quote.get("low", []), index),
                    "Close": close_value,
                    "Volume": self._safe_list_value(quote.get("volume", []), index, 0),
                }
                rows.append(
                    {
                        "source": "Yahoo Finance",
                        "symbol": config["symbol"],
                        "data_type": instrument_id,
                        "observation_time": iso_time,
                        "value": float(close_value),
                        "payload": payload_row,
                    }
                )
            except Exception:
                continue

            if len(rows) >= self.write_chunk_size:
                inserted += self.repository.upsert_points(rows)
                rows = []

        if rows:
            inserted += self.repository.upsert_points(rows)
        return inserted

    def _period_for_incremental_sync(
        self,
        period: str,
        earliest_local: Optional[str],
        latest_local: Optional[str],
    ) -> str:
        requested_period = period
        requested_days = self.range_days.get(requested_period)
        if not requested_days:
            return requested_period
        if not earliest_local or not latest_local:
            return requested_period

        try:
            earliest_dt = datetime.fromisoformat(earliest_local)
            latest_dt = datetime.fromisoformat(latest_local)
        except ValueError:
            return requested_period

        now = datetime.utcnow()
        desired_start = now - pd.Timedelta(days=requested_days)
        local_covers_start = earliest_dt <= desired_start
        local_is_fresh = (now - latest_dt).days <= 2

        if local_covers_start and local_is_fresh:
            return "1y" if requested_days <= 366 else requested_period
        return requested_period

    def _years_back_for_period(self, period: str) -> int:
        period_map = {"1y": 1, "5y": 5, "10y": 10, "20y": 20}
        return period_map.get(period, 20)

    def _fetch_yahoo_payload(self, symbol: str, period: str, interval: str) -> Dict[str, Any]:
        attempts = [(period, "1d")]

        last_error: Optional[Exception] = None
        for current_period, current_interval in attempts:
            url = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval={interval}&range={period}".format(
                symbol=symbol,
                interval=current_interval,
                period=current_period,
            )
            request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json,text/plain,*/*"})
            try:
                with urlopen(request, timeout=20) as response:
                    return json.loads(response.read().decode("utf-8"))
            except (HTTPError, URLError, TimeoutError, ValueError) as exc:
                last_error = exc
        raise ValueError("Yahoo Finance request failed for '%s': %s" % (symbol, last_error))

    def _get_instrument(self, instrument_id: str) -> Dict[str, str]:
        try:
            return self.instruments[instrument_id]
        except KeyError as exc:
            raise ValueError("Unknown instrument '%s'." % instrument_id) from exc

    def _build_table(self, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        table = []
        for row in rows:
            payload = json.loads(row["payload_json"] or "{}")
            if payload:
                table.append(payload)
            else:
                table.append({"Date": row["observation_time"].replace("T", " ")[:16], "Value": row["value"]})
        return table

    def _safe_list_value(self, values: List[Any], index: int, default: Any = None) -> Any:
        if index >= len(values):
            return default
        value = values[index]
        return default if value is None else value

    def _resample_history(self, history: List[Dict[str, Any]], period: str) -> List[Dict[str, Any]]:
        if not history:
            return []
        if period == "1d":
            return history

        frame = pd.DataFrame(history)
        frame["date"] = pd.to_datetime(frame["date"])
        frame["value"] = frame["value"].astype(float)
        frame = frame.set_index("date")
        rule_map = {"1w": "W-FRI", "1m": "M", "1q": "Q"}
        rule = rule_map.get(period)
        if not rule:
            return history
        sampled = frame.resample(rule).last().dropna().reset_index()
        sampled["date"] = sampled["date"].dt.strftime("%Y-%m-%d")
        return sampled.to_dict(orient="records")

    def _build_continuous_history(self, rows: List[Dict[str, Any]], interval: str) -> List[Dict[str, Any]]:
        if not rows:
            return []

        frame = pd.DataFrame(
            [
                {
                    "date": pd.to_datetime(row["observation_time"]).normalize(),
                    "value": float(row["value"]),
                }
                for row in rows
            ]
        )
        frame = frame.sort_values("date").drop_duplicates(subset=["date"], keep="last").set_index("date")

        today = pd.Timestamp.utcnow().tz_localize(None).normalize()
        end_date = max(frame.index.max(), today)
        full_index = pd.date_range(start=frame.index.min(), end=end_date, freq="D")
        frame = frame.reindex(full_index).ffill().dropna().reset_index()
        frame.columns = ["date", "value"]
        frame["date"] = frame["date"].dt.strftime("%Y-%m-%d")

        return self._resample_history(frame.to_dict(orient="records"), interval)
