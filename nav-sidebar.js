// ============================================================
// nav-sidebar.js — Shared Navigation Sidebar
// ============================================================
// Injects a consistent navigation sidebar into every page.
// Behaviour is controlled by a data-nav-mode attribute on
// <body>: "persistent" (always visible) or "collapsed"
// (hamburger-toggled overlay). A page that also sets
// data-nav-open-from="<px>" is persistent on a window at least
// that wide and collapsed below it; the page picks the width at
// which the nav still leaves its own content room.
//
// The nav also shows two counts from the API: Plaid categories
// the user has not mapped (on Categories) and rows in the
// catch-all label (on Transactions).
//
// Pages with sub-navigation (e.g. User Settings) declare
// child items that expand/collapse beneath the parent link.
// A parent marked alwaysOpen is instead a link of its own, with
// its children always shown beneath it.
// ============================================================

/**
 * Sidebar configuration: defines every navigable page, its
 * icon, href, and optional children for sub-navigation.
 *
 * The `id` field is matched against the current page to set
 * the active state.
 */
const NAV_SIDEBAR_ITEMS = [
  { id: 'dashboard',    label: 'Dashboard',    icon: '🏠', href: 'index.html' },
  { id: 'transactions', label: 'Transactions', icon: '💳', href: 'transactions.html' },
  { id: 'investments',  label: 'Investments',  icon: '📈', href: 'investments.html' },
  { id: 'accounts',     label: 'Accounts',     icon: '🏦', href: 'accounts.html' },
  { id: 'bills',        label: 'Bills',        icon: '📋', href: 'bills.html' },
  {
    id: 'budget',
    label: 'Budget',
    icon: '🎯',
    href: 'budget.html',
    // Why: one click opens the report, and Targets stays one click away
    // from any page, so this row navigates instead of toggling.
    alwaysOpen: true,
    section: 'report',
    children: [
      { id: 'budget-targets', label: 'Targets', section: 'targets' },
    ]
  },
  { id: 'spending-alerts', label: 'Spending Alerts', icon: '🔔', href: 'spending-alerts.html' },
  {
    id: 'categories',
    label: 'Categories',
    icon: '🏷️',
    href: 'categories.html',
    children: [
      { id: 'cat-preview',    label: 'My Categories',      section: 'preview' },
      { id: 'cat-mappings',   label: 'Mappings',           section: 'mappings' },
      { id: 'cat-rules',      label: 'Rules Engine',       section: 'rules' },
      { id: 'cat-overrides',  label: 'Overrides',          section: 'overrides' },
      { id: 'cat-bulk',       label: 'Audit Log',          section: 'bulk-actions' },
      { id: 'cat-advanced',   label: 'Advanced / CSV',     section: 'advanced' },
    ]
  },
];

const NAV_SIDEBAR_FOOTER_ITEMS = [
  {
    id: 'user-settings',
    label: 'User Settings',
    icon: '⚙️',
    href: 'user-settings.html',
    children: [
      { id: 'settings-profile',    label: 'Profile Details',    section: 'profile' },
      { id: 'settings-password',   label: 'Change Password',    section: 'password' },
      { id: 'settings-twofa',      label: 'Two-Factor Auth',    section: 'twofa' },
      { id: 'settings-app-config', label: 'App Configuration',  section: 'app-config' },
      { id: 'settings-excel',      label: 'Excel Add-in',       section: 'excel-addin' },
    ]
  },
  { id: 'reset-all', label: 'Reset All Data', icon: '🔄', action: 'reset-all' },
  { id: 'logout', label: 'Logout', icon: '🚪', action: 'logout' },
];


// ── Current Page Detection ──────────────────────────────────
// Reads from <body data-nav-page="...">.
// Falls back to parsing the URL path so pages work even if
// the attribute is omitted.

