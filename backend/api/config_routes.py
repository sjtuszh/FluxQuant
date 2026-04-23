from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/config", tags=["config"])

_SETTINGS = {
    "layout_mode": 2,
    "refresh_value": 5,
    "refresh_unit": "minute",
    "default_period": "1mo",
    "default_interval": "1d",
}


@router.get("/settings")
def get_settings() -> dict:
    return _SETTINGS
