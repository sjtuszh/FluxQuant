from __future__ import annotations

from typing import List

from fastapi import APIRouter, Query

from backend.services.macro_fetcher import MacroFetcher

router = APIRouter(prefix="/api/market", tags=["market"])
macro_fetcher = MacroFetcher()


@router.get("/catalog")
def get_catalog() -> dict:
    return macro_fetcher.get_instrument_catalog()


@router.get("/series")
def get_series(
    instrument_id: str = Query(...),
    period: str = Query(default="1mo"),
    interval: str = Query(default="1d"),
) -> dict:
    return macro_fetcher.fetch_instrument(instrument_id=instrument_id, period=period, interval=interval)


@router.get("/batch")
def get_batch(
    instrument_ids: List[str] = Query(...),
    period: str = Query(default="1mo"),
    interval: str = Query(default="1d"),
) -> dict:
    return macro_fetcher.fetch_batch(instrument_ids=instrument_ids, period=period, interval=interval)