function _detectCurrentPage() {
  const explicit = document.body.getAttribute('data-nav-page');
  if (explicit) return explicit;

  const path = window.location.pathname;
  const filename = path.substring(path.lastIndexOf('/') + 1) || 'index.html';

  const PAGE_MAP = {
    'index.html':         'dashboard',
    'transactions.html':  'transactions',
    'investments.html':   'investments',
    'accounts.html':      'accounts',
    'bills.html':              'bills',
    'budget.html':            'budget',
    'spending-alerts.html':   'spending-alerts',
    'categories.html':        'categories',
    'user-settings.html': 'user-settings',
  };

  return PAGE_MAP[filename] || 'dashboard';
}


// ── Build Sidebar HTML ──────────────────────────────────────

function _buildNavLink(item, currentPage) {
  const isActive = item.id === currentPage;
  const hasChildren = item.children && item.children.length > 0;
  // Why: on the user-settings page, parent is "active" and expanded
  const isParentActive = hasChildren && (
    isActive || item.children.some(child => child.id === currentPage)
  );

  let html = '';

  if (hasChildren && item.alwaysOpen) {
    html += _buildAlwaysOpenNavLink(item, currentPage);
  } else if (hasChildren) {
    const expandedClass = isParentActive ? ' expanded' : '';
    const activeClass = isParentActive ? ' active' : '';

    html += `<li>`;
    html += `<a class="nav-sidebar-link${activeClass}${expandedClass}" data-nav-id="${item.id}" data-has-children="true">`;
    html += `<span class="nav-icon">${item.icon}</span>`;
    html += `<span>${item.label}</span>`;
    html += `<span class="nav-chevron">▶</span>`;
    html += `</a>`;
    html += `<ul class="nav-sidebar-subnav${isParentActive ? ' expanded' : ''}">`;

    for (const child of item.children) {
      // Why: highlight the active sub-nav child for whichever page owns this group
      const isChildActive = currentPage === item.id &&
        _getActiveSection(currentPage) === child.section;
      html += `<li>`;
      html += `<a class="nav-sidebar-link${isChildActive ? ' active' : ''}" `;
      html += `data-nav-id="${child.id}" data-section="${child.section}" data-parent-page="${item.id}" `;
      html += `href="${item.href}#${child.section}">`;
      html += `<span>${child.label}</span>`;
      html += `</a></li>`;
    }

    html += `</ul></li>`;
  } else if (item.action) {
    html += `<li><a class="nav-sidebar-link${item.action === 'reset-all' ? ' nav-reset-all' : ''}" data-nav-id="${item.id}" data-action="${item.action}" href="#">`;
    html += `<span class="nav-icon">${item.icon}</span>`;
    html += `<span>${item.label}</span>`;
    html += `</a></li>`;
  } else {
    html += `<li><a class="nav-sidebar-link${isActive ? ' active' : ''}" data-nav-id="${item.id}" href="${item.href}">`;
    html += `<span class="nav-icon">${item.icon}</span>`;
    html += `<span>${item.label}</span>`;
    html += `</a></li>`;
  }

  return html;
}

/**
 * A parent row that is a link itself, with its children always shown.
 * It carries no data-has-children, so a click navigates (or, on its own
 * page, switches to its section) instead of toggling the list.
 */
function _buildAlwaysOpenNavLink(item, currentPage) {
  const isOnPage = item.id === currentPage;
  let html = `<li>`;
  html += `<a class="nav-sidebar-link nav-sidebar-link-open${isOnPage ? ' active' : ''}" `;
  html += `data-nav-id="${item.id}" data-section="${item.section}" data-parent-page="${item.id}" `;
  html += `href="${item.href}">`;
  html += `<span class="nav-icon">${item.icon}</span>`;
  html += `<span>${item.label}</span>`;
  html += `</a>`;
  html += `<ul class="nav-sidebar-subnav expanded">`;
  for (const child of item.children) {
    const isChildActive = isOnPage && _getActiveSection(currentPage) === child.section;
    html += `<li>`;
    html += `<a class="nav-sidebar-link${isChildActive ? ' active' : ''}" `;
    html += `data-nav-id="${child.id}" data-section="${child.section}" data-parent-page="${item.id}" `;
    html += `href="${item.href}#${child.section}">`;
    html += `<span>${child.label}</span>`;
    html += `</a></li>`;
  }
  html += `</ul></li>`;
  return html;
}

