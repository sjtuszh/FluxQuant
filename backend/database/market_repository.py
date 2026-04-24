from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from backend.database.connection import get_connection
from backend.database.init_db import init_db


class MarketDataRepository:
    def _ensure_schema(self) -> None:
        try:
            connection = get_connection()
            try:
                connection.execute("SELECT 1 FROM financial_data LIMIT 1")
            finally:
                connection.close()
        except sqlite3.OperationalError:
            init_db()

    def get_timestamp_range(self, data_type: str) -> Dict[str, Optional[str]]:
        self._ensure_schema()
        connection = get_connection()
        try:
            row = connection.execute(
                """
                SELECT MIN(observation_time) AS earliest_timestamp, MAX(observation_time) AS latest_timestamp
                FROM financial_data
                WHERE data_type = ?
                """,
                (data_type,),
            ).fetchone()
            if not row:
                return {"earliest_timestamp": None, "latest_timestamp": None}
            return {
                "earliest_timestamp": row["earliest_timestamp"],
                "latest_timestamp": row["latest_timestamp"],
            }
        finally:
            connection.close()

    def get_latest_timestamp(self, data_type: str) -> Optional[str]:
        self._ensure_schema()
        connection = get_connection()
        try:
            row = connection.execute(
                """
                SELECT observation_time
                FROM financial_data
                WHERE data_type = ?
                ORDER BY observation_time DESC
                LIMIT 1
                """,
                (data_type,),
            ).fetchone()
            return row["observation_time"] if row else None
        finally:
            connection.close()

    def upsert_points(self, rows: List[Dict[str, Any]]) -> int:
        self._ensure_schema()
        if not rows:
            return 0

        connection = get_connection()
        try:
            cursor = connection.cursor()
            inserted = 0
            for row in rows:
                cursor.execute(
                    """
                    INSERT OR IGNORE INTO financial_data
                    (source, symbol, data_type, observation_time, value, payload_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        row["source"],
                        row["symbol"],
                        row["data_type"],
                        row["observation_time"],
                        row["value"],
                        json.dumps(row.get("payload", {}), ensure_ascii=False),
                        row.get("created_at") or datetime.utcnow().isoformat(),
                    ),
                )
                inserted += cursor.rowcount
            connection.commit()
            return inserted
        finally:
            connection.close()

    def get_series(self, data_type: str, days: int) -> List[Dict[str, Any]]:
        self._ensure_schema()
        cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
        connection = get_connection()
        try:
            rows = connection.execute(
                """
                SELECT symbol, data_type, observation_time, value, payload_json
                FROM financial_data
                WHERE data_type = ? AND observation_time >= ?
                ORDER BY observation_time ASC
                """,
                (data_type, cutoff),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            connection.close()

    def get_recent_rows(self, data_type: str, limit: int = 12) -> List[Dict[str, Any]]:
        self._ensure_schema()
        connection = get_connection()
        try:
            rows = connection.execute(
                """
                SELECT symbol, data_type, observation_time, value, payload_json
                FROM financial_data
                WHERE data_type = ?
                ORDER BY observation_time DESC
                LIMIT ?
                """,
                (data_type, limit),
            ).fetchall()
            return [dict(row) for row in reversed(rows)]
        finally:
            connection.close()
