// ============================================================
// shared/clipboard-table.js — copy a table so it pastes as cells
//
// Excel, Numbers, and Google Sheets split pasted plain text into
// cells on tabs, never on commas. A CSV string on the clipboard
// lands as one column of comma-filled text; the same table with
// tabs between fields lands as a grid. Downloads stay CSV; only
// the clipboard copy is converted.
// ============================================================

/**
 * Parse CSV text into rows of field strings.
 * Handles quoted fields, doubled quotes inside them, and line breaks
 * inside quotes. A trailing newline does not produce an empty last row.
 *
 * @param {string} csvText
 * @returns {string[][]}
 */
function parseCsvRows(csvText) {
  const rows = [];
  let row = [];
  let field = '';
  let insideQuotes = false;
  const text = csvText || '';

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (insideQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      insideQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  const hasUnfinishedRow = field !== '' || row.length > 0;
  if (hasUnfinishedRow) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Make one field safe to sit between tabs on the clipboard.
 * A tab or line break inside a field would start a new cell or row, so each
 * becomes a space. A field that opens with a quote is wrapped, because a
 * spreadsheet reads a leading quote as the start of a quoted cell and would
 * swallow the cells after it.
 *
 * @param {string} field
 * @returns {string}
 */
function _tsvField(field) {
  const flattened = String(field).replace(/[\t\r\n]+/g, ' ');
  if (flattened.startsWith('"')) {
    return `"${flattened.replace(/"/g, '""')}"`;
  }
  return flattened;
}

/**
 * Convert CSV text to tab-separated text for pasting into a spreadsheet.
 *
 * @param {string} csvText
 * @returns {string}
 */
function csvToTsv(csvText) {
  return parseCsvRows(csvText)
    .map(row => row.map(_tsvField).join('\t'))
    .join('\n');
}

/**
 * Put a CSV table on the clipboard in the form spreadsheets paste as cells.
 *
 * @param {string} csvText
 * @returns {Promise<void>} rejects when the browser refuses clipboard access
 */
function copyCsvAsCells(csvText) {
  return navigator.clipboard.writeText(csvToTsv(csvText));
}
