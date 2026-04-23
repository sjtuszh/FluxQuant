const storageKey = "fluxquant_market_workspace";

function defaultCards() {
  return [
    { id: crypto.randomUUID(), type: "instrument", instrumentId: "wti", period: "1mo", interval: "1d" },
    { id: crypto.randomUUID(), type: "instrument", instrumentId: "ust_10y", period: "1mo", interval: "1d" },
    {
      id: crypto.randomUUID(),
      type: "comparison",
      instruments: ["wti", "gold", "dxy"],
      period: "3mo",
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
  catalog: [],
  cards: defaultCards(),
};

export function loadState() {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    Object.assign(appState, parsed);
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
    cards: appState.cards,
  };
  window.localStorage.setItem(storageKey, JSON.stringify(payload));
}
