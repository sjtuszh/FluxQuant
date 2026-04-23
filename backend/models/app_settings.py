from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class AppSettings:
    id: Optional[int] = None
    setting_key: str = ""
    setting_value: str = ""
    updated_at: str = datetime.utcnow().isoformat()


CREATE_APP_SETTINGS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT NOT NULL UNIQUE,
    setting_value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
"""
