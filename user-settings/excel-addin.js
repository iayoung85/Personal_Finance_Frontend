// ============================================================
// user-settings/excel-addin.js — Excel Add-in Panel
// Offers the add-in's manifest for download and the steps to
// install it in Excel on the Mac and on Windows.
// ============================================================

/**
 * Which manifest this page should hand out. The dev manifest points Excel at
 * the panel served from this computer, so it is only right on the dev API.
 *
 * @param {boolean} onDevBackend - whether the page is talking to the dev API
 * @returns {{href: string, downloadName: string, addinName: string, isDev: boolean}}
 */
function excelManifestForBackend(onDevBackend) {
  if (onDevBackend) {
    return {
      href: 'excel/manifest-dev.xml',
      downloadName: 'IAY-Financial-dev-manifest.xml',
      addinName: 'IAY Financial (dev)',
      isDev: true,
    };
  }
  return {
    href: 'excel/manifest.xml',
    downloadName: 'IAY-Financial-manifest.xml',
    addinName: 'IAY Financial',
    isDev: false,
  };
}

/**
 * Build the panel's markup for one manifest.
 *
 * @param {{href: string, downloadName: string, addinName: string, isDev: boolean}} manifest
 * @returns {string}
 */
function buildExcelAddinHtml(manifest) {
  const devNote = manifest.isDev
    ? `<p class="text-muted">You are on the dev API, so this is the dev manifest. Its panel loads from this computer and only works while the dev servers are running.</p>`
    : '';

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Get the manifest</h3>
      </div>
      <p class="text-muted">The add-in is a side panel inside Excel. It pastes your account balances and category summary into your workbook, lists what your lookups will miss, and moves budget targets between a sheet and the app. Excel finds it through one small file, the manifest.</p>
      ${devNote}
      <div class="flex-group">
        <a class="btn btn-primary addin-download" href="${manifest.href}" download="${manifest.downloadName}">Download manifest</a>
      </div>
      <p class="text-muted">The file only tells Excel where the panel lives. The panel updates with this site, so you install the manifest once per computer.</p>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Install on a Mac</h3>
      </div>
      <ol class="addin-steps">
        <li>In Finder, press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> and go to <code class="addin-path">~/Library/Containers/com.microsoft.Excel/Data/Documents</code>.</li>
        <li>Open the <code class="addin-path">wef</code> folder there. Create it if it is missing.</li>
        <li>Move the downloaded manifest into <code class="addin-path">wef</code>.</li>
        <li>Quit Excel with <kbd>Cmd</kbd>+<kbd>Q</kbd> and open it again.</li>
        <li>Open your workbook, then <strong>Home &gt; Add-ins</strong>, and pick <strong>${manifest.addinName}</strong> under Developer Add-ins.</li>
      </ol>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Install on Windows</h3>
      </div>
      <ol class="addin-steps">
        <li>Put the downloaded manifest in a folder of its own and share that folder: right-click it, then <strong>Properties &gt; Sharing &gt; Share</strong>. Note its network path, which looks like <code class="addin-path">\\\\YOUR-PC\\addins</code>.</li>
        <li>In Excel, open <strong>File &gt; Options &gt; Trust Center &gt; Trust Center Settings &gt; Trusted Add-in Catalogs</strong>.</li>
        <li>Paste the network path into Catalog Url, press <strong>Add catalog</strong>, tick <strong>Show in Menu</strong>, and press OK.</li>
        <li>Close Excel and open it again.</li>
        <li>Open your workbook, then <strong>Home &gt; Add-ins &gt; More Add-ins &gt; Shared Folder</strong>, pick <strong>${manifest.addinName}</strong>, and press Add.</li>
      </ol>
    </div>
  `;
}

/** Render the Excel add-in panel. */
function loadExcelAddinSettings() {
  const manifest = excelManifestForBackend(isLocalDevBackend(BACKEND_URL));
  $('#excel-addin-content').html(buildExcelAddinHtml(manifest));
}
