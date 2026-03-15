// ============================================================
// transactions/import/file-upload.js — Step 0: File Upload
// Drag-and-drop file selection, backend analyze call,
// and analysis summary display.
// ============================================================

/**
 * Render the file upload step into the wizard body.
 */
function renderFileUploadStep(container) {
  let html = '';

  // If analysis is already done (user came back to this step), show summary
  if (importAnalysis && importFile) {
    html += _renderFileSelectedBadge();
    html += _renderAnalysisSummary();
    container.innerHTML = html;
    return;
  }

  // Restored from localStorage — have analysis/mappings but need fresh file
  if (importAnalysis && !importFile && _importSavedFileName) {
    html += _renderResumeProgressBanner();
    html += _renderUploadZoneHtml();
    container.innerHTML = html;
    _bindDragDropHandlers();
    return;
  }

  // Fresh start — upload zone
  html += `
    <div class="import-upload-zone" id="import-upload-zone"
         onclick="document.getElementById('import-file-input').click()">
      <div class="import-upload-zone-icon">📂</div>
      <div class="import-upload-zone-text">
        Drag & drop your file here, or click to browse
      </div>
      <div class="import-upload-zone-hint">
        Supports: Quicken CSV
      </div>
      <input type="file" id="import-file-input" accept=".csv,.json"
             style="display:none" onchange="_onImportFileSelected(event)">
    </div>
  `;

  container.innerHTML = html;
  _bindDragDropHandlers();
}

/**
 * Handle file selection from the input or drag-and-drop.
 */
function _onImportFileSelected(event) {
  const file = event.target.files ? event.target.files[0] : null;
  if (!file) return;
  _processImportFile(file);
}

function _processImportFile(file) {
  // Basic validation
  const maxSizeBytes = 50 * 1024 * 1024; // 50 MB
  if (file.size > maxSizeBytes) {
    _showImportUploadError('File exceeds 50 MB size limit.');
    return;
  }

  const validExtensions = ['.csv', '.json'];
  const fileExtension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (!validExtensions.includes(fileExtension)) {
    _showImportUploadError('Unsupported file type. Please upload a CSV or JSON file.');
    return;
  }

  importFile = file;

  // Read file bytes for later re-send on execute
  const reader = new FileReader();
  reader.onload = function (readEvent) {
    importFileBytes = readEvent.target.result;
    _analyzeImportFile();
  };
  reader.readAsArrayBuffer(file);
}

/**
 * Send the file to /import/analyze and process the response.
 */
