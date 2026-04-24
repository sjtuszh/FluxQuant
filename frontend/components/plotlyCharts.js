function axisColor() {
  return "#6B778C";
}

function commonXaxis() {
  return {
    title: "Time",
    color: axisColor(),
    gridcolor: "#E6EDF5",
    unifiedhovertitle: { text: "%{x}" },
    rangeslider: { visible: true, thickness: 0.12 },
    type: "date",
  };
}

export function shiftPlotWindow(container, direction = 1) {
  const layout = container?.layout;
  const range = layout?.xaxis?.range;
  if (!range || range.length < 2) return;
  const start = new Date(range[0]).getTime();
  const end = new Date(range[1]).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  const width = end - start;
  const delta = width * 0.35 * direction;
  Plotly.relayout(container, {
    "xaxis.range": [new Date(start + delta).toISOString(), new Date(end + delta).toISOString()],
  });
}

export function renderSeriesChart(container, series, title) {
  const trace = {
    x: series.history.map((row) => row.date),
    y: series.history.map((row) => row.value),
    type: "scatter",
    mode: "lines",
    line: { color: "#2563eb", width: 2.5 },
    hovertemplate: "%{x}<br>%{y:.3f}<extra>" + series.label + "</extra>",
    name: series.label,
  };

  const layout = {
    title: { text: title, font: { size: 15 } },
    margin: { l: 56, r: 20, t: 36, b: 52 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    xaxis: commonXaxis(),
    yaxis: { title: series.unit || "Value", color: axisColor(), gridcolor: "#E6EDF5" },
    hovermode: "x unified",
    showlegend: false,
  };

  Plotly.react(container, [trace], layout, { responsive: true, displayModeBar: false });
}

export function renderComparisonChart(container, seriesList, title) {
  const traces = seriesList.map((series) => ({
    x: series.history.map((row) => row.date),
    y: series.history.map((row) => row.scaledValue),
    customdata: series.history.map((row) => row.rawValue),
    type: "scatter",
    mode: "lines",
    line: { color: series.color, width: 2.5 },
    name: `${series.label} x${series.multiplier.toExponential(2)}`,
    hovertemplate: "%{customdata:.3f}<extra>" + series.label + "</extra>",
  }));

  const layout = {
    title: { text: title, font: { size: 15 } },
    margin: { l: 56, r: 20, t: 36, b: 52 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    xaxis: commonXaxis(),
    yaxis: { title: "Scaled Value", color: axisColor(), gridcolor: "#E6EDF5" },
    hovermode: "x unified",
    legend: { orientation: "h", y: -0.2 },
  };

  Plotly.react(container, traces, layout, { responsive: true, displayModeBar: false });
}
