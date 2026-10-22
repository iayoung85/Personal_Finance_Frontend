// ============================================================
// categories/advanced-mode.js — CSV Import / Export toggle,
// file preview, upload, download, error & success display
// ============================================================

/**
 * Legacy toggle — kept as no-op for backward compatibility.
 * The CSV card is now always visible inside its own "Advanced / CSV"
 * panel, so toggling is handled by the sidebar sub-nav instead.
 */
function toggleAdvancedMode() {
  // No-op: panel switching is handled by nav-sidebar.js
}

// The chosen file is kept here, not read back from the input, because the
// input is emptied after each pick so choosing the same file again fires
// `change` and re-runs the preview.
let csvChosenFile = null;

function clearCSVSuccess() {
  document.getElementById('csv-success-container').style.display = 'none';
}

function clearCSVDisplay() {
  clearCSVSuccess();
  resetCSVInputs();
}

// Clears the file and preview but leaves the success box, which stays until
// the user dismisses it.
function resetCSVInputs() {
  csvChosenFile = null;
  document.getElementById('csv-preview-container').style.display = 'none';
  document.getElementById('csv-errors-container').style.display = 'none';
  document.getElementById('csv-file-name').textContent = 'No file selected';
  document.getElementById('csv-plan-container').style.display = 'none';
  document.getElementById('csv-apply-btn').disabled = true;
  document.getElementById('csv-file-input').value = '';
}

// ── Hash Display ───────────────────────────────────────────

function updateCategoryHashDisplay() {
  const hashDisplay = document.getElementById('category-hash-display');
  const hashValue = document.getElementById('category-hash-value');
  if (!hashDisplay || !hashValue) return;

  if (categoryListHash) {
    hashValue.textContent = categoryListHash;
    hashDisplay.style.display = 'block';
  } else {
    hashDisplay.style.display = 'none';
  }
}

// ── Download ───────────────────────────────────────────────

async function downloadCategoriesCSV() {
  try {
    showStatus('Downloading CSV...', 'info');

    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/categorization/categories/csv`,
      { method: 'GET' }
    );

    if (!response.ok) {
      const errorData = await response.json();
      showStatus(`Download failed: ${errorData.error}`, 'error');
      return;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'category_mappings.csv';
    document.body.appendChild(anchor);
    anchor.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(anchor);

    showStatus('CSV downloaded successfully', 'success');
    setTimeout(() => clearStatus(), 3000);
  } catch (error) {
    showStatus(`Download error: ${error.message}`, 'error');
    console.error('CSV download error:', error);
  }
}

// ── Upload ─────────────────────────────────────────────────

/**
 * Ask the API what the chosen file would do, without applying it, and show
 * the plan. Apply stays disabled until the file is valid.
 */
async function previewCategoriesCSV() {
  const file = csvChosenFile;
  if (!file) return;

  document.getElementById('csv-errors-container').style.display = 'none';
  document.getElementById('csv-success-container').style.display = 'none';
  document.getElementById('csv-plan-container').style.display = 'none';
  document.getElementById('csv-apply-btn').disabled = true;

  try {
    showStatus('Checking CSV...', 'info');
    const formData = new FormData();
    formData.append('file', file);
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/categorization/categories/csv?dry_run=1`,
      { method: 'POST', body: formData }
    );
    const data = await response.json();

    if (!response.ok) {
      _displayCSVErrors(data);
      showStatus('CSV could not be checked', 'error');
      return;
    }

    _displayCSVPlan(data);
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      _displayCSVErrors({ validation_errors: data.errors, errors_count: data.errors.length });
    }
    document.getElementById('csv-apply-btn').disabled = !data.valid;
    showStatus(data.valid ? 'Review the preview, then apply' : 'CSV needs changes before it can be applied', data.valid ? 'info' : 'error');
  } catch (error) {
    showStatus(`Preview error: ${error.message}`, 'error');
    console.error('CSV preview error:', error);
  }
}

