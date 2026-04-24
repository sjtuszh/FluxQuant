import { renderTable } from "../components/dataTable.js";
import { renderComparisonChart, renderSeriesChart } from "../components/plotlyCharts.js";
import { fetchBatch, fetchCatalog, fetchSeries, fetchSettings, syncBatch, syncSeries } from "../services/marketApi.js";
import { appState, loadState, saveState } from "../store/appState.js";

const updatedAt = document.getElementById("updatedAt");
const refreshButton = document.getElementById("refreshButton");
const scanButton = document.getElementById("scanButton");
const statusText = document.getElementById("statusText");
const layoutModeGroup = document.getElementById("layoutModeGroup");
const refreshValueInput = document.getElementById("refreshValue");
const refreshUnitInput = document.getElementById("refreshUnit");
const newCardTypeInput = document.getElementById("newCardType");
const newCardInstrumentInput = document.getElementById("newCardInstrument");
const addCardButton = document.getElementById("addCardButton");
const instrumentCatalog = document.getElementById("instrumentCatalog");
const cardGrid = document.getElementById("cardGrid");

const seriesColors = ["#2563eb", "#0f9f6e", "#c77800", "#c53d43", "#7c3aed", "#0891b2", "#4f46e5"];
const cardElements = new Map();
let fullscreenCardId = null;
const cardIntervals = ["1d", "1w", "1m", "1q"];
const cardPeriods = ["5d", "1m", "1y", "3y", "5y"];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatValue(value, digits = 3) {
  return Number(value).toFixed(digits);
}

function setStatus(text) {
  statusText.textContent = text;
}

function getInstrumentMeta(instrumentId) {
  return appState.catalog.find((item) => item.instrument_id === instrumentId);
}

function getDownloadState(instrumentId) {
  return appState.downloadState[instrumentId] || { status: "idle", progress: 0, message: "No local data yet." };
}

function setDownloadState(instrumentId, patch) {
  appState.downloadState[instrumentId] = { ...getDownloadState(instrumentId), ...patch };
  renderCatalog();
}

function formatRangeLabel(earliestTimestamp, latestTimestamp) {
  if (!earliestTimestamp || !latestTimestamp) return "No local data yet.";
  return `${earliestTimestamp.slice(0, 10)} - ${latestTimestamp.slice(0, 10)}`;
}

function syncDownloadStateFromCatalog() {
  const nextState = { ...appState.downloadState };
  appState.catalog.forEach((item) => {
    const previous = nextState[item.instrument_id] || {};
    if (previous.status === "loading") return;
    nextState[item.instrument_id] = {
      status: previous.status === "error" ? "error" : item.latest_local_timestamp ? "success" : "idle",
      progress: item.latest_local_timestamp ? 100 : 0,
      message:
        previous.status === "error"
          ? previous.message
          : formatRangeLabel(item.earliest_local_timestamp, item.latest_local_timestamp),
    };
  });
  appState.downloadState = nextState;
}

function updateCatalogRange(instrumentId, earliestTimestamp, latestTimestamp, message = null) {
  const catalogItem = getInstrumentMeta(instrumentId);
  if (catalogItem) {
    catalogItem.earliest_local_timestamp = earliestTimestamp || null;
    catalogItem.latest_local_timestamp = latestTimestamp || null;
  }
  setDownloadState(instrumentId, {
    status: latestTimestamp ? "success" : "idle",
    progress: latestTimestamp ? 100 : 0,
    message: message || formatRangeLabel(earliestTimestamp, latestTimestamp),
  });
}

function buildReferenceOptions(selectedValue, currentInstrumentId) {
  const options = ['<option value="usd">USD</option>'];
  appState.catalog.forEach((item) => {
    if (item.instrument_id === currentInstrumentId) return;
    const selected = item.instrument_id === selectedValue ? "selected" : "";
    options.push(`<option value="${item.instrument_id}" ${selected}>${item.label}</option>`);
  });
  return options.join("");
}

async function fetchReferenceSeries(referenceInstrumentId, period) {
  if (!referenceInstrumentId || referenceInstrumentId === "usd") return null;
  return fetchSeries({ instrumentId: referenceInstrumentId, period, interval: "1d" });
}

