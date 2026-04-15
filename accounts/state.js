// ============================================================
// accounts/state.js — Shared UI/Data State
// Single source of truth for mutable state used across the
// accounts page modules. Loaded first via <script> tag.
// ============================================================

// Auth state (mirrors transactions pattern)
let token = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

// Data caches
let banksCache = [];          // Array of bank objects (with nested accounts)
let accountsCache = [];       // Flat array of all accounts
let categoriesReference = {}; // Account categories + subcategories from /reference/categories

// UI selection state
let selectedBankId = null;    // null = "All Banks"
let selectedAccountId = null; // null = no account selected
let sidebarFilterText = '';   // Current text in the search/filter bar
let showArchivedAccounts = false; // Controls sidebar visibility of archived banks & accounts

// Pending confirmation action (used by confirm modal)
let pendingConfirmAction = null;

// Pending reset account (used by reset modal)
let pendingResetAccountId = null;

// ── Detail Cache ─────────────────────────────────────────────
// Caches individual account/bank detail responses so navigating
// back to a previously viewed item is instant instead of hitting
// the server again. Cleared on any mutation via reloadAndReselect().
const DETAIL_CACHE = new Map();
const DETAIL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Render-version counter: incremented each time a detail view is
// requested. When a fetch returns, if the counter has moved past
// the version that initiated the fetch the result is discarded —
// this prevents a slow response from overwriting a newer selection.
let _detailRenderVersion = 0;

// Debounce timer for detail-panel fetches. When users arrow-key
// through items rapidly, only the last item they settle on triggers
// a network call — intermediate items are skipped entirely.
let _detailDebounceTimer = null;
const DETAIL_DEBOUNCE_MS = 250;
