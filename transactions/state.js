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

// Chart state
let categoryChart = null;
let chartViewMode = 'primary'; // 'primary' or 'detailed'
let chartDrilldownPrimary = null; // When non-null, chart shows detailed breakdown for this primary category

// Pastel color palette for chart visualization
// Richer, more saturated palette that stays readable on a dark background
const PASTEL_COLORS = [
  '#5B9BD5', '#ED7D72', '#70C1B3', '#F6BD60', '#A78BFA',
  '#FF8C42', '#4ECDC4', '#F87171', '#38BDF8', '#FBBF24',
  '#C084FC', '#34D399', '#FB923C', '#60A5FA', '#E879F9',
  '#2DD4BF', '#F472B6', '#818CF8', '#A3E635', '#FCA5A5'
];

// Split transaction modal state
let currentSplitTransaction = null;
let splitRows = [];
let isEditingSplit = false;

// Balance ledger state — populated when a single account is selected
// Maps transaction ID (plaid or manual) to its running balance string
let balanceHistoryLookup = {};
let balanceHistoryLoading = false;

// Reconciliation banner state — populated by checkAndRenderReconciliationBanner()
let reconciliationStatus = null;

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