function applyReferenceSeries(baseSeries, referenceSeries) {
  if (!referenceSeries) {
    return {
      ...baseSeries,
      unit: "USD",
      reference_label: "USD",
      metrics: {
        ...baseSeries.metrics,
        reference: 1.0,
        derived_latest: baseSeries.metrics.latest,
      },
    };
  }

  const referenceMap = new Map(referenceSeries.history.map((row) => [row.date, Number(row.value)]));
  const derivedHistory = baseSeries.history
    .map((row) => {
      const referenceValue = referenceMap.get(row.date);
      if (!referenceValue || referenceValue === 0) return null;
      return { date: row.date, value: Number(row.value) / referenceValue };
    })
    .filter(Boolean);

  const latest = derivedHistory[derivedHistory.length - 1]?.value ?? 0;
  return {
    ...baseSeries,
    unit: `${baseSeries.label} / ${referenceSeries.label}`,
    reference_label: referenceSeries.label,
    history: derivedHistory,
    metrics: {
      ...baseSeries.metrics,
      reference: referenceSeries.metrics.latest,
      derived_latest: latest,
    },
  };
}

function buildInstrumentOptions(selectedValue) {
  return appState.catalog
    .map((item) => {
      const selected = item.instrument_id === selectedValue ? "selected" : "";
      return `<option value="${item.instrument_id}" ${selected}>${item.label}</option>`;
    })
    .join("");
}

function buildSelectOptions(values, selectedValue) {
  return values.map((value) => `<option value="${value}" ${value === selectedValue ? "selected" : ""}>${value}</option>`).join("");
}

function setLayoutMode(mode) {
  appState.layoutMode = mode;
  cardGrid.className = `card-grid columns-${mode}` + (fullscreenCardId ? " fullscreen-active" : "");
  Array.from(layoutModeGroup.querySelectorAll("button")).forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.columns) === mode);
  });
  saveState();
}

function setButtonLoading(button, loading, labelWhenIdle = null) {
  if (!button) return;
  if (!button.dataset.idleLabel) {
    button.dataset.idleLabel = labelWhenIdle || button.textContent;
  }
  button.disabled = loading;
  button.classList.toggle("is-loading", loading);
  button.textContent = loading ? "Loading" : button.dataset.idleLabel;
}

function setRefreshQueueButton() {
  if (!refreshButton) return;
  refreshButton.disabled = false;
  refreshButton.classList.toggle("is-loading", appState.refreshQueueRunning);
  refreshButton.textContent = appState.refreshQueueRunning ? "Pause Download" : "Download All 5Y";
}

function setScanButtonLoading(loading) {
  if (!scanButton) return;
  scanButton.disabled = loading;
  scanButton.classList.toggle("is-loading", loading);
  scanButton.textContent = loading ? "Scanning" : "Scan Local";
}

function setCardLoading(article, loading) {
  article.classList.toggle("is-loading", loading);
}

function setFullscreen(cardId) {
  fullscreenCardId = cardId;
  cardElements.forEach((article, id) => {
    article.classList.toggle("fullscreen", id === cardId);
    article.classList.toggle("hidden-by-fullscreen", Boolean(cardId) && id !== cardId);
    const fullscreenButton = article.querySelector(".card-fullscreen");
    if (fullscreenButton) {
      fullscreenButton.textContent = id === cardId ? "Back" : "Fullscreen";
    }
  });
  setLayoutMode(Number(appState.layoutMode));
}

function refreshMilliseconds() {
  const value = Number(appState.refreshValue);
  if (!value || value <= 0) return 0;
  return appState.refreshUnit === "hour" ? value * 60 * 60 * 1000 : value * 60 * 1000;
}

function updateAutoRefresh() {
  if (appState.timerId) {
    clearInterval(appState.timerId);
    appState.timerId = null;
  }
  const milliseconds = refreshMilliseconds();
  if (milliseconds > 0) {
    appState.timerId = setInterval(() => refreshAllCards(false), milliseconds);
  }
  saveState();
}

