import { renderTable } from "../components/dataTable.js";
import { renderComparisonChart, renderSeriesChart } from "../components/plotlyCharts.js";
import { fetchBatch, fetchCatalog, fetchSeries, fetchSettings } from "../services/marketApi.js";
import { appState, loadState, saveState } from "../store/appState.js";

const updatedAt = document.getElementById("updatedAt");
const refreshButton = document.getElementById("refreshButton");
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

function formatValue(value, digits = 3) {
  return Number(value).toFixed(digits);
}

function setStatus(text) {
  statusText.textContent = text;
}

function getInstrumentMeta(instrumentId) {
  return appState.catalog.find((item) => item.instrument_id === instrumentId);
}

function buildInstrumentOptions(selectedValue) {
  return appState.catalog
    .map((item) => {
      const selected = item.instrument_id === selectedValue ? "selected" : "";
      return `<option value="${item.instrument_id}" ${selected}>${item.label}</option>`;
    })
    .join("");
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
      ? { id: crypto.randomUUID(), type: "instrument", instrumentId: newCardInstrumentInput.value, period: "1mo", interval: "1d" }
      : { id: crypto.randomUUID(), type: "comparison", instruments: [newCardInstrumentInput.value], period: "3mo", interval: "1d", scales: {} };

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
  const changeClass = series.metrics.change > 0 ? "positive" : series.metrics.change < 0 ? "negative" : "";
  return `
    <div class="metric-box">
      <div class="label">Latest</div>
      <div class="value">${formatValue(series.metrics.latest)}</div>
    </div>
    <div class="metric-box">
      <div class="label">Change</div>
      <div class="value ${changeClass}">${series.metrics.change > 0 ? "+" : ""}${formatValue(series.metrics.change)}</div>
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
  const article = buildCardShell(card, meta?.label || card.instrumentId, meta ? `${meta.category} | ${meta.unit}` : "");
  const intervalOptions = (meta?.interval_options || ["1d"])
    .map((value) => `<option value="${value}" ${value === card.interval ? "selected" : ""}>${value}</option>`)
    .join("");

  article.insertAdjacentHTML(
    "beforeend",
    `
      <div class="card-controls">
        <label class="field">
          <span>Instrument</span>
          <select class="card-instrument">${buildInstrumentOptions(card.instrumentId)}</select>
        </label>
        <label class="field">
          <span>Period</span>
          <select class="card-period">
            <option value="5d" ${card.period === "5d" ? "selected" : ""}>5d</option>
            <option value="1mo" ${card.period === "1mo" ? "selected" : ""}>1mo</option>
            <option value="3mo" ${card.period === "3mo" ? "selected" : ""}>3mo</option>
            <option value="6mo" ${card.period === "6mo" ? "selected" : ""}>6mo</option>
            <option value="1y" ${card.period === "1y" ? "selected" : ""}>1y</option>
          </select>
        </label>
        <label class="field">
          <span>Interval</span>
          <select class="card-interval">${intervalOptions}</select>
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
    card.interval = "1d";
    saveState();
    const nextMeta = getInstrumentMeta(card.instrumentId);
    article.querySelector(".card-title").textContent = nextMeta?.label || card.instrumentId;
    article.querySelector(".card-subtitle").textContent = nextMeta ? `${nextMeta.category} | ${nextMeta.unit}` : "";
    const intervalSelect = article.querySelector(".card-interval");
    intervalSelect.innerHTML = (nextMeta?.interval_options || ["1d"]).map((value) => `<option value="${value}">${value}</option>`).join("");
  });
  article.querySelector(".card-period").addEventListener("change", (event) => {
    card.period = event.target.value;
    saveState();
  });
  article.querySelector(".card-interval").addEventListener("change", (event) => {
    card.interval = event.target.value;
    saveState();
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
          <span>Period</span>
          <select class="card-period">
            <option value="5d" ${card.period === "5d" ? "selected" : ""}>5d</option>
            <option value="1mo" ${card.period === "1mo" ? "selected" : ""}>1mo</option>
            <option value="3mo" ${card.period === "3mo" ? "selected" : ""}>3mo</option>
            <option value="6mo" ${card.period === "6mo" ? "selected" : ""}>6mo</option>
            <option value="1y" ${card.period === "1y" ? "selected" : ""}>1y</option>
          </select>
        </label>
        <label class="field">
          <span>Interval</span>
          <select class="card-interval">
            <option value="1d" ${card.interval === "1d" ? "selected" : ""}>1d</option>
            <option value="1h" ${card.interval === "1h" ? "selected" : ""}>1h</option>
            <option value="30m" ${card.interval === "30m" ? "selected" : ""}>30m</option>
            <option value="15m" ${card.interval === "15m" ? "selected" : ""}>15m</option>
          </select>
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
  });
  article.querySelector(".card-period").addEventListener("change", (event) => {
    card.period = event.target.value;
    saveState();
  });
  article.querySelector(".card-interval").addEventListener("change", (event) => {
    card.interval = event.target.value;
    saveState();
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
    .map((item) => `<div class="catalog-item"><div class="title">${item.label}</div><div class="meta">${item.category} | ${item.unit}</div></div>`)
    .join("");
  newCardInstrumentInput.innerHTML = appState.catalog.map((item) => `<option value="${item.instrument_id}">${item.label}</option>`).join("");
}

function rebuildWorkspace() {
  cardGrid.innerHTML = "";
  cardElements.clear();
  appState.cards.forEach((card) => mountCard(card));
}

async function refreshInstrumentCard(card, article) {
  const series = await fetchSeries({ instrumentId: card.instrumentId, period: card.period, interval: card.interval });
  article.querySelector(".metric-row").innerHTML = metricMarkup(series);
  renderSeriesChart(article.querySelector(".chart-host"), series, `${series.label} chart`);
  article.querySelector(".chart-note").textContent = `${series.source} | y-axis: ${series.unit} | hover for exact values`;
  renderTable(article.querySelector(".table-host"), series.table, instrumentColumns(series));
  updatedAt.textContent = `Last refresh: ${new Date(series.updated_at).toLocaleString()}`;
}

async function refreshComparisonCard(card, article, preloadedItems = null) {
  const chartHost = article.querySelector(".chart-host");
  const seriesListHost = article.querySelector(".series-list");
  if (!card.instruments || card.instruments.length === 0) {
    chartHost.innerHTML = `<div class="subtle">Select at least one instrument.</div>`;
    seriesListHost.innerHTML = "";
    return;
  }

  const items = preloadedItems || (await fetchBatch({ instrumentIds: card.instruments || [], period: card.period, interval: card.interval })).items;
  if (!items || items.length === 0) {
    chartHost.innerHTML = `<div class="subtle">No data returned.</div>`;
    seriesListHost.innerHTML = "";
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
    .join("");

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

async function refreshAllCards(manual) {
  if (manual) {
    setButtonLoading(refreshButton, true, "Refresh");
    setStatus("Refreshing all cards...");
  }
  try {
    for (const card of appState.cards) {
      await refreshCard(card.id, false);
    }
    setStatus("All cards updated.");
  } finally {
    if (manual) {
      setButtonLoading(refreshButton, false, "Refresh");
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

  updateAutoRefresh();
  await refreshAllCards(false);
}

boot();