/**
 * Maps each page that has sub-nav panels to its default section.
 * Why: lets us detect the active child without hard-coding page
 * names in every helper.
 */
const _PANEL_PAGE_DEFAULTS = {
  'user-settings': 'profile',
  'categories':    'preview',
  'budget':        'report',
};

/**
 * Determines which sub-section is active for the current page
 * based on the URL hash, falling back to the page's default.
 */
function _getActiveSection(pageId) {
  const defaultSection = _PANEL_PAGE_DEFAULTS[pageId];
  if (!defaultSection) return null;
  const hash = window.location.hash.replace('#', '');
  return hash || defaultSection;
}


// ── Counts ──────────────────────────────────────────────────

// Wider numbers would crowd the label in a 220px nav.
const NAV_COUNT_CAP = 999;

/**
 * The text a count badge shows.
 * @param {number} count
 * @returns {string} Empty for zero, a negative, or not a number: no badge then.
 */
function countBadgeText(count) {
  const value = Number(count);
  if (!Number.isFinite(value) || value < 1) return '';
  const whole = Math.floor(value);
  return whole > NAV_COUNT_CAP ? `${NAV_COUNT_CAP}+` : String(whole);
}

function _navEscape(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A count badge, or nothing when the count shows none.
 * @param {number} count
 * @param {{title?: string, href?: string, className?: string}} [options] With
 *   href the badge is a link of its own.
 * @returns {string} HTML.
 */
function buildCountBadge(count, options = {}) {
  const text = countBadgeText(count);
  if (!text) return '';
  const classes = ['count-badge', options.className].filter(Boolean).join(' ');
  const title = options.title ? ` title="${_navEscape(options.title)}" aria-label="${_navEscape(options.title)}"` : '';
  if (options.href) {
    return `<a class="${classes}" href="${_navEscape(options.href)}"${title}>${text}</a>`;
  }
  return `<span class="${classes}"${title}>${text}</span>`;
}

/**
 * Read the nav-counts response. Anything missing or malformed counts as zero.
 * @param {Object} data
 * @returns {{unansweredCount: number, catchAllLabel: string, catchAllTransactions: number}}
 */
function readNavCounts(data) {
  const body = data || {};
  const wholeCount = value => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  };
  return {
    unansweredCount: wholeCount(body.unanswered_count),
    catchAllLabel: typeof body.catch_all_label === 'string' ? body.catch_all_label : '',
    catchAllTransactions: wholeCount(body.catch_all_transactions),
  };
}

/**
 * The Transactions page filtered to the catch-all label.
 * @param {string} catchAllLabel
 * @returns {string}
 */
function catchAllTransactionsHref(catchAllLabel) {
  return `transactions.html?category=${encodeURIComponent(catchAllLabel)}`;
}

/**
 * Whether the hamburger should carry its dot.
 * @param {{unansweredCount: number, catchAllLabel: string, catchAllTransactions: number}|null} counts
 * @returns {boolean} True when either count would show a badge.
 */
function navCountsNeedAttention(counts) {
  if (!counts) return false;
  const showsCatchAll = Boolean(counts.catchAllLabel) && countBadgeText(counts.catchAllTransactions) !== '';
  return countBadgeText(counts.unansweredCount) !== '' || showsCatchAll;
}

let _navCounts = null;
// Set once a page hands the nav fresher counts than the load-time call, so
// that call cannot land late and put back a count the user just cleared.
let _navCountsFromPage = false;

/**
 * Let a page that has just read the same numbers update the counts, so a
 * change made there shows without a reload.
 * @param {{unansweredCount?: number, catchAllLabel?: string, catchAllTransactions?: number}} partial
 */
function updateNavCounts(partial) {
  _navCountsFromPage = true;
  _navCounts = { ...readNavCounts({}), ...(_navCounts || {}), ...(partial || {}) };
  _renderNavCounts();
}

