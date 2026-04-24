const storageKey = "fluxquant_market_workspace";

function defaultCards() {
  return [
    { id: crypto.randomUUID(), type: "instrument", instrumentId: "wti", period: "1y", interval: "1d", referenceInstrumentId: "usd" },
    { id: crypto.randomUUID(), type: "instrument", instrumentId: "ust_10y", period: "1y", interval: "1d", referenceInstrumentId: "usd" },
    {
      id: crypto.randomUUID(),
      type: "comparison",
      instruments: ["wti", "gold", "dxy"],
      period: "1y",
      interval: "1d",
      scales: {},
    },
  ];
}

export const appState = {
  layoutMode: 2,
  refreshValue: 5,
  refreshUnit: "minute",
  timerId: null,
  downloadRange: "5y",
  catalog: [],
  cards: defaultCards(),
  downloadState: {},
  refreshQueueRunning: false,
  refreshQueueStopRequested: false,
};

export function loadState() {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    Object.assign(appState, parsed);
    appState.downloadRange = ["1y", "5y", "10y", "20y"].includes(appState.downloadRange) ? appState.downloadRange : "5y";
    appState.cards = (appState.cards || []).map((card) => ({
      ...card,
      period: ["5d", "1m", "1y", "3y", "5y", "10y", "20y"].includes(card.period) ? card.period : "1y",
      interval: ["1d", "1w", "1m", "1q"].includes(card.interval) ? card.interval : "1d",
      referenceInstrumentId: card.type === "instrument" ? card.referenceInstrumentId || "usd" : card.referenceInstrumentId,
    }));
    if (!Array.isArray(appState.cards) || appState.cards.length === 0) {
      appState.cards = defaultCards();
    }
  } catch (error) {
    console.warn("Failed to restore workspace state", error);
  }
}

export function saveState() {
  const payload = {
    layoutMode: appState.layoutMode,
    refreshValue: appState.refreshValue,
    refreshUnit: appState.refreshUnit,
    downloadRange: appState.downloadRange,
    cards: appState.cards,
  };
  window.localStorage.setItem(storageKey, JSON.stringify(payload));
}