async function addCard() {
  setButtonLoading(addCardButton, true, "Add Card");
  const cardType = newCardTypeInput.value;
  const card =
    cardType === "instrument"
      ? { id: crypto.randomUUID(), type: "instrument", instrumentId: newCardInstrumentInput.value, period: "1d", interval: "1d", referenceInstrumentId: "usd" }
      : { id: crypto.randomUUID(), type: "comparison", instruments: [newCardInstrumentInput.value], period: "1d", interval: "1d", scales: {} };

  appState.cards.push(card);
  saveState();
  mountCard(card);
  try {
    await refreshCard(card.id, true);
  } finally {
    setButtonLoading(addCardButton, false, "Add Card");
  }
}

function removeCard(cardId) {
  appState.cards = appState.cards.filter((card) => card.id !== cardId);
  const article = cardElements.get(cardId);
  if (article) {
    article.remove();
    cardElements.delete(cardId);
  }
  if (fullscreenCardId === cardId) {
    setFullscreen(null);
  }
  saveState();
}

function cardById(cardId) {
  return appState.cards.find((card) => card.id === cardId);
}

function instrumentColumns(series) {
  if (series.table && series.table[0] && Object.prototype.hasOwnProperty.call(series.table[0], "Open")) {
    return [
      { key: "Date", label: "Date" },
      { key: "Open", label: "Open" },
      { key: "High", label: "High" },
      { key: "Low", label: "Low" },
      { key: "Close", label: "Close" },
      { key: "Volume", label: "Volume" },
    ];
  }
  return [
    { key: "date", label: "Date" },
    { key: "value", label: "Value" },
  ];
}

function metricMarkup(series) {
  const referenceLabel = escapeHtml(series.reference_label || "USD");
  return `
    <div class="metric-box">
      <div class="label">Latest</div>
      <div class="value">${formatValue(series.metrics.derived_latest ?? series.metrics.latest)}</div>
    </div>
    <div class="metric-box">
      <div class="label">Pricing Base</div>
      <div class="value metric-date">${referenceLabel}</div>
    </div>
    <div class="metric-box">
      <div class="label">Updated</div>
      <div class="value metric-date">${series.latest_date}</div>
    </div>
  `;
}

function multiplierFromExponent(scaleExp) {
  return Math.pow(10, Number(scaleExp || 0));
}

function autoScaleMap(items) {
  const latestValues = items.map((item) => Math.abs(Number(item.metrics.latest || 0))).filter((value) => value > 0);
  const target = latestValues.length ? Math.max(...latestValues) : 1;
  const result = {};
  items.forEach((item) => {
    const latest = Math.abs(Number(item.metrics.latest || 0)) || 1;
    result[item.instrument_id] = Math.log10(target / latest);
  });
  return result;
}

function buildCardShell(card, title, subtitle) {
  const article = document.createElement("article");
  article.className = "card";
  article.dataset.cardId = card.id;
  article.innerHTML = `
    <div class="card-loading-overlay"><div class="spinner"></div></div>
    <div class="card-header">
      <div>
        <h3 class="card-title">${title}</h3>
        <div class="subtle card-subtitle">${subtitle}</div>
      </div>
      <div class="card-actions">
        <button class="secondary-button card-fullscreen">Fullscreen</button>
        <button class="secondary-button card-refresh">Reload</button>
        <button class="secondary-button card-delete">Delete</button>
      </div>
    </div>
  `;
  article.querySelector(".card-delete").addEventListener("click", () => removeCard(card.id));
  article.querySelector(".card-fullscreen").addEventListener("click", () => setFullscreen(fullscreenCardId === card.id ? null : card.id));
  article.querySelector(".card-refresh").addEventListener("click", () => refreshCard(card.id, true));
  return article;
}

