// ============================================================
// transactions/import/main.js — Import Wizard State Machine
// Owns wizard state, stepper rendering, step transitions,
// and open/close lifecycle. Loaded first among import scripts.
// ============================================================

// ── Wizard State ──────────────────────────────────────────────
let importWizardOpen = false;
let importCurrentStep = 0; // 0=upload, 1=accounts, 2=categories, 3=review
let importFile = null;     // Raw File object held for re-send on execute
let importFileBytes = null; // ArrayBuffer of the file for the execute call
let importAnalysis = null; // Analysis payload from /import/analyze

// Account mappings: { csvName: { action, target_account_id, lock_current_balance, new_account_config } }
let importAccountMappings = {};

// Category mappings: { csvName: { action, target_category, new_category_name, route_to_investment_trending } }
let importCategoryMappings = {};

// Last import report (stored so localStorage power-users can retrieve it)
let importLastReport = null;

// Tracks whether the current session was restored from localStorage,
// so the analyze callback can merge saved mappings instead of reinitializing.
let _importSavedFileName = null;
let _importSavedFileSize = null;
let _importSavedStep = null;

const IMPORT_PROGRESS_KEY = 'pf_import_wizard_progress';

const IMPORT_STEPS = [
  { key: 'upload',     label: 'Upload' },
  { key: 'accounts',   label: 'Accounts' },
  { key: 'categories', label: 'Categories' },
  { key: 'review',     label: 'Review' },
];

// ── Open / Close ──────────────────────────────────────────────

function openImportWizard() {
  _resetImportWizardInMemory();

  const restored = _loadImportProgress();
  if (restored) {
    importAnalysis = restored.analysis;
    importAccountMappings = restored.accountMappings || {};
    importCategoryMappings = restored.categoryMappings || {};
    _importSavedFileName = restored.fileName;
    _importSavedFileSize = restored.fileSize;
    _importSavedStep = restored.currentStep || 0;
  }

  importWizardOpen = true;
  const overlay = document.getElementById('import-wizard-overlay');
  overlay.classList.remove('hidden');
  _renderImportWizardStep();
}

function closeImportWizard() {
  importWizardOpen = false;
  const overlay = document.getElementById('import-wizard-overlay');
  overlay.classList.add('hidden');
  _resetImportWizardInMemory();
}

/** Clear in-memory state only — localStorage is intentionally preserved. */
function _resetImportWizardInMemory() {
  importCurrentStep = 0;
  importFile = null;
  importFileBytes = null;
  importAnalysis = null;
  importAccountMappings = {};
  importCategoryMappings = {};
  _importSavedFileName = null;
  _importSavedFileSize = null;
  _importSavedStep = null;
}

/** Full reset: clear everything including localStorage. */
function resetImportWizardFull() {
  _clearImportProgress();
  _resetImportWizardInMemory();
  importCurrentStep = 0;
  const overlay = document.getElementById('import-wizard-overlay');
  if (overlay && !overlay.classList.contains('hidden')) {
    _renderImportWizardStep();
  }
}

// ── Step Navigation ───────────────────────────────────────────

function importWizardNext() {
  if (importCurrentStep >= IMPORT_STEPS.length - 1) return;

  // Run validation for the current step before advancing
  if (importCurrentStep === 0 && !importAnalysis) return;
  if (importCurrentStep === 1 && !_validateAccountMappingsUI()) return;
  if (importCurrentStep === 2 && !_validateCategoryMappingsUI()) return;

  importCurrentStep++;
  _renderImportWizardStep();
}

function importWizardBack() {
  if (importCurrentStep <= 0) return;
  importCurrentStep--;
  _renderImportWizardStep();
}

function importWizardGoToStep(stepIndex) {
  // Only allow going back to completed steps
  if (stepIndex >= importCurrentStep) return;
  importCurrentStep = stepIndex;
  _renderImportWizardStep();
}

// ── Master Render ─────────────────────────────────────────────

function _renderImportWizardStep() {
  _renderImportStepper();
  _renderImportBody();
  _renderImportFooter();
  _saveImportProgress();
}

// ── Stepper ───────────────────────────────────────────────────