async function _analyzeImportFile() {
  const body = document.getElementById('import-wizard-body');
  _showImportLoading(body, 'Analyzing file…');

  try {
    const formData = new FormData();
    formData.append('file', importFile);

    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/import/analyze`,
      { method: 'POST', body: formData }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Analysis failed');
    }

    importAnalysis = data;

    // If resuming from saved progress, merge the user's previous
    // mapping choices onto the fresh analysis instead of reinitializing.
    if (_importSavedFileName) {
      _mergeRestoredMappings(data);
      _importSavedFileName = null;
      _importSavedFileSize = null;
      _importSavedStep = null;
    } else {
      _initAccountMappingsFromAnalysis();
      _initCategoryMappingsFromAnalysis();
    }

    // Re-render the step with analysis results
    renderFileUploadStep(body);

    // Enable the Next button now that analysis is done
    _renderImportFooter();

  } catch (analyzeError) {
    importFile = null;
    importFileBytes = null;
    importAnalysis = null;

    let errorHtml = _renderUploadZoneHtml();
    errorHtml += `<div class="import-error-banner">${escapeHtml(analyzeError.message)}</div>`;
    body.innerHTML = errorHtml;
    _bindDragDropHandlers();
  }
}

function _initAccountMappingsFromAnalysis() {
  if (!importAnalysis || !importAnalysis.accounts) return;

  importAccountMappings = {};
  for (const csvAccount of importAnalysis.accounts) {
    importAccountMappings[csvAccount.csv_name] = { action: 'ignore' };
  }
}

/**
 * Pre-fill category mappings using the backend's suggestions.
 */
function _initCategoryMappingsFromAnalysis() {
  if (!importAnalysis || !importAnalysis.categories) return;

  importCategoryMappings = {};
  for (const category of importAnalysis.categories) {
    if (category.suggested_app_category) {
      importCategoryMappings[category.csv_name] = {
        action: 'map',
        target_category: category.suggested_app_category,
      };
    }
  }
}

/**
 * After re-analyzing a file during a resume, keep the user's previous
 * mapping choices for any CSV names that still appear in the fresh analysis.
 * New names get defaults (ignore for accounts, suggestion for categories).
 */
function _mergeRestoredMappings(freshAnalysis) {
  const freshAccountNames = new Set((freshAnalysis.accounts || []).map(acct => acct.csv_name));
  const mergedAccounts = {};

  for (const [csvName, mapping] of Object.entries(importAccountMappings)) {
    if (freshAccountNames.has(csvName)) {
      mergedAccounts[csvName] = mapping;
    }
  }
  for (const acct of (freshAnalysis.accounts || [])) {
    if (!mergedAccounts[acct.csv_name]) {
      mergedAccounts[acct.csv_name] = { action: 'ignore' };
    }
  }
  importAccountMappings = mergedAccounts;

  const freshCategoryNames = new Set((freshAnalysis.categories || []).map(cat => cat.csv_name));
  const mergedCategories = {};

  for (const [csvName, mapping] of Object.entries(importCategoryMappings)) {
    if (freshCategoryNames.has(csvName)) {
      mergedCategories[csvName] = mapping;
    }
  }
  for (const cat of (freshAnalysis.categories || [])) {
    if (!mergedCategories[cat.csv_name] && cat.suggested_app_category) {
      mergedCategories[cat.csv_name] = {
        action: 'map',
        target_category: cat.suggested_app_category,
      };
    }
  }
  importCategoryMappings = mergedCategories;
}

function _renderResumeProgressBanner() {
  const savedStep = _importSavedStep || 0;
  const stepLabel = IMPORT_STEPS[savedStep] ? IMPORT_STEPS[savedStep].label : 'Upload';
  const sizeLabel = _importSavedFileSize
    ? `(${(_importSavedFileSize / 1024).toFixed(1)} KB)`
    : '';

  return `
    <div class="import-resume-banner">
      <div class="import-resume-banner-icon">📋</div>
      <div class="import-resume-banner-text">
        <strong>Saved progress found</strong> for
        <em>${escapeHtml(_importSavedFileName || 'Unknown file')}</em> ${sizeLabel}<br>
        You were on the <strong>${escapeHtml(stepLabel)}</strong> step.
        Re-select your file below to continue, or use <strong>Start Over</strong> to begin a fresh import.
      </div>
    </div>
  `;
}

// ── Rendering Helpers ─────────────────────────────────────────

function _renderUploadZoneHtml() {
  return `
    <div class="import-upload-zone" id="import-upload-zone"
         onclick="document.getElementById('import-file-input').click()">
      <div class="import-upload-zone-icon">📂</div>
      <div class="import-upload-zone-text">
        Drag & drop your file here, or click to browse
      </div>
      <div class="import-upload-zone-hint">
        Supports: Quicken CSV
      </div>
      <input type="file" id="import-file-input" accept=".csv,.json"
             style="display:none" onchange="_onImportFileSelected(event)">
    </div>
  `;
}

function _renderFileSelectedBadge() {
  const sizeKB = (importFile.size / 1024).toFixed(1);
  return `
    <div class="import-file-selected">
      <span>📄</span>
      <span class="import-file-selected-name">${escapeHtml(importFile.name)}</span>
      <span class="import-file-selected-size">${sizeKB} KB</span>
      <button class="import-file-remove" onclick="_removeImportFile()" title="Remove file">✕</button>
    </div>
  `;
}

function _renderAnalysisSummary() {
  const analysis = importAnalysis;
  const accountCount = analysis.accounts ? analysis.accounts.length : 0;
  const categoryCount = analysis.categories ? analysis.categories.length : 0;
  const splitCount = analysis.split_group_count || 0;
  const discardedCount = analysis.discarded_rows || 0;

  let html = '<div class="import-analysis-summary">';

  html += _summaryCard(analysis.total_rows || 0, 'Total Rows Parsed');
  html += _summaryCard(accountCount, 'Accounts Found');
  html += _summaryCard(categoryCount, 'Categories Found');
  html += _summaryCard(splitCount, 'Split Groups');

  if (discardedCount > 0) {
    html += _summaryCard(discardedCount, 'Rows Discarded');
  }

  html += '</div>';

  // Format detected badge
  const formatLabel = _formatDisplayName(analysis.format_detected);
  html += `
    <div class="import-info-banner" style="margin-top: 16px;">
      <strong>Format detected:</strong> ${escapeHtml(formatLabel)}
      &nbsp;·&nbsp;Date format: ${escapeHtml(analysis.date_format_detected || 'auto')}
    </div>
  `;

  // Discarded rows detail
  if (discardedCount > 0 && analysis.discard_reasons) {
    html += '<div class="import-info-banner" style="margin-top: 8px;">';
    html += `<strong>${discardedCount} row(s) could not be parsed:</strong><br>`;
    const maxShown = 5;
    const reasons = analysis.discard_reasons.slice(0, maxShown);
    for (const reason of reasons) {
      html += `Row ${reason.row}: ${escapeHtml(reason.reason)}<br>`;
    }
    if (analysis.discard_reasons.length > maxShown) {
      html += `<em>…and ${analysis.discard_reasons.length - maxShown} more</em>`;
    }
    html += '</div>';
  }

  return html;
}

function _summaryCard(value, label) {
  return `
    <div class="import-summary-card">
      <div class="import-summary-card-value">${value}</div>
      <div class="import-summary-card-label">${escapeHtml(label)}</div>
    </div>
  `;
}

function _formatDisplayName(formatKey) {
  const names = {
    'quicken_csv': 'Quicken CSV',
    'app_csv': 'App CSV Export',
    'app_json': 'App JSON Export',
  };
  return names[formatKey] || formatKey || 'Unknown';
}

function _removeImportFile() {
  importFile = null;
  importFileBytes = null;
  importAnalysis = null;
  importAccountMappings = {};
  importCategoryMappings = {};
  _importSavedFileName = null;
  _importSavedFileSize = null;
  _importSavedStep = null;
  _clearImportProgress();

  const body = document.getElementById('import-wizard-body');
  renderFileUploadStep(body);
  _renderImportFooter();
}

function _showImportUploadError(message) {
  const body = document.getElementById('import-wizard-body');
  let html = _renderUploadZoneHtml();
  html += `<div class="import-error-banner">${escapeHtml(message)}</div>`;
  body.innerHTML = html;
  _bindDragDropHandlers();
}

// ── Drag & Drop ───────────────────────────────────────────────

function _bindDragDropHandlers() {
  const zone = document.getElementById('import-upload-zone');
  if (!zone) return;

  zone.addEventListener('dragover', (dragEvent) => {
    dragEvent.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', (dropEvent) => {
    dropEvent.preventDefault();
    zone.classList.remove('drag-over');
    const droppedFile = dropEvent.dataTransfer.files[0];
    if (droppedFile) {
      _processImportFile(droppedFile);
    }
  });
}
