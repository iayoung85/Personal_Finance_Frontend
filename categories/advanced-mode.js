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

function clearCSVDisplay() {
  document.getElementById('csv-preview-container').style.display = 'none';
  document.getElementById('csv-errors-container').style.display = 'none';
  document.getElementById('csv-success-container').style.display = 'none';
  document.getElementById('csv-file-name').textContent = 'No file selected';
  document.getElementById('csv-upload-btn').disabled = true;
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

async function uploadCategoriesCSV() {
  const fileInput = document.getElementById('csv-file-input');
  const file = fileInput.files[0];

  if (!file) {
    showStatus('Please select a CSV file first', 'error');
    return;
  }

  // Clear previous feedback
  document.getElementById('csv-errors-container').style.display = 'none';
  document.getElementById('csv-success-container').style.display = 'none';

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

    _displayCSVSuccess(data);
    showStatus('CSV uploaded successfully', 'success');
    setTimeout(() => clearStatus(), 3000);

    // Reload data after a brief delay so success message is visible
    setTimeout(() => {
      loadCategorizationData(true);
      clearCSVDisplay();
    }, 1500);
  } catch (error) {
    showStatus(`Upload error: ${error.message}`, 'error');
    console.error('CSV upload error:', error);
  }
}

// ── Feedback Display ───────────────────────────────────────

function _displayCSVErrors(data) {
  const errorsContainer = document.getElementById('csv-errors-container');
  const errorsList = document.getElementById('csv-errors-list');

  let errorHTML = '';

  if (data.validation_errors && Array.isArray(data.validation_errors)) {
    errorHTML = data.validation_errors
      .map(err => `<div style="margin: 5px 0;">• ${escapeHtml(err)}</div>`)
      .join('');
  } else if (data.error) {
    errorHTML = `<div>${escapeHtml(data.error)}</div>`;
  }

  if (data.errors_count) {
    errorHTML = `<div style="margin-bottom: 10px; font-weight: bold;">Total errors: ${data.errors_count}</div>` + errorHTML;
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

    document.getElementById('csv-file-name').textContent = `Selected: ${file.name}`;
    document.getElementById('csv-upload-btn').disabled = false;

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