function createInstrumentCard(card) {
  const meta = getInstrumentMeta(card.instrumentId);
  if (!card.referenceInstrumentId) card.referenceInstrumentId = "usd";
  const article = buildCardShell(card, meta?.label || card.instrumentId, meta ? `${meta.category} | ${meta.unit}` : "");

  article.insertAdjacentHTML(
    "beforeend",
    `
      <div class="card-controls">
        <label class="field">
          <span>Instrument</span>
          <select class="card-instrument">${buildInstrumentOptions(card.instrumentId)}</select>
        </label>
        <label class="field">
          <span>Interval</span>
          <select class="card-interval">${buildSelectOptions(cardIntervals, card.interval || "1d")}</select>
        </label>
        <label class="field">
          <span>Period</span>
          <select class="card-period">${buildSelectOptions(cardPeriods, card.period || "1y")}</select>
        </label>
        <label class="field">
          <span>Reference</span>
          <select class="card-reference">${buildReferenceOptions(card.referenceInstrumentId, card.instrumentId)}</select>
        </label>
      </div>
      <div class="metric-row"></div>
      <div class="chart-host"></div>
      <div class="chart-note"></div>
      <div class="table-host"></div>
    `
  );

  article.querySelector(".card-instrument").addEventListener("change", (event) => {
    card.instrumentId = event.target.value;
    saveState();
    const nextMeta = getInstrumentMeta(card.instrumentId);
    article.querySelector(".card-title").textContent = nextMeta?.label || card.instrumentId;
    article.querySelector(".card-subtitle").textContent = nextMeta ? `${nextMeta.category} | ${nextMeta.unit}` : "";
    if (card.referenceInstrumentId === card.instrumentId) {
      card.referenceInstrumentId = "usd";
    }
    article.querySelector(".card-reference").innerHTML = buildReferenceOptions(card.referenceInstrumentId, card.instrumentId);
    refreshCard(card.id, false);
  });
  article.querySelector(".card-period").addEventListener("change", (event) => {
    card.period = event.target.value;
    saveState();
    refreshCard(card.id, false);
  });
  article.querySelector(".card-interval").addEventListener("change", (event) => {
    card.interval = event.target.value;
    saveState();
    refreshCard(card.id, false);
  });
  article.querySelector(".card-reference").addEventListener("change", (event) => {
    card.referenceInstrumentId = event.target.value;
    saveState();
    refreshCard(card.id, false);
  });

  return article;
}

function createComparisonCard(card) {
  const article = buildCardShell(card, "Comparison Chart", "Shared time axis with per-series scaling");
  article.insertAdjacentHTML(
    "beforeend",
    `
      <div class="card-controls">
        <label class="field">
          <span>Interval</span>
          <select class="card-interval">${buildSelectOptions(cardIntervals, card.interval || "1d")}</select>
        </label>
        <label class="field">
          <span>Period</span>
          <select class="card-period">${buildSelectOptions(cardPeriods, card.period || "1y")}</select>
        </label>
        <div class="field">
          <span>Scale</span>
          <button class="secondary-button auto-scale">Auto fit</button>
        </div>
      </div>
      <details class="field" open>
        <summary>Select instruments</summary>
        <div class="check-list comparison-selector"></div>
      </details>
      <div class="chart-host"></div>
      <div class="series-list"></div>
    `
  );

  const selector = article.querySelector(".comparison-selector");
  selector.innerHTML = appState.catalog
    .map((item) => {
      const checked = (card.instruments || []).includes(item.instrument_id) ? "checked" : "";
      return `<label><input type="checkbox" value="${item.instrument_id}" ${checked}/> ${item.label}</label>`;
    })
    .join("");

  selector.addEventListener("change", () => {
    card.instruments = Array.from(selector.querySelectorAll("input:checked")).map((input) => input.value);
    saveState();
    refreshCard(card.id, false);
  });
  article.querySelector(".card-period").addEventListener("change", (event) => {
    card.period = event.target.value;
    saveState();
    refreshCard(card.id, false);
  });
  article.querySelector(".card-interval").addEventListener("change", (event) => {
    card.interval = event.target.value;
    saveState();
    refreshCard(card.id, false);
  });
  article.querySelector(".auto-scale").addEventListener("click", async () => {
    if (!card.instruments || card.instruments.length === 0) {
      refreshCard(card.id, false);
      return;
    }
    const button = article.querySelector(".auto-scale");
    setButtonLoading(button, true, "Auto fit");
    try {
      const payload = await fetchBatch({ instrumentIds: card.instruments || [], period: card.period, interval: card.interval });
      card.scales = autoScaleMap(payload.items);
      saveState();
      await refreshCard(card.id, false, payload.items);
    } finally {
      setButtonLoading(button, false, "Auto fit");
    }
  });

  return article;
}

