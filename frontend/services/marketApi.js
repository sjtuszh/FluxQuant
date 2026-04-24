const API_BASE = "http://127.0.0.1:8000";

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json();
}

async function readJsonPost(url) {
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json();
}

export function fetchSettings() {
  return readJson(`${API_BASE}/api/config/settings`);
}

export function fetchCatalog() {
  return readJson(`${API_BASE}/api/market/catalog`);
}

export function fetchSeries({ instrumentId, period, interval }) {
  const url = new URL(`${API_BASE}/api/market/series`);
  url.searchParams.set("instrument_id", instrumentId);
  url.searchParams.set("period", period);
  url.searchParams.set("interval", interval);
  return readJson(url.toString());
}

export function fetchBatch({ instrumentIds, period, interval }) {
  const url = new URL(`${API_BASE}/api/market/batch`);
  instrumentIds.forEach((instrumentId) => url.searchParams.append("instrument_ids", instrumentId));
  url.searchParams.set("period", period);
  url.searchParams.set("interval", interval);
  return readJson(url.toString());
}

export function syncSeries({ instrumentId, period, interval }) {
  const url = new URL(`${API_BASE}/api/market/sync/series`);
  url.searchParams.set("instrument_id", instrumentId);
  url.searchParams.set("period", period);
  url.searchParams.set("interval", interval);
  return readJsonPost(url.toString());
}

export function syncBatch({ instrumentIds, period, interval }) {
  const url = new URL(`${API_BASE}/api/market/sync/batch`);
  instrumentIds.forEach((instrumentId) => url.searchParams.append("instrument_ids", instrumentId));
  url.searchParams.set("period", period);
  url.searchParams.set("interval", interval);
  return readJsonPost(url.toString());
}
