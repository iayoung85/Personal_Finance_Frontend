// ============================================================
// transactions/state.js — Shared UI/Data State
// Single source of truth for all mutable state used across
// transaction page modules. Loaded first via <script> tag.
// ============================================================

// Core data arrays
let accounts = [];
let transactions = [];
let visibleTransactions = []; // Transactions currently shown in the table (post all active filters)
let availableCategories = [];
let plaidTaxonomy = []; // Plaid PFCv2 category taxonomy for parsing

// Account selection state
let selectedAccountMode = 'all'; // 'all' or 'single'
let selectedAccountId = null; // The account_id when mode is not 'all'

// Category filter state
let filterPrimaryCategory = '';
let filterDetailedCategory = '';

// Search state — raw query string and pre-parsed token array
let searchQuery = '';
let searchTokens = [];

// Auth state
let token = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

// Split transaction modal state
let currentSplitTransaction = null;
let splitRows = [];
let isEditingSplit = false;

// Balance ledger state — populated when a single account is selected
// Maps transaction ID (plaid or manual) to its running balance string
let balanceHistoryLookup = {};
let balanceHistoryLoading = false;

// Rows dated after the day the ledger last agreed with the bank are
// highlighted in the table while this is set: {accountId, afterDate}.
let bankSuspectHighlight = null;

// Scroll position cache — remembers where the user was scrolled to
// per view so switching between accounts preserves position.
// Key: accountId string or 'all'.  Value: scrollTop number.
let _scrollPositionCache = {};

// Debounce timer for sidebar account selection. When users arrow-key
// through accounts rapidly, only the last account they settle on
// triggers the balance-history fetch and table re-render.
let _sidebarSelectDebounceTimer = null;
const SIDEBAR_SELECT_DEBOUNCE_MS = 250;

// Virtual scroll: data-driven hidden transaction tracking so batch-unhide
// works correctly even when off-screen rows are not in the DOM.
let _hiddenTxnIdSet = new Set();
let _selectedHiddenTxnIds = new Set();

// Bulk-edit selection state (TXN-018). Mode flips on via the "Bulk modify"
// toolbar button; the same selection set persists across filter / search /
// account changes and only clears on Cancel, successful Apply, or page leave.
const BULK_EDIT_MAX_SELECTION = 500;
const bulkEditState = {
  active: false,
  selectedIds: new Set(),
  preflight: null,
  applying: false,
};