function mountCard(card) {
  const article = card.type === "comparison" ? createComparisonCard(card) : createInstrumentCard(card);
  cardGrid.appendChild(article);
  cardElements.set(card.id, article);
  if (fullscreenCardId) {
    setFullscreen(fullscreenCardId);
  }
}

function renderCatalog() {
  instrumentCatalog.innerHTML = appState.catalog
    .map((item) => {
      const downloadState = getDownloadState(item.instrument_id);
      const statusClass = downloadState.status === "loading" ? "is-loading" : downloadState.status === "success" ? "is-success" : downloadState.status === "error" ? "is-error" : "";
      const progress = Math.max(0, Math.min(100, Number(downloadState.progress || 0)));
      return `
        <div class="catalog-item ${statusClass}" data-instrument-id="${item.instrument_id}">
          <div class="title">${escapeHtml(item.label)}</div>
          <div class="meta">${escapeHtml(item.category)} | ${escapeHtml(item.unit)}</div>
          <div class="status">${escapeHtml(downloadState.message || "No local data yet.")}</div>
          <div class="catalog-actions">
            <button class="secondary-button catalog-scan" type="button">Scan Local</button>
            <button class="primary-button catalog-download" type="button">Download 5Y</button>
          </div>
          <div class="catalog-progress"><div class="catalog-progress-bar" style="width:${progress}%"></div></div>
        </div>
      `;
    })
    .join("");
  newCardInstrumentInput.innerHTML = appState.catalog.map((item) => `<option value="${item.instrument_id}">${item.label}</option>`).join("");
  Array.from(instrumentCatalog.querySelectorAll(".catalog-item")).forEach((node) => {
    node.querySelector(".catalog-scan").addEventListener("click", () => scanCatalogInstrument(node.dataset.instrumentId));
    node.querySelector(".catalog-download").addEventListener("click", () => syncCatalogInstrument(node.dataset.instrumentId));
  });
}

function rebuildWorkspace() {
  cardGrid.innerHTML = "";
  cardElements.clear();
  appState.cards.forEach((card) => mountCard(card));
}

async function refreshInstrumentCard(card, article) {
  const syncResult = await syncSeries({ instrumentId: card.instrumentId, period: "5y", interval: "1d" });
  const baseSeries = await fetchSeries({ instrumentId: card.instrumentId, period: card.period, interval: card.interval || "1d" });
  const referenceSeries = await fetchReferenceSeries(card.referenceInstrumentId, card.period);
  const series = applyReferenceSeries(baseSeries, referenceSeries);
  article.querySelector(".metric-row").innerHTML = metricMarkup(series);
  renderSeriesChart(article.querySelector(".chart-host"), series, `${series.label} chart`);
  const referenceLabel = card.referenceInstrumentId === "usd" ? "USD" : getInstrumentMeta(card.referenceInstrumentId)?.label || card.referenceInstrumentId;
  article.querySelector(".chart-note").textContent = `${series.source} | ${syncResult.message} | priced in ${referenceLabel}`;
  renderTable(article.querySelector(".table-host"), baseSeries.table, instrumentColumns(baseSeries));
  updatedAt.textContent = `Last refresh: ${new Date(baseSeries.updated_at).toLocaleString()}`;
}