function _renderNavCounts() {
  const sidebar = document.getElementById('nav-sidebar');
  if (!sidebar || !_navCounts) return;
  const counts = _navCounts;

  sidebar.querySelectorAll('.count-badge').forEach(badge => badge.remove());
  sidebar.querySelectorAll('.has-count-link').forEach(item => item.classList.remove('has-count-link'));

  const categoriesLink = sidebar.querySelector('.nav-sidebar-link[data-nav-id="categories"]');
  if (categoriesLink) {
    const noun = counts.unansweredCount === 1 ? 'category' : 'categories';
    const badge = buildCountBadge(counts.unansweredCount, {
      title: `${counts.unansweredCount} new Plaid ${noun} to map`,
      className: 'count-badge-alert',
    });
    const chevron = categoriesLink.querySelector('.nav-chevron');
    if (badge && chevron) chevron.insertAdjacentHTML('beforebegin', badge);
    else if (badge) categoriesLink.insertAdjacentHTML('beforeend', badge);
  }

  const transactionsLink = sidebar.querySelector('.nav-sidebar-link[data-nav-id="transactions"]');
  if (transactionsLink && counts.catchAllLabel) {
    const noun = counts.catchAllTransactions === 1 ? 'transaction' : 'transactions';
    // A link of its own beside the row's link, since links cannot nest.
    const badge = buildCountBadge(counts.catchAllTransactions, {
      title: `${counts.catchAllTransactions} ${noun} in ${counts.catchAllLabel}. Show them.`,
      href: catchAllTransactionsHref(counts.catchAllLabel),
      className: 'count-badge-link',
    });
    if (badge) {
      transactionsLink.parentElement.classList.add('has-count-link');
      transactionsLink.insertAdjacentHTML('afterend', badge);
    }
  }

  const hamburger = document.getElementById('nav-hamburger');
  if (hamburger) {
    const needsAttention = navCountsNeedAttention(counts);
    hamburger.classList.toggle('has-alert', needsAttention);
    hamburger.setAttribute('aria-label', needsAttention ? 'Toggle navigation (has new counts)' : 'Toggle navigation');
  }
}

/**
 * Read the counts once per page load. A failure shows no counts and says
 * nothing: they are a pointer, not something a page needs to work. The nav
 * belongs to no page, so it makes this one call itself rather than through
 * a page's api.js, with the same session renewal those use.
 */
async function _loadNavCounts() {
  try {
    if (window.BACKEND_URL_PROMISE) await window.BACKEND_URL_PROMISE;
    const backendUrl = window.BACKEND_URL;
    const accessToken = localStorage.getItem('authToken');
    if (!backendUrl || !accessToken) return;

    const url = `${backendUrl}/api/categorization/nav-counts`;
    const request = sentToken => fetch(url, { headers: { 'Authorization': `Bearer ${sentToken}` } });
    let response = await request(accessToken);
    if (response.status === 401 && typeof renewSessionAfter401 === 'function') {
      const renewedToken = await renewSessionAfter401(accessToken);
      if (!renewedToken) return;
      response = await request(renewedToken);
    }
    if (!response.ok) return;
    const data = await response.json();
    if (_navCountsFromPage) return;
    _navCounts = readNavCounts(data);
    _renderNavCounts();
  } catch (_ignored) { /* no counts this load */ }
}


// ── Mode by Window Width ────────────────────────────────────

/**
 * Read a page's data-nav-open-from width.
 * @param {string|null} value
 * @returns {number} 0 when the page sets none or it is not a positive number.
 */
function navOpenFromWidth(value) {
  const width = parseInt(value, 10);
  return Number.isFinite(width) && width > 0 ? width : 0;
}

/**
 * Which mode a page with an open-from width takes on a window this wide.
 * @param {number} openFromWidth From navOpenFromWidth.
 * @param {number} viewportWidth
 * @returns {'persistent'|'collapsed'}
 */
function navModeForWidth(openFromWidth, viewportWidth) {
  return viewportWidth >= openFromWidth ? 'persistent' : 'collapsed';
}

