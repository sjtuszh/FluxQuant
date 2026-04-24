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
    period: str = Query(default="1d"),
    interval: str = Query(default="1d"),
) -> dict:
    return macro_fetcher.read_instrument(instrument_id=instrument_id, period=period, interval=interval)


@router.get("/batch")
def get_batch(
    instrument_ids: List[str] = Query(...),
    period: str = Query(default="1d"),
    interval: str = Query(default="1d"),
) -> dict:
    return macro_fetcher.read_batch(instrument_ids=instrument_ids, period=period, interval=interval)


@router.post("/sync/series")
def sync_series(
    instrument_id: str = Query(...),
    period: str = Query(default="5y"),
    interval: str = Query(default="1d"),
) -> dict:
    return macro_fetcher.sync_instrument(instrument_id=instrument_id, period=period, interval=interval)


@router.post("/sync/batch")
def sync_batch(
    instrument_ids: List[str] = Query(...),
    period: str = Query(default="5y"),
    interval: str = Query(default="1d"),
) -> dict:
    return macro_fetcher.sync_batch(instrument_ids=instrument_ids, period=period, interval=interval)