async function refreshComparisonCard(card, article, preloadedItems = null) {
  const chartHost = article.querySelector(".chart-host");
  const seriesListHost = article.querySelector(".series-list");
  if (!card.instruments || card.instruments.length === 0) {
    chartHost.innerHTML = `<div class="subtle">Select at least one instrument.</div>`;
    seriesListHost.innerHTML = "";
    return;
  }

  const syncInfo =
    preloadedItems ||
    (await syncBatch({ instrumentIds: card.instruments || [], period: "5y", interval: "1d" })).items;
  const rawItems = (await fetchBatch({ instrumentIds: card.instruments || [], period: card.period, interval: card.interval || "1d" })).items;
  const items = (rawItems || []).filter((item) => !item.error);
  const failedItems = (rawItems || []).filter((item) => item.error);
  if (!items || items.length === 0) {
    chartHost.innerHTML = `<div class="subtle">No data returned.</div>`;
    seriesListHost.innerHTML = failedItems.map((item) => `<div class="subtle">${item.label}: ${item.error}</div>`).join("");
    return;
  }

  card.scales = card.scales || {};
  const chartSeries = items.map((item, index) => {
    const scaleExp = Number(card.scales[item.instrument_id] ?? 0);
    const multiplier = multiplierFromExponent(scaleExp);
    return {
      ...item,
      color: seriesColors[index % seriesColors.length],
      multiplier,
      scaleExp,
      history: item.history.map((row) => ({ date: row.date, rawValue: Number(row.value), scaledValue: Number(row.value) * multiplier })),
    };
  });

  renderComparisonChart(chartHost, chartSeries, "Comparison view");
  updatedAt.textContent = `Last refresh: ${new Date().toLocaleString()}`;
  const syncNotes = (syncInfo || [])
    .filter((item) => item && item.message)
    .map((item) => `<div class="subtle">${item.label || item.instrument_id}: ${item.message}</div>`)
    .join("");
  seriesListHost.innerHTML = chartSeries
    .map(
      (series) => `
        <div class="series-item" data-series-id="${series.instrument_id}">
          <div class="series-item-header">
            <strong style="color:${series.color};">${series.label}</strong>
            <span class="subtle">${series.unit}</span>
          </div>
          <div class="scale-row">
            <input type="range" min="-8" max="8" step="0.1" value="${series.scaleExp}" />
            <span>x${series.multiplier.toExponential(2)}</span>
          </div>
        </div>
      `
    )
    .join("") + syncNotes + failedItems.map((item) => `<div class="subtle">${item.label}: ${item.error}</div>`).join("");

  Array.from(seriesListHost.querySelectorAll(".series-item")).forEach((node) => {
    const instrumentId = node.dataset.seriesId;
    const slider = node.querySelector("input");
    slider.addEventListener("input", () => {
      card.scales[instrumentId] = Number(slider.value);
      saveState();
      refreshComparisonCard(card, article, items);
    });
  });
}

async function refreshCard(cardId, manual, preloadedItems = null) {
  const card = cardById(cardId);
  const article = cardElements.get(cardId);
  if (!card || !article) return;

  const reloadButton = article.querySelector(".card-refresh");
  setButtonLoading(reloadButton, true, "Reload");
  setCardLoading(article, true);
  if (manual) {
    setStatus("Refreshing selected card...");
  }

  try {
    if (card.type === "comparison") {
      await refreshComparisonCard(card, article, preloadedItems);
    } else {
      await refreshInstrumentCard(card, article);
    }
  } catch (error) {
    console.error(error);
    article.querySelector(".chart-host").innerHTML = `<div class="subtle">Load failed: ${error.message}</div>`;
  } finally {
    setCardLoading(article, false);
    setButtonLoading(reloadButton, false, "Reload");
    if (manual) {
      setStatus("Card updated.");
    }
  }
}

async function syncCatalogInstrument(instrumentId) {
  const instrumentMeta = getInstrumentMeta(instrumentId);
  if (!instrumentMeta) return;
  if (getDownloadState(instrumentId).status === "loading") return;

  setStatus(`Updating ${instrumentMeta.label}...`);
  setDownloadState(instrumentId, { status: "loading", progress: 18, message: "Preparing download..." });

  try {
    const period = "5y";
    setDownloadState(instrumentId, { progress: 52, message: "Downloading latest market data..." });
    const result = await syncSeries({ instrumentId, period, interval: "1d" });
    updateCatalogRange(
      instrumentId,
      result.earliest_local_timestamp,
      result.latest_local_timestamp,
      formatRangeLabel(result.earliest_local_timestamp, result.latest_local_timestamp)
    );
    setStatus(`${instrumentMeta.label} updated.`);

    const relatedCards = appState.cards.filter((card) => card.type === "instrument" && card.instrumentId === instrumentId);
    for (const card of relatedCards) {
      await refreshCard(card.id, false);
    }
  } catch (error) {
    console.error(error);
    const latestKnownTimestamp = instrumentMeta.latest_local_timestamp || null;
    const earliestKnownTimestamp = instrumentMeta.earliest_local_timestamp || null;
    setDownloadState(instrumentId, {
      status: "error",
      progress: latestKnownTimestamp ? 100 : 0,
      message:
        latestKnownTimestamp
          ? `${formatRangeLabel(earliestKnownTimestamp, latestKnownTimestamp)} | ${error.message || "Download failed."}`
          : error.message || "Download failed.",
    });
    setStatus(`${instrumentMeta.label} update failed.`);
  }
}

