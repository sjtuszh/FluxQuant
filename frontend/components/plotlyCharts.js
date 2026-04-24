function axisColor() {
  return "#6B778C";
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
    xaxis: { title: "Time", color: axisColor(), gridcolor: "#E6EDF5" },
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
    xaxis: { title: "Time", color: axisColor(), gridcolor: "#E6EDF5", unifiedhovertitle: { text: "%{x}" } },
    yaxis: { title: "Scaled Value", color: axisColor(), gridcolor: "#E6EDF5" },
    hovermode: "x unified",
    legend: { orientation: "h", y: -0.2 },
  };

  Plotly.react(container, traces, layout, { responsive: true, displayModeBar: false });
}
