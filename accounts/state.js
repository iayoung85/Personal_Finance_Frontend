// ============================================================
// accounts/state.js — Shared UI/Data State
// Single source of truth for mutable state used across the
// accounts page modules. Loaded first via <script> tag.
// ============================================================

// Auth state (mirrors transactions pattern)
let token = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
let idleTimeout;
const IDLE_TIMEOUT = 30 * 60 * 1000;

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
