// ============================================================
// nav-sidebar.js — Shared Navigation Sidebar
// ============================================================
// Injects a consistent navigation sidebar into every page.
// Behaviour is controlled by a data-nav-mode attribute on
// <body>: "persistent" (always visible) or "collapsed"
// (hamburger-toggled overlay).
//
// Pages with sub-navigation (e.g. User Settings) declare
// child items that expand/collapse beneath the parent link.
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
    id: 'categories',
    label: 'Categories',
    icon: '🏷️',
    href: 'categories.html',
    children: [
      { id: 'cat-preview',    label: 'My Categories',      section: 'preview' },
      { id: 'cat-mappings',   label: 'Mappings',           section: 'mappings' },
      { id: 'cat-rules',      label: 'Rules Engine',       section: 'rules' },
      { id: 'cat-overrides',  label: 'Overrides',          section: 'overrides' },
      { id: 'cat-bulk',       label: 'Bulk Actions',       section: 'bulk-actions' },
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
      { id: 'settings-profile',  label: 'Profile Details',  section: 'profile' },
      { id: 'settings-password', label: 'Change Password',  section: 'password' },
      { id: 'settings-twofa',    label: 'Two-Factor Auth',  section: 'twofa' },
      { id: 'settings-deletion', label: 'Delete Account',   section: 'deletion' },
    ]
  },
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
    'bills.html':         'bills',
    'categories.html':    'categories',
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

  if (hasChildren) {
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
      html += `data-nav-id="${child.id}" data-section="${child.section}" `;
      html += `href="${item.href}#${child.section}">`;
      html += `<span>${child.label}</span>`;
      html += `</a></li>`;
    }

    html += `</ul></li>`;
  } else if (item.action === 'logout') {
    html += `<li><a class="nav-sidebar-link" data-nav-id="${item.id}" data-action="logout" href="#">`;
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
 * Maps each page that has sub-nav panels to its default section.
 * Why: lets us detect the active child without hard-coding page
 * names in every helper.
 */
const _PANEL_PAGE_DEFAULTS = {
  'user-settings': 'profile',
  'categories':    'preview',
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

    // Parent item with children — toggle expand/collapse
    if (link.dataset.hasChildren === 'true') {
      event.preventDefault();
      _toggleSubNav(link);
      return;
    }

    // Sub-nav item on a page with panels — switch panel without navigation
    const currentPageId = _detectCurrentPage();
    if (link.dataset.section && _PANEL_PAGE_DEFAULTS[currentPageId]) {
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