async function scanCatalogInstrument(instrumentId) {
  const instrumentMeta = getInstrumentMeta(instrumentId);
  if (!instrumentMeta) return;
  setStatus(`Scanning local data for ${instrumentMeta.label}...`);
  try {
    const catalog = await fetchCatalog();
    appState.catalog = catalog.items || [];
    syncDownloadStateFromCatalog();
    renderCatalog();
    const refreshed = getInstrumentMeta(instrumentId);
    setStatus(`${instrumentMeta.label}: ${formatRangeLabel(refreshed?.earliest_local_timestamp, refreshed?.latest_local_timestamp)}`);
  } catch (error) {
    console.error(error);
    setStatus(`Scan failed for ${instrumentMeta.label}.`);
  }
}

async function scanAllCatalogInstruments() {
  setScanButtonLoading(true);
  setStatus("Scanning all local ranges...");
  try {
    const catalog = await fetchCatalog();
    appState.catalog = catalog.items || [];
    syncDownloadStateFromCatalog();
    renderCatalog();
    setStatus("All local ranges scanned.");
  } catch (error) {
    console.error(error);
    setStatus(`Scan failed: ${error.message}`);
  } finally {
    setScanButtonLoading(false);
  }
}

async function refreshAllCards(manual) {
  if (manual && appState.refreshQueueRunning) {
    appState.refreshQueueStopRequested = true;
    setStatus("Pausing downloads after current instrument...");
    setRefreshQueueButton();
    return;
  }

  if (manual) {
    appState.refreshQueueRunning = true;
    appState.refreshQueueStopRequested = false;
    setRefreshQueueButton();
    setStatus("Refreshing all cards...");
  }
  try {
    if (manual) {
      for (const item of appState.catalog) {
        await syncCatalogInstrument(item.instrument_id);
        if (appState.refreshQueueStopRequested) {
          setStatus("Downloads paused.");
          break;
        }
      }
    }
    for (const card of appState.cards) {
      await refreshCard(card.id, false);
    }
    if (!appState.refreshQueueStopRequested) {
      setStatus("All cards updated.");
    }
  } finally {
    if (manual) {
      appState.refreshQueueRunning = false;
      appState.refreshQueueStopRequested = false;
      setRefreshQueueButton();
    }
  }
}

async function boot() {
  loadState();
  try {
    const [settings, catalog] = await Promise.all([fetchSettings(), fetchCatalog()]);
    if (typeof appState.layoutMode !== "number") appState.layoutMode = settings.layout_mode || 2;
    if (!appState.refreshValue) appState.refreshValue = settings.refresh_value || 5;
    if (!appState.refreshUnit) appState.refreshUnit = settings.refresh_unit || "minute";
    appState.catalog = catalog.items || [];
    syncDownloadStateFromCatalog();
  } catch (error) {
    console.error(error);
    setStatus(`Bootstrap failed: ${error.message}`);
    return;
  }

  renderCatalog();
  refreshValueInput.value = String(appState.refreshValue);
  refreshUnitInput.value = appState.refreshUnit;
  setLayoutMode(Number(appState.layoutMode));
  rebuildWorkspace();

  Array.from(layoutModeGroup.querySelectorAll("button")).forEach((button) => {
    button.addEventListener("click", () => setLayoutMode(Number(button.dataset.columns)));
  });
  refreshValueInput.addEventListener("change", () => {
    appState.refreshValue = Number(refreshValueInput.value);
    updateAutoRefresh();
  });
  refreshUnitInput.addEventListener("change", () => {
    appState.refreshUnit = refreshUnitInput.value;
    updateAutoRefresh();
  });
  addCardButton.addEventListener("click", addCard);
  refreshButton.addEventListener("click", () => refreshAllCards(true));
  scanButton.addEventListener("click", scanAllCatalogInstruments);
  setRefreshQueueButton();
  setScanButtonLoading(false);

  updateAutoRefresh();
  await refreshAllCards(false);
}

boot();
