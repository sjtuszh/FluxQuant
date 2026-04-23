from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class FinancialData:
    id: Optional[int] = None
    source: str = ""
    symbol: str = ""
    data_type: str = ""
    observation_time: str = ""
    value: float = 0.0
    payload_json: str = "{}"
    created_at: str = datetime.utcnow().isoformat()


CREATE_FINANCIAL_DATA_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS financial_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    symbol TEXT NOT NULL,
    data_type TEXT NOT NULL,
    observation_time TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
"""