function _applyNavMode(mode) {
  const body = document.body;
  if (body.getAttribute('data-nav-mode') === mode) return;
  body.setAttribute('data-nav-mode', mode);
  // An overlay left open would sit over the page once the nav is part of it.
  if (mode === 'persistent') _closeNavSidebar();
}

/**
 * Switch a page with an open-from width between the two modes as the window
 * crosses it. Runs as soon as this script loads, ahead of the page's own
 * scripts, so they lay out against the mode the window calls for.
 */
function _startNavModeByWidth() {
  const body = document.body;
  if (!body || typeof body.getAttribute !== 'function') return;
  const openFrom = navOpenFromWidth(body.getAttribute('data-nav-open-from'));
  if (!openFrom || typeof window.matchMedia !== 'function') return;

  const wideEnough = window.matchMedia(`(min-width: ${openFrom}px)`);
  const apply = () => _applyNavMode(navModeForWidth(openFrom, window.innerWidth));
  apply();
  wideEnough.addEventListener('change', apply);
}

_startNavModeByWidth();


// ── Inject Sidebar Into DOM ─────────────────────────────────

function initNavSidebar() {
  const currentPage = _detectCurrentPage();

  // Build sidebar markup
  let sidebarHtml = '';

  // Brand header
  sidebarHtml += `<div class="nav-sidebar-brand">`;
  sidebarHtml += `<img src="IAY favicon.png" alt="IAY Financial">`;
  sidebarHtml += `<span>IAY Financial</span>`;
  sidebarHtml += `</div>`;

  // Main links
  sidebarHtml += `<ul class="nav-sidebar-links">`;
  for (const item of NAV_SIDEBAR_ITEMS) {
    sidebarHtml += _buildNavLink(item, currentPage);
  }
  sidebarHtml += `</ul>`;

  // Footer links (settings + logout)
  sidebarHtml += `<ul class="nav-sidebar-footer">`;
  for (const item of NAV_SIDEBAR_FOOTER_ITEMS) {
    sidebarHtml += _buildNavLink(item, currentPage);
  }
  sidebarHtml += `</ul>`;

  // Create sidebar element
  const sidebar = document.createElement('nav');
  sidebar.className = 'nav-sidebar';
  sidebar.id = 'nav-sidebar';
  sidebar.innerHTML = sidebarHtml;

  // Create overlay (for collapsed mode)
  const overlay = document.createElement('div');
  overlay.className = 'nav-sidebar-overlay';
  overlay.id = 'nav-sidebar-overlay';

  // Create hamburger button (visible only in collapsed mode)
  const hamburger = document.createElement('button');
  hamburger.className = 'nav-hamburger';
  hamburger.id = 'nav-hamburger';
  hamburger.setAttribute('aria-label', 'Toggle navigation');
  hamburger.innerHTML = `<span class="nav-hamburger-icon"></span>`;

  // Insert into DOM as first children of body
  document.body.prepend(hamburger);
  document.body.prepend(overlay);
  document.body.prepend(sidebar);

  // Attach event listeners
  _attachNavSidebarEvents();

  // A page may already have handed over counts; otherwise ask the API. The
  // dashboard builds the nav again after a sign-in, possibly for another
  // user, so counts from before are dropped rather than shown.
  if (_navCountsFromPage) {
    _renderNavCounts();
  } else {
    _navCounts = null;
    _loadNavCounts();
  }

  // Why: when the user clicked a nav link on the previous page we
  // flagged the sidebar to stay visible so the transition doesn't
  // feel abrupt. Open it now and let mouseleave close it.
  _maybeKeepSidebarOpen();
}


// ── Event Handlers ──────────────────────────────────────────

