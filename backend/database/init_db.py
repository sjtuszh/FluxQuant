from __future__ import annotations

from backend.database.connection import get_connection
from backend.models.app_settings import CREATE_APP_SETTINGS_TABLE_SQL
from backend.models.financial_data import CREATE_FINANCIAL_DATA_INDEX_SQL, CREATE_FINANCIAL_DATA_TABLE_SQL


def init_db() -> None:
    connection = get_connection()
    try:
        cursor = connection.cursor()
        cursor.execute(CREATE_FINANCIAL_DATA_TABLE_SQL)
        cursor.execute(CREATE_FINANCIAL_DATA_INDEX_SQL)
        cursor.execute(CREATE_APP_SETTINGS_TABLE_SQL)
        connection.commit()
    finally:
        connection.close()