function _renderImportStepper() {
  const header = document.getElementById('import-wizard-header');
  let html = '<div class="import-stepper">';

  IMPORT_STEPS.forEach((step, index) => {
    const isActive = index === importCurrentStep;
    const isCompleted = index < importCurrentStep;
    const isClickable = isCompleted;

    let stepClass = 'import-step-item';
    if (isActive) stepClass += ' active';
    if (isCompleted) stepClass += ' completed clickable';

    const clickHandler = isClickable ? `onclick="importWizardGoToStep(${index})"` : '';
    const numberContent = isCompleted ? '✓' : (index + 1);

    html += `<div class="${stepClass}" ${clickHandler}>`;
    html += `  <span class="import-step-number">${numberContent}</span>`;
    html += `  <span class="import-step-label">${escapeHtml(step.label)}</span>`;
    html += '</div>';

    if (index < IMPORT_STEPS.length - 1) {
      const connectorClass = isCompleted ? 'import-step-connector completed' : 'import-step-connector';
      html += `<div class="${connectorClass}"></div>`;
    }
  });

  html += '</div>';
  html += '<button class="import-wizard-close" onclick="closeImportWizard()" title="Close">✕</button>';
  header.innerHTML = html;
}

// ── Body ──────────────────────────────────────────────────────

function _renderImportBody() {
  const body = document.getElementById('import-wizard-body');

  switch (importCurrentStep) {
    case 0:
      renderFileUploadStep(body);
      break;
    case 1:
      renderAccountMappingStep(body);
      break;
    case 2:
      renderCategoryMappingStep(body);
      break;
    case 3:
      renderReviewStep(body);
      break;
  }
}

// ── Footer ────────────────────────────────────────────────────

function _renderImportFooter() {
  const footer = document.getElementById('import-wizard-footer');
  const isFirstStep = importCurrentStep === 0;
  const isLastStep = importCurrentStep === IMPORT_STEPS.length - 1;
  const hasSavedProgress = !!localStorage.getItem(IMPORT_PROGRESS_KEY);

  let leftHtml = '<div class="import-footer-left">';
  if (!isFirstStep) {
    leftHtml += '<button class="import-btn import-btn-secondary" onclick="importWizardBack()">← Back</button>';
  }
  if (hasSavedProgress) {
    leftHtml += '<button class="import-btn import-btn-danger-text" onclick="resetImportWizardFull()">Start Over</button>';
  }
  leftHtml += '</div>';

  let rightHtml = '<div class="import-footer-right">';
  if (isLastStep) {
    const fileWarning = !importFileBytes
      ? ' title="Re-upload your file on the Upload step first" disabled'
      : '';
    rightHtml += `<button class="import-btn import-btn-primary" id="import-execute-btn" onclick="executeImportFromWizard()"${fileWarning}>Import Transactions</button>`;
  } else if (importCurrentStep === 0) {
    // Next button only enabled after analysis is complete
    const disabled = importAnalysis ? '' : 'disabled';
    rightHtml += `<button class="import-btn import-btn-primary" ${disabled} onclick="importWizardNext()">Next →</button>`;
  } else {
    rightHtml += '<button class="import-btn import-btn-primary" onclick="importWizardNext()">Next →</button>';
  }
  rightHtml += '</div>';

  footer.innerHTML = leftHtml + rightHtml;
}

// ── Loading State Helper ──────────────────────────────────────

function _showImportLoading(container, message) {
  container.innerHTML = `
    <div class="import-loading">
      <div class="import-spinner"></div>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

// ── localStorage Persistence ──────────────────────────────────

function _saveImportProgress() {
  if (!importAnalysis) return;

  const progress = {
    savedAt: new Date().toISOString(),
    fileName: importFile ? importFile.name : _importSavedFileName,
    fileSize: importFile ? importFile.size : _importSavedFileSize,
    analysis: importAnalysis,
    accountMappings: importAccountMappings,
    categoryMappings: importCategoryMappings,
    currentStep: importCurrentStep,
  };

  try {
    localStorage.setItem(IMPORT_PROGRESS_KEY, JSON.stringify(progress));
  } catch (_storageError) {
    // localStorage full or unavailable — non-critical
  }
}

function _loadImportProgress() {
  try {
    const raw = localStorage.getItem(IMPORT_PROGRESS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_parseError) {
    localStorage.removeItem(IMPORT_PROGRESS_KEY);
    return null;
  }
}

function _clearImportProgress() {
  localStorage.removeItem(IMPORT_PROGRESS_KEY);
}