async function applyCategoriesCSV() {
  const file = csvChosenFile;

  if (!file) {
    showStatus('Please select a CSV file first', 'error');
    return;
  }

  document.getElementById('csv-errors-container').style.display = 'none';
  document.getElementById('csv-success-container').style.display = 'none';
  document.getElementById('csv-apply-btn').disabled = true;

  try {
    showStatus('Uploading CSV...', 'info');

    const formData = new FormData();
    formData.append('file', file);

    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/categorization/categories/csv`,
      {
        method: 'POST',
        body: formData
        // Why no Content-Type header: browser auto-sets multipart/form-data with the correct boundary
      }
    );

    const data = await response.json();

    if (!response.ok) {
      _displayCSVErrors(data);
      showStatus('CSV upload failed validation', 'error');
      return;
    }

    markTransactionCacheStale();
    document.getElementById('csv-plan-container').style.display = 'none';
    _displayCSVSuccess(data);
    showStatus('CSV uploaded successfully', 'success');
    setTimeout(() => clearStatus(), 3000);

    // Reload data after a brief delay so success message is visible
    setTimeout(() => {
      loadCategorizationData(true);
      resetCSVInputs();
    }, 1500);
  } catch (error) {
    document.getElementById('csv-apply-btn').disabled = false;
    showStatus(`Upload error: ${error.message}`, 'error');
    console.error('CSV upload error:', error);
  }
}

function _csvCellHTML(cell) {
  if (!cell.href) return escapeHtml(cell.text);
  return `<a href="${escapeHtml(cell.href)}" target="_blank" rel="noopener">${escapeHtml(cell.text)}</a>`;
}

function _inspectCell(row) {
  return row.inspectable ? { text: row.inspect.text, href: row.inspect.href } : { text: '' };
}

function _csvTableHTML(headers, rows) {
  const head = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows.map(cells => `<tr>${cells.map(c => (
    `<td class="${c.warn ? 'csv-plan-needs' : ''}">${_csvCellHTML(c)}</td>`
  )).join('')}</tr>`).join('');
  return `<table class="csv-plan-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function _displayCSVPlan(data) {
  const { labelRows, keyRows, movesNothing } = buildCsvPreviewRows(data);
  let html = '';

  if (movesNothing) {
    html = '<p>This upload moves no transactions.</p>';
  }
  if (labelRows.length > 0) {
    html += '<h5>Labels leaving your list</h5>' + _csvTableHTML(
      ['Label', 'Used by', 'Goes to', 'Decided by', ''],
      labelRows.map(row => [
        { text: row.label },
        { text: row.counts },
        { text: row.where, warn: row.needsLine },
        { text: row.how },
        _inspectCell(row),
      ])
    );
  }
  if (keyRows.length > 0) {
    html += '<h5>Plaid categories with past transactions on the old label</h5>' + _csvTableHTML(
      ['Plaid category', 'Label change', 'Transactions', 'Answer', ''],
      keyRows.map(row => [
        { text: row.key },
        { text: row.change },
        { text: String(row.transactions) },
        { text: row.answer, warn: row.needsLine },
        _inspectCell(row),
      ])
    );
  }

  document.getElementById('csv-plan-content').innerHTML = html;
  document.getElementById('csv-plan-container').style.display = 'block';
}

// ── Feedback Display ───────────────────────────────────────

/**
 * Split one API validation error into its explanation and the CSV lines the
 * user should add. The API joins them with newlines: first line is the
 * explanation, every following non-blank line is exact file text.
 * @param {string} error
 * @returns {{ text: string, linesToAdd: string[] }}
 */
function splitCSVError(error) {
  const parts = String(error).split('\n');
  const linesToAdd = parts.slice(1).filter(line => line.trim() !== '');
  return { text: parts[0], linesToAdd };
}

function _csvErrorItemHTML(error) {
  const { text, linesToAdd } = splitCSVError(error);
  let html = `<div class="csv-error-item">• ${escapeHtml(text)}`;
  if (linesToAdd.length > 0) {
    html += '<ul class="csv-error-lines">'
      + linesToAdd.map(line => `<li><code>${escapeHtml(line)}</code> <button type="button" class="csv-copy-line" data-line="${escapeHtml(line)}">Copy</button></li>`).join('')
      + '</ul>';
  }
  return html + '</div>';
}

function _displayCSVErrors(data) {
  const errorsContainer = document.getElementById('csv-errors-container');
  const errorsList = document.getElementById('csv-errors-list');

  let errorHTML = '';

  if (data.validation_errors && Array.isArray(data.validation_errors)) {
    errorHTML = data.validation_errors
      .map(_csvErrorItemHTML)
      .join('');
  } else if (data.error) {
    errorHTML = `<div>${escapeHtml(data.error)}</div>`;
  }

  if (data.errors_count) {
    errorHTML = `<div class="csv-error-total">Total errors: ${data.errors_count}</div>` + errorHTML;
  }

  errorsList.innerHTML = errorHTML;
  errorsContainer.style.display = 'block';
}

function _displayCSVSuccess(data) {
  const successContainer = document.getElementById('csv-success-container');
  const successContent = document.getElementById('csv-success-content');

  let successHTML = `
    <div style="margin: 5px 0;">Category mappings updated: <strong>${data.mappings_count}</strong> mappings</div>
    <div style="margin: 5px 0;">Custom categories updated: <strong>${data.custom_categories_count}</strong> categories</div>
  `;

  if (data.rules_migrated !== undefined && data.rules_migrated > 0) {
    successHTML += `<div style="margin: 5px 0;">Rules migrated: <strong>${data.rules_migrated}</strong> rules retargeted</div>`;
  }

  if (data.overrides_migrated !== undefined && data.overrides_migrated > 0) {
    successHTML += `<div style="margin: 5px 0;">Overrides migrated: <strong>${data.overrides_migrated}</strong> overrides retargeted</div>`;
  }

  describeCsvMoves(data).forEach(line => {
    successHTML += `<div style="margin: 5px 0;">${escapeHtml(line)}</div>`;
  });

  if (data.custom_categories && data.custom_categories.length > 0) {
    successHTML += `
      <div style="margin: 10px 0; padding: 8px; background: rgba(0,0,0,0.1); border-radius: 3px;">
        <strong>Custom categories:</strong><br>
        ${data.custom_categories.map(cat => `• ${escapeHtml(cat)}`).join('<br>')}
      </div>
    `;
  }

  successContent.innerHTML = successHTML;
  successContainer.style.display = 'block';
}

// ── CSV file-input listener (attached in main.js) ──────────

function _initCSVFileInput() {
  const fileInput = document.getElementById('csv-file-input');
  if (!fileInput) return;

  fileInput.addEventListener('change', function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    csvChosenFile = file;
    event.target.value = '';

    document.getElementById('csv-file-name').textContent = `Selected: ${file.name}`;
    previewCategoriesCSV();

    // Show first few lines as a preview
    const reader = new FileReader();
    reader.onload = function onCSVRead(readEvent) {
      const content = readEvent.target.result;
      const lines = content.split('\n').slice(0, 6); // header + 5 data rows
      document.getElementById('csv-preview-content').innerHTML = lines
        .map((line, idx) => `<div>${(idx + 1).toString().padStart(2, '0')}: ${escapeHtml(line)}</div>`)
        .join('');
      document.getElementById('csv-preview-container').style.display = 'block';
    };
    reader.readAsText(file);
  });
}

// Copy buttons sit inside the errors list, which is rebuilt on every check,
// so one listener on the container handles them all.
function _initCSVCopyButtons() {
  const list = document.getElementById('csv-errors-list');
  if (!list) return;
  list.addEventListener('click', async (event) => {
    const button = event.target.closest('.csv-copy-line');
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.dataset.line);
      button.textContent = 'Copied';
    } catch (copyError) {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  });
}