function _attachNavSidebarEvents() {
  const sidebar = document.getElementById('nav-sidebar');
  const overlay = document.getElementById('nav-sidebar-overlay');
  const hamburger = document.getElementById('nav-hamburger');

  // Hamburger toggle
  hamburger.addEventListener('click', _toggleNavSidebar);

  // Overlay click closes sidebar
  overlay.addEventListener('click', _closeNavSidebar);

  // Escape key closes sidebar
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') _closeNavSidebar();
  });

  // Handle clicks on nav links
  sidebar.addEventListener('click', (event) => {
    const link = event.target.closest('.nav-sidebar-link');
    if (!link) return;

    // Logout action
    if (link.dataset.action === 'logout') {
      event.preventDefault();
      _handleNavLogout();
      return;
    }

    // Reset all data action
    if (link.dataset.action === 'reset-all') {
      event.preventDefault();
      _handleResetAllData();
      return;
    }

    // Parent item with children — toggle expand/collapse
    if (link.dataset.hasChildren === 'true') {
      event.preventDefault();
      _toggleSubNav(link);
      return;
    }

    // Sub-nav item on a page with panels — switch panel without navigation
    const currentPageId = _detectCurrentPage();
    // Why: a sub-link owned by another page must navigate there, not open
    // a same-named panel that this page does not have.
    const isOwnPageSection = link.dataset.parentPage === currentPageId;
    if (link.dataset.section && isOwnPageSection && _PANEL_PAGE_DEFAULTS[currentPageId]) {
      event.preventDefault();
      _switchPanel(link.dataset.section, currentPageId);
      _closeNavSidebar();
      return;
    }

    // Normal link — flag the sidebar to stay open on the next page
    // so it remains visible until the user moves their mouse away.
    // Why: closing immediately feels jarring when navigating between
    // persistent and collapsed pages; this lets the user orient.
    sessionStorage.setItem('nav-sidebar-keep-open', 'true');
  });
}


function _toggleNavSidebar() {
  const sidebar = document.getElementById('nav-sidebar');
  const overlay = document.getElementById('nav-sidebar-overlay');
  const isOpen = sidebar.classList.contains('open');

  if (isOpen) {
    _closeNavSidebar();
  } else {
    sidebar.classList.add('open');
    overlay.classList.add('visible');
  }
}


function _closeNavSidebar() {
  const sidebar = document.getElementById('nav-sidebar');
  const overlay = document.getElementById('nav-sidebar-overlay');

  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('visible');
  sessionStorage.removeItem('nav-sidebar-keep-open');
}


/**
 * If the previous page flagged "keep-open", auto-open the sidebar
 * in collapsed mode and close it once the mouse leaves.
 * Why: provides a smooth visual bridge when navigating from a
 * persistent-sidebar page to a collapsed-sidebar page.
 */
function _maybeKeepSidebarOpen() {
  const shouldKeepOpen = sessionStorage.getItem('nav-sidebar-keep-open');
  if (!shouldKeepOpen) return;

  const navMode = document.body.getAttribute('data-nav-mode');
  if (navMode !== 'collapsed') {
    // Persistent pages already show the sidebar — just clear the flag.
    sessionStorage.removeItem('nav-sidebar-keep-open');
    return;
  }

  const sidebar = document.getElementById('nav-sidebar');
  const overlay = document.getElementById('nav-sidebar-overlay');
  if (!sidebar) return;

  // Open the sidebar immediately on load
  sidebar.classList.add('open');
  if (overlay) overlay.classList.add('visible');

  // Close when the mouse leaves the sidebar area
  sidebar.addEventListener('mouseleave', function _autoClose() {
    _closeNavSidebar();
    sidebar.removeEventListener('mouseleave', _autoClose);
  });
}


function _toggleSubNav(parentLink) {
  const subNav = parentLink.nextElementSibling;
  if (!subNav || !subNav.classList.contains('nav-sidebar-subnav')) return;

  const isExpanded = subNav.classList.contains('expanded');

  if (isExpanded) {
    subNav.classList.remove('expanded');
    parentLink.classList.remove('expanded');
  } else {
    subNav.classList.add('expanded');
    parentLink.classList.add('expanded');
  }
}


/**
 * Switches the visible panel and updates active states in
 * both the sidebar sub-nav and the page's panel elements.
 * Works for any page that declares panels (user-settings,
 * categories, etc.).
 */
