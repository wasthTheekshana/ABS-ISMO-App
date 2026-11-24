/**
 * Labels every cell of a `table.register` with its column header (data-label), so the stylesheet can
 * turn each row into a stacked entry on a phone ("Site: Biyagama EPZ", "On duty: 22") without every
 * table having to repeat its headers in markup.
 *
 * Cells that span several columns (group subtotals, expanded detail rows) are left unlabelled.
 */

const tidy = (text) => {
  const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** One label per visual column, repeating a header that spans several columns. */
export const headerLabels = (table) => {
  const headerRow = table.querySelector('thead tr');
  if (!headerRow) return [];
  const labels = [];
  for (const th of headerRow.children) {
    const label = tidy(th.textContent || '');
    for (let i = 0; i < (th.colSpan || 1); i += 1) labels.push(label);
  }
  return labels;
};

export const labelTable = (table) => {
  const labels = headerLabels(table);
  if (labels.length === 0) return;
  for (const row of table.querySelectorAll('tbody tr')) {
    let column = 0;
    for (const cell of row.children) {
      const span = cell.colSpan || 1;
      if (span === 1 && labels[column] && cell.getAttribute('data-label') !== labels[column]) {
        cell.setAttribute('data-label', labels[column]);
      }
      column += span;
    }
  }
};

export const labelRegisters = (root = document) => {
  for (const table of root.querySelectorAll('table.register')) labelTable(table);
};

/** Labels tables now and whenever the page changes. Returns a function that stops watching. */
export const installRegisterLabels = (root = document.body) => {
  let queued = false;
  const run = () => {
    queued = false;
    labelRegisters(root);
  };
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  });
  observer.observe(root, { childList: true, subtree: true });
  run();
  return () => observer.disconnect();
};
