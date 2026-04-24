function formatCellValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(3);
  }
  if (typeof value === "string" && value !== "" && !Number.isNaN(Number(value))) {
    return Number(value).toFixed(3);
  }
  return value ?? "";
}

export function renderTable(container, rows, columns) {
  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="subtle">No table data</div>`;
    return;
  }

  const head = columns.map((column) => `<th>${column.label}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = columns.map((column) => `<td>${formatCellValue(row[column.key])}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  container.innerHTML = `
    <details class="table-details">
      <summary>Show Table</summary>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </details>
  `;
}