function _switchPanel(section, pageId) {
  // Update sub-nav active state
  const subNavLinks = document.querySelectorAll('.nav-sidebar-subnav .nav-sidebar-link');
  subNavLinks.forEach(link => {
    link.classList.toggle('active', link.dataset.section === section);
  });

  // Why: each page uses its own panel class so styles don't collide
  const panelClassMap = {
    'user-settings': '.settings-panel',
    'categories':    '.categories-panel',
    'budget':        '.budget-panel',
  };
  const panelSelector = panelClassMap[pageId] || '.settings-panel';

  const panels = document.querySelectorAll(panelSelector);
  panels.forEach(panel => {
    if (panel.id === section) {
      panel.classList.remove('hidden');
      panel.classList.add('active');
    } else {
      panel.classList.add('hidden');
      panel.classList.remove('active');
    }
  });

  // Notify the page so it can lazy-load section content
  if (typeof loadSectionContent === 'function') {
    loadSectionContent(section);
  }

  // Update URL hash without scrolling
  history.replaceState(null, '', `#${section}`);

  window.scrollTo(0, 0);
}


/**
 * Clears all localStorage and sessionStorage except auth
 * credentials (authToken, refreshToken, currentUser).
 * Reloads the page so the app rebuilds from backend data.
 */
function _handleResetAllData() {
  const confirmed = window.confirm(
    'This will clear ALL local data and caches.\n\n' +
    'Your login session will be preserved, but everything else ' +
    '(filters, preferences, cached data) will be wiped.\n\n' +
    'The page will reload and pull fresh data from the backend.\n\n' +
    'Continue?'
  );
  if (!confirmed) return;

  // Keys to preserve
  const PRESERVE_KEYS = ['authToken', 'refreshToken', 'currentUser'];
  const preserved = {};
  for (const key of PRESERVE_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) preserved[key] = value;
  }

  // Nuke everything
  localStorage.clear();
  sessionStorage.clear();

  // Restore auth credentials
  for (const [key, value] of Object.entries(preserved)) {
    localStorage.setItem(key, value);
  }

  // Clear all IndexedDB databases, then reload
  _clearAllIndexedDBs().then(() => {
    console.info('[NavSidebar] All data reset. Auth credentials preserved. Reloading…');
    window.location.reload();
  });
}


/**
 * Deletes every IndexedDB database the browser knows about.
 * Uses the modern indexedDB.databases() API where available,
 * falls back to a best-effort no-op on older browsers.
 */
function _clearAllIndexedDBs() {
  if (typeof indexedDB === 'undefined') return Promise.resolve();

  // Modern browsers expose databases()
  if (typeof indexedDB.databases === 'function') {
    return indexedDB.databases().then(dbs => {
      const deletions = dbs.map(db => new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(db.name);
        req.onsuccess = () => { console.debug('[NavSidebar] Deleted IndexedDB:', db.name); resolve(); };
        req.onerror   = () => { console.warn('[NavSidebar] Failed to delete IndexedDB:', db.name); resolve(); };
        req.onblocked = () => { console.warn('[NavSidebar] IndexedDB delete blocked:', db.name); resolve(); };
      }));
      return Promise.all(deletions);
    });
  }

  // Fallback: no databases() API — nothing we can enumerate
  console.debug('[NavSidebar] indexedDB.databases() not available; skipping IndexedDB clear');
  return Promise.resolve();
}


/**
 * Handles logout from the sidebar. Looks for the page's own
 * logout() function first, then falls back to clearing session
 * and redirecting.
 */
function _handleNavLogout() {
  if (typeof logout === 'function') {
    logout();
  } else {
    // Fallback: clear session and redirect to login
    sessionStorage.clear();
    window.location.href = 'index.html';
  }
}


// ── Auto-Initialize ─────────────────────────────────────────
// Why: pages that include this script get the sidebar automatically
// once the DOM is ready. The data-nav-mode attribute on <body>
// must be set before this script loads.

document.addEventListener('DOMContentLoaded', () => {
  // Only inject sidebar if the page has declared a nav mode.
  // Auth-only views (login, register) on index.html skip the sidebar.
  const navMode = document.body.getAttribute('data-nav-mode');
  if (!navMode) return;

  initNavSidebar();
});
