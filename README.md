# FluxQuant

Focused market data app for:

- U.S. Treasury yields
- Oil, FX, macro, and crypto comparison

## Project Structure

- `frontend/`: static dashboard UI
- `backend/`: FastAPI data service

## Start / Stop

- `启动FluxQuant系统.bat`
- `关闭FluxQuant系统.bat`

## Manual Run

```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
python -m http.server 8501 --bind 127.0.0.1 --directory frontend
```
