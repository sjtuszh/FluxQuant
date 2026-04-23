export function renderTable(container, rows, columns) {
  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="subtle">No table data</div>`;
    return;
  }

  const head = columns.map((column) => `<th>${column.label}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = columns.map((column) => `<td>${row[column.key] ?? ""}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}
